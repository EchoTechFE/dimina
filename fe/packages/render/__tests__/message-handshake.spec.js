import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDataFunctionReference } from '@dimina/common'

describe('render message handshake', () => {
	afterEach(() => {
		vi.resetModules()
		delete globalThis.window
	})

	it('registers the response listener before sending a synchronous request', async () => {
		globalThis.window = {
			DiminaRenderBridge: {
				publish: vi.fn((rawMessage) => {
					const request = JSON.parse(rawMessage)
					window.DiminaRenderBridge.onMessage({
						type: request.body.moduleId,
						body: { data: { created: true } },
					})
				}),
			},
		}

		const message = (await import('../src/core/message')).default
		const response = await message.waitAndSend('component-1', {
			type: 'mC',
			target: 'service',
			body: { bridgeId: 'bridge-1', moduleId: 'component-1' },
		})

		expect(response).toEqual({ created: true })
		expect(window.DiminaRenderBridge.publish).toHaveBeenCalledTimes(1)
	})

	it('ignores an explicitly stale generation while accepting a legacy response without one', async () => {
		globalThis.window = {
			DiminaRenderBridge: {
				publish: vi.fn(),
			},
		}

		const message = (await import('../src/core/message')).default
		const responsePromise = message.waitAndSend('component-reused', {
			type: 'mC',
			target: 'service',
			body: {
				bridgeId: 'bridge-1',
				moduleId: 'component-reused',
				generation: 'current-generation',
			},
		}, {
			generation: 'current-generation',
		})
		let settled = false
		responsePromise.then(() => {
			settled = true
		})

		window.DiminaRenderBridge.onMessage({
			type: 'component-reused',
			body: {
				generation: 'old-generation',
				data: { stale: true },
			},
		})
		await Promise.resolve()
		expect(settled).toBe(false)

		window.DiminaRenderBridge.onMessage({
			type: 'component-reused',
			body: {
				data: { legacy: true },
			},
		})
		await expect(responsePromise).resolves.toEqual({ legacy: true })
	})

	it('cancels a pending response listener without rejecting when setup is disposed', async () => {
		globalThis.window = {
			DiminaRenderBridge: {
				publish: vi.fn(),
			},
		}

		const message = (await import('../src/core/message')).default
		const controller = new AbortController()
		const responsePromise = message.waitAndSend('component-never-responds', {
			type: 'mC',
			target: 'service',
			body: {
				bridgeId: 'bridge-1',
				moduleId: 'component-never-responds',
				generation: 'generation-1',
			},
		}, {
			generation: 'generation-1',
			signal: controller.signal,
		})

		expect(message.listenerCount('component-never-responds')).toBe(1)
		controller.abort()
		await expect(responsePromise).resolves.toBeUndefined()
		expect(message.listenerCount('component-never-responds')).toBe(0)

		// A late Service response has no remaining listener or side effect.
		window.DiminaRenderBridge.onMessage({
			type: 'component-never-responds',
			body: {
				generation: 'generation-1',
				data: { late: true },
			},
		})
		expect(message.listenerCount('component-never-responds')).toBe(0)
	})

	it('hydrates stable function proxies and serializes them back to references', async () => {
		globalThis.window = {
			DiminaRenderBridge: {
				publish: vi.fn(),
			},
		}

		const message = (await import('../src/core/message')).default
		const received = vi.fn()
		message.on('data-functions', received)
		const reference = createDataFunctionReference('function-1')

		window.DiminaRenderBridge.onMessage({
			type: 'data-functions',
			body: {
				fn: reference,
				list: [reference],
			},
		})

		const body = received.mock.calls[0][0]
		expect(body.fn).toBeTypeOf('function')
		expect(body.list[0]).toBe(body.fn)
		expect(JSON.parse(JSON.stringify(body))).toEqual({
			fn: reference,
			list: [reference],
		})
	})
})
