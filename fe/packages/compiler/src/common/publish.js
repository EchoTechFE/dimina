import path from 'node:path'
import process from 'node:process'
import fs from 'node:fs'
import { getAppId, getTargetPath } from '../env.js'

function createDist() {
	const distPath = getTargetPath()
	if (fs.existsSync(distPath)) {
		fs.rmSync(distPath, { recursive: true, force: true })
	}
	fs.mkdirSync(distPath, { recursive: true })
}
/**
 * 发布到指定目录
 * @param {string} dist 目标路径
 * @param {boolean} useAppIdDir 是否在路径中包含appId
 * @param {{ incremental?: boolean }} [opts] 增量模式：不清空最终目录，只覆写本次产物
 */
function publishToDist(dist, useAppIdDir = true, opts = {}) {
	const distPath = getTargetPath()
	const appId = getAppId()
	const absolutePath = useAppIdDir
		? `${path.resolve(process.cwd(), dist)}${path.sep}${appId}`
		: `${path.resolve(process.cwd(), dist)}`

	// 增量模式：保留最终目录已有产物，仅把本次（受影响）产物覆写过去。
	// 未受影响的产物文件不被重建，inode 保持不变。
	if (opts.incremental) {
		fs.mkdirSync(absolutePath, { recursive: true })
	}
	else {
		if (fs.existsSync(absolutePath)) {
			fs.rmSync(absolutePath, { recursive: true, force: true })
		}
		fs.mkdirSync(absolutePath, { recursive: true })
	}

	// 复制目录内容
	function copyDir(src, dest) {
		fs.mkdirSync(dest, { recursive: true })
		const entries = fs.readdirSync(src, { withFileTypes: true })
		
		for (const entry of entries) {
			const srcPath = path.join(src, entry.name)
			const destPath = path.join(dest, entry.name)
			
			if (entry.isDirectory()) {
				copyDir(srcPath, destPath)
			} else {
				fs.copyFileSync(srcPath, destPath)
			}
		}
	}
	
	copyDir(distPath, absolutePath)
}

export { createDist, publishToDist }
