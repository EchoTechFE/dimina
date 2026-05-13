import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Parser } from 'htmlparser2'

const DOC_RELATIVE_PATH = 'docs/API-Reference.md'

let cachedReference = null
const warnedItems = new Set()

function loadReference() {
	if (cachedReference) {
		return cachedReference
	}

	const docPath = findApiReferencePath()
	if (!docPath) {
		console.warn('[compat]', `API reference not found: ${DOC_RELATIVE_PATH}`)
		cachedReference = {
			supportedBuiltinComponents: new Set(),
			supportedWxApis: new Set(),
		}
		return cachedReference
	}

	const content = fs.readFileSync(docPath, 'utf-8')
	cachedReference = parseApiReference(content)
	return cachedReference
}

function findApiReferencePath() {
	const candidates = [
		path.resolve(process.cwd(), DOC_RELATIVE_PATH),
		path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..', DOC_RELATIVE_PATH),
		path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..', DOC_RELATIVE_PATH),
	]

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate
		}
	}

	return null
}

function parseApiReference(content) {
	return {
		supportedBuiltinComponents: parseSingleColumnTable(content, '组件列表'),
		supportedWxApis: parseApiTable(content),
	}
}

function parseSingleColumnTable(content, heading) {
	const section = getSectionContent(content, heading)
	const items = new Set()

	for (const row of getMarkdownRows(section)) {
		if (row.length !== 1 || row[0] === heading.replace(/列表$/, '') || isDividerCell(row[0])) {
			continue
		}
		items.add(stripMarkdownCode(row[0]))
	}

	return items
}

function parseApiTable(content) {
	const section = getSectionContent(content, 'API 列表')
	const apis = new Set()
	let apiColumnIndex = -1

	for (const row of getMarkdownRows(section)) {
		if (row.includes('API 名称')) {
			apiColumnIndex = row.indexOf('API 名称')
			continue
		}

		if (apiColumnIndex === -1 || row.some(isDividerCell)) {
			continue
		}

		const apiName = stripMarkdownCode(row[apiColumnIndex])
		if (apiName) {
			apis.add(apiName)
		}
	}

	return apis
}

function getSectionContent(content, heading) {
	const sectionStart = content.indexOf(`## ${heading}`)
	if (sectionStart === -1) {
		return ''
	}

	const nextSection = content.indexOf('\n## ', sectionStart + 1)
	return nextSection === -1
		? content.slice(sectionStart)
		: content.slice(sectionStart, nextSection)
}

function getMarkdownRows(content) {
	return content
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.startsWith('|') && line.endsWith('|'))
		.map(line => line.slice(1, -1).split('|').map(cell => cell.trim()))
}

function stripMarkdownCode(value = '') {
	return value.replace(/^`|`$/g, '').trim()
}

function isDividerCell(value = '') {
	return /^:?-{3,}:?$/.test(value.trim())
}

function getWxMemberName(node) {
	if (node?.type !== 'MemberExpression') {
		return null
	}

	if (node.object?.type !== 'Identifier' || node.object.name !== 'wx') {
		return null
	}

	if (!node.computed && node.property?.type === 'Identifier') {
		return node.property.name
	}

	if (
		node.computed
		&& (node.property?.type === 'StringLiteral' || node.property?.type === 'Literal')
		&& typeof node.property.value === 'string'
	) {
		return node.property.value
	}

	return null
}

function warnUnsupportedWxApi(apiName, filePath, line) {
	const { supportedWxApis } = loadReference()
	if (!apiName || supportedWxApis.has(apiName)) {
		return
	}

	const location = formatLocation(filePath, line)
	warnOnce('api', apiName, location, `[compat] Unsupported wx API: wx.${apiName}${location}`)
}

function warnUnsupportedComponent(tagName, filePath, line) {
	const { supportedBuiltinComponents } = loadReference()
	if (!tagName || supportedBuiltinComponents.has(tagName)) {
		return
	}

	const location = formatLocation(filePath, line)
	warnOnce('component', tagName, location, `[compat] Unsupported or undeclared component: <${tagName}>${location}`)
}

function checkTemplateCompatibility(content, filePath, components = {}) {
	let parser
	parser = new Parser(
		{
			onopentag(tagName) {
				if (components?.[tagName]) {
					return
				}

				const line = getLineByIndex(content, parser.startIndex)
				warnUnsupportedComponent(tagName, filePath, line)
			},
			onerror(error) {
				console.warn('[compat]', `Failed to parse template for compatibility diagnostics: ${filePath}`, error.message)
			},
		},
		{
			xmlMode: true,
			lowerCaseTags: false,
			lowerCaseAttributeNames: false,
			withStartIndices: true,
		},
	)

	parser.write(content)
	parser.end()
}

function getLineByIndex(content, index) {
	if (typeof index !== 'number' || index < 0) {
		return null
	}

	let line = 1
	for (let i = 0; i < index; i++) {
		if (content.charCodeAt(i) === 10) {
			line++
		}
	}
	return line
}

function formatLocation(filePath, line) {
	if (!filePath) {
		return ''
	}
	return line ? ` (${filePath}:${line})` : ` (${filePath})`
}

function warnOnce(type, name, location, message) {
	const key = `${type}:${name}:${location}`
	if (warnedItems.has(key)) {
		return
	}
	warnedItems.add(key)
	console.warn(message)
}

export {
	checkTemplateCompatibility,
	getWxMemberName,
	loadReference,
	parseApiReference,
	warnUnsupportedWxApi,
}
