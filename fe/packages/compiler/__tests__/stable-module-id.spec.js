import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Guards the deterministic-id change (env.js page/component `id` now derives
 * from the canonical path via `stableModuleId` instead of `uuid()`). A stable
 * id across builds is the prerequisite for state-preserving template HMR: the
 * runtime `data-v-${id}` scope id / Vue HMR record key must survive a recompile.
 */
function writeFixture(dir) {
	fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({
		pages: ['pages/home/index', 'pages/list/index'],
	}))
	fs.writeFileSync(path.join(dir, 'project.config.json'), JSON.stringify({ appid: 'id-stability' }))
	for (const p of ['pages/home', 'pages/list']) {
		fs.mkdirSync(path.join(dir, p), { recursive: true })
		fs.writeFileSync(path.join(dir, p, 'index.json'), JSON.stringify({}))
		fs.writeFileSync(path.join(dir, p, 'index.wxml'), '<view>{{ x }}</view>')
	}
}

describe('stableModuleId: deterministic page/component ids', () => {
	let tempDir
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-id-'))
		writeFixture(tempDir)
	})
	afterEach(() => {
		if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it('produces the SAME page id across two independent storeInfo runs', async () => {
		const env = await import('../src/env.js')
		env.storeInfo(tempDir)
		const idA = env.getPages().mainPages.find(p => p.path === 'pages/home/index').id
		env.storeInfo(tempDir)
		const idB = env.getPages().mainPages.find(p => p.path === 'pages/home/index').id
		expect(idA).toBe(idB)
	})

	it('different module paths get different ids (no collision)', async () => {
		const env = await import('../src/env.js')
		env.storeInfo(tempDir)
		const pages = env.getPages().mainPages
		const home = pages.find(p => p.path === 'pages/home/index').id
		const list = pages.find(p => p.path === 'pages/list/index').id
		expect(home).not.toBe(list)
	})

	it('id is a CSS-identifier-safe token (valid in `data-v-${id}`)', async () => {
		const env = await import('../src/env.js')
		env.storeInfo(tempDir)
		const id = env.getPages().mainPages.find(p => p.path === 'pages/home/index').id
		expect(id).toMatch(/^[a-z][a-z0-9]*$/)
	})
})
