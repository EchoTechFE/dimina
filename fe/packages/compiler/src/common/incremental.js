import path from 'node:path'

/**
 * 增量编译 v1（保守）影响分析。
 *
 * 设计原则：正确性优先。任何无法安全判定影响范围的改动一律回退全量。
 *
 * 已知局限（codex 评审 2026-06）：本版基于「路径启发式」（变更文件 strip 扩展名后是否
 * 命中页面/组件路径 + usingComponents 反向闭包），不建跨构建的真实依赖图。因此对
 * **页面/组件自身文件被其它页面以 `@import`(wxss) 或 `<include>/<import>`(wxml) 直接引用**
 * 这一反模式存在盲点：改该文件只重编它自身、漏掉引用方 → 引用方留陈旧产物。
 *   - 常见的共享样式/模板（放在专用的非页面/非组件文件，如 styles/common.wxss、
 *     templates/foo.wxml）不受影响：它们既非页面也非组件 → unclassifiable → 全量（安全）。
 *   - 盲点仅限「直接引用另一个页面/组件自身的源文件」，属罕见反模式。
 *   - 彻底修复需 v2：全量编译时记录每页/组件真实消费的源文件清单（@import/include/wxs/
 *     require 目标）并持久化，增量时据清单算 affected（取代启发式）。
 * codex 另两条假设经核实**不成立**：usingComponents 值已由 env.js getModuleId 归一化为
 * canonical moduleId（路径形态差异不存在）；分包页面 path 含 root（同名不碰撞）。
 */

// 已知的「可增量」源文件扩展名（模板 / 样式 / 逻辑）
const INCREMENTAL_EXTS = new Set(['.wxml', '.ddml', '.wxss', '.ddss', '.js', '.ts'])

// 改动这些文件必然影响全局配置 / 依赖图，保守全量
const FULL_BUILD_BASENAMES = new Set([
	'app.json',
	'project.config.json',
	'project.private.config.json',
	'sitemap.json',
])

// 主包标记，与 logic-compiler 主包（root 为空）保持一致
const MAIN_ROOT = ''

/**
 * 去掉扩展名并归一化为「相对小程序根目录、不带前导斜杠」的路径。
 * @param {string} p
 */
function stripToModulePath(p) {
	const normalized = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '')
	return normalized.replace(/\.[^./]+$/, '')
}

/**
 * 收集所有页面信息：{ path, root, usingComponents }
 * root 为主包标记 '' 或分包 root（getPages 的 subPages key，如 sub_xxx）。
 * @param {*} pages getPages() 的返回值
 */
function collectPages(pages) {
	const result = []
	for (const page of pages.mainPages || []) {
		result.push({ path: page.path, root: MAIN_ROOT, usingComponents: page.usingComponents || {} })
	}
	for (const [root, subPkg] of Object.entries(pages.subPages || {})) {
		for (const page of subPkg.info || []) {
			result.push({ path: page.path, root, usingComponents: page.usingComponents || {} })
		}
	}
	return result
}

/**
 * 归一化组件 moduleId（去前导斜杠），用于和 strip 后的源文件路径比较。
 * @param {string} id
 */
function normalizeComponentId(id) {
	return String(id).replace(/^\//, '')
}

/**
 * 计算增量编译计划。
 *
 * @param {{path:string,type:string}[]} changedFiles 变更文件（path 相对项目根）
 * @param {*} pages getPages() 的返回值
 * @param {Record<string, {path:string, usingComponents?:Record<string,string>}>} componentInfo
 * @returns {{ mode:'full'|'incremental', affectedPaths:Set<string>, affectedRoots:Set<string> }}
 */
export function computePlan(changedFiles, pages, componentInfo = {}) {
	const full = () => ({ mode: 'full', affectedPaths: new Set(), affectedRoots: new Set() })

	if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
		return full()
	}

	const allPages = collectPages(pages)

	// 页面路径集合（归一化、不带前导斜杠、不带扩展名）
	const pagePathSet = new Set(allPages.map(p => p.path))
	const pageByPath = new Map(allPages.map(p => [p.path, p]))

	// 组件路径集合
	const componentPathSet = new Set()
	for (const id of Object.keys(componentInfo)) {
		componentPathSet.add(normalizeComponentId(id))
	}

	// 反向图：组件 -> 直接引用它的页面 / 组件
	// 先构建「引用者 -> 被引用组件」的正向边，再做反向传递闭包。
	// 节点用归一化路径表示。
	const reverseEdges = new Map() // componentPath -> Set<refererPath>（referer 可以是页面或组件）

	const addReverseEdge = (componentId, refererPath) => {
		const comp = normalizeComponentId(componentId)
		if (!reverseEdges.has(comp)) {
			reverseEdges.set(comp, new Set())
		}
		reverseEdges.get(comp).add(refererPath)
	}

	// 页面 -> 组件
	for (const page of allPages) {
		for (const compId of Object.values(page.usingComponents || {})) {
			addReverseEdge(compId, page.path)
		}
	}
	// 组件 -> 组件
	for (const [id, info] of Object.entries(componentInfo)) {
		const selfPath = normalizeComponentId(id)
		for (const compId of Object.values(info.usingComponents || {})) {
			addReverseEdge(compId, selfPath)
		}
	}

	/**
	 * 给定一个组件路径，求所有（直接/间接）引用它的页面集合（传递闭包）。
	 */
	const pagesReferencingComponent = (componentPath) => {
		const resultPages = new Set()
		const visited = new Set()
		const stack = [componentPath]
		while (stack.length > 0) {
			const node = stack.pop()
			if (visited.has(node)) {
				continue
			}
			visited.add(node)
			const referers = reverseEdges.get(node)
			if (!referers) {
				continue
			}
			for (const referer of referers) {
				if (pagePathSet.has(referer)) {
					resultPages.add(referer)
				}
				// referer 可能是中间组件，继续向上回溯
				if (componentPathSet.has(referer)) {
					stack.push(referer)
				}
			}
		}
		return resultPages
	}

	const affectedPaths = new Set()

	for (const change of changedFiles) {
		const { path: rawPath, type } = change

		// 新增 / 删除一律全量（可能涉及页面增删、依赖图变化）
		if (type === 'add' || type === 'unlink') {
			return full()
		}

		const base = path.basename(rawPath)
		if (FULL_BUILD_BASENAMES.has(base)) {
			return full()
		}

		const ext = path.extname(rawPath).toLowerCase()
		if (!INCREMENTAL_EXTS.has(ext)) {
			return full()
		}

		// 路径含 miniprogram_npm 段：依赖图复杂，保守全量
		const segments = rawPath.replace(/\\/g, '/').split('/')
		if (segments.includes('miniprogram_npm')) {
			return full()
		}

		const modulePath = stripToModulePath(rawPath)

		// 页面 / 组件的 .json 变更：可能改 usingComponents / 依赖图，保守全量
		if (ext === '.json') {
			return full()
		}

		const isPage = pagePathSet.has(modulePath)
		const isComponent = componentPathSet.has(modulePath)

		if (!isPage && !isComponent) {
			// 既非页面也非组件（共享 util / 独立 wxs / 被 @import 的样式等）
			// v1 不建跨构建依赖图，无法安全判定影响范围 → 全量
			return full()
		}

		if (isPage) {
			affectedPaths.add(modulePath)
		}

		if (isComponent) {
			// 组件变更 → 反向映射到所有引用它的页面（传递闭包）
			const referencingPages = pagesReferencingComponent(modulePath)
			if (referencingPages.size === 0) {
				// 没有页面引用该组件（孤儿组件 / 映射缺失）→ 保守全量
				return full()
			}
			for (const p of referencingPages) {
				affectedPaths.add(p)
			}
		}
	}

	if (affectedPaths.size === 0) {
		return full()
	}

	const affectedRoots = new Set()
	for (const p of affectedPaths) {
		const page = pageByPath.get(p)
		affectedRoots.add(page ? page.root : MAIN_ROOT)
	}

	return { mode: 'incremental', affectedPaths, affectedRoots }
}

/**
 * 依据 affectedPaths / affectedRoots，从完整 pages 中筛出每个 worker 实际需要编译的 pages。
 *
 * - view / style worker：只编受影响的页面。
 * - logic worker：按分包整包编译（受影响 root 的全部页面），不能只编受影响页，
 *   否则同包其它页逻辑会从 logic.js 丢失。
 *
 * @param {*} pages getPages() 返回值（注意：style 阶段调用方可能已 unshift app 到 mainPages）
 * @param {{affectedPaths:Set<string>, affectedRoots:Set<string>}} plan
 */
export function filterPagesForWorker(pages, plan, worker) {
	const { affectedPaths, affectedRoots } = plan

	if (worker === 'logic') {
		// 按分包整包：受影响 root 的全部页面保留，未受影响 root 的页面清空。
		const mainPages = affectedRoots.has(MAIN_ROOT) ? pages.mainPages : []
		const subPages = {}
		for (const [root, subPkg] of Object.entries(pages.subPages || {})) {
			if (affectedRoots.has(root)) {
				subPages[root] = subPkg
			}
		}
		return { mainPages, subPages }
	}

	// view / style：仅受影响页面（按 path 过滤）
	const keep = page => affectedPaths.has(page.path)

	const mainPages = (pages.mainPages || []).filter(keep)
	const subPages = {}
	for (const [root, subPkg] of Object.entries(pages.subPages || {})) {
		const info = (subPkg.info || []).filter(keep)
		if (info.length > 0) {
			subPages[root] = { ...subPkg, info }
		}
	}
	return { mainPages, subPages }
}
