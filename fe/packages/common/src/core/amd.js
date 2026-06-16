import { isFunction } from './utils'

const JSModules = {} // 缓存已定义的模块
const MODULES_STATUS_UNLOAD = 1 // 未加载
const MODULES_STATUS_LOADED = 2 // 已加载

// 模块定义函数
function modDefine(id, factory) {
	if (!JSModules[id]) {
		JSModules[id] = {
			factory,
			status: MODULES_STATUS_UNLOAD,
			exports: undefined,
		}
	}
}
// 模块重置函数（热更新用）：丢弃已缓存的模块记录，使后续重新注入的
// modDefine 生效、modRequire 重新执行 factory。没有它时 modDefine 的
// `if (!JSModules[id])` 守卫会忽略重注入、modRequire 对 LOADED 模块直接返回
// 旧 exports，热替换无从落地。返回是否确实清除了一个已存在的模块。
function modReset(id) {
	if (JSModules[id]) {
		delete JSModules[id]
		return true
	}
	return false
}
// 模块加载函数
function modRequire(id, callback, errorCallback) {
	if (typeof id !== 'string') {
		throw new TypeError('require args must be a string')
	}
	const mod = JSModules[id]
	if (!mod) {
		throw new Error(`module ${id} not found`)
	}

	if (mod.status === MODULES_STATUS_UNLOAD) {
		mod.status = MODULES_STATUS_LOADED
		const module = {
			exports: {},
		}
		let res
		try {
			if (mod.factory) {
				res = mod.factory.call(null, modRequire, module, module.exports)
			}
		}
		catch (e) {
			mod.status = MODULES_STATUS_UNLOAD
			const em = `
				name: ${e.name}
				msg: ${e.message}
				stack:
				${e.stack}
			`
			console.error(`require ${id} error: ${em}`)
			if (isFunction(errorCallback)) {
				errorCallback({ mod: id, errMsg: e.message })
			}
		}
		mod.exports = module.exports === undefined ? res : module.exports
	}

	if (isFunction(callback)) {
		callback(mod.exports)
	}

	return mod.exports
}

// TODO:https://developers.weixin.qq.com/miniprogram/dev/reference/api/require.html
modRequire.async = async (id) => {
	return new Promise((resolve, reject) => {
		try {
			resolve(modRequire(id))
		}
		catch (e) {
			reject(new Error(`${e.message}: Failed to initialize asynchronous loading for module '${id}'`))
		}
	})
}

export { modDefine, modRequire, modReset }
