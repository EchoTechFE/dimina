import { animationToStyle, getDataAttributes, toCamelCase, transformRpx } from '@dimina/common'
import { triggerEvent, useInfo } from '@/common/events'
import { deepToRaw, install, replaceExternalClassTokens } from '@/common/utils'
import components from './src/index'

export * from './src/index'

const EXTERNAL_CLASS_SCOPE_ATTRIBUTE = 'data-dd-external-class-scope'
const LEGACY_COMPONENT_TAG_ALIASES = {
	'component-host': ['dd-wrapper'],
}

function transformAnimation(el, propertyValue) {
	if (!propertyValue?.actions?.length)
		return

	let currentIndex = 0
	const actions = propertyValue.actions

	function executeAnimation() {
		if (currentIndex >= actions.length)
			return

		const currentAction = actions[currentIndex]
		const style = animationToStyle(currentAction)

		// 创建动画
		const animation = el.animate(
			style.keyframes,
			style.options,
		)

		// 设置动画完成回调，执行下一个动画
		animation.onfinish = () => {
			currentIndex++
			executeAnimation()
		}
	}
	// 开始执行动画序列
	executeAnimation()
}

// 记录每个元素上 c-style 指令当前接管的 CSS 声明:每个属性名对应当前应用的值
// (applied)和指令接管前元素原有的值(original,没有则为 null)。声明从 WXML
// 值中消失时可归还 original,而不是直接删除。
const directiveStyleState = new WeakMap()
let styleProbeEl = null

function snapshotStyle(style) {
	return new Map(Array.from(style, name => [name, {
		priority: style.getPropertyPriority(name),
		value: style.getPropertyValue(name),
	}]))
}

// 借助一个游离元素解析 WXML 样式字符串,复用浏览器自带的 CSS 解析器
// (自动处理简写属性展开和 !important),而不是自己写一套解析逻辑。
function parseCssDeclarations(cssText) {
	if (typeof cssText !== 'string' || !cssText.trim()) return new Map()
	styleProbeEl ??= document.createElement('div')
	styleProbeEl.style.cssText = cssText
	return snapshotStyle(styleProbeEl.style)
}

function isSameDeclaration(a, b) {
	return a?.value === b?.value && a?.priority === b?.priority
}

// 只应用与指令上次实际应用值不同的声明。新旧 WXML 值之间未变化的声明完全不碰,
// 因此不会经历短暂的"撤销态",避免被并发的布局读取(如 ScrollView 的
// scrollTo)撞见。新值中不再出现的声明会归还给指令接管前元素原有的值,
// 而不是直接移除。
function applyDirectiveCss(el, val) {
	const newDeclarations = parseCssDeclarations(transformRpx(val))
	const owned = directiveStyleState.get(el)
	const nextOwned = new Map()

	// 先统一记录每个新接管属性名的更新前 DOM 值,再做任何写入。简写/展开属性
	// (如 margin 和 margin-top)可能同时出现在同一份声明里,写入展开属性会
	// 改变简写属性的读回值——如果边写边记录 original,前面的写入会污染后面
	// 属性的基准值。
	const priorValues = new Map()
	for (const name of newDeclarations.keys()) {
		if (owned?.has(name)) continue
		const value = el.style.getPropertyValue(name)
		const priority = el.style.getPropertyPriority(name)
		priorValues.set(name, (value || priority) ? { value, priority } : null)
	}

	if (owned) {
		for (const [name, record] of owned) {
			if (newDeclarations.has(name)) continue
			if (record.original) {
				el.style.setProperty(name, record.original.value, record.original.priority)
			}
			else {
				el.style.removeProperty(name)
			}
		}
	}

	for (const [name, declaration] of newDeclarations) {
		const record = owned?.get(name)
		if (record && isSameDeclaration(record.applied, declaration)) {
			nextOwned.set(name, record)
			continue
		}
		const original = record ? record.original : priorValues.get(name)
		el.style.setProperty(name, declaration.value, declaration.priority)
		nextOwned.set(name, { applied: declaration, original })
	}

	if (nextOwned.size) {
		directiveStyleState.set(el, nextOwned)
	}
	else {
		directiveStyleState.delete(el)
	}
}

function parseDataset(el, vnode) {
	el._ds = getDataAttributes(vnode.ctx.attrs, deepToRaw)
}

function parseExternalClass(el, instance, vnode) {
	const ctx = vnode.ctx
	if (instance.props && Array.isArray(ctx.provides.externalClasses)) {
		for(const externalClass of ctx.provides.externalClasses) {
			const clsName = instance.props[toCamelCase(externalClass)]
			if (clsName) {
				el.className = replaceExternalClassTokens(el.className, externalClass, clsName)
				if (!el.hasAttribute(instance.sId)) {
					el.setAttribute(instance.sId, '')
				}
				const scopeTokens = new Set(
					(el.getAttribute(EXTERNAL_CLASS_SCOPE_ATTRIBUTE) || '').split(/\s+/).filter(Boolean),
				)
				scopeTokens.add(instance.sId)
				el.setAttribute(EXTERNAL_CLASS_SCOPE_ATTRIBUTE, [...scopeTokens].join(' '))
			}
		}
	}
}

function collectEventBindings(props = {}) {
	const eventBindings = {}
	for (const [attrName, handler] of Object.entries(props || {})) {
		const match = attrName.match(/^(capture-)?(bind|catch)(?::)?(.+)$/)
		if (!match || handler === undefined || handler === null || handler === '') {
			continue
		}

		const [, capture, listenerType, eventType] = match
		const bindingType = capture
			? (listenerType === 'catch' ? 'captureCatch' : 'captureBind')
			: listenerType
		eventBindings[eventType] = eventBindings[eventType] || {}
		eventBindings[eventType][bindingType] = handler
	}
	return eventBindings
}

function getEventBindingRecord(el, binding, vnode) {
	const target = vnode.component?.proxy
	return el._ddEventBindings?.find(record => (
		record.owner === binding.instance
		&& record.target === target
		&& record.nodeType === binding.value
	))
}

function mountEventBindingRecord(el, binding, vnode) {
	const record = {
		owner: binding.instance,
		target: vnode.component?.proxy,
		nodeType: binding.value,
		eventAttr: collectEventBindings(vnode.props),
	}
	el._ddEventBindings = el._ddEventBindings || []
	el._ddEventBindings.push(record)
}

function updateEventBindingRecord(el, binding, vnode) {
	const record = getEventBindingRecord(el, binding, vnode)
	if (record) {
		record.eventAttr = collectEventBindings(vnode.props)
	}
}

function removeEventBindingRecord(el, binding, vnode) {
	const record = getEventBindingRecord(el, binding, vnode)
	if (!record) {
		return
	}
	const index = el._ddEventBindings.indexOf(record)
	if (index >= 0) {
		el._ddEventBindings.splice(index, 1)
	}
}

function Components(app) {
	app.directive('c-style', {
		mounted(el, binding) {
			applyDirectiveCss(el, binding.value)
		},
		updated(el, binding) {
			if (binding.value === binding.oldValue) return
			applyDirectiveCss(el, binding.value)
		},
	})

	app.directive('c-animation', {
		mounted(el, binding) {
			transformAnimation(el, binding.value)
		},
		updated(el, binding) {
			if (binding.value === binding.oldValue) return
			transformAnimation(el, binding.value)
		},
	})

	app.directive('c-data', {
		mounted(el, _binding, vnode) {
			parseDataset(el, vnode)
		},
		updated(el, _binding, vnode) {
			parseDataset(el, vnode)
		},
	})

	app.directive('c-class', {
		mounted(el, binding, vnode) {
			parseExternalClass(el, binding.instance, vnode)
		},
		updated(el, binding, vnode) {
			parseExternalClass(el, binding.instance, vnode)
		},
	})

	app.directive('c-prop-bindings', {
		mounted(el, binding) {
			// 将属性绑定信息存储在 DOM 元素上，供 render 层使用
			// 使用动态绑定，Vue 会自动将 HTML 实体解码后的 JSON 解析为对象
			el._propBindings = binding.value || {}
		},
	})

	app.directive('c-event-node', {
		mounted(el, binding, vnode) {
			mountEventBindingRecord(el, binding, vnode)
		},
		updated(el, binding, vnode) {
			updateEventBindingRecord(el, binding, vnode)
		},
		beforeUnmount(el, binding, vnode) {
			removeEventBindingRecord(el, binding, vnode)
		},
	})

	return components.forEach((component) => {
		component.mixins = [{
			inheritAttrs: false,
		}]
		install(app, component)
		for (const alias of LEGACY_COMPONENT_TAG_ALIASES[component.__tagName] || []) {
			// Keep already-compiled applications working while new output uses
			// dd-component-host exclusively.
			app.component(alias, component)
		}
	})
}

const tagWhiteList = components.map(obj => obj.__tagName)

export { Components, deepToRaw, tagWhiteList, triggerEvent, useInfo }
