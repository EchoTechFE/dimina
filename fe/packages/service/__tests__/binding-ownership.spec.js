import { callback as callbackRegistry } from '@dimina/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import loader from '../src/core/loader'
import runtime from '../src/core/runtime'
import { getUpdateQueueStats, resetUpdateQueues } from '../src/core/update-queue'
import { ComponentModule } from '../src/instance/component/component-module'
import { Page } from '../src/instance/page/page'

describe('property binding ownership', () => {
	const bridgeId = 'bridge-binding-owner'
	const componentPath = 'components/binding-owner/index'
	const binding = {
		value: {
			expression: 'value',
			dependencies: ['value'],
			isSimple: true,
			owner: 'service',
		},
	}
	const observerCalls = []

	beforeEach(() => {
		observerCalls.length = 0
		resetUpdateQueues()
		runtime.instances = {}
		runtime.pageStates.clear()
		globalThis.DiminaServiceBridge.publish = vi.fn(() => Promise.resolve())
		loader.staticModules[componentPath] = new ComponentModule({
			data: {},
			properties: {
				value: {
					type: Number,
					value: 0,
					observer(value, oldValue) {
						observerCalls.push(`property:${oldValue}->${value}`)
					},
				},
				localValue: {
					type: Number,
					value: 0,
				},
			},
			observers: {
				value(value) {
					observerCalls.push(`observer:${value}`)
				},
			},
			methods: {},
		}, {
			component: true,
			path: componentPath,
			usingComponents: {},
		})
	})

	function makeOwner(id) {
		const owner = {
			bridgeId,
			data: { value: 0 },
			initd: true,
			__id__: id,
			__info__: {},
			__childPropsBindings__: {},
		}
		owner.setData = Page.prototype.setData
		return owner
	}

	function createChild({
		bindingOwnerId,
		parentId,
		generation,
		propBindings = binding,
		wxsModules,
	}) {
		return runtime.createInstance({
			bridgeId,
			moduleId: 'child',
			path: componentPath,
			pageId: bindingOwnerId,
			bindingOwnerId,
			parentId,
			generation,
			propBindings,
			wxsModules,
			properties: { value: 0 },
			propertyNames: ['value'],
			eventAttr: {},
			targetInfo: {},
		})
	}

	it('propagates after mC even when the component has never attached or become ready', () => {
		const owner = makeOwner('page')
		runtime.instances[bridgeId] = { [owner.__id__]: owner }

		const child = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
		})
		observerCalls.length = 0

		owner.setData({ value: 1 })

		expect(child.__componentAttached__).not.toBe(true)
		expect(child.__componentReadied__).not.toBe(true)
		expect(child.data.value).toBe(1)
		expect(observerCalls).toEqual([
			'observer:1',
			'property:0->1',
		])
		expect(owner.__childPropsBindings__.child).toBe(binding)
	})

	it('replays the lexical owner current value before created-time property observers', () => {
		const owner = makeOwner('page')
		owner.data.value = 5
		runtime.instances[bridgeId] = { [owner.__id__]: owner }

		const child = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
		})

		expect(child.data.value).toBe(5)
		expect(observerCalls).toEqual([
			'observer:5',
			'property:0->5',
		])
	})

	it('evaluates a slotted child against its lexical owner, not its structural parent', () => {
		const lexicalOwner = makeOwner('slot-owner')
		const structuralParent = makeOwner('render-parent')
		runtime.instances[bridgeId] = {
			[lexicalOwner.__id__]: lexicalOwner,
			[structuralParent.__id__]: structuralParent,
		}

		const child = createChild({
			bindingOwnerId: lexicalOwner.__id__,
			parentId: structuralParent.__id__,
		})
		observerCalls.length = 0

		structuralParent.setData({ value: 3 })
		expect(child.data.value).toBe(0)

		lexicalOwner.setData({ value: 2 })
		expect(child.data.value).toBe(2)
		expect(child.__bindingOwnerId__).toBe(lexicalOwner.__id__)
		expect(child.__parentId__).toBe(structuralParent.__id__)
		expect(observerCalls).toEqual([
			'observer:2',
			'property:0->2',
		])
	})

	it('ignores stale Render feedback after Service takes ownership of a property', () => {
		const owner = makeOwner('page')
		runtime.instances[bridgeId] = { [owner.__id__]: owner }
		const child = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
		})
		observerCalls.length = 0

		owner.setData({ value: 1 })
		owner.setData({ value: 2 })
		expect(child.data.value).toBe(2)

		child.tO({ value: 1 })

		expect(child.data.value).toBe(2)
		expect(observerCalls).toEqual([
			'observer:1',
			'property:0->1',
			'observer:2',
			'property:1->2',
		])
	})

	it('rejects stale lifecycle and event messages after the same module id is recreated', async () => {
		const owner = makeOwner('page')
		runtime.instances[bridgeId] = { [owner.__id__]: owner }
		createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
			generation: 1,
		})
		runtime.moduleUnmounted({ bridgeId, moduleId: 'child', generation: 1 })

		const recreated = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
			generation: 2,
		})
		observerCalls.length = 0

		runtime.moduleReady({
			bridgeId,
			moduleId: 'child',
			generation: 1,
			propBindings: {
				value: {
					expression: 'stale',
					dependencies: ['stale'],
					isSimple: true,
				},
			},
		})
		runtime.moduleUnmounted({ bridgeId, moduleId: 'child', generation: 1 })
		await runtime.triggerEvent({
			bridgeId,
			moduleId: 'child',
			generation: 1,
			methodName: 'tO',
			event: { value: 9 },
		})

		expect(runtime.instances[bridgeId].child).toBe(recreated)
		expect(recreated.__generation__).toBe(2)
		expect(recreated.__propBindings__).toBe(binding)
		expect(recreated.data.value).toBe(0)
		expect(observerCalls).toEqual([])
	})

	it('releases binding records, queued updates and callbacks when an instance is destroyed', async () => {
		const owner = makeOwner('page')
		runtime.instances[bridgeId] = { [owner.__id__]: owner }
		const child = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
			generation: 1,
		})
		const callback = vi.fn()
		const existingCallbackIds = new Set(Object.keys(callbackRegistry.callbacks))

		child.setData({ value: 3 }, callback)
		await Promise.resolve()

		expect(getUpdateQueueStats(bridgeId)).toMatchObject({
			pendingCallbacks: 1,
		})
		const callbackIds = Object.keys(callbackRegistry.callbacks)
			.filter(id => !existingCallbackIds.has(id))

		runtime.moduleUnmounted({ bridgeId, moduleId: child.__id__, generation: 1 })

		expect(owner.__childPropsBindings__.child).toBeUndefined()
		expect(runtime.instances[bridgeId].child).toBeUndefined()
		expect(getUpdateQueueStats(bridgeId)).toEqual({
			queuedUpdates: 0,
			queuedCallbacks: 0,
			pendingCallbacks: 0,
		})
		expect(callbackIds.every(id => callbackRegistry.callbacks[id] === undefined)).toBe(true)
		expect(callback).not.toHaveBeenCalled()
	})

	it('uses compiler ownership metadata for complex owner expressions and local scopes', () => {
		const owner = makeOwner('page')
		owner.data.offset = 1
		owner.data.item = { value: 7 }
		runtime.instances[bridgeId] = { [owner.__id__]: owner }

		const child = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
			propBindings: {
				value: {
					expression: 'value + offset',
					dependencies: ['value', 'offset'],
					isSimple: false,
					owner: 'service',
				},
			},
		})
		observerCalls.length = 0

		owner.setData({ value: 2 })
		expect(child.data.value).toBe(3)

		runtime.registerPropertyBindings(child, {
			bindingOwnerId: owner.__id__,
			propBindings: {
				value: {
					expression: 'item.value',
					dependencies: ['item'],
					isSimple: true,
					owner: 'render',
				},
			},
		})
		owner.setData({ 'item.value': 8 })
		expect(child.data.value).toBe(3)

		child.tO({ value: 8 })
		expect(child.data.value).toBe(8)
	})

	it('filters mixed Service and Render ownership per property in one feedback message', () => {
		const owner = makeOwner('page')
		owner.data.item = { value: 7 }
		runtime.instances[bridgeId] = { [owner.__id__]: owner }
		const child = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
			propBindings: {
				value: {
					expression: 'value',
					dependencies: ['value'],
					isSimple: true,
					owner: 'service',
				},
				localValue: {
					expression: 'item.value',
					dependencies: ['item'],
					isSimple: true,
					owner: 'render',
				},
			},
		})
		observerCalls.length = 0

		owner.setData({
			value: 2,
			'item.value': 8,
		})
		expect(child.data).toMatchObject({
			value: 2,
			localValue: 0,
		})

		child.tO({
			value: 1,
			localValue: 8,
		})
		expect(child.data).toMatchObject({
			value: 2,
			localValue: 8,
		})
		expect(observerCalls).toEqual([
			'observer:2',
			'property:0->2',
		])
	})

	it('evaluates an ordinary WXS property binding in the lexical owner Service realm', () => {
		const owner = makeOwner('page')
		runtime.instances[bridgeId] = { [owner.__id__]: owner }
		const child = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
			propBindings: {
				value: {
					expression: 'format.double(value)',
					dependencies: ['format', 'value'],
					isSimple: false,
					owner: 'service',
					wxsRoots: ['format'],
				},
			},
			wxsModules: [{
				path: 'inline_format',
				originalName: 'format',
				code: `
					exports.double = function (value) {
						return value * 2
					}
				`,
			}],
		})
		observerCalls.length = 0

		owner.setData({ value: 3 })

		expect(child.data.value).toBe(6)
		expect(observerCalls).toEqual([
			'observer:6',
			'property:0->6',
		])
		child.tO({ value: 2 })
		expect(child.data.value).toBe(6)
	})

	it('falls back to Render ownership when an older runtime omits WXS module transport', () => {
		const owner = makeOwner('page')
		runtime.instances[bridgeId] = { [owner.__id__]: owner }
		const propBindings = {
			value: {
				expression: 'format.double(value)',
				dependencies: ['format', 'value'],
				isSimple: false,
				owner: 'service',
				wxsRoots: ['format'],
			},
		}
		const child = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
			propBindings,
		})
		observerCalls.length = 0

		owner.setData({ value: 3 })
		expect(child.data.value).toBe(0)
		expect(propBindings.value.owner).toBe('render')

		child.tO({ value: 6 })
		expect(child.data.value).toBe(6)
		expect(observerCalls).toEqual([
			'observer:6',
			'property:0->6',
		])
	})

	it('clears pending acknowledgements even when pageUnload arrives after instances are gone', async () => {
		const owner = makeOwner('page')
		runtime.instances[bridgeId] = { [owner.__id__]: owner }
		const callback = vi.fn()
		const existingCallbackIds = new Set(Object.keys(callbackRegistry.callbacks))

		owner.setData({ value: 1 }, callback)
		await Promise.resolve()
		const callbackIds = Object.keys(callbackRegistry.callbacks)
			.filter(id => !existingCallbackIds.has(id))
		expect(getUpdateQueueStats(bridgeId).pendingCallbacks).toBe(1)

		delete runtime.instances[bridgeId]
		runtime.pageUnload({ bridgeId })

		expect(getUpdateQueueStats(bridgeId)).toEqual({
			queuedUpdates: 0,
			queuedCallbacks: 0,
			pendingCallbacks: 0,
		})
		expect(callbackIds.every(id => callbackRegistry.callbacks[id] === undefined)).toBe(true)
		expect(callback).not.toHaveBeenCalled()
	})

	it.each([
		{
			name: 'current compiler bindings delivered with mC',
			createBindings: {
				value: {
					expression: 'value',
					dependencies: ['value'],
					isSimple: true,
					owner: 'service',
				},
			},
			readyBindings: null,
		},
		{
			name: 'legacy compiler bindings delivered with mR',
			createBindings: null,
			readyBindings: {
				value: {
					expression: 'value',
					dependencies: ['value'],
					isSimple: true,
				},
			},
		},
	])('keeps post-ready propagation and teardown equivalent for $name', ({
		createBindings,
		readyBindings,
	}) => {
		const owner = makeOwner('page')
		runtime.instances[bridgeId] = { [owner.__id__]: owner }
		const child = createChild({
			bindingOwnerId: owner.__id__,
			parentId: owner.__id__,
			generation: 1,
			propBindings: createBindings,
		})

		if (readyBindings) {
			expect(owner.__childPropsBindings__.child).toBeUndefined()
			runtime.moduleReady({
				bridgeId,
				moduleId: child.__id__,
				generation: 1,
				bindingOwnerId: owner.__id__,
				propBindings: readyBindings,
			})
		}
		observerCalls.length = 0

		owner.setData({ value: 4 })

		expect(child.data.value).toBe(4)
		expect(observerCalls).toEqual([
			'observer:4',
			'property:0->4',
		])
		expect(owner.__childPropsBindings__.child).toEqual(createBindings || readyBindings)

		runtime.moduleUnmounted({
			bridgeId,
			moduleId: child.__id__,
			generation: 1,
		})
		expect(owner.__childPropsBindings__.child).toBeUndefined()
		expect(runtime.instances[bridgeId].child).toBeUndefined()
	})
})
