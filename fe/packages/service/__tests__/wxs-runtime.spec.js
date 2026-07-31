import {
	WxsRuntimeError,
	createWxsRuntimeRealm,
} from '../src/core/wxs-runtime'

describe('WXS runtime realm', () => {
	it('loads an inline CommonJS module and exposes it by originalName', () => {
		const realm = createWxsRuntimeRealm([
			{
				path: 'inline_format',
				originalName: 'format',
				code: `
					exports.upper = function (value) {
						return String(value).toUpperCase()
					}
				`,
			},
		])

		const byPath = realm.require('inline_format')

		expect(byPath.upper('wxs')).toBe('WXS')
		expect(realm.requireByName('format')).toBe(byPath)
		expect(realm.getNamedExports()).toEqual({
			format: byPath,
		})
	})

	it('resolves external module dependencies by their processed path', () => {
		const realm = createWxsRuntimeRealm([
			{
				path: 'shared_math',
				code: `
					module.exports = {
						double: function (value) {
							return value * 2
						}
					}
				`,
			},
			{
				path: 'external_summary',
				originalName: 'summary',
				code: `
					var math = require('shared_math')
					module.exports = {
						summarize: function (value) {
							return math.double(value) + 1
						}
					}
				`,
			},
		])

		expect(realm.requireByName('summary').summarize(20)).toBe(41)
	})

	it('initializes each factory only once inside a realm', () => {
		const realm = createWxsRuntimeRealm([
			{
				path: 'counter',
				originalName: 'counter',
				code: `
					var value = 0
					module.exports = {
						next: function () {
							value += 1
							return value
						}
					}
				`,
			},
		])

		const first = realm.require('counter')
		const second = realm.require('counter')

		expect(second).toBe(first)
		expect(first.next()).toBe(1)
		expect(second.next()).toBe(2)
		expect(realm.requireByName('counter')).toBe(first)
	})

	it('keeps mutable module state independent between owner realms', () => {
		const records = [
			{
				path: 'counter',
				originalName: 'counter',
				code: `
					var value = 0
					module.exports = {
						next: function () {
							value += 1
							return value
						}
					}
				`,
			},
		]
		const ownerA = createWxsRuntimeRealm(records)
		const ownerB = createWxsRuntimeRealm(records)

		const counterA = ownerA.requireByName('counter')
		const counterB = ownerB.requireByName('counter')

		expect(counterA).not.toBe(counterB)
		expect(counterA.next()).toBe(1)
		expect(counterA.next()).toBe(2)
		expect(counterB.next()).toBe(1)
	})

	it('supports CommonJS circular dependencies with partial exports', () => {
		const realm = createWxsRuntimeRealm([
			{
				path: 'a',
				originalName: 'a',
				code: `
					exports.name = 'a'
					var b = require('b')
					exports.seenFromB = b.name
				`,
			},
			{
				path: 'b',
				originalName: 'b',
				code: `
					exports.name = 'b'
					var a = require('a')
					exports.seenFromA = a.name
				`,
			},
		])

		expect(realm.require('a')).toEqual({
			name: 'a',
			seenFromB: 'b',
		})
		expect(realm.require('b')).toEqual({
			name: 'b',
			seenFromA: 'a',
		})
	})

	it('wraps missing, compilation, and execution errors with module context', () => {
		const missingRealm = createWxsRuntimeRealm([])
		expect(() => missingRealm.require('missing')).toThrowError(
			expect.objectContaining({
				name: 'WxsRuntimeError',
				code: 'WXS_MODULE_NOT_FOUND',
				modulePath: 'missing',
				requireStack: ['missing'],
			}),
		)

		expect(() => createWxsRuntimeRealm([
			{
				path: 'invalid',
				code: 'module.exports = {',
			},
		])).toThrowError(
			expect.objectContaining({
				name: 'WxsRuntimeError',
				code: 'WXS_MODULE_COMPILE_FAILED',
				modulePath: 'invalid',
			}),
		)

		const executionRealm = createWxsRuntimeRealm([
			{
				path: 'entry',
				code: `require('broken')`,
			},
			{
				path: 'broken',
				code: `throw new Error('broken factory')`,
			},
		])

		try {
			executionRealm.require('entry')
			throw new Error('expected WXS execution to fail')
		}
		catch (error) {
			expect(error).toBeInstanceOf(WxsRuntimeError)
			expect(error).toMatchObject({
				code: 'WXS_MODULE_EXECUTION_FAILED',
				modulePath: 'broken',
				requireStack: ['entry', 'broken'],
			})
			expect(error.cause).toMatchObject({
				message: 'broken factory',
			})
		}
	})

	it('clears registry, cache, and mutable state when the owner is destroyed', () => {
		const records = [
			{
				path: 'state',
				originalName: 'state',
				code: `
					var value = 0
					module.exports = {
						next: function () {
							value += 1
							return value
						}
					}
				`,
			},
		]
		const realm = createWxsRuntimeRealm(records)

		expect(realm.requireByName('state').next()).toBe(1)
		expect(realm.clear()).toBeUndefined()
		expect(realm.clear()).toBeUndefined()
		expect(() => realm.require('state')).toThrowError(
			expect.objectContaining({
				code: 'WXS_REALM_CLEARED',
			}),
		)
		expect(() => realm.getNamedExports()).toThrowError(
			expect.objectContaining({
				code: 'WXS_REALM_CLEARED',
			}),
		)

		const replacementRealm = createWxsRuntimeRealm(records)
		expect(replacementRealm.requireByName('state').next()).toBe(1)
	})
})
