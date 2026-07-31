import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('custom component property binding transport', () => {
	let tempDir
	let originalTargetPath

	beforeEach(() => {
		originalTargetPath = process.env.TARGET_PATH
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prop-bindings-transport-'))
	})

	afterEach(() => {
		if (originalTargetPath) {
			process.env.TARGET_PATH = originalTargetPath
		}
		else {
			delete process.env.TARGET_PATH
		}
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it('emits the same descriptor through the legacy directive and the create-time transport prop', async () => {
		fs.writeFileSync(path.join(tempDir, 'app.json'), JSON.stringify({
			pages: ['pages/home/index'],
		}))
		fs.writeFileSync(path.join(tempDir, 'project.config.json'), JSON.stringify({
			appid: 'test-app-id',
		}))
		fs.mkdirSync(path.join(tempDir, 'pages/home'), { recursive: true })
		fs.writeFileSync(path.join(tempDir, 'pages/home/index.json'), JSON.stringify({
			usingComponents: {
				'child-card': '/components/child-card/index',
			},
		}))
		fs.writeFileSync(
			path.join(tempDir, 'pages/home/index.wxml'),
			[
				'<wxs module="fmt">module.exports.value = function (v) { return v < 0 && \'negative\' || v }</wxs>',
				'<child-card count="{{count}}" total="{{count + offset}}" wxs-value="{{fmt.value(count)}}" change:value="{{fmt.onChange}}" />',
				'<block wx:for="{{items}}" wx:for-item="row" wx:for-index="idx">',
				'  <child-card count="{{row.value}}" total="{{idx + offset}}" />',
				'</block>',
			].join(''),
		)
		fs.mkdirSync(path.join(tempDir, 'components/child-card'), { recursive: true })
		fs.writeFileSync(path.join(tempDir, 'components/child-card/index.json'), JSON.stringify({
			component: true,
			properties: {
				count: Number,
				total: Number,
				wxsValue: Number,
			},
		}))
		fs.writeFileSync(path.join(tempDir, 'components/child-card/index.wxml'), '<view />')

		const outputDir = path.join(tempDir, 'dist')
		fs.mkdirSync(outputDir, { recursive: true })
		process.env.TARGET_PATH = outputDir

		const { getPages, storeInfo } = await import('../src/env.js')
		storeInfo(tempDir)
		const { compileML } = await import('../src/core/view-compiler.js')
		await compileML(getPages().mainPages, null, { completedTasks: 0 })

		const output = fs.readFileSync(path.join(outputDir, 'main/pages_home_index.js'), 'utf8')
		expect(output).toContain('c-prop-bindings')
		expect(output).toContain('dimina-prop-bindings')
		expect(output).toContain('dimina-wxs-modules')
		expect(output).toContain("%20'negative'%20")
		expect(output).toContain('change:value')
		expect(output).not.toContain('expression:"fmt.onChange"')
		expect(output.match(/expression:"count"/g)).toHaveLength(2)
		expect(output.match(/expression:"count \+ offset"/g)).toHaveLength(2)
		expect(output.match(/owner:"service"/g)).toHaveLength(6)
		expect(output.match(/owner:"render"/g)).toHaveLength(4)
		expect(output.match(/wxsRoots:\["fmt"\]/g)).toHaveLength(2)
	})
})
