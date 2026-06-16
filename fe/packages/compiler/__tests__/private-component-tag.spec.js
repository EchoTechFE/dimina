import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * 需求 D — 标签 whitelist：spu-price 活过编译。
 *
 * 沿用 wxs-reserved-context.spec.js 的真实编译范式：
 *   写一个最小项目 -> storeInfo -> compileML -> 读产物 JS 字符串再断言。
 *
 * 当前 tagWhiteList 不含 spu-price，未知标签会被降级成 dd-text，
 * 因此本测试现在应当失败（产物里出现 dd-text 而非 dd-spu-price）。
 */
describe('私有内置组件标签 spu-price', () => {
	let tempDir
	let originalTargetPath

	beforeEach(() => {
		originalTargetPath = process.env.TARGET_PATH
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-component-tag-'))
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

	it('<spu-price> 应编译成内置组件形态 dd-spu-price，而非降级的 dd-text', async () => {
		fs.writeFileSync(path.join(tempDir, 'app.json'), JSON.stringify({
			pages: ['pages/home/index'],
		}))
		fs.writeFileSync(path.join(tempDir, 'project.config.json'), JSON.stringify({
			appid: 'test-app-id',
		}))

		fs.mkdirSync(path.join(tempDir, 'pages/home'), { recursive: true })
		fs.writeFileSync(path.join(tempDir, 'pages/home/index.json'), JSON.stringify({}))
		fs.writeFileSync(path.join(tempDir, 'pages/home/index.wxml'), `
			<spu-price spu-id="{{spuId}}"></spu-price>
		`)
		fs.writeFileSync(path.join(tempDir, 'pages/home/index.js'), `Page({ data: { spuId: '1' } })`)

		const outputDir = path.join(tempDir, 'dist')
		fs.mkdirSync(outputDir, { recursive: true })
		process.env.TARGET_PATH = outputDir

		const { storeInfo, getPages } = await import('../src/env.js')
		storeInfo(tempDir)

		const { compileML } = await import('../src/core/view-compiler.js')
		await compileML(getPages().mainPages, null, { completedTasks: 0 })

		const output = fs.readFileSync(path.join(outputDir, 'main/pages_home_index.js'), 'utf-8')

		// 应识别为内置组件标签
		expect(output).toContain('dd-spu-price')
		// 不应被当成未知标签降级
		expect(output).not.toContain('dd-text')
	})
})
