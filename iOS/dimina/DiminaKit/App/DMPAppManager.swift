//
//  DMPAppManager.swift
//  dimina
//
//  Created by Lehem on 2025/4/28.
//

public class DMPAppManager {
    private static let instance = DMPAppManager()

    private var appPools: [Int: DMPApp] = [:]
    private var appIndex: Int = 0
    public private(set) var apiNamespaces: [String] = []

    private init() {}

    public static func sharedInstance() -> DMPAppManager {
        return instance
    }

    public func setup(apiNamespaces: [String] = []) {
        self.apiNamespaces = apiNamespaces
    }
    
    func getApp(appIndex: Int) -> DMPApp? {
        return appPools[appIndex]
    }
    
    func newAppWithConfig(appConfig: DMPAppConfig) -> DMPApp {
        appIndex += 1
        let newApp = DMPApp(appConfig: appConfig, appIndex: appIndex)
        appPools[appIndex] = newApp
        return newApp
    }
    
    public func appWithConfig(appConfig: DMPAppConfig) -> DMPApp {
        print("appWithConfig config=\(appConfig)")
        if let existingApp = existApp(appId: appConfig.appId) {
            print("appWithConfig return exist DMPApp")
            return existingApp
        } else {
            print("appWithConfig create DMPApp")
            appIndex += 1
            let newApp = DMPApp(appConfig: appConfig, appIndex: appIndex)
            appPools[appIndex] = newApp
            // 自动注入已提前注册的 ext 模块
            applyPendingExtModules(to: newApp)
            return newApp
        }
    }

    func existApp(appId: String) -> DMPApp? {
        return appPools.values.first(where: { $0.getAppId() == appId })
    }
    
    func removeApp(appId: String) {
        if let key = appPools.first(where: { $0.value.getAppId() == appId })?.key {
            appPools.removeValue(forKey: key)
        }
    }

    // MARK: - Ext Module Registration

    /// 注册第三方扩展 bridge 模块（全局注册，对所有小程序生效）。
    ///
    /// 小程序通过 `wx.extBridge` / `wx.extOnBridge` / `wx.extOffBridge` 与 native 模块通信，
    /// 宿主在初始化后、启动小程序前调用此方法注册对应处理器。
    ///
    /// 示例：
    /// ```swift
    /// DMPAppManager.sharedInstance().registerExtModule("MyModule") { event, data, callback in
    ///     switch event {
    ///     case "getUserInfo":
    ///         callback.onSuccess(DMPMap(["name": "Alice"]))
    ///         return nil
    ///     case "onDataChange":
    ///         let token = startObserving { res in callback.onSuccess(res) }
    ///         return { stopObserving(token) }
    ///     default:
    ///         callback.onFail(DMPMap(["errMsg": "unknown event: \(event)"]))
    ///         return nil
    ///     }
    /// }
    /// ```
    ///
    /// - Parameters:
    ///   - moduleName: 模块名，与小程序侧 `module` 参数一致
    ///   - handler:    处理器，详见 `DMPExtModuleHandler`
    public func registerExtModule(_ moduleName: String, handler: @escaping DMPExtModuleHandler) {
        // 注册到所有已创建的 App 实例
        appPools.values.forEach { $0.registerExtModule(moduleName, handler: handler) }
        // 缓存起来，供后续新建的 App 初始化时使用
        pendingExtModules[moduleName] = handler
    }

    /// 待注册的 ext 模块缓存，用于在 App 创建之前注册的模块能在 App 初始化后自动注入
    private var pendingExtModules: [String: DMPExtModuleHandler] = [:]

    /// 创建新 App 时自动注入已缓存的 ext 模块（内部使用）
    internal func applyPendingExtModules(to app: DMPApp) {
        pendingExtModules.forEach { moduleName, handler in
            app.registerExtModule(moduleName, handler: handler)
        }
    }

    // MARK: - Render User Script Registration

    /// 已注册的渲染层启动脚本（全局，对所有小程序的每个渲染层 WebView 生效）。
    ///
    /// 仅注入到渲染层 WKWebView（不注入逻辑层 JSContext），且在框架自身的
    /// render bridge bootstrap 之后追加，保证 `DiminaRenderBridge` 已就绪、
    /// `customElements.define` 早于页面渲染（`.atDocumentStart`）。
    public private(set) var renderUserScripts: [String] = []

    /// 注册渲染层启动脚本（用于注入 Web Component / 自定义元素 bundle 等）。
    ///
    /// 宿主应在启动小程序、创建 WebView 之前调用；可多次调用累加。
    /// 脚本会在每个渲染层 WebView 加载页面框架时、框架 bootstrap 注入之后，
    /// 以 `WKUserScript(injectionTime: .atDocumentStart, forMainFrameOnly: false)` 注入。
    ///
    /// - Parameter script: 要注入的 JavaScript 源码。
    public func registerRenderUserScript(_ script: String) {
        renderUserScripts.append(script)
    }
}
