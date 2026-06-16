import { describe, expect, it, vi } from 'vitest'

/**
 * render-only 来源门：纯函数 isRenderOnlyBlocked 的契约测试。
 *
 * 契约（待实现，src/pages/miniApp/render-only-gate.js 具名导出）：
 *   isRenderOnlyBlocked(name, source, renderOnlyApis) -> boolean
 *
 *   返回 true（=拦截）当且仅当 renderOnlyApis.has(name) 且 source !== 'render'。
 *   - 集合不含 name -> 永远 false（任何 source 都放行）。
 *   - 集合含 name 且 source === 'render' -> false（放行）。
 *   - 集合含 name 且 source === 'service' -> true（拦截）。
 *   - 集合含 name 且 source 为 undefined/null/''/其它非 'render' 值 -> true（fail-safe）。
 *   - 空 Set -> 任何输入都 false。
 *
 * 现在 import 会失败（模块不存在），属预期。
 */
import { isRenderOnlyBlocked } from '../src/pages/miniApp/render-only-gate.js'

describe('isRenderOnlyBlocked', () => {
	// 核心 bug 守卫：render-only API 绝不能被 service 来源调用。
	it('blocks a render-only API called from service source', () => {
		const set = new Set(['createSelectorQuery'])

		expect(isRenderOnlyBlocked('createSelectorQuery', 'service', set)).toBe(true)
	})

	it('allows a render-only API called from render source', () => {
		const set = new Set(['createSelectorQuery'])

		expect(isRenderOnlyBlocked('createSelectorQuery', 'render', set)).toBe(false)
	})

	it('allows an API not in the render-only set, regardless of source', () => {
		const set = new Set(['createSelectorQuery'])

		expect(isRenderOnlyBlocked('request', 'service', set)).toBe(false)
		expect(isRenderOnlyBlocked('request', 'render', set)).toBe(false)
		expect(isRenderOnlyBlocked('request', undefined, set)).toBe(false)
	})

	describe('fail-safe: render-only name with a non-render source is blocked', () => {
		it('blocks when source is undefined', () => {
			const set = new Set(['createSelectorQuery'])
			expect(isRenderOnlyBlocked('createSelectorQuery', undefined, set)).toBe(true)
		})

		it('blocks when source is null', () => {
			const set = new Set(['createSelectorQuery'])
			expect(isRenderOnlyBlocked('createSelectorQuery', null, set)).toBe(true)
		})

		it('blocks when source is empty string', () => {
			const set = new Set(['createSelectorQuery'])
			expect(isRenderOnlyBlocked('createSelectorQuery', '', set)).toBe(true)
		})

		it('blocks when source is an arbitrary non-render value', () => {
			const set = new Set(['createSelectorQuery'])
			expect(isRenderOnlyBlocked('createSelectorQuery', 'worker', set)).toBe(true)
			expect(isRenderOnlyBlocked('createSelectorQuery', 'Render', set)).toBe(true) // 大小写敏感
		})
	})

	it('returns false for any input when the set is empty', () => {
		const set = new Set()

		expect(isRenderOnlyBlocked('createSelectorQuery', 'service', set)).toBe(false)
		expect(isRenderOnlyBlocked('createSelectorQuery', 'render', set)).toBe(false)
		expect(isRenderOnlyBlocked('createSelectorQuery', undefined, set)).toBe(false)
		expect(isRenderOnlyBlocked('anything', 'whatever', set)).toBe(false)
	})

	it('supports multiple render-only entries independently', () => {
		const set = new Set(['createSelectorQuery', 'createIntersectionObserver'])

		expect(isRenderOnlyBlocked('createSelectorQuery', 'service', set)).toBe(true)
		expect(isRenderOnlyBlocked('createIntersectionObserver', 'service', set)).toBe(true)
		expect(isRenderOnlyBlocked('createSelectorQuery', 'render', set)).toBe(false)
		expect(isRenderOnlyBlocked('createIntersectionObserver', 'render', set)).toBe(false)
		// 不在集合内的依旧放行
		expect(isRenderOnlyBlocked('navigateTo', 'service', set)).toBe(false)
	})
})

/**
 * 集成式断言：用真函数 isRenderOnlyBlocked 配一个最小 invoke 包装，
 * 验证它在真实调用路径上的行为。不复刻判定逻辑。
 */
describe('isRenderOnlyBlocked integration via a minimal invoke wrapper', () => {
	function makeInvoke(renderOnlyApis) {
		const handler = vi.fn(() => 'OK')
		const invoke = (name, source) => {
			if (isRenderOnlyBlocked(name, source, renderOnlyApis)) {
				return 'BLOCKED'
			}
			return handler(name, source)
		}
		return { invoke, handler }
	}

	it('blocks a render-only API from service and never runs the handler', () => {
		const { invoke, handler } = makeInvoke(new Set(['createSelectorQuery']))

		expect(invoke('createSelectorQuery', 'service')).toBe('BLOCKED')
		expect(handler).not.toHaveBeenCalled()
	})

	it('runs the handler for a render-only API from render source', () => {
		const { invoke, handler } = makeInvoke(new Set(['createSelectorQuery']))

		expect(invoke('createSelectorQuery', 'render')).toBe('OK')
		expect(handler).toHaveBeenCalledWith('createSelectorQuery', 'render')
	})

	it('runs the handler for a normal API regardless of source', () => {
		const { invoke, handler } = makeInvoke(new Set(['createSelectorQuery']))

		expect(invoke('request', 'service')).toBe('OK')
		expect(invoke('request', 'render')).toBe('OK')
		expect(handler).toHaveBeenCalledTimes(2)
	})
})
