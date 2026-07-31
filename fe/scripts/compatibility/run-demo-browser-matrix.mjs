import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'

const args = parseArgs(process.argv.slice(2))
const containerDist = requiredDirectory(args.containerDist, '--container-dist')
const legacyReport = readJson(requiredFile(args.legacyReport, '--legacy-report'))
const currentReport = readJson(requiredFile(args.currentReport, '--current-report'))
const outputPath = path.resolve(required(args.output, '--output'))
const concurrency = positiveInteger(args.concurrency || '6', '--concurrency')
const timeoutMs = positiveInteger(args.timeoutMs || '8000', '--timeout-ms')
const settleMs = positiveInteger(args.settleMs || '500', '--settle-ms')
const chromePath = path.resolve(args.chrome || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const stageRoot = path.join(containerDist, '.compatibility-matrix')
const profileRoot = fs.mkdtempSync('/tmp/dimina-browser-matrix.')

let chrome
let server
const clients = []

async function main() {
try {
	const modes = stageArtifacts()
	server = await startStaticServer(containerDist)
	chrome = await startChrome(chromePath, profileRoot)
	const targetClients = await Promise.all(
		Array.from({ length: concurrency }, () => createTargetClient(chrome.debugPort)),
	)
	clients.push(...targetClients)

	const cases = modes.flatMap(mode => mode.apps.flatMap(app =>
		app.source.pages.map(page => ({
			mode: mode.name,
			demoName: app.demoName,
			appId: app.appId,
			entryPath: app.path,
			page,
			root: app.pageRoots[page] || 'main',
			manifestPath: app.manifestPath,
		})),
	))
	const results = Array.from({ length: cases.length })
	let nextCase = 0
	let completed = 0

	await Promise.all(targetClients.map(async (client) => {
		while (true) {
			const index = nextCase++
			if (index >= cases.length) {
				return
			}
			results[index] = await runCase(client, cases[index], server.origin)
			completed += 1
			if (completed % 20 === 0 || completed === cases.length) {
				console.log(`Browser compatibility progress: ${completed}/${cases.length}`)
			}
		}
	}))

	const comparisons = compareModes(results)
	const summary = {
		caseCount: results.length,
		pagePairCount: comparisons.length,
		readyCount: results.filter(result => result.ready).length,
		timeoutCount: results.filter(result => !result.ready).length,
		asymmetricErrorPairCount: comparisons.filter(result => result.asymmetricErrors.length > 0).length,
		structuralDifferencePairCount: comparisons.filter(result => result.structuralDifferences.length > 0).length,
		setDataProbeCount: results.filter(result => result.setDataProbe?.applicable).length,
		setDataProbePassedCount: results.filter(result => result.setDataProbe?.passed).length,
	}
	const report = {
		createdAt: new Date().toISOString(),
		legacyCompilerRoot: legacyReport.compilerRoot,
		currentCompilerRoot: currentReport.compilerRoot,
		summary,
		comparisons,
		results,
	}
	fs.mkdirSync(path.dirname(outputPath), { recursive: true })
	fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
	console.log(`Browser compatibility report: ${outputPath}`)
	console.log(JSON.stringify(summary, null, 2))

	if (
		summary.timeoutCount > 0
		|| summary.asymmetricErrorPairCount > 0
		|| summary.setDataProbeCount !== summary.setDataProbePassedCount
	) {
		process.exitCode = 1
	}
}
finally {
	await Promise.all(clients.map(client => client.close()))
	if (chrome?.process.exitCode === null) {
		chrome.process.kill('SIGTERM')
		await new Promise(resolve => chrome.process.once('exit', resolve))
	}
	if (server) {
		await new Promise(resolve => server.server.close(resolve))
	}
	fs.rmSync(stageRoot, { recursive: true, force: true })
	fs.rmSync(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
}

function stageArtifacts() {
	assertSameDemoCorpus()
	fs.rmSync(stageRoot, { recursive: true, force: true })
	fs.mkdirSync(path.join(stageRoot, 'manifests'), { recursive: true })

	return [
		stageMode('legacy', legacyReport),
		stageMode('current', currentReport),
	]
}

function stageMode(name, report) {
	const artifactRoot = requiredDirectory(report.outputRoot, `${name} report outputRoot`)
	const linkPath = path.join(stageRoot, name)
	fs.symlinkSync(artifactRoot, linkPath, 'dir')

	return {
		name,
		apps: report.apps.map((app) => {
			const appConfig = readJson(path.join(artifactRoot, app.appId, 'main/app-config.json'))
			const pageRoots = Object.fromEntries(
				Object.entries(appConfig.modules || {}).map(([page, config]) => [page, config?.root || 'main']),
			)
			const manifestName = `${name}-${app.demoName}.json`
			const manifestPath = `/.compatibility-matrix/manifests/${manifestName}`
			fs.writeFileSync(path.join(stageRoot, 'manifests', manifestName), `${JSON.stringify({
				appId: app.appId,
				name: `${app.demoName} (${name})`,
				path: app.path,
				webBaseUrl: `/.compatibility-matrix/${name}/`,
			}, null, 2)}\n`)
			return {
				...app,
				manifestPath,
				pageRoots,
			}
		}),
	}
}

function assertSameDemoCorpus() {
	const legacyApps = new Map(legacyReport.apps.map(app => [app.demoName, app]))
	const currentApps = new Map(currentReport.apps.map(app => [app.demoName, app]))
	if (legacyApps.size !== currentApps.size) {
		throw new Error('Legacy and current reports contain a different number of demos')
	}

	for (const [name, legacyApp] of legacyApps) {
		const currentApp = currentApps.get(name)
		if (!currentApp
			|| legacyApp.appId !== currentApp.appId
			|| JSON.stringify(legacyApp.source.pages) !== JSON.stringify(currentApp.source.pages)) {
			throw new Error(`Legacy and current reports do not describe the same demo corpus: ${name}`)
		}
	}
}

async function runCase(client, testCase, origin) {
	const diagnostics = {
		consoleErrors: [],
		exceptions: [],
		httpErrors: [],
		networkFailures: [],
	}
	client.setDiagnostics(diagnostics)
	const manifestUrl = `${origin}${testCase.manifestPath}`
	let url
	if (testCase.root !== 'main') {
		await client.evaluate(`sessionStorage.setItem(${JSON.stringify(`dimina:manifest:${testCase.appId}`)}, ${JSON.stringify(manifestUrl)})`)
		url = `${origin}/?appId=${encodeURIComponent(testCase.appId)}&entry=${encodeURIComponent(testCase.entryPath)}&page=${encodeURIComponent(testCase.page)}`
	}
	else {
		url = `${origin}/?manifestUrl=${encodeURIComponent(testCase.manifestPath)}&entry=${encodeURIComponent(testCase.page)}`
	}
	const loaded = client.waitFor('Page.loadEventFired', timeoutMs)
	await client.send('Page.navigate', { url })
	await loaded.catch(() => null)

	const deadline = Date.now() + timeoutMs
	let snapshot
	while (Date.now() < deadline) {
		snapshot = await client.evaluate(readinessExpression()).catch(error => ({
			ready: false,
			evaluationError: error.message,
		}))
		if (snapshot?.ready) {
			await delay(settleMs)
			snapshot = await client.evaluate(readinessExpression()).catch(() => snapshot)
			break
		}
		await delay(80)
	}

	const setDataProbe = snapshot?.ready
		? await runSetDataProbe(client)
		: { applicable: false, passed: false }
	client.setDiagnostics(null)
	return {
		...testCase,
		url,
		ready: snapshot?.ready === true,
		snapshot,
		setDataProbe,
		diagnostics: normalizeDiagnostics(diagnostics, origin),
	}
}

async function runSetDataProbe(client) {
	const before = await client.evaluate(setDataProbeExpression(false))
	if (!before.applicable) {
		return before
	}

	await client.evaluate(setDataProbeExpression(true))
	const deadline = Date.now() + timeoutMs
	let after
	while (Date.now() < deadline) {
		after = await client.evaluate(setDataProbeExpression(false))
		if (after.afterMatches) break
		await delay(40)
	}

	return {
		applicable: true,
		passed: before.beforeMatches && after?.afterMatches === true,
		beforeText: before.text,
		afterText: after?.text || '',
	}
}

function setDataProbeExpression(click) {
	return `(() => {
		const iframes = document.querySelectorAll('.dimina-native-webview__window')
		const doc = iframes[iframes.length - 1]?.contentDocument
		const button = doc?.getElementById('update-values')
		const text = doc?.body?.innerText?.replace(/\\s+/g, ' ').trim() || ''
		const beforeTokens = [
			'2|5|4|0|0 /seen:2|5|4|-1|-1',
			'0|0|0|7|0 /seen:-1|-1|-1|7|-1',
			'0|0|0|11|1 /seen:-1|-1|-1|11|1',
		]
		const afterTokens = [
			'4|10|8|0|0 /seen:4|10|8|-1|-1',
			'0|0|0|13|0 /seen:-1|-1|-1|13|-1',
			'0|0|0|17|1 /seen:-1|-1|-1|17|1',
		]
		if (${click ? 'true' : 'false'} && button) button.click()
		return {
			applicable: Boolean(button),
			beforeMatches: beforeTokens.every(token => text.includes(token)),
			afterMatches: afterTokens.every(token => text.includes(token)),
			text,
		}
	})()`
}

function readinessExpression() {
	return `(() => {
		const iframes = document.querySelectorAll('.dimina-native-webview__window')
		const iframe = iframes[iframes.length - 1]
		const launch = document.querySelector('.dimina-mini-app__launch-screen')
		const doc = iframe?.contentDocument
		const body = doc?.body
		const nodes = body ? Array.from(body.querySelectorAll('*')) : []
		const text = body?.innerText?.replace(/\\s+/g, ' ').trim() || ''
		const tagCounts = {}
		for (const node of nodes) {
			const tag = node.tagName.toLowerCase()
			tagCounts[tag] = (tagCounts[tag] || 0) + 1
		}
		return {
			ready: Boolean(body?.hasAttribute('data-v-app') && launch?.style.display === 'none'),
			documentReadyState: doc?.readyState || null,
			vueMounted: Boolean(body?.hasAttribute('data-v-app')),
			launchDisplay: launch?.style.display || null,
			bodyElementCount: nodes.length,
			componentHostCount: nodes.filter(node => node.hasAttribute('data-dd-component-host')).length,
			legacyBindingNodeCount: nodes.filter(node => node._propBindings && Object.keys(node._propBindings).length > 0).length,
			textLength: text.length,
			textDigest: text,
			tagCounts,
		}
	})()`
}

function normalizeDiagnostics(diagnostics, origin) {
	const normalize = value => value
		.replaceAll(origin, '<origin>')
		.replace(/\/\.compatibility-matrix\/(?:legacy|current)\//g, '/.compatibility-matrix/<artifact>/')
		.replace(/(?:legacy|current)-([a-z0-9-]+\.json)/gi, '<artifact>-$1')
		.replace(/webview_[a-z0-9-]+/gi, 'webview_<id>')
		.replace(/bridge_[a-z0-9-]+/gi, 'bridge_<id>')
		.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>')
		.replace(/:\d+:\d+/g, ':<line>:<column>')
		.trim()
	const unique = values => [...new Set(values.map(normalize).filter(Boolean))].sort()
	return {
		consoleErrors: unique(diagnostics.consoleErrors),
		exceptions: unique(diagnostics.exceptions),
		httpErrors: unique(diagnostics.httpErrors),
		networkFailures: unique(diagnostics.networkFailures),
	}
}

function compareModes(results) {
	const byCase = new Map(results.map(result => [`${result.mode}:${result.demoName}:${result.page}`, result]))
	const currentResults = results.filter(result => result.mode === 'current')

	return currentResults.map((current) => {
		const legacy = byCase.get(`legacy:${current.demoName}:${current.page}`)
		const legacyErrors = diagnosticSet(legacy)
		const currentErrors = diagnosticSet(current)
		const asymmetricErrors = [
			...[...legacyErrors].filter(error => !currentErrors.has(error)).map(error => `legacy-only: ${error}`),
			...[...currentErrors].filter(error => !legacyErrors.has(error)).map(error => `current-only: ${error}`),
		]
		const structuralDifferences = []
		for (const key of ['bodyElementCount', 'componentHostCount', 'textLength']) {
			if (legacy?.snapshot?.[key] !== current.snapshot?.[key]) {
				structuralDifferences.push(`${key}: legacy=${legacy?.snapshot?.[key]} current=${current.snapshot?.[key]}`)
			}
		}
		if (legacy?.snapshot?.textDigest !== current.snapshot?.textDigest) {
			structuralDifferences.push('textDigest differs')
		}

		return {
			demoName: current.demoName,
			page: current.page,
			legacyReady: legacy?.ready === true,
			currentReady: current.ready,
			asymmetricErrors,
			structuralDifferences,
		}
	})
}

function diagnosticSet(result) {
	const diagnostics = result?.diagnostics || {}
	return new Set([
		...(diagnostics.consoleErrors || []).map(value => `console: ${value}`),
		...(diagnostics.exceptions || []).map(value => `exception: ${value}`),
		...(diagnostics.httpErrors || []).map(value => `http: ${value}`),
		...(diagnostics.networkFailures || []).map(value => `network: ${value}`),
	])
}

async function createTargetClient(debugPort) {
	const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })
	const target = await response.json()
	const client = await CdpClient.connect(target.webSocketDebuggerUrl)
	await Promise.all([
		client.send('Page.enable'),
		client.send('Runtime.enable'),
		client.send('Log.enable'),
		client.send('Network.enable'),
	])
	return client
}

class CdpClient {
	constructor(socket) {
		this.socket = socket
		this.sequence = 0
		this.pending = new Map()
		this.waiters = new Map()
		this.diagnostics = null
		socket.addEventListener('message', event => this.onMessage(JSON.parse(event.data)))
	}

	static async connect(url) {
		const socket = new WebSocket(url)
		await new Promise((resolve, reject) => {
			socket.addEventListener('open', resolve, { once: true })
			socket.addEventListener('error', reject, { once: true })
		})
		return new CdpClient(socket)
	}

	send(method, params = {}) {
		const id = ++this.sequence
		this.socket.send(JSON.stringify({ id, method, params }))
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
	}

	evaluate(expression) {
		return this.send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true,
		}).then((result) => {
			if (result.exceptionDetails) {
				throw new Error(result.exceptionDetails.text)
			}
			return result.result.value
		})
	}

	waitFor(method, timeout) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.removeWaiter(method, waiter)
				reject(new Error(`Timed out waiting for ${method}`))
			}, timeout)
			const waiter = (params) => {
				clearTimeout(timer)
				resolve(params)
			}
			const waiters = this.waiters.get(method) || []
			waiters.push(waiter)
			this.waiters.set(method, waiters)
		})
	}

	removeWaiter(method, waiter) {
		const waiters = this.waiters.get(method) || []
		this.waiters.set(method, waiters.filter(candidate => candidate !== waiter))
	}

	setDiagnostics(diagnostics) {
		this.diagnostics = diagnostics
		this.requests = new Map()
	}

	onMessage(message) {
		if (message.id) {
			const pending = this.pending.get(message.id)
			if (!pending) return
			this.pending.delete(message.id)
			if (message.error) pending.reject(new Error(message.error.message))
			else pending.resolve(message.result)
			return
		}

		const waiters = this.waiters.get(message.method) || []
		this.waiters.delete(message.method)
		for (const waiter of waiters) waiter(message.params)

		if (!this.diagnostics) return
		if (message.method === 'Runtime.exceptionThrown') {
			const details = message.params.exceptionDetails
			this.diagnostics.exceptions.push(details.exception?.description || details.text || '')
		}
		else if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
			this.diagnostics.consoleErrors.push(message.params.args
				.map(arg => arg.value ?? arg.description ?? '')
				.join(' '))
		}
		else if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) {
			this.diagnostics.consoleErrors.push(message.params.entry.text || '')
		}
		else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
			this.diagnostics.httpErrors.push(`${message.params.response.status} ${message.params.response.url}`)
		}
		else if (message.method === 'Network.loadingFailed') {
			const url = this.requests?.get(message.params.requestId) || ''
			if (message.params.errorText !== 'net::ERR_ABORTED') {
				this.diagnostics.networkFailures.push(`${message.params.errorText} ${url}`)
			}
		}
		else if (message.method === 'Network.requestWillBeSent') {
			this.requests?.set(message.params.requestId, message.params.request.url)
		}
	}

	async close() {
		if (this.socket.readyState === WebSocket.OPEN) {
			this.socket.close()
		}
	}
}

async function startChrome(executable, userDataDir) {
	if (!fs.existsSync(executable)) {
		throw new Error(`Chrome executable does not exist: ${executable}`)
	}
	const child = spawn(executable, [
		'--headless=new',
		'--remote-debugging-port=0',
		`--user-data-dir=${userDataDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-background-networking',
		'--disable-component-update',
		'--disable-domain-reliability',
		'--disable-sync',
		'--metrics-recording-only',
		'about:blank',
	], {
		stdio: ['ignore', 'ignore', 'pipe'],
	})
	const debugUrl = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('Timed out waiting for Chrome DevTools endpoint')), 10000)
		let stderr = ''
		child.stderr.on('data', (chunk) => {
			stderr += chunk
			const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
			if (match) {
				clearTimeout(timeout)
				resolve(match[1])
			}
		})
		child.once('exit', code => reject(new Error(`Chrome exited before startup with code ${code}: ${stderr}`)))
	})
	const { port } = new URL(debugUrl)
	return {
		process: child,
		debugPort: port,
	}
}

async function startStaticServer(root) {
	const server = http.createServer((request, response) => {
		try {
			const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
			const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
			const absolutePath = path.resolve(root, relativePath)
			if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
				response.writeHead(403).end('Forbidden')
				return
			}
			const stat = fs.statSync(absolutePath, { throwIfNoEntry: false })
			if (!stat?.isFile()) {
				response.writeHead(404).end('Not found')
				return
			}
			response.setHeader('Content-Type', contentType(absolutePath))
			response.setHeader('Cache-Control', 'no-store')
			fs.createReadStream(absolutePath).pipe(response)
		}
		catch (error) {
			response.writeHead(500).end(error.message)
		}
	})
	await new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	const address = server.address()
	return {
		server,
		origin: `http://127.0.0.1:${address.port}`,
	}
}

function contentType(file) {
	const types = {
		'.css': 'text/css',
		'.html': 'text/html',
		'.ico': 'image/x-icon',
		'.jpeg': 'image/jpeg',
		'.jpg': 'image/jpeg',
		'.js': 'text/javascript',
		'.json': 'application/json',
		'.png': 'image/png',
		'.svg': 'image/svg+xml',
		'.webp': 'image/webp',
	}
	return types[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function parseArgs(argv) {
	const parsed = {}
	for (let index = 0; index < argv.length; index += 2) {
		const token = argv[index]
		if (!token?.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
		const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
		parsed[key] = required(argv[index + 1], token)
	}
	return parsed
}

function required(value, label) {
	if (!value) throw new Error(`Missing required argument ${label}`)
	return value
}

function requiredDirectory(value, label) {
	const directory = path.resolve(required(value, label))
	if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
		throw new Error(`${label} is not a directory: ${directory}`)
	}
	return directory
}

function requiredFile(value, label) {
	const file = path.resolve(required(value, label))
	if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
		throw new Error(`${label} is not a file: ${file}`)
	}
	return file
}

function positiveInteger(value, label) {
	const number = Number.parseInt(value, 10)
	if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`)
	return number
}

function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

await main()
