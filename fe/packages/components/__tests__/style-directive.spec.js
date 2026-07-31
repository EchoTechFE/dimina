/** @vitest-environment jsdom */

import { createApp, h, nextTick, ref, resolveDirective, withDirectives } from 'vue'
import { Components } from '../index.js'

describe('WXML style directive', () => {
	it('registers ComponentHost and keeps the legacy compiled tag as an alias', () => {
		const app = createApp({ render: () => null })
		Components(app)

		expect(app.component('dd-component-host')).toBeDefined()
		expect(app.component('dd-wrapper')).toBe(app.component('dd-component-host'))
	})

	it('updates WXML declarations without erasing component-owned inline styles', async () => {
		const host = document.createElement('div')
		document.body.appendChild(host)
		const externalStyle = ref('color: red; margin: 1rpx')
		const imageUrl = ref('/first.png')

		const app = createApp({
			setup() {
				return () => withDirectives(h('div', {
					style: {
						backgroundImage: `url(${imageUrl.value})`,
						backgroundSize: 'cover',
					},
				}), [[resolveDirective('c-style'), externalStyle.value]])
			},
		})
		Components(app)
		app.mount(host)
		const element = host.firstElementChild

		expect(element.style.backgroundImage).toContain('/first.png')
		expect(element.style.backgroundSize).toBe('cover')
		expect(element.style.color).toBe('red')
		expect(element.style.margin).toBe('0.133333vw')

		imageUrl.value = '/second.png'
		externalStyle.value = 'color: blue'
		await nextTick()
		expect(element.style.backgroundImage).toContain('/second.png')
		expect(element.style.backgroundSize).toBe('cover')
		expect(element.style.color).toBe('blue')
		expect(element.style.margin).toBe('')

		externalStyle.value = ''
		await nextTick()
		expect(element.style.backgroundImage).toContain('/second.png')
		expect(element.style.backgroundSize).toBe('cover')
		expect(element.style.color).toBe('')

		app.unmount()
		host.remove()
	})

	it('never touches inline declarations when an unrelated re-render leaves the WXML style value unchanged', async () => {
		const host = document.createElement('div')
		document.body.appendChild(host)
		const externalStyle = ref('height: 400px')
		const unrelated = ref(0)

		const app = createApp({
			setup() {
				return () => h('div', { 'data-unrelated': unrelated.value }, [
					withDirectives(h('div'), [[resolveDirective('c-style'), externalStyle.value]]),
				])
			},
		})
		Components(app)
		app.mount(host)
		const element = host.querySelector('[data-unrelated] > div')
		expect(element.style.height).toBe('400px')

		const removeSpy = vi.spyOn(CSSStyleDeclaration.prototype, 'removeProperty')
		const setSpy = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')

		// 指令未接管的状态触发的重渲染,不能撤销再重新应用 height:正是这种
		// 短暂的取消设置,曾让并发的布局读取(如 scroll-view 的 scrollTo)
		// 撞见塌缩的容器,导致滚动位置被不可逆地钳位。
		unrelated.value = 1
		await nextTick()

		expect(removeSpy).not.toHaveBeenCalled()
		expect(setSpy).not.toHaveBeenCalled()
		expect(element.style.height).toBe('400px')

		removeSpy.mockRestore()
		setSpy.mockRestore()
		app.unmount()
		host.remove()
	})

	it('hands a dropped declaration back to the component\'s own pre-directive value', async () => {
		const host = document.createElement('div')
		document.body.appendChild(host)
		const externalStyle = ref('opacity: 0.4')

		const app = createApp({
			setup() {
				return () => withDirectives(h('div', { style: { opacity: '0.9' } }), [[resolveDirective('c-style'), externalStyle.value]])
			},
		})
		Components(app)
		app.mount(host)
		const element = host.firstElementChild
		expect(element.style.opacity).toBe('0.4')

		externalStyle.value = ''
		await nextTick()

		// 组件自身在指令接管前就设置了 opacity: 0.9。一旦 WXML 值不再包含
		// opacity,指令必须把该属性归还给这个接管前的值,而不是留空。
		expect(element.style.opacity).toBe('0.9')

		app.unmount()
		host.remove()
	})
})
