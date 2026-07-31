import { isAndroid, isIOS } from '@dimina/common'
import mitt from 'mitt'
import { decodeDataFunctions } from './data-function'

class Message {
	constructor() {
		this.event = mitt()
		this.init()
	}

	init() {
		if (!window.DiminaRenderBridge) {
			window.DiminaRenderBridge = {}
		}
		// window.DiminaRenderBridge 是容器提供，容器调用此方法给视图层发消息
		window.DiminaRenderBridge.onMessage = (msg) => {
			const decodedMsg = decodeDataFunctions(msg)
			console.log('[system]', '[render]', 'receive msg: ', decodedMsg)
			const { type, body } = decodedMsg
			this.event.emit(type, body)
		}
	}

	// 向渲染层注册消息监听
	on(type, callback) {
		this.event.on(type, callback)
	}

	// 渲染层经过容器层中转向逻辑层发送消息
	send(msg) {
		window.DiminaRenderBridge.publish(JSON.stringify(msg))
	}

	// 渲染层向容器层发送消息
	invoke(msg) {
		// android/ios 只能接收基础类型，需要转换成字符串
		if (isAndroid || isIOS) {
			Message.prototype.invoke = function (msg) {
				window.DiminaRenderBridge.invoke(JSON.stringify(msg))
			}
		}
		else {
			Message.prototype.invoke = function (msg) {
				window.DiminaRenderBridge.invoke(msg)
			}
		}
		return this.invoke(msg)
	}

	off(type, callback) {
		this.event.off(type, callback)
	}

	listenerCount(eventName) {
		return this.event.all.get(eventName)?.length || 0
	}

	wait(eventName, { generation, signal } = {}) {
		return new Promise((resolve) => {
			let settled = false
			const finish = (value) => {
				if (settled) {
					return
				}
				settled = true
				this.off(eventName, handleMessage)
				signal?.removeEventListener('abort', handleAbort)
				resolve(value)
			}
			const handleMessage = (msg) => {
				// A generation-less response comes from an older Service runtime and
				// remains compatible. Once Service supplies a generation, stale
				// responses for a reused module id no longer resolve this setup.
				if (generation != null && msg.generation != null && msg.generation !== generation) {
					return
				}
				finish(msg.data)
			}
			const handleAbort = () => finish(undefined)

			if (signal?.aborted) {
				finish(undefined)
				return
			}
			this.on(eventName, handleMessage)
			signal?.addEventListener('abort', handleAbort, { once: true })
		})
	}

	waitAndSend(eventName, msg, options) {
		const response = this.wait(eventName, options)
		this.send(msg)
		return response
	}
}

export default new Message()
