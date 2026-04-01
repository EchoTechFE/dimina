import { callback } from '@dimina/common'
import { invokeAPI } from './index'

const _singletonCache = new Map()

export function isContextDescriptor(value) {
	return value && typeof value === 'object' && value.__context__ === true
}

export function wrapContext(descriptor) {
	if (descriptor.__singleton__) {
		const cached = _singletonCache.get(descriptor.__type__)
		if (cached) return cached
	}

	const id = descriptor.__id__
	const state = { ...descriptor.__properties__ }
	const getterCache = {}
	const eventListeners = {}

	const ctx = {}

	// methods → invokeAPI('__ctx_{method}', ...)
	for (const method of (descriptor.__methods__ || [])) {
		ctx[method] = (...args) => {
			const data = { __contextId__: id }
			if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
				Object.assign(data, args[0])
			}
			else if (args.length > 0) {
				data.args = args
			}
			return invokeAPI(`__ctx_${method}`, data)
		}
	}

	// event helpers
	function bindEvent(event, fn) {
		if (typeof fn !== 'function') return
		const cbId = callback.store((data) => {
			if (data && data.__state__) {
				Object.assign(getterCache, data.__state__)
				delete data.__state__
			}
			fn(data)
		}, true)
		if (!eventListeners[event]) eventListeners[event] = []
		eventListeners[event].push({ cbId, fn })
		invokeAPI('__ctx_bindEvent', { __contextId__: id, event, callbackId: cbId })
	}

	function unbindEvent(event, fn) {
		if (!eventListeners[event]) return
		if (fn) {
			const idx = eventListeners[event].findIndex(l => l.fn === fn)
			if (idx !== -1) {
				const { cbId } = eventListeners[event].splice(idx, 1)[0]
				callback.remove(cbId)
				invokeAPI('__ctx_unbindEvent', { __contextId__: id, event, callbackId: cbId })
			}
		}
		else {
			for (const l of eventListeners[event]) callback.remove(l.cbId)
			eventListeners[event] = []
			invokeAPI('__ctx_unbindEvent', { __contextId__: id, event })
		}
	}

	// named events → onXxx / offXxx
	for (const event of (descriptor.__events__ || [])) {
		const cap = event[0].toUpperCase() + event.slice(1)
		ctx['on' + cap] = (fn) => bindEvent(event, fn)
		ctx['off' + cap] = (fn) => unbindEvent(event, fn)
	}

	// generic on/off
	if (descriptor.__generic_events__) {
		ctx.on = (event, fn) => bindEvent(event, fn)
		ctx.off = (event, fn) => unbindEvent(event, fn)
	}

	// Proxy: getters read local cache, setters notify native
	const proxy = new Proxy(ctx, {
		get(target, key) {
			if ((descriptor.__getters__ || []).includes(key)) {
				return getterCache[key] ?? 0
			}
			if (key in state) return state[key]
			return target[key]
		},
		set(target, key, value) {
			if (key in state) {
				state[key] = value
				invokeAPI('__ctx_setProp', { __contextId__: id, key, value })
				return true
			}
			target[key] = value
			return true
		},
	})

	if (descriptor.__singleton__) _singletonCache.set(descriptor.__type__, proxy)
	return proxy
}
