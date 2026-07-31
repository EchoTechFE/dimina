export class WxsRuntimeError extends Error {
	constructor(message, {
		code,
		modulePath,
		requireStack = [],
		cause,
	} = {}) {
		super(message)
		this.name = 'WxsRuntimeError'
		this.code = code
		this.modulePath = modulePath
		this.requireStack = [...requireStack]
		if (cause !== undefined) {
			this.cause = cause
		}
	}
}

function createRuntimeError(code, modulePath, requireStack, message, cause) {
	return new WxsRuntimeError(message, {
		code,
		modulePath,
		requireStack,
		cause,
	})
}

function compileFactory(record) {
	try {
		// eslint-disable-next-line no-new-func -- WXS CommonJS source is compiler output.
		return new Function('require', 'module', 'exports', record.code)
	}
	catch (cause) {
		throw createRuntimeError(
			'WXS_MODULE_COMPILE_FAILED',
			record.path,
			[record.path],
			`Failed to compile WXS module "${record.path}": ${cause.message}`,
			cause,
		)
	}
}

function validateModuleRecord(record, index) {
	if (!record || typeof record !== 'object') {
		throw createRuntimeError(
			'WXS_INVALID_MODULE_RECORD',
			undefined,
			[],
			`Invalid WXS module record at index ${index}`,
		)
	}
	if (typeof record.path !== 'string' || record.path.length === 0) {
		throw createRuntimeError(
			'WXS_INVALID_MODULE_RECORD',
			record.path,
			[],
			`WXS module record at index ${index} requires a non-empty path`,
		)
	}
	if (typeof record.code !== 'string') {
		throw createRuntimeError(
			'WXS_INVALID_MODULE_RECORD',
			record.path,
			[record.path],
			`WXS module "${record.path}" requires string code`,
		)
	}
	if (
		record.originalName !== undefined
		&& (typeof record.originalName !== 'string' || record.originalName.length === 0)
	) {
		throw createRuntimeError(
			'WXS_INVALID_MODULE_RECORD',
			record.path,
			[record.path],
			`WXS module "${record.path}" has an invalid originalName`,
		)
	}
}

class WxsRuntimeRealm {
	constructor(moduleRecords) {
		if (!Array.isArray(moduleRecords)) {
			throw createRuntimeError(
				'WXS_INVALID_MODULE_RECORD',
				undefined,
				[],
				'WXS runtime modules must be an array',
			)
		}

		this.registry = new Map()
		this.cache = new Map()
		this.originalNames = new Map()
		this.cleared = false

		moduleRecords.forEach((record, index) => {
			validateModuleRecord(record, index)
			if (this.registry.has(record.path)) {
				throw createRuntimeError(
					'WXS_DUPLICATE_MODULE_PATH',
					record.path,
					[record.path],
					`Duplicated WXS module path "${record.path}"`,
				)
			}
			if (record.originalName !== undefined && this.originalNames.has(record.originalName)) {
				throw createRuntimeError(
					'WXS_DUPLICATE_ORIGINAL_NAME',
					record.path,
					[record.path],
					`Duplicated WXS originalName "${record.originalName}"`,
				)
			}

			const moduleRecord = {
				path: record.path,
				originalName: record.originalName,
				factory: compileFactory(record),
			}
			this.registry.set(moduleRecord.path, moduleRecord)
			if (moduleRecord.originalName !== undefined) {
				this.originalNames.set(moduleRecord.originalName, moduleRecord.path)
			}
		})
	}

	require(path) {
		this.assertActive()
		return this.load(path, [])
	}

	requireByName(originalName) {
		this.assertActive()
		const path = this.originalNames.get(originalName)
		if (path === undefined) {
			throw createRuntimeError(
				'WXS_MODULE_NOT_FOUND',
				originalName,
				[originalName],
				`Unknown WXS originalName "${originalName}"`,
			)
		}
		return this.load(path, [])
	}

	getNamedExports() {
		this.assertActive()
		const namedExports = Object.create(null)
		for (const [originalName, path] of this.originalNames) {
			namedExports[originalName] = this.load(path, [])
		}
		return namedExports
	}

	clear() {
		if (this.cleared) {
			return
		}
		this.cleared = true
		this.cache.clear()
		this.registry.clear()
		this.originalNames.clear()
	}

	assertActive() {
		if (!this.cleared) {
			return
		}
		throw createRuntimeError(
			'WXS_REALM_CLEARED',
			undefined,
			[],
			'WXS runtime realm has been cleared',
		)
	}

	load(path, parentStack) {
		if (typeof path !== 'string' || path.length === 0) {
			throw createRuntimeError(
				'WXS_INVALID_REQUIRE_PATH',
				path,
				parentStack,
				'WXS require path must be a non-empty string',
			)
		}

		const requireStack = [...parentStack, path]
		const record = this.registry.get(path)
		if (record === undefined) {
			throw createRuntimeError(
				'WXS_MODULE_NOT_FOUND',
				path,
				requireStack,
				`Cannot find WXS module "${path}"`,
			)
		}

		const cached = this.cache.get(path)
		if (cached !== undefined) {
			if (cached.state === 'failed') {
				throw cached.error
			}
			return cached.module.exports
		}

		const module = {
			id: path,
			filename: path,
			exports: {},
			loaded: false,
		}
		const cacheEntry = {
			module,
			state: 'loading',
			error: undefined,
		}
		this.cache.set(path, cacheEntry)

		const localRequire = dependencyPath => this.load(dependencyPath, requireStack)
		try {
			record.factory.call(null, localRequire, module, module.exports)
			module.loaded = true
			cacheEntry.state = 'loaded'
			return module.exports
		}
		catch (cause) {
			const error = cause instanceof WxsRuntimeError
				? cause
				: createRuntimeError(
						'WXS_MODULE_EXECUTION_FAILED',
						path,
						requireStack,
						`Failed to execute WXS module "${path}": ${cause.message}`,
						cause,
					)
			cacheEntry.state = 'failed'
			cacheEntry.error = error
			throw error
		}
	}
}

export function createWxsRuntimeRealm(moduleRecords) {
	return new WxsRuntimeRealm(moduleRecords)
}
