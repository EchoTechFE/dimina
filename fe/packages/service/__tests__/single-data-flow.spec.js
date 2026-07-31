import { beforeEach, describe, expect, it, vi } from 'vitest'
import runtime from '../src/core/runtime'
import { Component } from '../src/instance/component/component'
import { Page } from '../src/instance/page/page'
import { resetUpdateQueues } from '../src/core/update-queue'

const compilerProtocols = [
	{ name: 'legacy compiler descriptor', explicitOwner: false },
	{ name: 'current compiler descriptor', explicitOwner: true },
]

describe.each(compilerProtocols)('single authoritative setData flow ($name)', ({ explicitOwner }) => {
	const bridgeId = 'bridge-single-data-flow'
	const sentMessages = []

	beforeEach(() => {
		sentMessages.length = 0
		resetUpdateQueues()
		runtime.instances = {}
		globalThis.DiminaServiceBridge.publish = vi.fn((_bridgeId, msg) => {
			sentMessages.push(msg)
			return Promise.resolve()
		})
	})

	function makeComponent({ id, parentId, calls }) {
		const component = {
			bridgeId,
			data: { value: 0 },
			initd: true,
			__id__: id,
			__parentId__: parentId,
			__isComponent__: true,
			__info__: {
				properties: {
					value: {
						observer(value, oldValue) {
							calls.push(`${id}:property:${oldValue}->${value}`)
						},
					},
				},
				observers: {
					value(value) {
						calls.push(`${id}:observer:${value}`)
					},
				},
			},
			__childPropsBindings__: {},
			__pendingSyncedProps__: {},
			normalizePropertyValues(data) {
				return data
			},
			normalizePropertyValue(_prop, value) {
				return value
			},
			hasPropertyFilter() {
				return false
			},
		}
		component.tO = Component.prototype.tO
		component.setData = Component.prototype.setData
		return component
	}

	function makeBinding(expression = 'value') {
		return {
			value: {
				expression,
				dependencies: [expression],
				isSimple: true,
				...(explicitOwner ? { owner: 'service' } : {}),
			},
		}
	}

	it('propagates parent assignments through every registered component depth synchronously', async () => {
		const calls = []
		const page = {
			bridgeId,
			data: { value: 0 },
			initd: true,
			__id__: 'page',
			__info__: {},
			__childPropsBindings__: {
				child: makeBinding(),
			},
		}
		page.setData = Page.prototype.setData

		const child = makeComponent({ id: 'child', parentId: page.__id__, calls })
		child.__childPropsBindings__.grandchild = makeBinding()
		const grandchild = makeComponent({
			id: 'grandchild',
			parentId: child.__id__,
			calls,
		})

		runtime.instances[bridgeId] = {
			[page.__id__]: page,
			[child.__id__]: child,
			[grandchild.__id__]: grandchild,
		}

		page.setData({ value: 1 })

		expect(page.data.value).toBe(1)
		expect(child.data.value).toBe(1)
		expect(grandchild.data.value).toBe(1)
		expect(calls).toEqual([
			'child:observer:1',
			'grandchild:observer:1',
			'grandchild:property:0->1',
			'child:property:0->1',
		])

		await Promise.resolve()
		expect(sentMessages).toHaveLength(1)
		expect(sentMessages[0].body.updates.map(update => update.moduleId)).toEqual([
			'page',
			'child',
			'grandchild',
		])
	})

	it('does not mistake a repeated service assignment for render feedback', () => {
		const calls = []
		const page = {
			bridgeId,
			data: { value: 0 },
			initd: true,
			__id__: 'page',
			__info__: {},
			__childPropsBindings__: {
				child: makeBinding(),
			},
		}
		page.setData = Page.prototype.setData

		const child = makeComponent({ id: 'child', parentId: page.__id__, calls })
		child.__childPropsBindings__.grandchild = makeBinding()
		const grandchild = makeComponent({
			id: 'grandchild',
			parentId: child.__id__,
			calls,
		})
		runtime.instances[bridgeId] = { page, child, grandchild }

		page.setData({ value: 1 })
		page.setData({ value: 1 })

		expect(calls).toEqual([
			'child:observer:1',
			'grandchild:observer:1',
			'grandchild:property:0->1',
			'child:property:0->1',
			'child:observer:1',
			'grandchild:observer:1',
		])
	})

	it('keeps the root-first render order when a child observer calls setData', async () => {
		const calls = []
		const page = {
			bridgeId,
			data: { value: 0 },
			initd: true,
			__id__: 'page',
			__info__: {},
			__childPropsBindings__: {
				child: makeBinding(),
			},
		}
		page.setData = Page.prototype.setData

		const child = makeComponent({ id: 'child', parentId: page.__id__, calls })
		child.data.derived = 0
		child.__info__.observers.value = function valueObserver(value) {
			calls.push(`child:observer:${value}`)
			this.setData({ derived: value * 2 })
		}
		child.__childPropsBindings__.grandchild = makeBinding('derived')
		const grandchild = makeComponent({
			id: 'grandchild',
			parentId: child.__id__,
			calls,
		})
		runtime.instances[bridgeId] = { page, child, grandchild }

		page.setData({ value: 2 })

		expect(child.data).toMatchObject({ value: 2, derived: 4 })
		expect(grandchild.data.value).toBe(4)
		expect(calls).toEqual([
			'child:observer:2',
			'grandchild:observer:4',
			'grandchild:property:0->4',
			'child:property:0->2',
		])

		await Promise.resolve()
		expect(sentMessages).toHaveLength(1)
		expect(sentMessages[0].body.updates.map(update => update.moduleId)).toEqual([
			'page',
			'child',
			'grandchild',
		])
	})
})
