import { AppManager } from '@/core/appManager'
import { Bridge } from '@/core/bridge'
import { JSCore } from '@/core/jscore'
import { HashRouter } from '@/utils/hashRouter'
import { mergePageConfig, queryPath, readFile, sleep, uuid } from '@/utils/util'
import tpl from './miniApp.html?raw'
import './miniApp.scss'

export class MiniApp {
	constructor(opts) {
		this.appInfo = opts
		this.id = `mini_app_${uuid()}`
		this.parent = null
		this.appId = opts.appId
		this.appConfig = null
		this.bridgeList = []
		this.jscore = new JSCore(this)
		this.webviewsContainer = null
		this.webviewAnimaEnd = true
		this.el = document.createElement('div')
		this.el.classList.add('dimina-native-view')
		this.toastInfo = {
			dom: null,
			timer: null,
		}
		this.color = null
		// TabBar 状态（参考鸿蒙 DMPTabBarContainerView 的"按需创建 + 持久缓存"模型）
		this.tabBarPagePaths = new Set()  // app.tabBar.list 中声明的所有 tab 路径
		this.tabBarBridges = new Map()    // pagePath -> bridge：懒加载的持久 tab 池
		this.currentTabPath = null        // 当前激活的 tab 路径；null 表示当前不在任何 tab 页
	}

	viewDidLoad() {
		this.initPageFrame()
		this.webviewsContainer = this.el.querySelector('.dimina-mini-app__webviews')
		this.showLaunchScreen()
		this.bindMoreEvent()
		this.bindCloseEvent()
		this.initApp()
	}

	async initApp() {
		// 1. 等待逻辑线程初始化
		await this.jscore.init()

		// 2. 模拟拉取小程序资源
		await sleep(260)

		// 3. 读取配置文件
		const root = 'main'
		const configPath = `${this.appInfo.appId}/${root}/app-config.json`
		const configContent = await readFile(`${import.meta.env.BASE_URL}${configPath}`)

		if (!configContent) {
			return
		}

		this.appConfig = JSON.parse(configContent)

		if (this.appConfig.app.tabBar && this.appConfig.app.tabBar.list) {
			this.tabBarPagePaths = new Set(
				this.appConfig.app.tabBar.list.map((item) => item.pagePath),
			)
		}

		const entryPagePath = this._normalizePath(this.appInfo.pagePath || this.appConfig.app.entryPagePath)

		// 4. 读取页面配置
		const pageConfig = this.appConfig.modules[entryPagePath]
		const mergeConfig = mergePageConfig(this.appConfig.app, pageConfig)

		// 5. 设置状态栏的颜色模式
		this.updateTargetPageColorStyle(mergeConfig)

		// 6. 创建通信 bridge
		const entryPageBridge = await this.createBridge({
			pagePath: entryPagePath,
			query: this.appInfo.query,
			scene: this.appInfo.scene,
			jscore: this.jscore,
			isRoot: true,
			root,
			appId: this.appInfo.appId,
			pages: this.appConfig.app.pages,
			configInfo: mergeConfig,
		})

		this.bridgeList.push(entryPageBridge)

		// 入口若是 tab 页：登记到 tab 池并设为当前 tab
		const entryIsTabPage = this.tabBarPagePaths.has(entryPagePath)
		if (entryIsTabPage) {
			this.tabBarBridges.set(entryPagePath, entryPageBridge)
			this.currentTabPath = entryPagePath
		}

		entryPageBridge.start()
		HashRouter.sync(this.appId, entryPagePath, this.appInfo.query)

		// 7. 渲染 TabBar：仅在入口为 tab 页时显示
		if (this.appConfig.app.tabBar) {
			this._renderTabBar(this.appConfig.app.tabBar)
			this._setTabBarVisible(entryIsTabPage)
		}

		// 8.隐藏 loading
		this.hideLaunchScreen()
	}

	// 创建一个bridge对象
	async createBridge(opts) {
		const { jscore, configInfo, isRoot, appId, pagePath, query, scene, pages, root } = opts
		const bridge = new Bridge({
			jscore,
			configInfo,
			isRoot,
			appId,
			pagePath,
			query,
			scene,
			pages,
			root,
		})

		bridge.parent = this
		await bridge.init()
		return bridge
	}

	onPresentIn() {
		const currentBridge = this.bridgeList[this.bridgeList.length - 1]
		// 首次异步创建时， bridge 不存在，会在[Service]自行调用 invokeInitLifecycle
		currentBridge?.appShow()
		currentBridge?.pageShow()
		if (currentBridge) {
			HashRouter.sync(this.appId, currentBridge.opts.pagePath, currentBridge.opts.query)
		}
	}

	onPresentOut() {
		const currentBridge = this.bridgeList[this.bridgeList.length - 1]

		currentBridge?.appHide()
		currentBridge?.pageHide()
	}

	initPageFrame() {
		this.el.innerHTML = tpl
	}

	// 设置指定页面状态栏的颜色模式
	updateTargetPageColorStyle(mergeConfig) {
		const { navigationBarTextStyle } = mergeConfig
		this.updateActionColorStyle(navigationBarTextStyle)
	}

	showLaunchScreen() {
		const launchScreen = this.el.querySelector('.dimina-mini-app__launch-screen')
		const name = this.el.querySelector('.dimina-mini-app__name')
		const logo = this.el.querySelector('.dimina-mini-app__logo-img-url')

		this.updateActionColorStyle('black')
		name.innerHTML = this.appInfo.name
		logo.src = this.appInfo.logo
		launchScreen.style.display = 'block'
	}

	hideLaunchScreen() {
		const startPage = this.el.querySelector('.dimina-mini-app__launch-screen')
		startPage.style.display = 'none'
	}

	updateActionColorStyle(color) {
		this.color = color
		const action = this.el.querySelector('.dimina-mini-app-navigation__actions')

		if (color === 'white') {
			action.classList.remove('dimina-mini-app-navigation__actions--black')
			action.classList.add('dimina-mini-app-navigation__actions--white')
		}
		else if (color === 'black') {
			action.classList.remove('dimina-mini-app-navigation__actions--white')
			action.classList.add('dimina-mini-app-navigation__actions--black')
		}

		this.parent.updateStatusBarColor(color)
	}

	restoreColorStyle() {
		this.updateActionColorStyle(this.color)
	}

	createCallbackFunction(funcId) {
		if (funcId) {
			return (args) => {
				this.jscore.postMessage({
					type: 'triggerCallback',
					body: {
						id: funcId,
						args,
					},
				})
			}
		}
	}

	async navigateTo(opts) {
		// 防抖处理
		if (!this.webviewAnimaEnd) {
			return
		}
		this.webviewAnimaEnd = false

		const { url, success } = opts
		const queryResult = queryPath(url)
		const query = queryResult.query
		const pagePath = this._normalizePath(queryResult.pagePath)
		const onSuccess = this.createCallbackFunction(success)

		const pageConfig = this.appConfig.modules[pagePath]
		const mergeConfig = mergePageConfig(this.appConfig.app, pageConfig)
		// 更新状态栏颜色模式
		this.updateTargetPageColorStyle(mergeConfig)

		// 创建新的入口页面的 bridge
		const bridge = await this.createBridge({
			pagePath,
			query,
			scene: this.appInfo.scene,
			jscore: this.jscore,
			isRoot: false,
			root: pageConfig?.root || 'main',
			appId: this.appInfo.appId,
			pages: this.appConfig.app.pages,
			configInfo: mergeConfig,
		})

		// 获取前一个bridge
		const preBridge = this.bridgeList[this.bridgeList.length - 1]
		const preWebview = preBridge.webview

		this.bridgeList.push(bridge)

		// 触发新页面的初始化逻辑
		bridge.start()
		HashRouter.sync(this.appId, pagePath, query)

		// 上一个页面推出
		preWebview.el.classList.remove('dimina-native-view--instage')
		preWebview.el.classList.add('dimina-native-view--slide-out')
		preWebview.el.classList.add('dimina-native-view--linear-anima')
		preBridge?.pageHide()

		// 新页面推入
		bridge.webview.el.style.zIndex = this.bridgeList.length + 1
		bridge.webview.el.classList.add('dimina-native-view--enter-anima')
		bridge.webview.el.classList.add('dimina-native-view--instage')
		await sleep(540)

		// 页面进入后移出动画相关class
		this.webviewAnimaEnd = true
		preWebview.el.classList.remove('dimina-native-view--linear-anima')
		bridge.webview.el.classList.remove('dimina-native-view--before-enter')
		bridge.webview.el.classList.remove('dimina-native-view--enter-anima')
		bridge.webview.el.classList.remove('dimina-native-view--instage')

		// navigateTo 总是进入非 tab 页（target 是 tab 页时按 wechat 规范应使用 switchTab），隐藏 TabBar
		this._setTabBarVisible(false)

		onSuccess?.()
	}

	reLaunch(opts) {
		// 防抖处理
		if (!this.webviewAnimaEnd) {
			return
		}
		this.webviewAnimaEnd = false

		const { url, success, fail, complete } = opts
		const queryResult = queryPath(url)
		const query = queryResult.query
		const pagePath = this._normalizePath(queryResult.pagePath)
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			const pageConfig = this.appConfig.modules[pagePath]
			const mergeConfig = mergePageConfig(this.appConfig.app, pageConfig)

			this.updateTargetPageColorStyle(mergeConfig)

			// 销毁所有 bridge：当前可见栈 + tab 池（用 Set 去重，避免同一 bridge 被销毁两次）
			const allBridges = new Set([...this.bridgeList, ...this.tabBarBridges.values()])
			for (const bridge of allBridges) {
				bridge.destroy()
				bridge.webview?.el?.remove()
			}
			this.bridgeList.length = 0
			this.tabBarBridges.clear()
			this.currentTabPath = null

			if (this.webviewsContainer) {
				this.webviewsContainer.innerHTML = ''
			}

			this.createBridge({
				pagePath,
				query,
				scene: this.appInfo.scene,
				jscore: this.jscore,
				isRoot: true,
				root: pageConfig?.root || 'main',
				appId: this.appInfo.appId,
				pages: this.appConfig.app.pages,
				configInfo: mergeConfig,
			}).then((bridge) => {
				this.bridgeList.push(bridge)
				bridge.webview.el.style.zIndex = 1

				// 入口若是 tab 页：登记到池并显示 TabBar
				if (this.tabBarPagePaths.has(pagePath)) {
					this.tabBarBridges.set(pagePath, bridge)
					this.currentTabPath = pagePath
					this._setTabBarVisible(true)
					this._updateTabBarSelection(pagePath)
				} else {
					this._setTabBarVisible(false)
				}

				bridge.start()
				HashRouter.sync(this.appId, pagePath, query)

				this.webviewAnimaEnd = true
				onSuccess?.({ errMsg: 'reLaunch:ok' })
				onComplete?.()
			}).catch((error) => {
				onFail?.({ errMsg: `reLaunch:fail ${error.message}` })
				onComplete?.()
				this.webviewAnimaEnd = true
			})
		}
		catch (error) {
			onFail?.({ errMsg: `reLaunch:fail ${error.message}` })
			onComplete?.()
			this.webviewAnimaEnd = true
		}
	}

	redirectTo(opts) {
		// 防抖处理
		if (!this.webviewAnimaEnd) {
			return
		}
		this.webviewAnimaEnd = false

		const { url, success } = opts
		const queryResult = queryPath(url)
		const query = queryResult.query
		const pagePath = this._normalizePath(queryResult.pagePath)
		const onSuccess = this.createCallbackFunction(success)

		const curBridge = this.bridgeList[this.bridgeList.length - 1]
		const oldPath = this._normalizePath(curBridge.opts.pagePath)
		const pageConfig = this.appConfig.modules[pagePath]
		const mergeConfig = mergePageConfig(this.appConfig.app, pageConfig)

		this.updateTargetPageColorStyle(mergeConfig)

		// redirect 会改变 bridge 的 pagePath 身份：若旧路径在 tab 池中则需移除
		if (this.tabBarBridges.get(oldPath) === curBridge) {
			this.tabBarBridges.delete(oldPath)
			if (this.currentTabPath === oldPath) {
				this.currentTabPath = null
			}
		}

		curBridge.destroy()
		curBridge.opts = {
			...curBridge.opts,
			pagePath,
			query,
			configInfo: mergeConfig,
		}
		curBridge.resetStatus()
		curBridge.start()
		HashRouter.sync(this.appId, pagePath, query)

		// redirect 目标若是 tab 页：登记到池并显示 TabBar
		if (this.tabBarPagePaths.has(pagePath)) {
			this.tabBarBridges.set(pagePath, curBridge)
			this.currentTabPath = pagePath
			this._setTabBarVisible(true)
			this._updateTabBarSelection(pagePath)
		} else {
			this._setTabBarVisible(false)
		}

		this.webviewAnimaEnd = true
		onSuccess?.()
	}

	async navigateBack() {
		if (this.bridgeList.length < 2) {
			return
		}

		if (!this.webviewAnimaEnd) {
			return
		}

		this.webviewAnimaEnd = false

		const currentBridge = this.bridgeList.pop()
		const preBridge = this.bridgeList[this.bridgeList.length - 1]

		const pageConfig = this.appConfig.modules[preBridge.opts.pagePath]
		const mergeConfig = mergePageConfig(this.appConfig.app, pageConfig)

		// 更新状态栏颜色模式
		this.updateTargetPageColorStyle(mergeConfig)

		// 当前页面推出
		currentBridge.webview.el.classList.add('dimina-native-view--before-enter')
		currentBridge.webview.el.classList.add('dimina-native-view--enter-anima')

		// 触发当前页面的生命周期函数
		currentBridge?.destroy()

		// 上一个页面推入
		preBridge.webview.el.classList.remove('dimina-native-view--slide-out')
		preBridge.webview.el.classList.add('dimina-native-view--instage')
		preBridge.webview.el.classList.add('dimina-native-view--enter-anima')

		// 触发上一个页面的生命周期函数
		preBridge?.pageShow()
		HashRouter.sync(this.appId, preBridge.opts.pagePath, preBridge.opts.query)
		await sleep(540)
		this.webviewAnimaEnd = true

		// 页面进入后移出动画相关class
		preBridge.webview.el.classList.remove('dimina-native-view--enter-anima')
		preBridge.webview.el.classList.remove('dimina-native-view--instage')
		currentBridge.webview.el.parentNode.removeChild(currentBridge.webview.el)

		// 退到 tab 页则恢复 TabBar 显示
		this._setTabBarVisible(this.tabBarPagePaths.has(this._normalizePath(preBridge.opts.pagePath)))
	}

	/**
	 * 切换 TabBar 页面（基于鸿蒙 DMPTabBarContainerView 的"按需创建 + 持久缓存"模型）
	 * 流程：
	 *   1. 当前可见栈顶 pageHide + display:none（无论 tab 还是非 tab 页）
	 *   2. 销毁当前 tab 之上 navigateTo 进来的所有非 tab 覆盖页（destroy）
	 *   3. 目标 tab 已在池里则复用 + pageShow；否则按需创建并 start（首次 onShow 由 service 在资源就绪时触发）
	 *   4. 同步 currentTabPath / 选中态 / TabBar 显隐
	 */
	async switchTab(opts) {
		const { url, success, fail, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		let { query, pagePath } = queryPath(url)
		if (pagePath.startsWith('/')) {
			pagePath = pagePath.substring(1)
		}

		if (!this.tabBarPagePaths.has(pagePath)) {
			onFail?.({ errMsg: 'switchTab:fail not a tabBar page' })
			onComplete?.()
			return
		}

		try {
			// 1. 隐藏当前可见的栈顶（无论是否 tab）：触发 pageHide 并 display:none
			const currentBridge = this.bridgeList[this.bridgeList.length - 1]
			if (currentBridge) {
				currentBridge.pageHide()
				currentBridge.webview.el.style.display = 'none'
			}

			// 2. 销毁所有 navigateTo 进来的非 tab 覆盖页（已经 hide 过，直接 destroy）
			for (let i = this.bridgeList.length - 1; i >= 0; i--) {
				const b = this.bridgeList[i]
				if (this.tabBarPagePaths.has(this._normalizePath(b.opts.pagePath))) {
					continue
				}
				b.destroy()
				b.webview?.el?.remove()
				this.bridgeList.splice(i, 1)
			}

			// 3. 取或创建目标 tab
			let targetBridge = this.tabBarBridges.get(pagePath)
			if (targetBridge) {
				// 复用：恢复显示
				targetBridge.webview.el.style.display = 'block'
				targetBridge.webview.el.classList.remove(
					'dimina-native-view--slide-out',
					'dimina-native-view--enter-anima',
					'dimina-native-view--instage',
				)
				// 移到栈顶
				const idx = this.bridgeList.indexOf(targetBridge)
				if (idx >= 0 && idx !== this.bridgeList.length - 1) {
					this.bridgeList.splice(idx, 1)
					this.bridgeList.push(targetBridge)
				}
				else if (idx < 0) {
					this.bridgeList.push(targetBridge)
				}
				// 总是触发 pageShow：包括"切回同一 tab"的场景，确保 onShow 一定可被业务监听到
				targetBridge.pageShow()
			}
			else {
				// 按需创建
				const pageConfig = this.appConfig.modules[pagePath]
				const mergeConfig = mergePageConfig(this.appConfig.app, pageConfig)
				this.updateTargetPageColorStyle(mergeConfig)

				targetBridge = await this.createBridge({
					pagePath,
					query,
					scene: this.appInfo.scene,
					jscore: this.jscore,
					isRoot: true,
					root: pageConfig?.root || 'main',
					appId: this.appInfo.appId,
					pages: this.appConfig.app.pages,
					configInfo: mergeConfig,
				})

				this.tabBarBridges.set(pagePath, targetBridge)
				this.bridgeList.push(targetBridge)

				targetBridge.webview.el.style.display = 'block'
				targetBridge.webview.el.style.zIndex = 1
				targetBridge.webview.el.classList.remove(
					'dimina-native-view--before-enter',
					'dimina-native-view--slide-out',
					'dimina-native-view--enter-anima',
					'dimina-native-view--instage',
				)
				targetBridge.start()  // 首次 onLoad/onShow 由 service 端在资源就绪后触发
			}

			// 4. 状态同步
			this.currentTabPath = pagePath
			HashRouter.sync(this.appId, pagePath, query)
			this._updateTabBarSelection(pagePath)
			this._setTabBarVisible(true)

			onSuccess?.({ errMsg: 'switchTab:ok' })
		}
		catch (error) {
			onFail?.({ errMsg: `switchTab:fail ${error.message}` })
		}
		finally {
			onComplete?.()
		}
	}

	/**
	 * 规范化 pagePath：去掉前导 '/'，与 app.tabBar.list 中声明的格式对齐
	 */
	_normalizePath(path) {
		if (!path) return ''
		return path.startsWith('/') ? path.substring(1) : path
	}

	/**
	 * 渲染 TabBar UI（一次性渲染，后续通过 _setTabBarVisible / _updateTabBarSelection 调整）
	 */
	_renderTabBar(tabBarConfig) {
		const tabBarEl = this.el.querySelector('.dimina-mini-app__tabbar')
		if (!tabBarEl) return

		const { color, backgroundColor, borderStyle, list } = tabBarConfig
		const borderColor = borderStyle === 'white' ? '#ffffff' : 'rgba(0, 0, 0, 0.2)'
		const normalColor = color || '#999999'

		tabBarEl.innerHTML = `
			<div class="dimina-tabbar" style="background-color: ${backgroundColor || '#ffffff'}; border-top: 0.5px solid ${borderColor};">
				${list
					.map(
						(item, index) => `
					<div class="dimina-tabbar-item" data-path="${item.pagePath}" data-index="${index}">
						${
							item.iconPath
								? `<img class="dimina-tabbar-icon dimina-tabbar-icon-default"
									src="${import.meta.env.BASE_URL}${this.appId}/main/${item.iconPath}" alt="${item.text}" />
								${
									item.selectedIconPath
										? `<img class="dimina-tabbar-icon dimina-tabbar-icon-selected"
											src="${import.meta.env.BASE_URL}${this.appId}/main/${item.selectedIconPath}" alt="${item.text}" />`
										: ''
								}`
								: ''
						}
						<span class="dimina-tabbar-text" style="color: ${normalColor};">${item.text}</span>
					</div>
				`,
					)
					.join('')}
			</div>
		`

		// 事件委托：单个监听器即可处理所有 tab 项点击
		tabBarEl.addEventListener('click', (e) => {
			const item = e.target.closest('.dimina-tabbar-item')
			if (!item) return
			const path = item.getAttribute('data-path')
			if (path) {
				this.switchTab({ url: `/${path}` })
			}
		})

		this._updateTabBarSelection(this.currentTabPath)
	}

	/**
	 * 控制 TabBar 容器及 webviews 容器的底部 padding
	 */
	_setTabBarVisible(visible) {
		const tabBarEl = this.el.querySelector('.dimina-mini-app__tabbar')
		if (!tabBarEl) return
		tabBarEl.style.display = visible ? 'block' : 'none'
		const webviewsContainer = this.el.querySelector('.dimina-mini-app__webviews')
		if (webviewsContainer) {
			webviewsContainer.style.bottom = visible ? '49px' : '0'
		}
	}

	/**
	 * 仅更新选中态（颜色 / 图标 / class），不重渲染 TabBar
	 */
	_updateTabBarSelection(currentPath) {
		const tabBarEl = this.el.querySelector('.dimina-mini-app__tabbar')
		if (!tabBarEl) return

		const tabBarConfig = this.appConfig?.app?.tabBar
		if (!tabBarConfig) return

		const normalColor = tabBarConfig.color || '#999999'
		const selectedColor = tabBarConfig.selectedColor || '#1890ff'

		tabBarEl.querySelectorAll('.dimina-tabbar-item').forEach((item) => {
			const path = item.getAttribute('data-path')
			const isSelected = path === currentPath
			const text = item.querySelector('.dimina-tabbar-text')
			const defaultIcon = item.querySelector('.dimina-tabbar-icon-default')
			const selectedIcon = item.querySelector('.dimina-tabbar-icon-selected')

			if (text) text.style.color = isSelected ? selectedColor : normalColor
			if (defaultIcon) defaultIcon.style.display = isSelected ? 'none' : 'block'
			if (selectedIcon) selectedIcon.style.display = isSelected ? 'block' : 'none'
			item.classList.toggle('dimina-tabbar-item--selected', isSelected)
		})
	}

	navigateToMiniProgram(opts) {
		const { appId, path } = opts
		AppManager.openApp(
			{
				appId,
				path,
				scene: 1037, // 打开小程序
			},
			this.parent,
		)
	}

	bindMoreEvent() {
		const moreBtn = this.el.querySelector('.dimina-mini-app-navigation__actions-variable')
		const dialog = this.el.querySelector('.dimina-mini-app_dialog-content')
		const overlay = this.el.querySelector('.dimina-mini-app_dialog-bg')
		const info = this.el.querySelector('.dimina-mini-app_dialog-info')
		info.innerHTML = `app id: ${this.appId}`

		overlay.addEventListener('transitionend', () => {
			if (overlay.style.opacity === '0') {
				overlay.style.display = 'none'
			}
		})

		moreBtn.onclick = () => {
			overlay.style.display = 'block'
			overlay.style.opacity = 1
			dialog.classList.add('show')
		}

		overlay.onclick = () => {
			overlay.style.opacity = 0
			dialog.classList.remove('show')
		}
	}

	bindCloseEvent() {
		const closeBtn = this.el.querySelector('.dimina-mini-app-navigation__actions-close')

		closeBtn.onclick = () => {
			HashRouter.clear()
			AppManager.closeApp(this)
		}
	}

	destroy() {
		AppManager.popView()
		this.jscore.destroy()
	}

	/**
	 * 获取网络类型
	 * https://developers.weixin.qq.com/miniprogram/dev/api/device/network/wx.getNetworkType.html
	 */
	getNetworkType(opts) {
		const { success } = opts
		const onSuccess = this.createCallbackFunction(success)
		onSuccess?.({
			networkType: 'wifi',
		})
	}

	/**
	 * 发起 HTTPS 网络请求
	 * https://developers.weixin.qq.com/miniprogram/dev/api/network/request/wx.request.html
	 * @param {*} param0
	 */
	request({
		url,
		data,
		header = {}, // 默认为空对象
		timeout = 0, // 默认为0，表示没有超时
		method = 'GET', // 默认为GET方法
		dataType = 'json', // 默认为json类型
		responseType = 'text', // 响应的数据类型，默认为 text
		success,
		fail,
		complete,
	}) {
		// 创建一个AbortController实例
		// const controller = new AbortController();
		// const { signal } = controller;

		// 创建fetch请求的init对象
		const init = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				url,
				data,
				header,
				timeout,
				method,
				dataType,
				responseType,
			}),
		}

		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		fetch('http://localhost:7788/proxy', init)
			.then((response) => {
				if (!response.ok) {
					const error = new Error(response.statusText)
					error.code = response.status
					throw error
				}

				// Convert the Headers object to a plain object
				const headers = {}
				response.headers.forEach((value, key) => {
					headers[key] = value
				})

				switch (dataType) {
					case 'json':
						return response.json().then(data => ({ data: JSON.parse(data), header: headers, statusCode: response.status }))
					case 'arraybuffer':
						return response.arrayBuffer().then(data => ({ data, header: headers, statusCode: response.status }))
					default:
						return response.text().then(data => ({ data, header: headers, statusCode: response.status }))
				}
			})
			.then((data) => {
				onSuccess?.(data)
			})
			.catch((error) => {
				onFail?.({ errMsg: error.message, errno: error.code })
			})
			.finally(() => {
				onComplete?.()
			})

		// return { abort: controller.abort };
	}

	getSystemInfoAsync(opts) {
		const bar = this.parent.parent.root.querySelector('.iphone__status-bar').getBoundingClientRect()
		const wb = this.parent.el.querySelector('.dimina-native-webview__root').getBoundingClientRect()

		const { success, complete } = opts

		const onSuccess = this.createCallbackFunction(success)
		const onComplete = this.createCallbackFunction(complete)

		onSuccess?.({
			statusBarHeight: bar.height,
			brand: 'devtools',
			mode: 'default',
			model: 'web',
			platform: 'devtools',
			system: 'web',
			deviceOrientation: 'portrait',
			SDKVersion: '3.0.0',
			language: 'zh_CN',
			wifiEnabled: true,
			safeArea: {
				width: wb.width,
				height: wb.height,
				top: wb.top,
				bottom: wb.bottom,
				left: wb.left,
				right: wb.right,
			},
		})
		onComplete?.()
	}

	getMenuButtonBoundingClientRect() {
		return this.el.querySelector('.dimina-mini-app-navigation__actions').getBoundingClientRect()
	}

	getSystemInfoSync() {
		return {
			brand: 'devtools',
			model: 'web',
			platform: 'devtools',
			system: 'web',
			SDKVersion: '3.0.0', // vant组件库 判断  canIUseModel version 需要大于 2.9.3
		}
	}

	showToast(opts) {
		const { title = '', duration = 1500, icon = 'success', success, complete } = opts

		if (!title) {
			return
		}

		this.hideToast({})

		const onSuccess = this.createCallbackFunction(success)
		const onComplete = this.createCallbackFunction(complete)

		this.toastInfo.dom = document.createElement('div')
		this.toastInfo.dom.classList.add('dimina-toast', `dimina-toast--${icon}`)
		this.toastInfo.dom.innerHTML = `<p>${title}</p>`
		this.webviewsContainer.appendChild(this.toastInfo.dom)

		this.toastInfo.timer = setTimeout(() => {
			this.webviewsContainer.removeChild(this.toastInfo.dom)
			this.toastInfo.dom = null
		}, duration)

		onSuccess?.()
		onComplete?.()
	}

	hideToast(opts) {
		const { success, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onComplete = this.createCallbackFunction(complete)

		if (this.toastInfo.dom) {
			this.webviewsContainer.removeChild(this.toastInfo.dom)
			this.toastInfo.dom = null
		}
		if (this.toastInfo.timer) {
			clearTimeout(this.toastInfo.timer)
			this.toastInfo.timer = null
		}
		onSuccess?.()
		onComplete?.()
	}

	showLoading(opts) {
		this.showToast({ ...opts, icon: 'loading' })
	}

	hideLoading(opts) {
		this.hideLoading(opts)
	}

	showModal(opts = {}) {
		const {
			title = '',
			content = '',
			showCancel = true,
			cancelText = '取消',
			cancelColor = '#000000',
			confirmText = '确定',
			confirmColor = '#576b95',
			success,
			fail,
			complete,
		} = opts

		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		// 单调递增的层级序号，保证后弹出的 modal 能覆盖之前的（即使先开的没关）
		// 每个 modal 占两层：mask 偶数、dialog 奇数（dialog 始终在自己的 mask 之上）
		this._modalDepth = (this._modalDepth || 0) + 1
		const baseZ = 2000
		const maskZ = baseZ + this._modalDepth * 2
		const dialogZ = maskZ + 1

		const mask = document.createElement('div')
		mask.className = 'dimina-dialog-mask'
		mask.style.zIndex = String(maskZ)

		const dialog = document.createElement('div')
		dialog.className = 'dimina-dialog'
		dialog.style.zIndex = String(dialogZ)

		// 用 DOM API 构造，textContent 自动转义，避免 content/title 注入 HTML
		if (title) {
			const titleEl = document.createElement('h3')
			titleEl.className = 'dimina-dialog__title'
			titleEl.textContent = title
			dialog.appendChild(titleEl)
		}

		const contentEl = document.createElement('p')
		contentEl.className = 'dimina-dialog__content'
		contentEl.textContent = content
		dialog.appendChild(contentEl)

		const buttonRow = document.createElement('div')
		buttonRow.className = 'dimina-dialog__buttons'

		let cancelBtn = null
		if (showCancel) {
			cancelBtn = document.createElement('button')
			cancelBtn.type = 'button'
			cancelBtn.className = 'dimina-dialog__button'
			cancelBtn.textContent = cancelText
			cancelBtn.style.color = cancelColor
			buttonRow.appendChild(cancelBtn)
		}

		const confirmBtn = document.createElement('button')
		confirmBtn.type = 'button'
		confirmBtn.className = 'dimina-dialog__button'
		confirmBtn.textContent = confirmText
		confirmBtn.style.color = confirmColor
		buttonRow.appendChild(confirmBtn)

		dialog.appendChild(buttonRow)

		// 退出过程：先去掉 .show 触发渐出，动画结束再 remove DOM
		// 每个 modal 独立管理自己的 dismiss，互不干扰；多 modal 叠加时按用户操作顺序逐个关闭
		let resolved = false
		const dismiss = () => {
			if (resolved) return
			resolved = true
			mask.classList.remove('show')
			dialog.classList.remove('show')
			setTimeout(() => {
				mask.remove()
				dialog.remove()
			}, 200)
		}

		const handleCancel = () => {
			dismiss()
			onSuccess?.({ cancel: true, confirm: false, errMsg: 'showModal:ok' })
			onComplete?.()
		}
		const handleConfirm = () => {
			dismiss()
			onSuccess?.({ confirm: true, cancel: false, errMsg: 'showModal:ok' })
			onComplete?.()
		}

		cancelBtn?.addEventListener('click', handleCancel)
		confirmBtn.addEventListener('click', handleConfirm)
		// 微信规范：showCancel:false 时点击遮罩不关闭，强制用户操作 confirm 按钮
		if (showCancel) {
			mask.addEventListener('click', handleCancel)
		}

		this.webviewsContainer.appendChild(mask)
		this.webviewsContainer.appendChild(dialog)

		// 触发渐入：等浏览器把初始 opacity:0 + scale(0.9) 应用一帧后再加 .show
		requestAnimationFrame(() => {
			mask.classList.add('show')
			dialog.classList.add('show')
		})
	}

	showActionSheet(opts = {}) {
		const {
			itemList = [],
			itemColor = '#000000',
			alertText = '',
			success,
			fail,
			complete,
		} = opts

		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		// 参数校验：微信规范 itemList 必须为非空数组、长度 ≤ 6
		if (!Array.isArray(itemList) || itemList.length === 0) {
			onFail?.({ errMsg: 'showActionSheet:fail invalid itemList' })
			onComplete?.()
			return
		}
		if (itemList.length > 6) {
			onFail?.({ errMsg: 'showActionSheet:fail itemList must be no more than 6' })
			onComplete?.()
			return
		}

		// 互斥：先关掉上一次未关闭的 action sheet
		this._dismissActionSheet?.()

		const mask = document.createElement('div')
		mask.className = 'dimina-action-sheet-mask'

		const sheet = document.createElement('div')
		sheet.className = 'dimina-action-sheet'

		// 警示文字（wechat 8.0+ 字段）
		if (alertText) {
			const alertEl = document.createElement('div')
			alertEl.className = 'dimina-action-sheet-alert'
			alertEl.textContent = alertText
			sheet.appendChild(alertEl)
		}

		// 退出过程：先去掉 .show 触发渐出，动画结束再 remove
		let resolved = false
		const dismiss = () => {
			if (resolved) return
			resolved = true
			mask.classList.remove('show')
			sheet.classList.remove('show')
			setTimeout(() => {
				mask.remove()
				sheet.remove()
				if (this._dismissActionSheet === dismiss) {
					this._dismissActionSheet = null
				}
			}, 200)
		}
		this._dismissActionSheet = dismiss

		const handleSelect = (idx) => {
			dismiss()
			onSuccess?.({ tapIndex: idx, errMsg: 'showActionSheet:ok' })
			onComplete?.()
		}
		const handleCancel = () => {
			dismiss()
			onFail?.({ errMsg: 'showActionSheet:fail cancel' })
			onComplete?.()
		}

		itemList.forEach((item, idx) => {
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'dimina-action-sheet-item'
			btn.style.color = itemColor
			btn.textContent = String(item)
			btn.addEventListener('click', () => handleSelect(idx))
			sheet.appendChild(btn)
		})

		const cancelBtn = document.createElement('button')
		cancelBtn.type = 'button'
		cancelBtn.className = 'dimina-action-sheet-cancel'
		cancelBtn.textContent = '取消'
		cancelBtn.addEventListener('click', handleCancel)
		sheet.appendChild(cancelBtn)

		// 点击遮罩等同于取消（wechat 规范）
		mask.addEventListener('click', handleCancel)

		this.webviewsContainer.appendChild(mask)
		this.webviewsContainer.appendChild(sheet)

		// 等浏览器把初始态绘一帧后再加 .show 触发渐入
		requestAnimationFrame(() => {
			mask.classList.add('show')
			sheet.classList.add('show')
		})
	}

	setNavigationBarTitle(opts) {
		const { title, success, fail, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)
		try {
			const currentBridge = this.bridgeList[this.bridgeList.length - 1]
			const navigationTitle = currentBridge.webview.el.querySelector('.dimina-native-webview__navigation-title')
			if (navigationTitle) {
				navigationTitle.textContent = title || ''
				onSuccess?.({ errMsg: 'setNavigationBarTitle:ok' })
			}
			else {
				onFail?.({ errMsg: `setNavigationBarTitle:fail Navigation title element not found` })
			}
		}
		catch (error) {
			onFail?.({ errMsg: `setNavigationBarTitle:fail ${error.message}` })
		}
		finally {
			onComplete?.()
		}
	}

	setNavigationBarColor(opts) {
		const { frontColor, backgroundColor, success, fail, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			const currentBridge = this.bridgeList[this.bridgeList.length - 1]
			const navigation = currentBridge.webview.el.querySelector('.dimina-native-webview__navigation')
			if (navigation) {
				// 设置前景色（文字颜色）
				if (frontColor) {
					navigation.querySelector('.dimina-native-webview__navigation-title').style.color = frontColor
				}
				// 设置背景色
				if (backgroundColor) {
					navigation.style.backgroundColor = backgroundColor
				}
				onSuccess?.({ errMsg: 'setNavigationBarColor:ok' })
			}
			else {
				onFail?.({ errMsg: `setNavigationBarColor:fail Navigation element not found` })
			}
		}
		catch (error) {
			onFail?.({ errMsg: `setNavigationBarColor:fail ${error.message}` })
		}
		finally {
			onComplete?.()
		}
	}

	/**
	 * 页面滚动到指定位置
	 */
	pageScrollTo(opts) {
		const { scrollTop, duration = 300, success, fail, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			const currentBridge = this.bridgeList[this.bridgeList.length - 1]
			const webviewRoot = currentBridge.webview.iframe.contentWindow.document.documentElement
			if (webviewRoot) {
				webviewRoot.scrollTo({
					top: scrollTop,
					behavior: duration > 0 ? 'smooth' : 'auto',
				})

				// 模拟滚动动画时间
				setTimeout(() => {
					onSuccess?.({ errMsg: 'pageScrollTo:ok' })
					onComplete?.()
				}, duration)
			}
			else {
				onFail?.({ errMsg: `pageScrollTo:fail Webview root element not found` })
				onComplete?.()
			}
		}
		catch (error) {
			onFail?.({ errMsg: `pageScrollTo:fail ${error.message}` })
			onComplete?.()
		}
	}

	/**
	 * 设置剪贴板数据
	 */
	setClipboardData(opts) {
		const { data, success, fail, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			navigator.clipboard.writeText(data).then(() => {
				onSuccess?.({ errMsg: 'setClipboardData:ok' })
				onComplete?.()
			}).catch((error) => {
				onFail?.({ errMsg: `setClipboardData:fail ${error.message}` })
				onComplete?.()
			})
		}
		catch (error) {
			onFail?.({ errMsg: `setClipboardData:fail ${error.message}` })
			onComplete?.()
		}
	}

	/**
	 * 获取剪贴板数据
	 */
	getClipboardData(opts) {
		const { success, fail, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			navigator.clipboard.readText().then((data) => {
				onSuccess?.({ data, errMsg: 'getClipboardData:ok' })
				onComplete?.()
			}).catch((error) => {
				onFail?.({ errMsg: `getClipboardData:fail ${error.message}` })
				onComplete?.()
			})
		}
		catch (error) {
			onFail?.({ errMsg: `getClipboardData:fail ${error.message}` })
			onComplete?.()
		}
	}

	setStorage(opts) {
		const { key, data, success, fail, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			// 按appId区分存储数据
			const storageKey = `${this.appId}_${key}`
			// 将数据转为字符串存储
			const dataString = typeof data === 'object' ? JSON.stringify(data) : String(data)
			localStorage.setItem(storageKey, dataString)
			onSuccess?.({ errMsg: 'setStorage:ok' })
		}
		catch (error) {
			onFail?.({ errMsg: `setStorage:fail ${error.message}` })
		}
		finally {
			onComplete?.()
		}
	}

	getStorage(opts) {
		const { key, success, fail, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			// 按appId区分存储数据
			const storageKey = `${this.appId}_${key}`
			const data = localStorage.getItem(storageKey)
			if (data !== null) {
				// 尝试解析JSON数据
				let parsedData = data
				try {
					parsedData = JSON.parse(data)
				}
				catch {
					// 如果解析失败，保持原始字符串
				}
				onSuccess?.({ data: parsedData, errMsg: 'getStorage:ok' })
			}
			else {
				onFail?.({ errMsg: `getStorage:fail data not found` })
			}
		}
		catch (error) {
			onFail?.({ errMsg: `getStorage:fail ${error.message}` })
		}
		finally {
			onComplete?.()
		}
	}

	removeStorage(opts) {
		const { key, success, fail, complete } = opts
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			// 按appId区分存储数据
			const storageKey = `${this.appId}_${key}`
			if (localStorage.getItem(storageKey) !== null) {
				localStorage.removeItem(storageKey)
				onSuccess?.({ errMsg: 'removeStorage:ok' })
			}
			else {
				// 即使key不存在也返回成功
				onSuccess?.({ errMsg: 'removeStorage:ok' })
			}
		}
		catch (error) {
			onFail?.({ errMsg: `removeStorage:fail ${error.message}` })
		}
		finally {
			onComplete?.()
		}
	}

	clearStorage(opts) {
		const { success, fail, complete } = opts || {}
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			// 只清除当前appId的存储数据
			const appIdPrefix = `${this.appId}_`
			const keysToRemove = []

			// 找出所有属于当前appId的keys
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i)
				if (key.startsWith(appIdPrefix)) {
					keysToRemove.push(key)
				}
			}

			// 删除所有找到的keys
			keysToRemove.forEach(key => localStorage.removeItem(key))

			onSuccess?.({ errMsg: 'clearStorage:ok' })
		}
		catch (error) {
			onFail?.({ errMsg: `clearStorage:fail ${error.message}` })
		}
		finally {
			onComplete?.()
		}
	}

	getStorageInfo(opts) {
		const { success, fail, complete } = opts || {}
		const onSuccess = this.createCallbackFunction(success)
		const onFail = this.createCallbackFunction(fail)
		const onComplete = this.createCallbackFunction(complete)

		try {
			const keys = []
			let currentSize = 0
			const limitSize = 10 * 1024 * 1024 // 假设限制为10MB
			const appIdPrefix = `${this.appId}_`

			// 只获取当前appId的存储信息
			for (let i = 0; i < localStorage.length; i++) {
				const fullKey = localStorage.key(i)

				// 只处理当前appId的keys
				if (fullKey.startsWith(appIdPrefix)) {
					// 移除appId前缀，返回原始key给小程序
					const originalKey = fullKey.substring(appIdPrefix.length)
					keys.push(originalKey)

					const item = localStorage.getItem(fullKey)
					currentSize += item ? item.length * 2 : 0 // 估算字符串大小（UTF-16编码每个字符2字节）
				}
			}

			onSuccess?.({
				keys,
				currentSize, // 当前占用空间，单位为字节
				limitSize, // 存储限制，单位为字节
				errMsg: 'getStorageInfo:ok',
			})
		}
		catch (error) {
			onFail?.({ errMsg: `getStorageInfo:fail ${error.message}` })
		}
		finally {
			onComplete?.()
		}
	}
}
