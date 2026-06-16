import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * 外部平台组件标签清单（externalComponents）能力。
 *
 * 契约：
 * storeInfo(workPath, { externalComponents: ['demo-widget'] }) 声明一批“外部组件标签名”，
 * 让任意名字的标签活过编译（emit dd-<name>）而不被降级成 dd-text，
 * 且不需要 usingComponents、不注册成内置/Vue 组件。
 *
 * 这些标签由外部宿主平台提供，编译器只需保留标签、不去解析其实现。
 *
 * 注：两个用例用**不同页面路径**（with-ext / no-ext），因为编译器按页面路径缓存模块，
 * 共用同一路径会让后跑的用例命中前一个用例的缓存产物（与 externalComponents 无关的串扰）。
 */
describe('externalComponents 外部组件标签清单', () => {
	let tempDir
	let originalTargetPath

	// pagePath 形如 'pages/with-ext/index'，各用例用不同路径以隔离编译缓存
	function writePage(dir, pagePath) {
		fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({
			pages: [pagePath],
		}))
		fs.writeFileSync(path.join(dir, 'project.config.json'), JSON.stringify({
			appid: 'test-app-id',
		}))

		const pageDir = path.join(dir, path.dirname(pagePath))
		fs.mkdirSync(pageDir, { recursive: true })
		fs.writeFileSync(path.join(pageDir, 'index.json'), JSON.stringify({}))
		fs.writeFileSync(path.join(pageDir, 'index.wxml'), `
			<view>
				<demo-widget foo="{{x}}"></demo-widget>
			</view>
		`)

		const outputDir = path.join(dir, 'dist')
		fs.mkdirSync(outputDir, { recursive: true })
		return outputDir
	}

	beforeEach(() => {
		originalTargetPath = process.env.TARGET_PATH
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-components-'))
	})

	afterEach(() => {
		if (originalTargetPath) {
			process.env.TARGET_PATH = originalTargetPath
		}
		else {
			delete process.env.TARGET_PATH
		}

		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it('声明 externalComponents 后，对应标签应活过编译（dd-demo-widget），不降级 dd-text', async () => {
		const pagePath = 'pages/with-ext/index'
		const outputDir = writePage(tempDir, pagePath)
		process.env.TARGET_PATH = outputDir

		const { storeInfo, getPages } = await import('../src/env.js')
		storeInfo(tempDir, { externalComponents: ['demo-widget'] })

		const { compileML } = await import('../src/core/view-compiler.js')
		await compileML(getPages().mainPages, null, { completedTasks: 0 })

		const output = fs.readFileSync(path.join(outputDir, 'main/pages_with-ext_index.js'), 'utf-8')
		expect(output).toContain('dd-demo-widget')
		expect(output).not.toContain('dd-text')
	})

	it('不声明 externalComponents 时，未知标签应被降级成 dd-text（对照用例，防止凭空放过）', async () => {
		const pagePath = 'pages/no-ext/index'
		const outputDir = writePage(tempDir, pagePath)
		process.env.TARGET_PATH = outputDir

		const { storeInfo, getPages } = await import('../src/env.js')
		// 不传第二参（也可传 {}），证明该能力确实由 externalComponents 选项驱动
		storeInfo(tempDir)

		const { compileML } = await import('../src/core/view-compiler.js')
		await compileML(getPages().mainPages, null, { completedTasks: 0 })

		const output = fs.readFileSync(path.join(outputDir, 'main/pages_no-ext_index.js'), 'utf-8')
		expect(output).toContain('dd-text')
		expect(output).not.toContain('dd-demo-widget')
	})
})
