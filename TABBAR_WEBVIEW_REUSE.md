# TabBar WebView 复用方案 - 三端统一架构

## 📋 方案概述

三端(HarmonyOS/iOS/Android/Web)统一采用**容器管理多 WebView/视图**的架构，实现 TabBar 页面的真正复用和即时切换。

### 核心思想
- ✅ **容器管理**：专门的容器组件管理所有 Tab 页面
- ✅ **多视图并存**：所有 Tab 页面同时创建，常驻内存
- ✅ **可见性控制**：切换 Tab 只改变可见性，不销毁重建
- ✅ **状态保留**：WebView/页面状态完整保持
- ✅ **即时切换**：无加载过程，无白屏

---

## 🎯 HarmonyOS 实现

### 架构组件

#### 1. DMPTabBarContainerView (容器组件)
```typescript
// /harmony/dimina/src/main/ets/Container/DMPTabBarContainerView.ets

@Component
export struct DMPTabBarContainerView {
  @State selectedIndex: number = 0
  @State tabPageRecords: DMPPageRecord[] = []

  build() {
    Column() {
      // 所有 Tab 页面的堆栈（只有选中的可见）
      Stack() {
        ForEach(this.tabPageRecords, (pageRecord, index) => {
          DMPPageContainer({
            appIndex: this.appIndex,
            webViewId: pageRecord.webViewId,
            hideTabBar: true  // 容器统一显示 TabBar
          })
            .visibility(index === this.selectedIndex ? Visibility.Visible : Visibility.None)
            .zIndex(index === this.selectedIndex ? 1 : 0)
        })
      }
      .layoutWeight(1)

      // TabBar 在容器层级
      DMPTabBar({ selectedIndex: this.selectedIndex, ... })
    }
  }
}
```

#### 2. DMPNavigator (导航器辅助方法)
```typescript
// 查找已有页面记录
public findPageRecordByPath(pagePath: string): DMPPageRecord | undefined

// 为 Tab 创建页面记录（无需路由）
public createPageRecordForTab(pagePath: string): DMPPageRecord

// 更新 Tab 选中状态（栈+生命周期）
public updateTabBarSelection(targetPath: string)
```

### switchTab 流程
```
用户点击 Tab
  ↓
DMPTabBar.onTabSelected(index)
  ↓
DMPTabBarContainerView.handleTabSelected(index)
  ├─ selectedIndex = index  (@State 触发 UI 更新)
  └─ navigator.updateTabBarSelection(targetPath)
       ├─ 触发当前页面 onHide
       ├─ 更新栈顺序（移目标到栈顶）
       └─ 触发目标页面 onShow
  ↓
UI 自动重渲染
  └─ ForEach 根据 selectedIndex 切换 Visibility
```

---

## 🍎 iOS 实现

### 架构组件

#### 1. DMPTabBarContainerViewController (容器 VC)
```swift
// /iOS/dimina/DiminaKit/Container/DMPTabBarContainerViewController.swift

public class DMPTabBarContainerViewController: UIViewController {
    // 所有 Tab 页面控制器（提前创建）
    private var tabPageControllers: [DMPPageController] = []

    // 容器视图
    private let tabPagesContainer = UIView()

    /// 创建所有 Tab 页面（多视图方法）
    private func createAllTabPages() {
        for (index, tabItem) in tabBarConfig.list.enumerated() {
            let pageController = DMPPageController(...)

            // 添加到容器（所有页面同时存在）
            tabPagesContainer.addSubview(pageController.view)
            addChild(pageController)

            // 初始化时只显示第一个
            pageController.view.isHidden = (index != selectedIndex)

            tabPageControllers.append(pageController)
            navigator.createPageRecordForTab(path: pagePath, webViewId: webViewId)
        }
    }
}
```

#### 2. DMPNavigator (导航器辅助方法)
```swift
// 查找页面记录
public func findPageRecord(byPath path: String) -> DMPPageRecord?

// 为 Tab 创建页面记录
public func createPageRecordForTab(path: String, webViewId: Int) -> DMPPageRecord

// 更新 Tab 选中状态
public func updateTabBarSelection(to path: String, webViewId: Int)
```

### switchTab 流程
```
用户点击 Tab
  ↓
DMPTabBarView.onTabSelected(index)
  ↓
DMPTabBarContainerViewController.handleTabSelected(index)
  ├─ currentPageController.view.isHidden = true   // 隐藏当前
  ├─ targetPageController.view.isHidden = false   // 显示目标
  ├─ selectedIndex = index
  └─ navigator.updateTabBarSelection(to: path, webViewId: id)
       ├─ 触发 pageLifecycle.onHide(currentWebViewId)
       ├─ 更新 pageRecords 栈顺序
       └─ 触发 pageLifecycle.onShow(targetWebViewId)
```

---

## 🤖 Android 实现

### 架构组件

#### 1. DiminaActivity (多 WebView 管理)
```kotlin
// /android/dimina/src/main/kotlin/com/didi/dimina/ui/container/DiminaActivity.kt

class DiminaActivity : ComponentActivity() {
    // TabBar 页面实例（多 WebView 状态保留）
    private val tabBarWebViews = mutableMapOf<String, WebView>()
    private val tabBarBridges = mutableMapOf<String, Bridge>()
    private var currentTabPath = mutableStateOf<String?>(null)

    @Composable
    fun DiminaContent() {
        if (tabBarConfig.value != null) {
            // 为每个 tab 创建 WebView
            tabBarConfig.value?.list?.forEach { tabItem ->
                val isVisible = currentTabPath.value == tabItem.pagePath
                Box(modifier = Modifier
                    .fillMaxSize()
                    .then(if (isVisible) Modifier else Modifier.alpha(0f))
                ) {
                    DiminaWebView(
                        onInitReady = { webView ->
                            tabBarWebViews[tabItem.pagePath] = webView
                            if (isVisible) onWebViewReady(webView)
                        },
                        identifier = "tabbar_${tabItem.pagePath}"
                    )
                }
            }
        }
    }
}
```

### switchTab 流程
```
用户点击 Tab
  ↓
TabBarView.onClick(index)
  ↓
DiminaActivity.switchTab(pagePath)
  ├─ 检查是否已在当前 tab
  ├─ 更新 selectedTabIndex
  ├─ 获取/创建目标 WebView 和 Bridge
  │   ├─ targetWebView = tabBarWebViews[pagePath]
  │   └─ cachedBridge = tabBarBridges[pagePath] ?: createBridge()
  └─ currentTabPath.value = pagePath  (@State 触发 UI 更新)
       ↓
       UI 重组：alpha(0f) ↔ alpha(1f) 切换可见性
```

---

## 🌐 Frontend (Web) 实现

### 架构组件

#### 1. MiniApp (多 iframe 管理)
```javascript
// /fe/packages/container/src/pages/miniApp/miniApp.js

export class MiniApp {
    constructor(opts) {
        // TabBar 支持（多 iframe 方法）
        this.tabBarPagePaths = new Set()
        this.tabBarBridges = new Map()  // path -> bridge 映射
    }

    async switchTab(opts) {
        const { pagePath } = queryPath(opts.url)

        // 隐藏当前页面
        const currentBridge = this.bridgeList[this.bridgeList.length - 1]
        if (currentBridge) {
            currentBridge.pageHide()
            currentBridge.webview.el.style.display = 'none'
        }

        // 检查目标 tabBar 页面是否已存在
        let targetBridge = this.tabBarBridges.get(pagePath)

        if (targetBridge) {
            // 复用已存在的 tabBar 页面
            targetBridge.webview.el.style.display = 'block'

            // 移到栈顶
            const index = this.bridgeList.indexOf(targetBridge)
            if (index >= 0 && index !== this.bridgeList.length - 1) {
                this.bridgeList.splice(index, 1)
                this.bridgeList.push(targetBridge)
            }

            targetBridge.pageShow()
        } else {
            // 创建新的 tabBar 页面
            const bridge = await this.createBridge({...})
            this.tabBarBridges.set(pagePath, bridge)
            this.bridgeList.push(bridge)

            bridge.webview.el.style.display = 'block'
            bridge.start()
        }
    }
}
```

### switchTab 流程
```
JS 调用 wx.switchTab({ url: '/pages/tab2' })
  ↓
MiniApp.switchTab(opts)
  ├─ currentBridge.pageHide()
  ├─ currentBridge.webview.el.style.display = 'none'
  ├─ targetBridge = tabBarBridges.get(pagePath)
  │   ├─ 已存在：复用
  │   └─ 不存在：创建新 bridge 并缓存
  ├─ targetBridge.webview.el.style.display = 'block'
  ├─ 更新 bridgeList 栈顺序
  └─ targetBridge.pageShow()
```

---

## 📊 三端对比

| 维度 | HarmonyOS | iOS | Android | Web |
|------|----------|-----|---------|-----|
| **容器组件** | DMPTabBarContainerView | DMPTabBarContainerViewController | DiminaActivity | MiniApp |
| **多实例管理** | `DMPPageContainer[]` | `DMPPageController[]` | `Map<String, WebView>` | `Map<path, Bridge>` |
| **可见性控制** | `.visibility()` | `.isHidden` | `.alpha(0f)` | `style.display` |
| **状态管理** | `@State selectedIndex` | `TabBarState.selectedIndex` | `mutableStateOf<String?>` | `bridgeList + Map` |
| **生命周期** | pageLifecycle.onShow/onHide | pageLifecycle.onShow/onHide | Bridge lifecycle | bridge.pageShow/Hide |
| **导航辅助** | DMPNavigator 辅助方法 | DMPNavigator 辅助方法 | Activity 内部管理 | MiniApp 内部管理 |

---

## ✅ 方案优势

### 1. 性能优化
- ❌ **旧方案**：每次切换销毁重建，加载资源，白屏等待
- ✅ **新方案**：即时切换，0延迟，无白屏

### 2. 状态保留
- ❌ **旧方案**：页面状态丢失，用户输入、滚动位置等全部重置
- ✅ **新方案**：完整保留页面状态，用户体验一致

### 3. 内存管理
- Tab 页面常驻内存，但数量有限（通常 3-5 个）
- 移除非 TabBar 页面，释放内存
- 整体内存占用可控

### 4. 架构统一
- 三端（四端）方案思想一致
- 代码结构类似，便于维护
- 新增功能可同步实现

---

## 🎯 关键代码位置

### HarmonyOS
- 容器: `/harmony/dimina/src/main/ets/Container/DMPTabBarContainerView.ets`
- 导航器: `/harmony/dimina/src/main/ets/Navigator/DMPNavigator.ets` (新增辅助方法)
- 页面: `/harmony/dimina/src/main/ets/DPages/DMPPage.ets` (检测 TabBar 应用)
- 页面容器: `/harmony/dimina/src/main/ets/DPages/DMPPageContainer.ets` (hideTabBar 属性)

### iOS
- 容器: `/iOS/dimina/DiminaKit/Container/DMPTabBarContainerViewController.swift`
- 导航器: `/iOS/dimina/DiminaKit/Navigator/DMPNavigator.swift` (switchTab + 辅助方法)

### Android
- Activity: `/android/dimina/src/main/kotlin/com/didi/dimina/ui/container/DiminaActivity.kt`

### Web
- MiniApp: `/fe/packages/container/src/pages/miniApp/miniApp.js` (switchTab 方法)

---

## 📝 使用说明

### 1. TabBar 配置
```json
{
  "tabBar": {
    "color": "#999999",
    "selectedColor": "#1890ff",
    "backgroundColor": "#ffffff",
    "borderStyle": "black",
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "首页",
        "iconPath": "images/home.png",
        "selectedIconPath": "images/home-active.png"
      },
      {
        "pagePath": "pages/profile/profile",
        "text": "我的",
        "iconPath": "images/profile.png",
        "selectedIconPath": "images/profile-active.png"
      }
    ]
  }
}
```

### 2. 切换 Tab (小程序 API)
```javascript
wx.switchTab({
  url: '/pages/profile/profile',
  success: () => {
    console.log('切换成功')
  }
})
```

### 3. 容器自动检测
- 有 tabBar 配置 → 使用 TabBarContainer
- 无 tabBar 配置 → 使用普通页面导航

---

## 🔧 技术要点

### 1. 页面记录管理
- 所有 Tab 页面记录始终保留在栈中
- 非 TabBar 页面记录在 switchTab 时清理
- 栈顺序反映当前选中状态（选中的在栈顶）

### 2. 生命周期
- Tab 切换触发 onShow/onHide
- 不触发 onLoad/onUnload（页面未销毁）
- 保持与微信小程序一致的生命周期行为

### 3. 路由同步
- Tab 切换更新 URL hash (Web)
- 更新导航栈状态（Native）
- 保持路由历史记录一致

---

## 🚀 未来优化方向

1. **懒加载优化**
   - 首次只创建第一个 Tab 页面
   - 其他 Tab 在首次点击时创建
   - 减少启动时间

2. **内存监控**
   - 监控 Tab 页面内存占用
   - 超过阈值时卸载不常用的 Tab
   - 再次切换时重新创建

3. **预加载策略**
   - 预测用户下一个可能访问的 Tab
   - 提前创建/恢复页面
   - 进一步提升切换速度

---

**总结**：三端 TabBar WebView 复用方案通过容器管理多视图的架构，实现了真正的状态保留和即时切换，大幅提升了用户体验，且三端实现思路高度统一，便于维护和扩展。
