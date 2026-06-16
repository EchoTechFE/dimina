import { describe, expect, it } from 'vitest'
import { processWxsContent } from '../src/core/view-compiler'

/**
 * WXS 安全加固契约测试。
 *
 * 调用入口：processWxsContent(wxsContent, wxsFilePath, scriptModule, workPath, filePath)
 *   —— 这是 view-compiler 对单段 WXS 源码做编译转换的真实入口，
 *      已被 view-compiler.spec.js 大量复用（getRegExp/getDate/constructor 转换都走它）。
 *      产物字符串就是最终被 require() 的 WXS 模块体。
 *
 * 这些测试现在应当全部失败——实现尚未加上 'use strict' 注入与 AST 黑名单。
 */

// 统一的调用助手：用最接近真实编译的方式跑单段 WXS。
function compileWxs(src) {
	return processWxsContent(src, 'inline.wxs', [], '', '')
}

describe('需求 A — WXS 编译产物加 use strict', () => {
	it('合法 WXS 编译产物应包含严格模式指令 use strict', () => {
		const src = `module.exports = { f: function(){ return 1 } }`
		const out = compileWxs(src)
		// 目的：让 fn.call(null) 时 this 不再是全局对象
		expect(out).toMatch(/['"]use strict['"]/)
	})

	it('即使 WXS 内只有函数声明也应注入 use strict', () => {
		const src = `
			function add(a, b) { return a + b }
			module.exports = { add: add }
		`
		const out = compileWxs(src)
		expect(out).toMatch(/['"]use strict['"]/)
	})
})

describe('需求 B — WXS 编译期 AST 黑名单（命中即编译报错）', () => {
	describe('危险标识符引用', () => {
		const dangerousIdentifierCases = {
			'window': `var x = window`,
			'globalThis': `var x = globalThis`,
			'self': `var x = self`,
			'global': `var x = global`,
			'document': `var d = document`,
			'Function': `Function('return this')()`,
			'eval': `eval('1+1')`,
		}

		for (const [name, src] of Object.entries(dangerousIdentifierCases)) {
			it(`引用危险标识符 ${name} 应编译报错`, () => {
				expect(() => compileWxs(src)).toThrow()
			})
		}
	})

	describe('危险成员名访问（静态点访问）', () => {
		const dangerousStaticMemberCases = {
			'.__proto__': `var p = obj.__proto__`,
			'.prototype': `var c = Array.prototype`,
		}

		for (const [name, src] of Object.entries(dangerousStaticMemberCases)) {
			it(`静态访问危险成员 ${name} 应编译报错`, () => {
				expect(() => compileWxs(src)).toThrow()
			})
		}
	})

	describe('静态 .constructor 是合法 WXS 特性（改写成类型名字符串，不报错）', () => {
		// dimina 已有合法行为：静态 x.constructor 被改写成
		// Object.prototype.toString.call(x).slice(8, -1)，模拟 WXS 中
		// [].constructor === 'Array' 的规范语义。故不该报错。
		it('静态 var c = x.constructor 应编译通过', () => {
			const src = `var c = x.constructor`
			expect(() => compileWxs(src)).not.toThrow()
		})

		it('静态 .constructor 产物应改写成类型名形式，且不再有裸的活 .constructor 访问', () => {
			const src = `var c = x.constructor`
			const out = compileWxs(src)
			// 已改写成类型名字符串形式
			expect(out).toContain('Object.prototype.toString')
			// 不再保留可拿到构造器的活访问
			expect(out).not.toMatch(/\.constructor\b/)
		})
	})

	describe('危险成员名访问（字符串字面量计算式访问）', () => {
		const dangerousComputedMemberCases = {
			"['constructor']": `var c = [][ 'constructor' ]`,
			"['__proto__']": `var p = obj['__proto__']`,
			"['prototype']": `var c = Array['prototype']`,
		}

		for (const [name, src] of Object.entries(dangerousComputedMemberCases)) {
			it(`字符串字面量计算式访问危险成员 ${name} 应编译报错`, () => {
				expect(() => compileWxs(src)).toThrow()
			})
		}
	})

	describe('组合逃逸表达式', () => {
		it('全静态 [].constructor.constructor("return this")() 应编译通过（被改写成类型名，拿不到 Function）', () => {
			const src = `var f = [].constructor.constructor('return this')()`
			// 静态 .constructor 是合法特性，会被改写成类型名字符串，
			// 因此整条逃逸链失效——不报错。
			expect(() => compileWxs(src)).not.toThrow()
			const out = compileWxs(src)
			// 产物里 .constructor 已被改写成类型名形式
			expect(out).toContain('Object.prototype.toString')
		})

		it("计算式 []['constructor'] 应编译报错", () => {
			const src = `var f = []['constructor']`
			expect(() => compileWxs(src)).toThrow()
		})

		it("计算式 []['constructor']['constructor'] 应编译报错", () => {
			const src = `var f = []['constructor']['constructor']`
			expect(() => compileWxs(src)).toThrow()
		})
	})
})

describe('需求 C — 合法 WXS 不被误伤（必须仍编译通过）', () => {
	const legalCases = {
		'数组下标 u[i]': `var x = u[i]`,
		// 动态键属性访问目前允许通过——动态键混淆是已知接受的残留，不应被黑名单拦下
		'动态键属性访问 data[key]': `var v = data[key]`,
		"字符串方法 'abc'.indexOf('b')": `var i = 'abc'.indexOf('b')`,
		"arr.split(',')": `var parts = arr.split(',')`,
		'Math.max(1,2)': `var m = Math.max(1, 2)`,
		'JSON.stringify(o)': `var s = JSON.stringify(o)`,
		'普通属性 obj.field': `var f = obj.field`,
		'module.exports 对象': `module.exports = { a: 1, b: function(){ return 2 } }`,
		"require('./other.wxs')": `var other = require('./other.wxs')`,
	}

	for (const [name, src] of Object.entries(legalCases)) {
		it(`${name} 应正常编译、不报错`, () => {
			expect(() => compileWxs(src)).not.toThrow()
		})
	}
})
