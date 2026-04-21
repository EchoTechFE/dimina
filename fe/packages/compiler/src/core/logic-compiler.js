import fs from 'node:fs'
import path from 'node:path'
import { isMainThread, parentPort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import MagicString from 'magic-string'
import { transform } from 'esbuild'
import { collectAssets, hasCompileInfo } from '../common/utils.js'
import {
	getAppConfigInfo,
	getAppId,
	getComponent,
	getContentByPath,
	getNpmResolver,
	getTargetPath,
	getWorkPath,
	resetStoreInfo,
	resolveAppAlias,
} from '../env.js'
import { mergeSourcemap, remapSourcemap, wrapModDefine } from './sourcemap.js'

const SCRIPT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']
const TYPE_SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const FRAMEWORK_TYPES_FILE = fileURLToPath(new URL('./logic-compiler-globals.d.ts', import.meta.url))

// 用于缓存已处理的模块
const processedModules = new Set()

// 是否生成 sourcemap
let enableSourcemap = false

let compilerState = null

if (!isMainThread) {
	parentPort.on('message', async ({ pages, storeInfo, sourcemap }) => {
		try {
			resetStoreInfo(storeInfo)
			enableSourcemap = !!sourcemap
			compilerState = createCompilerState()

			const progress = {
				_completedTasks: 0,
				get completedTasks() {
					return this._completedTasks
				},
				set completedTasks(value) {
					this._completedTasks = value
					parentPort.postMessage({ completedTasks: this.completedTasks })
				},
			}

			const mainCompileRes = await compileJS(pages.mainPages, null, null, progress)
			for (const [root, subPages] of Object.entries(pages.subPages)) {
				try {
					// 独立分包: https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/independent.html
					const subCompileRes = await compileJS(
						subPages.info,
						root,
						subPages.independent ? [] : mainCompileRes,
						progress,
					)
					await writeCompileRes(subCompileRes, root)
				}
				catch (error) {
					throw new Error(`Error processing subpackage ${root}: ${error.message}\n${error.stack}`)
				}
			}
			await writeCompileRes(mainCompileRes, null)
			writeDeclarationOutputs()

			// Worker 任务完成后清理缓存，释放内存
			clearCompilerState()

			parentPort.postMessage({ success: true })
		}
		catch (error) {
			// 错误时也清理缓存
			clearCompilerState()

			parentPort.postMessage({
				success: false,
				error: {
					message: error.message,
					stack: error.stack,
					name: error.name,
				},
			})
		}
	})
}

function createCompilerState() {
	return {
		workPath: getWorkPath(),
		tsConfig: null,
		tsProgram: null,
		tsProgramRootNames: [],
		tsProgramVersion: 0,
		checkedDiagnosticsVersion: -1,
		emittedModules: new Map(),
		discoveredTypeScriptFiles: new Set(),
		declarationOutputs: new Map(),
		moduleResolutionHost: null,
	}
}

function clearCompilerState() {
	processedModules.clear()
	enableSourcemap = false
	compilerState = null
}

function ensureCompilerState() {
	const workPath = getWorkPath()
	if (!compilerState || compilerState.workPath !== workPath) {
		processedModules.clear()
		compilerState = createCompilerState()
	}
	return compilerState
}

async function writeCompileRes(compileRes, root) {
	const outputDir = root
		? `${getTargetPath()}/${root}`
		: `${getTargetPath()}/main`

	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true })
	}

	/*
	 * sourcemap 模式跳过 minify：
	 * 当前 mergeSourcemap 只做单层行偏移拼接，
	 * 若再对 bundle 整体 minify 则需用 remapping 串联两份 map，暂未实现
	 */
	if (enableSourcemap) {
		const { bundleCode, sourcemap } = mergeSourcemap(compileRes)
		const sourcemapFileName = 'logic.js.map'
		fs.writeFileSync(`${outputDir}/logic.js`, `${bundleCode}//# sourceMappingURL=${sourcemapFileName}\n`)
		fs.writeFileSync(`${outputDir}/${sourcemapFileName}`, sourcemap)
	}
	else {
		let mergeCode = ''
		for (const module of compileRes) {
			const { header, code, footer } = wrapModDefine(module)
			const amdFormat = `${header}${code}${footer}`
			const { code: minifiedCode } = await transform(amdFormat, {
				minify: true,
				target: ['es2023'], // quickjs 支持版本
				platform: 'neutral',
			})
			mergeCode += minifiedCode
		}
		fs.writeFileSync(`${outputDir}/logic.js`, mergeCode)
	}
}

function writeDeclarationOutputs() {
	if (!compilerState?.declarationOutputs.size) {
		return
	}

	const declarationRoot = path.join(getTargetPath(), 'types')
	for (const [relativeFilePath, content] of compilerState.declarationOutputs) {
		const outputPath = path.join(declarationRoot, relativeFilePath)
		fs.mkdirSync(path.dirname(outputPath), { recursive: true })
		fs.writeFileSync(outputPath, content)
	}
}

/**
 * 编译 js / ts 文件
 */
async function compileJS(pages, root, mainCompileRes, progress) {
	ensureCompilerState()

	const compileRes = []
	if (!root) {
		await buildJSByPath(root, { path: 'app' }, compileRes, mainCompileRes, false)
	}

	for (const page of pages) {
		await buildJSByPath(root, page, compileRes, mainCompileRes, true)
		progress.completedTasks++
	}

	return compileRes
}

async function buildJSByPath(packageName, module, compileRes, mainCompileRes, addExtra, depthChain = [], putMain = false) {
	ensureCompilerState()

	const currentPath = module.path

	if (depthChain.includes(currentPath)) {
		console.warn('[logic]', `检测到循环依赖: ${[...depthChain, currentPath].join(' -> ')}`)
		return
	}
	if (depthChain.length > 20) {
		console.warn('[logic]', `检测到深度依赖: ${[...depthChain, currentPath].join(' -> ')}`)
		return
	}

	depthChain = [...depthChain, currentPath]
	if (!module.path) {
		return
	}
	if (hasCompileInfo(module.path, compileRes, mainCompileRes)) {
		return
	}

	const src = module.path.startsWith('/') ? module.path : `/${module.path}`
	const modulePath = getScriptAbsolutePath(src)
	if (!modulePath) {
		if (module.path === 'app') {
			return
		}
		console.warn('[logic]', `找不到模块文件: ${src}`)
		return
	}

	const sourceCode = getContentByPath(modulePath)
	if (!sourceCode) {
		console.warn('[logic]', `无法读取模块文件: ${modulePath}`)
		return
	}

	const compileInfo = {
		path: module.path,
		code: '',
		map: null,
		sourceFile: null,
		extraInfoCode: addExtra ? buildExtraInfoCode(module) : '',
	}

	if (enableSourcemap) {
		const workPath = getWorkPath()
		compileInfo.sourceFile = modulePath.startsWith(workPath)
			? modulePath.slice(workPath.length)
			: src
	}

	if (putMain) {
		mainCompileRes.push(compileInfo)
	}
	else {
		compileRes.push(compileInfo)
	}

	if (isTypeScriptFile(modulePath)) {
		compilerState.discoveredTypeScriptFiles.add(modulePath)
	}

	if (module.usingComponents) {
		const allSubPackages = getAppConfigInfo().subPackages

		for (const componentPath of Object.values(module.usingComponents)) {
			let toMainSubPackage = true
			if (packageName) {
				const normalizedPath = componentPath.startsWith('/') ? componentPath.substring(1) : componentPath
				for (const subPackage of allSubPackages) {
					if (normalizedPath.startsWith(`${subPackage.root}/`)) {
						toMainSubPackage = false
						break
					}
				}
			}
			else {
				toMainSubPackage = false
			}

			const componentModule = getComponent(componentPath)
			if (!componentModule) {
				continue
			}

			await buildJSByPath(
				packageName,
				componentModule,
				compileRes,
				mainCompileRes,
				true,
				depthChain,
				putMain || toMainSubPackage,
			)
		}
	}

	const emittedModule = await emitModule(modulePath, sourceCode)
	const postProcessed = await postProcessModuleCode({
		compileInfo,
		modulePath,
		emittedCode: emittedModule.code,
		emittedMap: emittedModule.map,
		loader: emittedModule.loader,
	})

	compileInfo.code = postProcessed.code
	compileInfo.map = postProcessed.map

	for (const depId of postProcessed.dependencies) {
		if (!processedModules.has(packageName + depId)) {
			await buildJSByPath(packageName, { path: depId }, compileRes, mainCompileRes, false, depthChain, putMain)
		}
	}

	processedModules.add(packageName + currentPath)
}

function buildExtraInfoCode(module) {
	const extraInfo = {
		path: module.path,
	}

	// https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/
	if (module.component) {
		extraInfo.component = true
	}

	if (module.usingComponents) {
		extraInfo.usingComponents = module.usingComponents
	}

	return `globalThis.__extraInfo = ${JSON.stringify(extraInfo)};\n`
}

async function emitModule(modulePath, sourceCode) {
	if (!isTypeScriptFile(modulePath)) {
		return {
			code: sourceCode,
			map: null,
			loader: isJsxFile(modulePath) ? 'jsx' : 'js',
		}
	}

	if (compilerState.emittedModules.has(modulePath)) {
		return compilerState.emittedModules.get(modulePath)
	}

	const program = ensureTypeScriptProgram(modulePath)
	const sourceFile = program.getSourceFile(modulePath)
	if (!sourceFile) {
		throw new Error(`[logic] TypeScript Program 未包含源文件: ${modulePath}`)
	}

	const outputs = {
		code: null,
		map: null,
		loader: 'js',
	}

	const emitResult = program.emit(sourceFile, (fileName, text, _writeByteOrderMark, _onError, sourceFiles) => {
		const belongsToCurrentModule = sourceFiles?.some(item => path.resolve(item.fileName) === modulePath)
		if (!belongsToCurrentModule) {
			return
		}

		const normalizedFileName = fileName.replace(/\\/g, '/')
		if (isDeclarationOutputFile(normalizedFileName) || isDeclarationMapOutputFile(normalizedFileName)) {
			storeDeclarationOutput(normalizedFileName, text)
			return
		}

		if (normalizedFileName.endsWith('.map')) {
			outputs.map = text
			return
		}

		if (/\.(?:[cm]?js|jsx)$/.test(normalizedFileName)) {
			outputs.code = text
			outputs.loader = normalizedFileName.endsWith('.jsx') ? 'jsx' : 'js'
		}
	}, undefined, false)

	if (emitResult.emitSkipped || !outputs.code) {
		const diagnostics = [
			...emitResult.diagnostics,
			...program.getSyntacticDiagnostics(sourceFile),
			...program.getSemanticDiagnostics(sourceFile),
		].filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)

		if (diagnostics.length > 0) {
			throw new Error(formatTypeScriptDiagnostics(diagnostics))
		}
		throw new Error(`[logic] TypeScript emit 失败: ${modulePath}`)
	}

	if (outputs.map) {
		outputs.map = normalizeTypeScriptSourceMap(outputs.map, modulePath)
	}

	compilerState.emittedModules.set(modulePath, outputs)
	return outputs
}

async function postProcessModuleCode({ compileInfo, modulePath, emittedCode, emittedMap, loader }) {
	const sourceFile = ts.createSourceFile(
		modulePath,
		emittedCode,
		ts.ScriptTarget.Latest,
		true,
		loader === 'jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS,
	)

	const s = new MagicString(emittedCode)
	const replacements = []
	const dependencies = []

	const visit = (node) => {
		if (ts.isStringLiteral(node) && isLocalAssetString(node.text)) {
			replacements.push({
				start: node.getStart(sourceFile),
				end: node.end,
				newValue: collectAssets(getWorkPath(), modulePath, node.text, getTargetPath(), getAppId()),
			})
		}

		if (ts.isCallExpression(node)) {
			const specifierNode = getCallSpecifierNode(node)
			if (specifierNode) {
				const { id, shouldProcess } = resolveDependencyId(specifierNode.text, modulePath)
				if (shouldProcess) {
					replacements.push({
						start: specifierNode.getStart(sourceFile),
						end: specifierNode.end,
						newValue: id,
					})
					dependencies.push(id)
				}
			}
		}

		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
			const { id, shouldProcess } = resolveDependencyId(node.moduleSpecifier.text, modulePath)
			if (shouldProcess) {
				replacements.push({
					start: node.moduleSpecifier.getStart(sourceFile),
					end: node.moduleSpecifier.end,
					newValue: id,
				})
				dependencies.push(id)
			}
		}

		ts.forEachChild(node, visit)
	}

	visit(sourceFile)

	for (const replacement of replacements.reverse()) {
		s.overwrite(replacement.start, replacement.end, `'${replacement.newValue}'`)
	}

	const rewrittenCode = s.toString()
	let preEsbuildMap = emittedMap
	if (enableSourcemap && compileInfo.sourceFile && replacements.length > 0) {
		const rewrittenMap = JSON.parse(s.generateMap({
			file: compileInfo.sourceFile,
			source: compileInfo.sourceFile,
			includeContent: true,
			hires: true,
		}).toString())
		rewrittenMap.file = compileInfo.sourceFile
		rewrittenMap.sources = [compileInfo.sourceFile]
		rewrittenMap.sourcesContent = [emittedCode]
		preEsbuildMap = emittedMap
			? remapSourcemap(JSON.stringify(rewrittenMap), emittedMap)
			: JSON.stringify(rewrittenMap)
	}

	try {
		const esbuildOpts = {
			format: 'cjs',
			target: 'es2020',
			platform: 'neutral',
			loader,
		}
		if (enableSourcemap && compileInfo.sourceFile) {
			esbuildOpts.sourcemap = true
			esbuildOpts.sourcefile = compileInfo.sourceFile
			esbuildOpts.sourcesContent = true
		}
		const esbuildResult = await transform(rewrittenCode, esbuildOpts)

		return {
			code: esbuildResult.code,
			map: enableSourcemap && esbuildResult.map
				? (preEsbuildMap ? remapSourcemap(esbuildResult.map, preEsbuildMap) : esbuildResult.map)
				: null,
			dependencies: [...new Set(dependencies)],
		}
	}
	catch (error) {
		throw new Error(`[logic] esbuild 转换失败 ${modulePath}: ${error.message}`)
	}
}

function getCallSpecifierNode(node) {
	if (
		(node.expression.kind === ts.SyntaxKind.ImportKeyword
			|| isRequireLikeExpression(node.expression))
		&& node.arguments.length > 0
		&& ts.isStringLiteral(node.arguments[0])
	) {
		return node.arguments[0]
	}
	return null
}

function isRequireLikeExpression(expression) {
	if (ts.isIdentifier(expression)) {
		return expression.text === 'require'
	}

	if (ts.isPropertyAccessExpression(expression)) {
		return ts.isIdentifier(expression.expression)
			&& expression.expression.text === 'require'
	}

	return false
}

function ensureTypeScriptProgram(modulePath) {
	ensureCompilerState()
	const rootNames = getTypeScriptProgramRootNames(modulePath)
	if (!compilerState.tsProgram || !haveSameRootNames(rootNames, compilerState.tsProgramRootNames)) {
		const config = getTypeScriptConfig()
		const compilerOptions = getTypeScriptCompilerOptions(config.options)
		const host = ts.createCompilerHost(compilerOptions, true)
		compilerState.tsProgram = ts.createProgram({
			rootNames,
			options: compilerOptions,
			projectReferences: config.projectReferences,
			host,
		})
		compilerState.tsProgramRootNames = rootNames
		compilerState.tsProgramVersion++
		compilerState.checkedDiagnosticsVersion = -1
	}

	ensureTypeScriptDiagnostics()
	return compilerState.tsProgram
}

function getTypeScriptProgramRootNames(modulePath) {
	const config = getTypeScriptConfig()
	compilerState.discoveredTypeScriptFiles.add(modulePath)

	if (config.fileNames.length > 0) {
		return [...new Set([FRAMEWORK_TYPES_FILE, ...config.fileNames, ...compilerState.discoveredTypeScriptFiles])]
	}

	return [...new Set([FRAMEWORK_TYPES_FILE, ...compilerState.discoveredTypeScriptFiles])]
}

function ensureTypeScriptDiagnostics() {
	if (compilerState.checkedDiagnosticsVersion === compilerState.tsProgramVersion) {
		return
	}

	const diagnostics = [
		...compilerState.tsProgram.getOptionsDiagnostics(),
		...compilerState.tsProgram.getGlobalDiagnostics(),
		...compilerState.tsProgram.getSyntacticDiagnostics(),
		...compilerState.tsProgram.getSemanticDiagnostics(),
	].filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)

	if (diagnostics.length > 0) {
		throw new Error(formatTypeScriptDiagnostics(diagnostics))
	}

	compilerState.checkedDiagnosticsVersion = compilerState.tsProgramVersion
}

function getTypeScriptConfig() {
	ensureCompilerState()

	if (compilerState.tsConfig) {
		return compilerState.tsConfig
	}

	const workPath = getWorkPath()
	const configPath = ts.findConfigFile(workPath, ts.sys.fileExists, 'tsconfig.json')

	if (!configPath) {
		compilerState.tsConfig = {
			options: {},
			fileNames: [],
			projectReferences: undefined,
		}
		return compilerState.tsConfig
	}

	const parsed = ts.getParsedCommandLineOfConfigFile(
		configPath,
		{},
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
				throw new Error(formatTypeScriptDiagnostics([diagnostic]))
			},
		},
	)

	if (!parsed) {
		throw new Error(`[logic] 解析 tsconfig 失败: ${configPath}`)
	}

	if (parsed.errors?.length) {
		throw new Error(formatTypeScriptDiagnostics(parsed.errors))
	}

	compilerState.tsConfig = {
		options: parsed.options,
		fileNames: parsed.fileNames.map(fileName => path.resolve(fileName)),
		projectReferences: parsed.projectReferences,
	}
	return compilerState.tsConfig
}

function getTypeScriptCompilerOptions(parsedOptions = {}) {
	return {
		...parsedOptions,
		target: parsedOptions.target ?? ts.ScriptTarget.ES2020,
		module: parsedOptions.module ?? ts.ModuleKind.ESNext,
		allowJs: parsedOptions.allowJs ?? true,
		ignoreDeprecations: parsedOptions.ignoreDeprecations ?? '6.0',
		noEmit: false,
		emitDeclarationOnly: false,
		declaration: parsedOptions.declaration ?? parsedOptions.emitDeclarationOnly ?? false,
		sourceMap: enableSourcemap,
		inlineSources: enableSourcemap,
		inlineSourceMap: false,
	}
}

function formatTypeScriptDiagnostics(diagnostics) {
	return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
		getCanonicalFileName: fileName => fileName,
		getCurrentDirectory: () => getWorkPath(),
		getNewLine: () => '\n',
	})
}

function normalizeTypeScriptSourceMap(mapText, modulePath) {
	const map = JSON.parse(mapText)
	const moduleDir = path.dirname(modulePath)

	map.sources = (map.sources || []).map((source) => {
		if (!source) {
			return source
		}

		let candidatePath = source
		if (!path.isAbsolute(candidatePath)) {
			if (map.sourceRoot) {
				candidatePath = path.resolve(map.sourceRoot, candidatePath)
			}
			else {
				candidatePath = path.resolve(moduleDir, candidatePath)
			}
		}

		const normalizedSource = normalizeSourceMapPath(candidatePath)
		return normalizedSource || source.replace(/\\/g, '/')
	})
	map.sourceRoot = ''

	return JSON.stringify(map)
}

function normalizeSourceMapPath(filePath) {
	const absolutePath = path.resolve(filePath)
	const workPath = getWorkPath()
	if (!absolutePath.startsWith(workPath)) {
		return null
	}
	return `/${path.relative(workPath, absolutePath).replace(/\\/g, '/')}`
}

function storeDeclarationOutput(fileName, content) {
	const relativePath = getDeclarationOutputRelativePath(fileName)
	if (!relativePath) {
		return
	}
	compilerState.declarationOutputs.set(relativePath, content)
}

function getDeclarationOutputRelativePath(fileName) {
	const normalized = path.resolve(fileName)
	const workPath = getWorkPath()
	const config = getTypeScriptConfig()

	if (normalized.startsWith(workPath)) {
		return path.relative(workPath, normalized)
	}

	const outDir = config.options.outDir
	if (outDir) {
		const normalizedOutDir = path.resolve(outDir)
		if (normalized.startsWith(normalizedOutDir)) {
			return path.relative(normalizedOutDir, normalized)
		}
	}

	return null
}

function isLocalAssetString(value) {
	return typeof value === 'string'
		&& !value.startsWith('http')
		&& !value.startsWith('//')
		&& (value.startsWith('/') || value.startsWith('./') || value.startsWith('../'))
		&& /\.(?:png|jpe?g|gif|svg)(?:\?.*)?$/.test(value)
}

function getScriptAbsolutePath(modulePath) {
	const workPath = getWorkPath()
	const resolvedModuleId = resolveModuleIdToExistingPath(modulePath)
	if (!resolvedModuleId) {
		return null
	}

	for (const ext of SCRIPT_EXTENSIONS) {
		const fullPath = `${workPath}${resolvedModuleId}${ext}`
		if (fs.existsSync(fullPath)) {
			return fullPath
		}
	}

	return null
}

function resolveDependencyId(specifier, modulePath) {
	if (!specifier) {
		return { id: specifier, shouldProcess: false }
	}

	if (specifier.startsWith('miniprogram_npm/')) {
		const npmModuleId = normalizeModuleId(`/${specifier}`)
		return {
			id: resolveModuleIdToExistingPath(npmModuleId) || npmModuleId,
			shouldProcess: true,
		}
	}

	if (specifier.startsWith('/')) {
		return {
			id: resolveModuleIdToExistingPath(specifier) || normalizeModuleId(specifier),
			shouldProcess: true,
		}
	}

	const aliasResolved = resolveAppAlias(specifier)
	if (aliasResolved) {
		return {
			id: resolveModuleIdToExistingPath(aliasResolved) || normalizeModuleId(aliasResolved),
			shouldProcess: true,
		}
	}

	const tsResolved = resolveTypeScriptModuleId(specifier, modulePath)
	if (tsResolved) {
		return {
			id: tsResolved,
			shouldProcess: true,
		}
	}

	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		return {
			id: resolveRelativeModuleId(specifier, modulePath),
			shouldProcess: true,
		}
	}

	if (specifier.startsWith('@') || isBareModuleSpecifier(specifier)) {
		const npmModuleId = resolveNpmModuleId(specifier, modulePath)
		return {
			id: npmModuleId || specifier,
			shouldProcess: Boolean(npmModuleId),
		}
	}

	return { id: specifier, shouldProcess: false }
}

function resolveTypeScriptModuleId(specifier, modulePath) {
	const config = getTypeScriptConfig()
	const compilerOptions = getTypeScriptCompilerOptions(config.options)
	const host = compilerState.moduleResolutionHost || {
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		realpath: ts.sys.realpath,
		directoryExists: ts.sys.directoryExists,
		getDirectories: ts.sys.getDirectories,
		useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
	}
	compilerState.moduleResolutionHost = host

	const resolution = ts.resolveModuleName(specifier, modulePath, compilerOptions, host).resolvedModule
	if (!resolution || resolution.isExternalLibraryImport) {
		return null
	}

	const resolvedFileName = resolution.resolvedFileName
	if (!resolvedFileName || resolvedFileName.endsWith('.d.ts')) {
		return null
	}

	const workPath = getWorkPath()
	const normalizedResolvedPath = path.resolve(resolvedFileName)
	if (!normalizedResolvedPath.startsWith(workPath)) {
		return null
	}

	return filePathToModuleId(normalizedResolvedPath)
}

function filePathToModuleId(filePath) {
	const workPath = getWorkPath()
	const relativePath = path.relative(workPath, filePath).replace(/\\/g, '/')
	return normalizeModuleId(relativePath)
}

function isBareModuleSpecifier(specifier) {
	return !specifier.startsWith('.') && !specifier.startsWith('/')
}

function resolveRelativeModuleId(specifier, modulePath) {
	const requireFullPath = path.resolve(path.dirname(modulePath), specifier)
	return filePathToModuleId(requireFullPath)
}

function normalizeModuleId(moduleId) {
	let normalized = moduleId.replace(/\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/, '').replace(/\\/g, '/')
	if (!normalized.startsWith('/')) {
		normalized = `/${normalized}`
	}
	return normalized
}

function resolveNpmModuleId(specifier, modulePath) {
	const npmResolver = getNpmResolver()
	if (!npmResolver) {
		return null
	}
	return npmResolver.resolveScriptModule(specifier, modulePath, resolveModuleIdToExistingPath)
}

function resolveModuleIdToExistingPath(moduleId) {
	const normalizedModuleId = normalizeModuleId(moduleId)
	const workPath = getWorkPath()

	for (const ext of SCRIPT_EXTENSIONS) {
		if (fs.existsSync(`${workPath}${normalizedModuleId}${ext}`)) {
			return normalizedModuleId
		}
	}

	for (const ext of SCRIPT_EXTENSIONS) {
		if (fs.existsSync(`${workPath}${normalizedModuleId}/index${ext}`)) {
			return `${normalizedModuleId}/index`
		}
	}

	const packageJsonPath = `${workPath}${normalizedModuleId}/package.json`
	if (fs.existsSync(packageJsonPath)) {
		try {
			const packageInfo = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
			for (const entryField of ['miniprogram', 'module', 'main']) {
				if (typeof packageInfo[entryField] === 'string' && packageInfo[entryField]) {
					const entryModuleId = normalizeModuleId(path.resolve(normalizedModuleId, packageInfo[entryField]))
					const resolvedEntry = resolveModuleIdToExistingPath(entryModuleId)
					if (resolvedEntry) {
						return resolvedEntry
					}
				}
			}
		}
		catch (error) {
			console.warn('[logic]', `解析 package.json 失败: ${packageJsonPath}`, error.message)
		}
	}

	return null
}

function isTypeScriptFile(filePath) {
	return TYPE_SCRIPT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function isJsxFile(filePath) {
	return ['.jsx', '.tsx'].includes(path.extname(filePath).toLowerCase())
}

function haveSameRootNames(nextRootNames, prevRootNames) {
	if (nextRootNames.length !== prevRootNames.length) {
		return false
	}

	const prevSet = new Set(prevRootNames)
	return nextRootNames.every(rootName => prevSet.has(rootName))
}

function isDeclarationOutputFile(fileName) {
	return /\.d\.(?:ts|mts|cts)$/.test(fileName)
}

function isDeclarationMapOutputFile(fileName) {
	return /\.d\.(?:ts|mts|cts)\.map$/.test(fileName)
}

export { compileJS, buildJSByPath }
