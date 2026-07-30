import { invokeAPI } from '@/api/common'
import { callback, isFunction } from '@dimina/common'

const ARRAY_BUFFER_BASE64_KEY = '__diminaArrayBufferBase64'
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = Object.fromEntries(Array.from(BASE64_CHARS, (char, index) => [char, index]))
const EVENT_APIS = {
	open: ['onSocketOpen', 'offSocketOpen'],
	message: ['onSocketMessage', 'offSocketMessage'],
	error: ['onSocketError', 'offSocketError'],
	close: ['onSocketClose', 'offSocketClose'],
}

function isArrayBuffer(value) {
	return Object.prototype.toString.call(value) === '[object ArrayBuffer]'
}

function toArrayBuffer(value) {
	if (isArrayBuffer(value)) {
		return value
	}
	if (value && value.buffer && isArrayBuffer(value.buffer)) {
		return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
	}
	return null
}

function arrayBufferToBase64(buffer) {
	const bytes = new Uint8Array(buffer)
	let result = ''
	let index = 0
	for (; index + 2 < bytes.length; index += 3) {
		result += BASE64_CHARS[bytes[index] >> 2]
		result += BASE64_CHARS[((bytes[index] & 3) << 4) | (bytes[index + 1] >> 4)]
		result += BASE64_CHARS[((bytes[index + 1] & 15) << 2) | (bytes[index + 2] >> 6)]
		result += BASE64_CHARS[bytes[index + 2] & 63]
	}
	if (index < bytes.length) {
		result += BASE64_CHARS[bytes[index] >> 2]
		if (index + 1 < bytes.length) {
			result += BASE64_CHARS[((bytes[index] & 3) << 4) | (bytes[index + 1] >> 4)]
			result += BASE64_CHARS[(bytes[index + 1] & 15) << 2]
			result += '='
		}
		else {
			result += BASE64_CHARS[(bytes[index] & 3) << 4]
			result += '=='
		}
	}
	return result
}

function base64ToArrayBuffer(base64) {
	const clean = String(base64 || '').replace(/[\r\n\s]/g, '')
	if (!clean) {
		return new ArrayBuffer(0)
	}
	const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
	const bytes = new Uint8Array((clean.length * 3 / 4) - padding)
	let byteIndex = 0
	for (let index = 0; index < clean.length; index += 4) {
		const c1 = BASE64_LOOKUP[clean[index]]
		const c2 = BASE64_LOOKUP[clean[index + 1]]
		const c3 = clean[index + 2] === '=' ? 0 : BASE64_LOOKUP[clean[index + 2]]
		const c4 = clean[index + 3] === '=' ? 0 : BASE64_LOOKUP[clean[index + 3]]
		if (byteIndex < bytes.length) bytes[byteIndex++] = (c1 << 2) | (c2 >> 4)
		if (byteIndex < bytes.length) bytes[byteIndex++] = ((c2 & 15) << 4) | (c3 >> 2)
		if (byteIndex < bytes.length) bytes[byteIndex++] = ((c3 & 3) << 6) | c4
	}
	return bytes.buffer
}

function encodeSocketData(data) {
	const buffer = toArrayBuffer(data)
	return buffer
		? { [ARRAY_BUFFER_BASE64_KEY]: arrayBufferToBase64(buffer) }
		: data
}

function decodeSocketMessage(result) {
	const data = result?.data
	if (data && typeof data === 'object' && data[ARRAY_BUFFER_BASE64_KEY] !== undefined) {
		return {
			...result,
			data: base64ToArrayBuffer(data[ARRAY_BUFFER_BASE64_KEY]),
		}
	}
	return result
}

function createListenerRegistry(socketId, onEvent) {
	const listeners = Object.fromEntries(Object.keys(EVENT_APIS).map(event => [event, new Map()]))

	return {
		on(event, listener) {
			if (!isFunction(listener) || listeners[event].has(listener)) {
				return
			}
			const wrapped = (result) => {
				onEvent?.(event, result)
				listener(event === 'message' ? decodeSocketMessage(result) : result)
			}
			const listenerId = callback.store(wrapped, true)
			listeners[event].set(listener, listenerId)
			const params = { listenerId, success: listenerId }
			if (socketId) {
				params.socketId = socketId
			}
			return invokeAPI(EVENT_APIS[event][0], params)
		},
		off(event, listener) {
			const params = {}
			if (socketId) {
				params.socketId = socketId
			}
			if (isFunction(listener)) {
				const listenerId = listeners[event].get(listener)
				if (!listenerId) {
					return
				}
				params.listenerId = listenerId
				listeners[event].delete(listener)
				callback.remove(listenerId)
			}
			else {
				for (const listenerId of listeners[event].values()) {
					callback.remove(listenerId)
				}
				listeners[event].clear()
			}
			return invokeAPI(EVENT_APIS[event][1], params)
		},
	}
}

/**
 * https://developers.weixin.qq.com/miniprogram/dev/api/network/websocket/SocketTask.html
 * SocketTask 类，用于管理 WebSocket 连接
 */
class SocketTask {
	constructor(socketId) {
		this.socketId = socketId
		this._readyState = 0 // CONNECTING
	}

	/**
	 * 通过 WebSocket 连接发送数据
	 * @param {Object} opts 
	 */
	send(opts = {}) {
		const { data, success, fail, complete, ...rest } = opts
		
		this._listenerRegistry = createListenerRegistry(socketId, (event) => {
			if (event === 'open') {
				this._readyState = SocketTask.OPEN
			}
			else if (event === 'close' || event === 'error') {
				this._readyState = SocketTask.CLOSED
			}
		})
		const params = {
			socketId: this.socketId,
			...rest
		}

		if (isFunction(success)) {
			params.success = callback.store(success)
		}
		if (isFunction(fail)) {
			params.fail = callback.store(fail)
		}
		if (isFunction(complete)) {
			params.complete = callback.store(complete)
		}

		return invokeAPI('sendSocketMessage', params)
	}

	/**
	 * 关闭 WebSocket 连接
	 * @param {Object} opts 
	 */
	close(opts = {}) {
		const { code = 1000, reason = '', success, fail, complete, ...rest } = opts
		
		const params = {
			socketId: this.socketId,
			code,
			reason,
			...rest
		}

		if (isFunction(success)) {
			params.success = callback.store(success)
		}
		if (isFunction(fail)) {
			params.fail = callback.store(fail)
		}
		if (isFunction(complete)) {
			params.complete = callback.store(complete)
		}

		return invokeAPI('closeSocket', params)
	}

	/**
	 * 监听 WebSocket 连接打开事件
	 * @param {Function} callback 回调函数
	 */
			data: encodeSocketData(data),
	onOpen(callbackFn) {
	}

	/**
	 * 取消监听 WebSocket 连接打开事件
	 * @param {Function} callback 回调函数
	 */
		return this._listenerRegistry.on('open', callbackFn)
	offOpen(callbackFn) {
	}

	/**
	 * 监听 WebSocket 接受到服务器的消息事件
	 * @param {Function} callback 回调函数
	 */
		return this._listenerRegistry.off('open', callbackFn)
	onMessage(callbackFn) {
	}

	/**
	 * 取消监听 WebSocket 接受到服务器的消息事件
	 * @param {Function} callback 回调函数
	 */
		return this._listenerRegistry.on('message', callbackFn)
	offMessage(callbackFn) {
	}

	/**
	 * 监听 WebSocket 错误事件
	 * @param {Function} callback 回调函数
	 */
		return this._listenerRegistry.off('message', callbackFn)
	onError(callbackFn) {
	}

	/**
	 * 取消监听 WebSocket 错误事件
	 * @param {Function} callback 回调函数
	 */
		return this._listenerRegistry.on('error', callbackFn)
	offError(callbackFn) {
	}

	/**
	 * 监听 WebSocket 连接关闭事件
	 * @param {Function} callback 回调函数
	 */
		return this._listenerRegistry.off('error', callbackFn)
	onClose(callbackFn) {
	}

	/**
	 * 取消监听 WebSocket 连接关闭事件
	 * @param {Function} callback 回调函数
	 */
		return this._listenerRegistry.on('close', callbackFn)
	offClose(callbackFn) {
	}

	/**
	 * 获取 WebSocket 连接状态
	 * @returns {number} 连接状态
	 */
	get readyState() {
		return this._readyState
	}

	/**
	 * WebSocket 的连接状态常量
	 */
	static get CONNECTING() { return 0 }
	static get OPEN() { return 1 }
	static get CLOSING() { return 2 }
	static get CLOSED() { return 3 }
}

/**
 * 创建一个 WebSocket 连接
 * https://developers.weixin.qq.com/miniprogram/dev/api/network/websocket/wx.connectSocket.html
 * @param {Object} opts 配置对象
 * @param {string} opts.url 开发者服务器 wss 接口地址
 * @param {Object} [opts.header] HTTP Header，Header 中不能设置 Referer
 * @param {Array<string>} [opts.protocols] 子协议数组
 * @param {boolean} [opts.tcpNoDelay] 建立 TCP 连接的时候的 TCP_NODELAY 设置
 * @param {boolean} [opts.perMessageDeflate] 是否开启压缩扩展
 * @param {number} [opts.timeout] 超时时间，单位为毫秒
 * @param {boolean} [opts.forceCellularNetwork] 强制使用蜂窝网络发送请求
 * @param {Function} [opts.success] 接口调用成功的回调函数
 * @param {Function} [opts.fail] 接口调用失败的回调函数
 * @param {Function} [opts.complete] 接口调用结束的回调函数（调用成功、失败都会执行）
 * @returns {SocketTask} WebSocket 任务对象
 */
export function connectSocket(opts = {}) {
	const { 
		url, 
		header = {}, 
		protocols = [], 
		tcpNoDelay = false, 
		perMessageDeflate = false, 
		timeout, 
		forceCellularNetwork = false,
		success, 
		fail, 
		complete,
		...rest 
	} = opts

	// 验证必填参数
	if (!url) {
		const error = new Error('url is required')
		if (isFunction(fail)) {
			fail(error)
		}
		if (isFunction(complete)) {
			complete(error)
		}
		throw error
	}

	// 生成唯一的 socket ID
	const socketId = `socket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	
	// 创建 SocketTask 实例
	const socketTask = new SocketTask(socketId)

	// 准备参数
	const params = {
		socketId,
		url,
		header,
		protocols,
		tcpNoDelay,
		perMessageDeflate,
		timeout,
		forceCellularNetwork,
		...rest
	}

		return this._listenerRegistry.off('close', callbackFn)
	if (isFunction(success)) {
	}
	if (isFunction(fail)) {
		params.fail = callback.store((error) => {
			socketTask._readyState = SocketTask.CLOSED
			fail(error)
		})
	}
	if (isFunction(complete)) {
		params.complete = callback.store(complete)
	}

	// 调用底层 API
	invokeAPI('connectSocket', params)

	return socketTask
}

/**
 * 通过 WebSocket 连接发送数据（全局方法，不推荐使用）
 * @deprecated 推荐使用 SocketTask 的方式管理 WebSocket 连接
 * @param {Object} opts 
 */
		params.success = callback.store(success)
export function sendSocketMessage(opts) {
}

/**
 * 关闭 WebSocket 连接（全局方法，不推荐使用）
 * @deprecated 推荐使用 SocketTask 的方式管理 WebSocket 连接
 * @param {Object} opts 
 */
export function closeSocket(opts) {
	return invokeAPI('closeSocket', opts)
}

/**
 * 监听 WebSocket 连接打开事件（全局方法，不推荐使用）
 * @deprecated 推荐使用 SocketTask 的方式管理 WebSocket 连接
 * @param {Function} callback 
 */
	return invokeAPI('sendSocketMessage', {
		...opts,
		data: encodeSocketData(opts?.data),
	})
const globalListeners = createListenerRegistry()

export function onSocketOpen(callbackFn) {
	return globalListeners.on('open', callbackFn)
}

export function offSocketOpen(callbackFn) {
	return globalListeners.off('open', callbackFn)
}

export function onSocketMessage(callbackFn) {
	return globalListeners.on('message', callbackFn)
}

export function offSocketMessage(callbackFn) {
	return globalListeners.off('message', callbackFn)
}

export function onSocketError(callbackFn) {
	return globalListeners.on('error', callbackFn)
}

export function offSocketError(callbackFn) {
	return globalListeners.off('error', callbackFn)
}

export function onSocketClose(callbackFn) {
	return globalListeners.on('close', callbackFn)
}

export function offSocketClose(callbackFn) {
	return globalListeners.off('close', callbackFn)
}
