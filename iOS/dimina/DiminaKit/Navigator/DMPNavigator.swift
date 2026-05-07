//
//  DMPNavigator.swift
//  dimina
//
//  Created by Lehem on 2025/4/17.
//

import Foundation
import ObjectiveC
import SwiftUI
import UIKit

// 用于存储关联对象的键
private var navigatorAssociationKey: UInt8 = 0

/// DMPNavigator 是一个导航管理器，用于接管整个应用的导航动作
public class DMPNavigator: NSObject {
    // app 弱引用
    private weak var app: DMPApp?

    // 页面生命周期管理
    private lazy var pageLifecycle: DMPPageLifecycle? = DMPPageLifecycle(app: app!)

    // 用于小程序页面导航的控制器（有 tabBar 时为内层 nav controller）
    public private(set) weak var navigationController: UINavigationController?

    // 外层导航控制器（主 app 的 nav controller，用于 push 容器 VC）
    private weak var outerNavigationController: UINavigationController?

    // tabBar 容器 VC 弱引用
    private weak var tabBarContainerVC: DMPTabBarContainerViewController?

    // tabBar 页面路径集合
    private(set) var tabBarPagePaths: Set<String> = []

    // 页面记录
    private var pageRecords: [DMPPageRecord] = []

    // 公开初始化方法
    public init(app: DMPApp? = nil) {
        self.app = app
        super.init()
    }

    public func setup(navigationController: UINavigationController) {
        self.outerNavigationController = navigationController
        self.navigationController = navigationController

        objc_setAssociatedObject(
            navigationController, &navigatorAssociationKey, self, .OBJC_ASSOCIATION_RETAIN_NONATOMIC
        )

        // 禁用系统返回手势
        navigationController.interactivePopGestureRecognizer?.isEnabled = false
    }

    // MARK: - TabBar Setup

    /// 当 app-config 包含 tabBar 时调用，创建容器 VC 并切换内层导航
    @MainActor
    public func setupTabBarContainer(tabBarConfig: DMPTabBarConfig) {
        guard let outerNavController = outerNavigationController else { return }

        // 记录所有 tabBar 页面路径
        tabBarPagePaths = tabBarConfig.tabPagePaths

        // 创建容器 VC（内含 innerNavigationController）
        let containerVC = DMPTabBarContainerViewController(tabBarConfig: tabBarConfig, app: app)
        containerVC.navigator = self
        tabBarContainerVC = containerVC

        // 将内层 nav controller 注册到关联对象，用于页面导航
        let innerNavController = containerVC.innerNavigationController
        innerNavController.interactivePopGestureRecognizer?.isEnabled = false
        self.navigationController = innerNavController

        // 将容器 VC 推入外层导航栈
        outerNavController.pushViewController(containerVC, animated: true)
    }

    // MARK: - Back Button

    /// 创建自定义返回按钮
    public func createBackButton(darkStyle: Bool = false) -> UIBarButtonItem {
        if let bundle = DMPResourceManager.assetsBundle {
            let imageName = darkStyle ? "arrow-back-dark" : "arrow-back-light"
            if let backImage = UIImage(named: imageName, in: bundle, compatibleWith: nil) {
                let originalImage = backImage.withRenderingMode(.alwaysOriginal)
                return UIBarButtonItem(
                    image: originalImage, style: .plain, target: self,
                    action: #selector(handleBackButtonTapped))
            }
        }

        return UIBarButtonItem(
            title: "back",
            style: .plain,
            target: self,
            action: #selector(handleBackButtonTapped)
        )
    }

    /// 处理返回按钮点击事件
    @objc public func handleBackButtonTapped() {
        DispatchQueue.main.async { [weak self] in
            self?.navigateBack()
        }
    }

    // MARK: - Navigation

    /// 启动到指定页面（首页）
    @MainActor
    public func launch(to path: String, query: [String: Any]? = nil, animated: Bool = true) async {
        guard let navigationController = navigationController else {
            print("导航控制器未设置")
            return
        }

        pageLifecycle?.onHide(webviewId: app!.getCurrentWebViewId())

        let pageController = DMPPageController(
            pagePath: path,
            query: query,
            appConfig: app!.getAppConfig()!,
            app: app,
            navigator: self,
            isRoot: true
        )

        let pageRecord = DMPPageRecord(
            webViewId: pageController.getWebView().getWebViewId(),
            fromWebViewId: app!.getCurrentWebViewId(), pagePath: path)
        pageRecord.query = query
        pageRecord.navStyle = app?.getBundleAppConfig()?.getPageConfig(pagePath: path)
        pageRecords.append(pageRecord)

        await app?.service?.loadSubPackage(pagePath: path)

        navigationController.pushViewController(pageController, animated: animated)

        pageLifecycle?.onShow(webviewId: pageController.getWebView().getWebViewId())
    }

    /// 导航到指定页面
    @MainActor
    public func navigateTo(to path: String, query: [String: Any]? = nil, animated: Bool = true) async {
        guard let navigationController = navigationController else {
            print("导航控制器未设置")
            return
        }

        pageLifecycle?.onHide(webviewId: app!.getCurrentWebViewId())

        let pageController = DMPPageController(
            pagePath: path,
            query: query,
            appConfig: app!.getAppConfig()!,
            app: app,
            navigator: self,
            isRoot: false
        )

        let pageRecord = DMPPageRecord(
            webViewId: pageController.getWebView().getWebViewId(),
            fromWebViewId: app!.getCurrentWebViewId(), pagePath: path)
        pageRecord.query = query
        pageRecord.navStyle = app?.getBundleAppConfig()?.getPageConfig(pagePath: path)
        pageRecords.append(pageRecord)

        print("navigateTo: Creating page controller for path: \(path), isRoot: false")

        await app?.service?.loadSubPackage(pagePath: path)

        navigationController.pushViewController(pageController, animated: animated)

        pageLifecycle?.onShow(webviewId: pageController.getWebView().getWebViewId())
    }

    /// 返回上一页或多页
    @MainActor
    public func navigateBack(delta: Int = 1, animated: Bool = true, destroy: Bool = true) {
        guard let navigationController = navigationController else {
            print("导航控制器未设置")
            return
        }

        if navigationController.viewControllers.count <= 1 {
            if destroy {
                // 有 tabBar 容器时 pop 外层，否则 destroy
                if let containerVC = tabBarContainerVC {
                    outerNavigationController?.popViewController(animated: animated)
                    _ = containerVC  // will trigger viewWillDisappear -> app.destroy()
                } else {
                    app?.destroy()
                }
            }
            return
        }

        let currentIndex = navigationController.viewControllers.count - 1
        let targetIndex = max(currentIndex - delta, 0)

        if targetIndex == 0 {
            pageLifecycle?.onUnload(webviewId: app!.getCurrentWebViewId())
            pageRecords.removeAll()
            navigationController.popToRootViewController(animated: animated)
            return
        }

        for _ in 0..<delta {
            if navigationController.viewControllers.count <= 1 || pageRecords.isEmpty {
                break
            }
            pageLifecycle?.onUnload(webviewId: app!.getCurrentWebViewId())
            pageRecords.removeLast()
        }

        let targetViewController = navigationController.viewControllers[targetIndex]
        navigationController.popToViewController(targetViewController, animated: animated)

        if let previousPageRecord = pageRecords.last {
            pageLifecycle?.onShow(webviewId: previousPageRecord.webViewId)
        }
    }

    @MainActor
    public func redirectTo(to path: String, query: [String: Any]? = nil) async {
        guard let navigationController = navigationController else {
            print("导航控制器未设置")
            return
        }

        let currentIndex = navigationController.viewControllers.count - 1

        if currentIndex == 0 {
            pageLifecycle?.onUnload(webviewId: app!.getCurrentWebViewId())

            if !pageRecords.isEmpty {
                pageRecords.removeLast()
            }

            let pageController = DMPPageController(
                pagePath: path,
                query: query,
                appConfig: app!.getAppConfig()!,
                app: app,
                navigator: self,
                isRoot: true
            )

            let pageRecord = DMPPageRecord(
                webViewId: pageController.getWebView().getWebViewId(),
                fromWebViewId: app!.getCurrentWebViewId(), pagePath: path)
            pageRecord.query = query
            pageRecord.navStyle = app?.getBundleAppConfig()?.getPageConfig(pagePath: path)
            pageRecords.append(pageRecord)

            await app?.service?.loadSubPackage(pagePath: path)

            let viewControllers = [pageController]
            navigationController.setViewControllers(viewControllers, animated: false)

            pageLifecycle?.onShow(webviewId: pageController.getWebView().getWebViewId())

            return
        }

        pageLifecycle?.onUnload(webviewId: app!.getCurrentWebViewId())

        if !pageRecords.isEmpty {
            pageRecords.removeLast()
        }

        let pageController = DMPPageController(
            pagePath: path,
            query: query,
            appConfig: app!.getAppConfig()!,
            app: app,
            navigator: self,
            isRoot: false
        )

        let pageRecord = DMPPageRecord(
            webViewId: pageController.getWebView().getWebViewId(),
            fromWebViewId: app!.getCurrentWebViewId(), pagePath: path)
        pageRecord.query = query
        pageRecord.navStyle = app?.getBundleAppConfig()?.getPageConfig(pagePath: path)
        pageRecords.append(pageRecord)

        var viewControllers = navigationController.viewControllers
        viewControllers.removeLast()
        viewControllers.append(pageController)
        navigationController.setViewControllers(viewControllers, animated: false)
        pageLifecycle?.onShow(webviewId: pageController.getWebView().getWebViewId())
    }

    @MainActor
    public func relaunch(to path: String, query: [String: Any]? = nil, animated: Bool = true) async {
        guard let navigationController = navigationController else {
            print("导航控制器未设置")
            return
        }

        navigationController.popToRootViewController(animated: animated)
        pageRecords.removeAll()

        await launch(to: path, query: query, animated: animated)
    }

    // MARK: - SwitchTab

    /// 跳转到 tabBar 页面（使用 TabBar 容器管理的方式，直接切换可见性）
    /// TabBar 容器会管理所有 tab 页面，这里只负责更新页面记录栈和生命周期
    @MainActor
    public func switchTab(to path: String) async {
        print("🔄 [switchTab] 开始切换到: \(path)")

        // 触发当前页面的 onHide
        let currentWebViewId = app?.getCurrentWebViewId() ?? -1
        if currentWebViewId >= 0 {
            print("👁️ [switchTab] 隐藏当前页面 webViewId: \(currentWebViewId)")
            pageLifecycle?.onHide(webviewId: currentWebViewId)
        }

        // 移除所有非 tabBar 页面记录
        var recordsToRemove: [DMPPageRecord] = []
        for record in pageRecords {
            if !tabBarPagePaths.contains(record.pagePath) {
                recordsToRemove.append(record)
            }
        }

        if recordsToRemove.count > 0 {
            print("🗑️ [switchTab] 移除 \(recordsToRemove.count) 个非 tabBar 页面")
            for record in recordsToRemove {
                print("  - 移除: \(record.pagePath), webViewId: \(record.webViewId)")
                pageLifecycle?.onUnload(webviewId: record.webViewId)
                if let index = pageRecords.firstIndex(where: { $0.webViewId == record.webViewId }) {
                    pageRecords.remove(at: index)
                }
            }
        }

        // 查找目标 tabBar 页面记录
        if let existingRecord = pageRecords.first(where: { $0.pagePath == path }) {
            // TabBar 页面记录已存在，更新栈顺序
            print("✅ [switchTab] 复用已存在的 tabBar 页面: \(path), webViewId: \(existingRecord.webViewId)")

            // 将目标记录移到栈顶
            if let index = pageRecords.firstIndex(where: { $0.webViewId == existingRecord.webViewId }) {
                if index != pageRecords.count - 1 {
                    pageRecords.remove(at: index)
                    pageRecords.append(existingRecord)
                    print("  更新栈顺序，将 \(path) 移到栈顶")
                }
            }

            // 触发目标页面的 onShow
            pageLifecycle?.onShow(webviewId: existingRecord.webViewId)
        } else {
            // TabBar 页面记录不存在（TabBar 容器应该已经创建了所有 tab 页面，这里只创建记录）
            print("⚠️ [switchTab] TabBar 页面记录不存在，创建新记录: \(path)")

            // 创建页面记录（webViewId 由容器中的 ViewController 提供）
            let pageRecord = DMPPageRecord(
                webViewId: -1,  // 临时ID，后续由容器更新
                fromWebViewId: -1,
                pagePath: path
            )
            pageRecord.navStyle = app?.getBundleAppConfig()?.getPageConfig(pagePath: path)
            pageRecords.append(pageRecord)

            print("  创建页面记录: \(path)")
        }

        // 更新 tabBar 容器的选中状态
        if let containerVC = tabBarContainerVC,
           let list = app?.getBundleAppConfig()?.tabBar?.list,
           let index = list.firstIndex(where: { $0.pagePath == path }) {
            print("📍 [switchTab] 更新 TabBar 选中索引: \(index)")
            containerVC.selectTab(index: index)
        }

        print("✅ [switchTab] 切换完成")
    }

    // MARK: - Helpers

    /// 获取当前页面记录
    public func getTopPageRecord() -> DMPPageRecord? {
        return pageRecords.last
    }

    /// 查找页面记录（根据路径）
    public func findPageRecord(byPath path: String) -> DMPPageRecord? {
        return pageRecords.first(where: { $0.pagePath == path })
    }

    /// 为 TabBar 页面创建页面记录（无需导航，由容器管理 ViewController）
    @MainActor
    public func createPageRecordForTab(path: String, webViewId: Int) -> DMPPageRecord {
        print("📝 [createPageRecordForTab] 创建 TabBar 页面记录: \(path), webViewId: \(webViewId)")

        let pageRecord = DMPPageRecord(
            webViewId: webViewId,
            fromWebViewId: -1,
            pagePath: path
        )
        pageRecord.navStyle = app?.getBundleAppConfig()?.getPageConfig(pagePath: path)

        // 检查是否已存在
        if let existingIndex = pageRecords.firstIndex(where: { $0.pagePath == path }) {
            pageRecords[existingIndex] = pageRecord
            print("  更新已存在的记录")
        } else {
            pageRecords.append(pageRecord)
            print("  添加新记录")
        }

        return pageRecord
    }

    /// 更新 TabBar 选中状态（由容器在切换 tab 时调用）
    @MainActor
    public func updateTabBarSelection(to path: String, webViewId: Int) {
        print("🔄 [updateTabBarSelection] 更新到: \(path), webViewId: \(webViewId)")

        // 隐藏当前页面
        if let currentRecord = pageRecords.last, currentRecord.webViewId != webViewId {
            pageLifecycle?.onHide(webviewId: currentRecord.webViewId)
        }

        // 更新栈顺序：将目标页面移到栈顶
        if let targetRecord = pageRecords.first(where: { $0.pagePath == path }) {
            if let index = pageRecords.firstIndex(where: { $0.webViewId == targetRecord.webViewId }) {
                if index != pageRecords.count - 1 {
                    pageRecords.remove(at: index)
                    pageRecords.append(targetRecord)
                    print("  更新栈顺序，移到栈顶")
                }
            }

            // 显示目标页面
            pageLifecycle?.onShow(webviewId: targetRecord.webViewId)
        }
    }

    /// 返回到根页面
    private func goBackToRoot(animated: Bool = true) {
        guard let navigationController = navigationController else {
            print("导航控制器未设置")
            return
        }

        navigationController.popToRootViewController(animated: animated)
        pageRecords.removeAll()
    }
}
