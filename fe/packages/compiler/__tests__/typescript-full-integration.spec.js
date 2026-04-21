import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import build from '../src/index.js'

describe('TypeScript 完整集成', () => {
	let tempDir

	afterEach(() => {
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it('should honor tsconfig paths, decorator metadata, and declaration emit', async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-full-integration-'))

		const workDir = path.join(tempDir, 'app')
		const outputDir = path.join(tempDir, 'out')

		fs.mkdirSync(path.join(workDir, 'pages/index'), { recursive: true })
		fs.mkdirSync(path.join(workDir, 'src/lib'), { recursive: true })

		fs.writeFileSync(path.join(workDir, 'app.json'), JSON.stringify({
			pages: ['pages/index/index'],
		}))
		fs.writeFileSync(path.join(workDir, 'project.config.json'), JSON.stringify({
			appid: 'ts-full-app-id',
		}))
		fs.writeFileSync(path.join(workDir, 'tsconfig.json'), JSON.stringify({
			compilerOptions: {
				target: 'ES2020',
				module: 'ESNext',
				baseUrl: '.',
				paths: {
					'@lib/*': ['src/lib/*'],
				},
				experimentalDecorators: true,
				emitDecoratorMetadata: true,
				declaration: true,
				skipLibCheck: true,
			},
		}, null, 2))

		fs.writeFileSync(path.join(workDir, 'app.ts'), 'App({})\n')
		fs.writeFileSync(path.join(workDir, 'pages/index/index.json'), JSON.stringify({}))
		fs.writeFileSync(path.join(workDir, 'pages/index/index.wxml'), '<view>ts full</view>\n')

		fs.writeFileSync(path.join(workDir, 'src/lib/helper.ts'), `
export const enum Action {
	Load = 1,
}

export namespace Helper {
	export const prefix = 'action'
}

export function helper(action: Action) {
	return \`\${Helper.prefix}:\${action}\`
}
`)

		fs.writeFileSync(path.join(workDir, 'pages/index/index.ts'), `
import { Action, helper } from '@lib/helper'

function trace(): MethodDecorator {
	return () => {}
}

class Service {
	@trace()
	run(message: string): string {
		return message
	}
}

Page({
	onLoad() {
		const service = new Service()
		console.log(helper(Action.Load), service.run('ok'))
	},
})
`)

		await build(outputDir, workDir, false, { sourcemap: true })

		const logicCode = fs.readFileSync(path.join(outputDir, 'main/logic.js'), 'utf-8')
		const pageTypes = path.join(outputDir, 'types/pages/index/index.d.ts')
		const helperTypes = path.join(outputDir, 'types/src/lib/helper.d.ts')

		expect(logicCode).toContain('require("/src/lib/helper")')
		expect(logicCode).not.toContain('@lib/helper')
		expect(logicCode).toContain('__decorate')
		expect(logicCode).toContain('__metadata')
		expect(fs.existsSync(pageTypes)).toBe(true)
		expect(fs.existsSync(helperTypes)).toBe(true)
		expect(fs.readFileSync(pageTypes, 'utf-8')).toContain('export {}')
		expect(fs.readFileSync(helperTypes, 'utf-8')).toContain('export declare const enum Action')
	})
})
