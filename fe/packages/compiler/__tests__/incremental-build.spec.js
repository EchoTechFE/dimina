import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import build from '../src/index.js'

/**
 * 增量编译 v1（保守）契约测试
 *
 * 入口：build(target, work, useAppIdDir, { changedFiles })
 *   changedFiles: { path: string, type: 'add'|'change'|'unlink' }[]
 *     path 相对项目根的源文件路径
 *
 * 设计原则：正确性优先。无法安全判断影响范围的改动一律回退全量。
 *
 * 这些测试在「增量编译」实现存在之前应当全部失败：
 *   - changedFiles 选项尚未被消费 → build 仍走全量 → 「未受影响产物字节不变」断言失败
 *     （全量会重写所有产物，可能 mtime/字节因 data-v hash 顺序等变化；
 *      但核心是：增量语义未实现，故针对增量行为的精确断言无法满足）。
 *
 * 注意：本文件不触碰任何现有测试；无 changedFiles 时行为必须保持全量不变。
 */

const APP_ID = 'incr-app'

// 多页面 + 一个被两页用的组件 + 一个共享 util.js
function scaffold(work) {
	fs.writeFileSync(path.join(work, 'app.json'), JSON.stringify({
		pages: ['pages/home/index', 'pages/about/index', 'pages/lonely/index'],
	}))
	fs.writeFileSync(path.join(work, 'project.config.json'), JSON.stringify({ appid: APP_ID }))
	fs.writeFileSync(path.join(work, 'app.js'), 'App({})')
	fs.writeFileSync(path.join(work, 'app.wxss'), '')

	// util.js：被 home 引用，但本身不是页面/组件
	fs.mkdirSync(path.join(work, 'utils'), { recursive: true })
	fs.writeFileSync(path.join(work, 'utils/format.js'), 'module.exports.fmt = function (v) { return "FMT_V1_" + v }')

	// 共享组件 card：被 home + about 引用
	fs.mkdirSync(path.join(work, 'components/card'), { recursive: true })
	fs.writeFileSync(path.join(work, 'components/card/index.json'), JSON.stringify({ component: true }))
	fs.writeFileSync(path.join(work, 'components/card/index.wxml'), '<view class="card">CARD_MARK_V1</view>')
	fs.writeFileSync(path.join(work, 'components/card/index.wxss'), '.card{color:green}')
	fs.writeFileSync(path.join(work, 'components/card/index.js'), 'Component({})')

	// home：用 card + require util
	fs.mkdirSync(path.join(work, 'pages/home'), { recursive: true })
	fs.writeFileSync(path.join(work, 'pages/home/index.json'), JSON.stringify({
		usingComponents: { card: '/components/card/index' },
	}))
	fs.writeFileSync(path.join(work, 'pages/home/index.wxml'), '<view>HOME_MARK_V1<card /></view>')
	fs.writeFileSync(path.join(work, 'pages/home/index.wxss'), '.home{color:red}')
	fs.writeFileSync(path.join(work, 'pages/home/index.js'), 'var f = require("../../utils/format.js"); Page({ data: { x: "HOME_LOGIC_V1" } })')

	// about：用 card
	fs.mkdirSync(path.join(work, 'pages/about'), { recursive: true })
	fs.writeFileSync(path.join(work, 'pages/about/index.json'), JSON.stringify({
		usingComponents: { card: '/components/card/index' },
	}))
	fs.writeFileSync(path.join(work, 'pages/about/index.wxml'), '<view>ABOUT_MARK_V1<card /></view>')
	fs.writeFileSync(path.join(work, 'pages/about/index.wxss'), '.about{color:blue}')
	fs.writeFileSync(path.join(work, 'pages/about/index.js'), 'Page({ data: { x: "ABOUT_LOGIC_V1" } })')

	// lonely：不用 card，独立
	fs.mkdirSync(path.join(work, 'pages/lonely'), { recursive: true })
	fs.writeFileSync(path.join(work, 'pages/lonely/index.json'), JSON.stringify({}))
	fs.writeFileSync(path.join(work, 'pages/lonely/index.wxml'), '<view>LONELY_MARK_V1</view>')
	fs.writeFileSync(path.join(work, 'pages/lonely/index.wxss'), '.lonely{color:black}')
	fs.writeFileSync(path.join(work, 'pages/lonely/index.js'), 'Page({ data: { x: "LONELY_LOGIC_V1" } })')
}

describe('增量编译 v1（保守）', () => {
	let work
	let dist
	let mainDir

	beforeEach(() => {
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-work-'))
		dist = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-dist-'))
		// 让 build 在临时内部目录暂存，避免污染共享 TARGET_PATH
		process.env.TARGET_PATH = path.join(work, '_internal_dist')
		mainDir = path.join(dist, APP_ID, 'main')
		scaffold(work)
	})

	afterEach(() => {
		delete process.env.TARGET_PATH
		for (const d of [work, dist]) {
			if (d && fs.existsSync(d)) {
				fs.rmSync(d, { recursive: true, force: true })
			}
		}
	})

	const view = page => path.join(mainDir, `pages_${page}_index.js`)
	const style = page => path.join(mainDir, `pages_${page}_index.css`)
	const logic = () => path.join(mainDir, 'logic.js')

	const read = p => fs.readFileSync(p, 'utf-8')
	const readBytes = p => fs.readFileSync(p)
	// inode 是「文件是否被重新创建」的可靠判别：
	// 全量编译会 rm 整个产物目录再 copy → 即便内容字节相同，inode 也会变。
	// 真增量只重写受影响产物，未受影响产物 inode 保持不变。
	// 仅靠字节对比无法区分全量与增量（编译器确定性输出会让字节相同）。
	const inode = p => fs.statSync(p).ino

	async function fullBuild() {
		await build(dist, work, true)
	}
	async function incrBuild(changedFiles) {
		await build(dist, work, true, { changedFiles })
	}

	// ── 契约 1：首次/无 changedFiles = 全量 + output-manifest ─────────────
	describe('契约1 全量基线 + output-manifest', () => {
		it('无 changedFiles 时全量编译，产物齐全（行为不变）', async () => {
			// 防 bug：增量入口意外改变了无 changedFiles 的默认全量行为。
			await fullBuild()
			expect(fs.existsSync(view('home'))).toBe(true)
			expect(fs.existsSync(view('about'))).toBe(true)
			expect(fs.existsSync(view('lonely'))).toBe(true)
			expect(fs.existsSync(logic())).toBe(true)
			expect(read(view('home'))).toContain('HOME_MARK_V1')
			expect(read(logic())).toContain('HOME_LOGIC_V1')
		})

		it('重复全量编译后，产物文件集合一致（manifest 应记录产物，便于后续清理）', async () => {
			// 防 bug：缺少 output-manifest / 产物集合在重复编译间漂移。
			// 不硬编码 manifest 文件名，只验「产物集合稳定」这一可观察契约。
			await fullBuild()
			const first = fs.readdirSync(mainDir).sort()
			await fullBuild()
			const second = fs.readdirSync(mainDir).sort()
			// 至少应包含三个页面 view，且两次集合相同
			expect(second).toEqual(first)
			expect(first).toEqual(expect.arrayContaining([
				'pages_home_index.js',
				'pages_about_index.js',
				'pages_lonely_index.js',
				'logic.js',
			]))
		})
	})

	// ── 契约 2：只改某页 .wxml → 该页 view 更新，其它页 view 字节不变 ──────
	describe('契约2 改页面 .wxml', () => {
		it('只重编受影响页 view，其它页 view 字节不变', async () => {
			// 防 bug：把别的页面也重编了（或全量），破坏「未受影响字节不变」。
			await fullBuild()
			const aboutBefore = readBytes(view('about'))
			const lonelyBefore = readBytes(view('lonely'))
			const aboutIno = inode(view('about'))
			const lonelyIno = inode(view('lonely'))

			fs.writeFileSync(path.join(work, 'pages/home/index.wxml'), '<view>HOME_MARK_V2<card /></view>')
			await incrBuild([{ path: 'pages/home/index.wxml', type: 'change' }])

			// 受影响页 view 更新为新模板
			const homeAfter = read(view('home'))
			expect(homeAfter).toContain('HOME_MARK_V2')
			expect(homeAfter).not.toContain('HOME_MARK_V1')

			// 其它页 view 未被重新生成：字节不变 + inode 不变（未重编）
			expect(readBytes(view('about')).equals(aboutBefore)).toBe(true)
			expect(readBytes(view('lonely')).equals(lonelyBefore)).toBe(true)
			expect(inode(view('about'))).toBe(aboutIno)
			expect(inode(view('lonely'))).toBe(lonelyIno)
		})
	})

	// ── 契约 3：只改某页 .wxss → 该页 css 更新，其它页 css 不变 ───────────
	describe('契约3 改页面 .wxss', () => {
		it('只重编受影响页 css，其它页 css 字节不变', async () => {
			// 防 bug：样式增量误重编其它页样式。
			await fullBuild()
			const aboutBefore = readBytes(style('about'))
			const lonelyBefore = readBytes(style('lonely'))
			const aboutIno = inode(style('about'))
			const lonelyIno = inode(style('lonely'))

			fs.writeFileSync(path.join(work, 'pages/home/index.wxss'), '.home{color:hotpink}')
			await incrBuild([{ path: 'pages/home/index.wxss', type: 'change' }])

			expect(read(style('home'))).toContain('hotpink')
			expect(readBytes(style('about')).equals(aboutBefore)).toBe(true)
			expect(readBytes(style('lonely')).equals(lonelyBefore)).toBe(true)
			// 其它页 css 未被重新生成（inode 不变）
			expect(inode(style('about'))).toBe(aboutIno)
			expect(inode(style('lonely'))).toBe(lonelyIno)
		})
	})

	// ── 契约 4：改某页 .js → 整个分包 logic.js 重编（blocker 1）─────────────
	describe('契约4 改页面 .js（logic 按分包整包）', () => {
		it('主包 logic.js 重编并含新逻辑，且仍包含同包其它页逻辑', async () => {
			// 防 bug：logic 被错误地按页拆分增量，导致 logic.js 丢失同包其它页。
			await fullBuild()
			expect(read(logic())).toContain('HOME_LOGIC_V1')
			expect(read(logic())).toContain('ABOUT_LOGIC_V1')

			fs.writeFileSync(
				path.join(work, 'pages/home/index.js'),
				'var f = require("../../utils/format.js"); Page({ data: { x: "HOME_LOGIC_V2" } })',
			)
			await incrBuild([{ path: 'pages/home/index.js', type: 'change' }])

			const after = read(logic())
			expect(after).toContain('HOME_LOGIC_V2')
			expect(after).not.toContain('HOME_LOGIC_V1')
			// 同分包其它页逻辑不能因增量丢失
			expect(after).toContain('ABOUT_LOGIC_V1')
			expect(after).toContain('LONELY_LOGIC_V1')
		})
	})

	// ── 契约 5：改被多页用的组件 .wxml → 所有引用页 view 更新，未引用页不变 ──
	describe('契约5 改共享组件 .wxml', () => {
		it('所有引用该组件的页 view 更新，未引用页 view 字节不变', async () => {
			// 防 bug：组件变更未传播到全部引用页（漏编），或误编未引用页。
			await fullBuild()
			expect(read(view('home'))).toContain('CARD_MARK_V1')
			expect(read(view('about'))).toContain('CARD_MARK_V1')
			const lonelyBefore = readBytes(view('lonely'))
			const lonelyIno = inode(view('lonely'))

			fs.writeFileSync(path.join(work, 'components/card/index.wxml'), '<view class="card">CARD_MARK_V2</view>')
			await incrBuild([{ path: 'components/card/index.wxml', type: 'change' }])

			// home + about（都引用 card）的 view 都应更新
			expect(read(view('home'))).toContain('CARD_MARK_V2')
			expect(read(view('home'))).not.toContain('CARD_MARK_V1')
			expect(read(view('about'))).toContain('CARD_MARK_V2')
			expect(read(view('about'))).not.toContain('CARD_MARK_V1')

			// lonely 不引用 card：字节不变 + 未被重新生成（inode 不变）
			expect(readBytes(view('lonely')).equals(lonelyBefore)).toBe(true)
			expect(inode(view('lonely'))).toBe(lonelyIno)
		})
	})

	// ── 契约 6：保守全量兜底 ────────────────────────────────────────────────
	describe('契约6 保守全量兜底', () => {
		it('改 app.json → 全量（所有产物按全量重算）', async () => {
			// 防 bug：app.json 变更被当增量处理，导致页面增删未生效。
			await fullBuild()

			// 把 lonely 从 about 之后挪到前面（重排），并改 home 内容；
			// 只有全量才能保证所有页面与配置一致重算。
			fs.writeFileSync(path.join(work, 'app.json'), JSON.stringify({
				pages: ['pages/home/index', 'pages/about/index', 'pages/lonely/index'],
				window: { navigationBarTitleText: 'CHANGED' },
			}))
			fs.writeFileSync(path.join(work, 'pages/home/index.wxml'), '<view>HOME_MARK_V2<card /></view>')

			await incrBuild([{ path: 'app.json', type: 'change' }])

			// 全量兜底：home 新内容、其它页齐全
			expect(read(view('home'))).toContain('HOME_MARK_V2')
			expect(fs.existsSync(view('about'))).toBe(true)
			expect(fs.existsSync(view('lonely'))).toBe(true)
			// app-config.json 应反映新配置
			expect(read(path.join(mainDir, 'app-config.json'))).toContain('CHANGED')
		})

		it('改 project.config.json → 全量', async () => {
			// 防 bug：项目配置变更被增量跳过。
			await fullBuild()
			fs.writeFileSync(path.join(work, 'project.config.json'), JSON.stringify({ appid: APP_ID, projectname: 'renamed' }))
			fs.writeFileSync(path.join(work, 'pages/home/index.wxml'), '<view>HOME_MARK_V2<card /></view>')
			await incrBuild([{ path: 'project.config.json', type: 'change' }])
			// 全量兜底应重算 home
			expect(read(view('home'))).toContain('HOME_MARK_V2')
		})

		it('新增文件（type:add）→ 全量', async () => {
			// 防 bug：新增页面/文件未触发全量，新产物缺失。
			await fullBuild()
			// 新增一个页面并登记到 app.json（但 changedFiles 只标 add 该 wxml，
			// 测「add 必走全量」这条保守规则）。
			fs.mkdirSync(path.join(work, 'pages/fresh'), { recursive: true })
			fs.writeFileSync(path.join(work, 'pages/fresh/index.json'), JSON.stringify({}))
			fs.writeFileSync(path.join(work, 'pages/fresh/index.wxml'), '<view>FRESH_MARK</view>')
			fs.writeFileSync(path.join(work, 'pages/fresh/index.wxss'), '')
			fs.writeFileSync(path.join(work, 'pages/fresh/index.js'), 'Page({})')
			fs.writeFileSync(path.join(work, 'app.json'), JSON.stringify({
				pages: ['pages/home/index', 'pages/about/index', 'pages/lonely/index', 'pages/fresh/index'],
			}))

			await incrBuild([{ path: 'pages/fresh/index.wxml', type: 'add' }])

			// 全量兜底：新页面产物存在
			expect(fs.existsSync(view('fresh'))).toBe(true)
			expect(read(view('fresh'))).toContain('FRESH_MARK')
		})

		it('删除文件（type:unlink）→ 全量', async () => {
			// 防 bug：删除被增量当作 no-op。unlink 必须走全量。
			await fullBuild()
			// 删 about，更新 app.json 移除它
			fs.rmSync(path.join(work, 'pages/about'), { recursive: true, force: true })
			fs.writeFileSync(path.join(work, 'app.json'), JSON.stringify({
				pages: ['pages/home/index', 'pages/lonely/index'],
			}))
			fs.writeFileSync(path.join(work, 'pages/home/index.wxml'), '<view>HOME_MARK_V2<card /></view>')

			await incrBuild([
				{ path: 'pages/about/index.wxml', type: 'unlink' },
				{ path: 'pages/about/index.js', type: 'unlink' },
				{ path: 'pages/about/index.wxss', type: 'unlink' },
				{ path: 'pages/about/index.json', type: 'unlink' },
				{ path: 'app.json', type: 'change' },
			])

			// 全量兜底：home 新内容生效
			expect(read(view('home'))).toContain('HOME_MARK_V2')
		})

		it('改共享非页面/非组件 js（utils/format.js）→ 全量', async () => {
			// 防 bug：v1 不建跨构建依赖图，无法安全判断哪些页面 require 了它；
			// 必须全量，否则 home 的 logic 不会带上新版 util。
			await fullBuild()
			expect(read(logic())).toContain('FMT_V1_')

			fs.writeFileSync(path.join(work, 'utils/format.js'), 'module.exports.fmt = function (v) { return "FMT_V2_" + v }')
			await incrBuild([{ path: 'utils/format.js', type: 'change' }])

			const after = read(logic())
			expect(after).toContain('FMT_V2_')
			expect(after).not.toContain('FMT_V1_')
		})

		it('含无法归类的路径 → 全量', async () => {
			// 防 bug：遇到未知/不可归类路径时静默跳过编译，产物陈旧。
			await fullBuild()
			fs.writeFileSync(path.join(work, 'pages/home/index.wxml'), '<view>HOME_MARK_V2<card /></view>')
			// mystery.bin 既非页面也非组件也非已知配置 → 必须全量兜底
			fs.writeFileSync(path.join(work, 'mystery.bin'), 'x')
			await incrBuild([{ path: 'mystery.bin', type: 'change' }])
			expect(read(view('home'))).toContain('HOME_MARK_V2')
		})
	})

	// ── 契约 7：删除页面后旧产物清理（blocker 3）────────────────────────────
	describe('契约7 删除产物清理（output-manifest 比对）', () => {
		it('页面从 app.json 删除后，其旧产物不应残留在目标目录', async () => {
			// 防 bug：全量编译用「按需写入」而非「清空目录」时，被删页面的
			// 旧产物（about 的 view/css）残留，运行时加载到陈旧/孤儿模块。
			await fullBuild()
			expect(fs.existsSync(view('about'))).toBe(true)
			expect(fs.existsSync(style('about'))).toBe(true)

			// 删除 about
			fs.rmSync(path.join(work, 'pages/about'), { recursive: true, force: true })
			fs.writeFileSync(path.join(work, 'app.json'), JSON.stringify({
				pages: ['pages/home/index', 'pages/lonely/index'],
			}))

			await incrBuild([
				{ path: 'pages/about/index.wxml', type: 'unlink' },
				{ path: 'pages/about/index.js', type: 'unlink' },
				{ path: 'pages/about/index.wxss', type: 'unlink' },
				{ path: 'pages/about/index.json', type: 'unlink' },
				{ path: 'app.json', type: 'change' },
			])

			// 旧产物应被清理（manifest 比对删除）
			expect(fs.existsSync(view('about'))).toBe(false)
			expect(fs.existsSync(style('about'))).toBe(false)
			// 保留页面仍在
			expect(fs.existsSync(view('home'))).toBe(true)
			expect(fs.existsSync(view('lonely'))).toBe(true)
		})
	})

	// 已知局限（codex 评审）：v1 路径启发式不建跨构建依赖图，对「页面/组件自身文件被
	// 其它页面直接 @import/include」这一反模式存在盲点（改它只重编自身、漏引用方）。
	// 常见共享样式/模板（放专用非页面文件）不受影响（→ unclassifiable → 全量，安全）。
	// 彻底修复需 v2 依赖清单（见 incremental.js 头注释）。以下场景留待 v2：
	describe('契约8 增量盲点（v1 已知局限，待 v2 依赖清单）', () => {
		it.todo('改被另一页面 wxss @import 的「页面自身 .wxss」→ 引用方应重编（v1 漏，需 v2）')
		it.todo('改被另一页面 <include>/<import> 的「页面自身 .wxml」→ 引用方应重编（v1 漏，需 v2）')
	})
})
