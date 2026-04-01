import { invokeAPI } from '@/api/common'
import { wrapContext, isContextDescriptor } from '@/api/common/context'

const apiInfo = import.meta.glob('./core/**/index.js', { eager: true })
const api = {}
for (const f of Object.values(apiInfo)) {
	for (const [k, v] of Object.entries(f)) {
		api[k] = v
	}
}
const handler = {
	get(target, prop, receiver) {
		const origMethod = Reflect.get(target, prop, receiver)

		// API存在则直接调用，API 已具体实现
		if (typeof origMethod === 'function') {
			return origMethod
		}

		// 如果是非函数属性且已存在，或者特殊处理 webpackJsonp 属性来兼容 Taro，直接返回
		if (origMethod !== undefined || prop === 'webpackJsonp') {
			return origMethod
		}

		// API 不存在则返回一个函数，通过消息通道调用
		return (...args) => {
			const result = invokeAPI(prop, ...args)
			if (isContextDescriptor(result)) {
				return wrapContext(result)
			}
			return result
		}
	},
	set(target, prop, value, receiver) {
		// 允许对target对象进行属性赋值
		return Reflect.set(target, prop, value, receiver)
	},
}
/**
 * 外部挂载 API，内部转发不存在 API
 * [Render]invokeAPI -> [Container]invokeAPI -> [Service]invokeAPI -> [Container]invokeAPI
 */

const globalApi = new Proxy(api, handler)

export default globalApi
