import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/common', () => ({
	invokeAPI: vi.fn(),
}))

import { invokeAPI } from '@/api/common'
import { callback } from '@dimina/common'
import {
	connectSocket,
	offSocketOpen,
	onSocketOpen,
	sendSocketMessage,
} from '../src/api/core/network/websocket/index.js'

function bytes(buffer) {
	return Array.from(new Uint8Array(buffer))
}

describe('websocket service adapter', () => {
	beforeEach(() => {
		vi.mocked(invokeAPI).mockReset()
		callback.remove()
	})

	it('creates a SocketTask and forwards the official connection options', () => {
		const success = vi.fn()
		const task = connectSocket({
			url: 'wss://example.test/socket',
			header: { Authorization: 'Bearer token' },
			protocols: ['chat'],
			timeout: 3000,
			success,
		})

		const [name, params] = vi.mocked(invokeAPI).mock.calls[0]
		expect(name).toBe('connectSocket')
		expect(params).toMatchObject({
			socketId: task.socketId,
			url: 'wss://example.test/socket',
			header: { Authorization: 'Bearer token' },
			protocols: ['chat'],
			timeout: 3000,
		})
		expect(task.readyState).toBe(0)

		callback.invoke(params.success, { errMsg: 'connectSocket:ok' })
		expect(success).toHaveBeenCalledWith({ errMsg: 'connectSocket:ok' })
		expect(task.readyState).toBe(0)
	})

	it('uses persistent success callbacks for task events and updates readyState', () => {
		const task = connectSocket({ url: 'wss://example.test/socket' })
		const listener = vi.fn()
		vi.mocked(invokeAPI).mockClear()

		task.onOpen(listener)

		const [name, params] = vi.mocked(invokeAPI).mock.calls[0]
		expect(name).toBe('onSocketOpen')
		expect(params).toEqual({
			socketId: task.socketId,
			listenerId: expect.any(String),
			success: expect.any(String),
		})
		expect(params.listenerId).toBe(params.success)

		callback.invoke(params.success, { header: { Upgrade: 'websocket' } })
		expect(task.readyState).toBe(1)
		expect(listener).toHaveBeenCalledWith({ header: { Upgrade: 'websocket' } })

		task.offOpen(listener)
		expect(vi.mocked(invokeAPI).mock.calls[1]).toEqual([
			'offSocketOpen',
			{ socketId: task.socketId, listenerId: params.listenerId },
		])

		callback.invoke(params.success, {})
		expect(listener).toHaveBeenCalledTimes(1)
	})

	it('encodes outgoing ArrayBuffer and decodes incoming binary messages', () => {
		const task = connectSocket({ url: 'wss://example.test/socket' })
		const listener = vi.fn()
		vi.mocked(invokeAPI).mockClear()

		task.send({ data: new Uint8Array([104, 105]).buffer })
		expect(vi.mocked(invokeAPI).mock.calls[0]).toEqual([
			'sendSocketMessage',
			{
				socketId: task.socketId,
				data: { __diminaArrayBufferBase64: 'aGk=' },
			},
		])

		task.onMessage(listener)
		const eventParams = vi.mocked(invokeAPI).mock.calls[1][1]
		callback.invoke(eventParams.success, {
			data: { __diminaArrayBufferBase64: 'aGk=' },
		})
		expect(bytes(listener.mock.calls[0][0].data)).toEqual([104, 105])
	})

	it('supports binary data and removable listeners on the legacy global APIs', () => {
		const listener = vi.fn()
		onSocketOpen(listener)
		const eventParams = vi.mocked(invokeAPI).mock.calls[0][1]

		expect(eventParams).toEqual({
			listenerId: expect.any(String),
			success: expect.any(String),
		})

		offSocketOpen(listener)
		expect(vi.mocked(invokeAPI).mock.calls[1]).toEqual([
			'offSocketOpen',
			{ listenerId: eventParams.listenerId },
		])
	})

	it('encodes ArrayBuffer for the legacy send API', () => {
		sendSocketMessage({ data: new Uint8Array([1, 2, 3]).buffer })

		expect(vi.mocked(invokeAPI)).toHaveBeenCalledWith('sendSocketMessage', {
			data: { __diminaArrayBufferBase64: 'AQID' },
		})
	})
})
