import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = parseArgs(process.argv.slice(2))

if (args.single) {
	await buildSingleDemo(args)
}
else {
	buildDemoMatrix(args)
}

function buildDemoMatrix(options) {
	const compilerRoot = requiredDirectory(options.compilerRoot, '--compiler-root')
	const sourceRoot = requiredDirectory(options.sourceRoot, '--source-root')
	const outputRoot = path.resolve(required(options.outputRoot, '--output-root'))
	const reportPath = path.resolve(options.report || path.join(outputRoot, 'compatibility-report.json'))
	const demoNames = fs.readdirSync(sourceRoot, { withFileTypes: true })
		.filter(entry => entry.isDirectory() && fs.existsSync(path.join(sourceRoot, entry.name, 'app.json')))
		.map(entry => entry.name)
		.sort()

	fs.mkdirSync(outputRoot, { recursive: true })
	const apps = []

	for (const demoName of demoNames) {
		const resultPath = path.join(outputRoot, `.compat-${demoName}.json`)
		const result = spawnSync(process.execPath, [
			fileURLToPath(import.meta.url),
			'--single',
			'--compiler-root',
			compilerRoot,
			'--source-root',
			sourceRoot,
			'--output-root',
			outputRoot,
			'--demo',
			demoName,
			'--result',
			resultPath,
		], {
			cwd: compilerRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		if (result.status !== 0) {
			process.stderr.write(result.stdout)
			process.stderr.write(result.stderr)
			throw new Error(`Failed to compile demo "${demoName}" with ${compilerRoot}`)
		}

		process.stdout.write(result.stdout)
		process.stderr.write(result.stderr)
		apps.push(JSON.parse(fs.readFileSync(resultPath, 'utf8')))
		fs.rmSync(resultPath)
	}

	const report = {
		compilerRoot,
		compilerRevision: gitOutput(compilerRoot, ['rev-parse', 'HEAD']),
		compilerTrackedChanges: gitOutput(compilerRoot, [
			'status',
			'--short',
			'--untracked-files=no',
			'--',
			'packages/compiler/src',
		]),
		compilerSourceSha256: inspectArtifact(path.join(compilerRoot, 'packages/compiler/src')).sha256,
		sourceRoot,
		outputRoot,
		appCount: apps.length,
		pageCount: apps.reduce((sum, app) => sum + app.source.pages.length, 0),
		templateCount: apps.reduce((sum, app) => sum + app.source.templateCount, 0),
		wxsTemplateCount: apps.reduce((sum, app) => sum + app.source.wxsTemplateCount, 0),
		apps,
	}
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
	console.log(`Compatibility build report: ${reportPath}`)
}

async function buildSingleDemo(options) {
	const compilerRoot = requiredDirectory(options.compilerRoot, '--compiler-root')
	const sourceRoot = requiredDirectory(options.sourceRoot, '--source-root')
	const outputRoot = path.resolve(required(options.outputRoot, '--output-root'))
	const demoName = required(options.demo, '--demo')
	const resultPath = path.resolve(required(options.result, '--result'))
	const sourcePath = path.join(sourceRoot, demoName)
	const compilerEntry = path.join(compilerRoot, 'packages/compiler/src/index.js')

	if (!fs.existsSync(compilerEntry)) {
		throw new Error(`Compiler entry does not exist: ${compilerEntry}`)
	}

	const { default: build } = await import(pathToFileURL(compilerEntry))
	const metadata = await build(outputRoot, sourcePath, true)
	const artifactRoot = path.join(outputRoot, metadata.appId)
	const result = {
		demoName,
		...metadata,
		source: inspectSource(sourcePath),
		artifact: inspectArtifact(artifactRoot),
	}
	delete result.dependencyGraph
	fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`)
}

function inspectSource(sourcePath) {
	const appConfig = JSON.parse(fs.readFileSync(path.join(sourcePath, 'app.json'), 'utf8'))
	const mainPages = appConfig.pages || []
	const subPages = (appConfig.subPackages || appConfig.subpackages || [])
		.flatMap(pkg => (pkg.pages || []).map(page => path.posix.join(pkg.root, page)))
	const files = walkFiles(sourcePath)
	const templateFiles = files.filter(file => /\.(?:wxml|ddml)$/.test(file))

	return {
		pages: [...mainPages, ...subPages],
		templateCount: templateFiles.length,
		wxsTemplateCount: templateFiles.filter((file) => {
			const content = fs.readFileSync(path.join(sourcePath, file), 'utf8')
			return /<(?:wxs|sjs)\b/.test(content)
		}).length,
	}
}

function inspectArtifact(artifactRoot) {
	const files = walkFiles(artifactRoot)
	const hash = createHash('sha256')
	let byteCount = 0
	let newTransportFileCount = 0
	let legacyTransportFileCount = 0
	let ownerMetadataFileCount = 0
	let wxsRootsFileCount = 0

	for (const file of files) {
		const absolutePath = path.join(artifactRoot, file)
		const content = fs.readFileSync(absolutePath)
		hash.update(file)
		hash.update('\0')
		hash.update(content)
		byteCount += content.byteLength

		if (!/\.(?:js|html)$/.test(file)) {
			continue
		}

		const text = content.toString('utf8')
		newTransportFileCount += Number(text.includes('dimina-prop-bindings'))
		legacyTransportFileCount += Number(text.includes('c-prop-bindings'))
		ownerMetadataFileCount += Number(/["']owner["']\s*:/.test(text))
		wxsRootsFileCount += Number(/["']wxsRoots["']\s*:/.test(text))
	}

	return {
		fileCount: files.length,
		byteCount,
		sha256: hash.digest('hex'),
		newTransportFileCount,
		legacyTransportFileCount,
		ownerMetadataFileCount,
		wxsRootsFileCount,
	}
}

function walkFiles(root) {
	const files = []
	const visit = (directory, prefix = '') => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const relativePath = path.posix.join(prefix, entry.name)
			if (entry.isDirectory()) {
				visit(path.join(directory, entry.name), relativePath)
			}
			else if (entry.isFile()) {
				files.push(relativePath)
			}
		}
	}
	visit(root)
	return files
}

function parseArgs(argv) {
	const parsed = {}
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index]
		if (token === '--single') {
			parsed.single = true
			continue
		}
		if (!token.startsWith('--')) {
			throw new Error(`Unexpected argument: ${token}`)
		}
		const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
		parsed[key] = required(argv[index + 1], token)
		index += 1
	}
	return parsed
}

function required(value, label) {
	if (!value) {
		throw new Error(`Missing required argument ${label}`)
	}
	return value
}

function requiredDirectory(value, label) {
	const directory = path.resolve(required(value, label))
	if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
		throw new Error(`${label} is not a directory: ${directory}`)
	}
	return directory
}

function gitOutput(directory, gitArgs) {
	const result = spawnSync('git', ['-C', directory, ...gitArgs], {
		encoding: 'utf8',
	})
	if (result.status !== 0) {
		throw new Error(result.stderr || `git ${gitArgs.join(' ')} failed`)
	}
	return result.stdout.trim()
}
