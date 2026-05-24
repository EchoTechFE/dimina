//
//  DMPTabBarContainerViewController.swift
//  dimina
//
//  Created by Claude on 2025/6/1.
//

import UIKit
import SwiftUI

// MARK: - SwiftUI Tab Bar View

struct DMPTabBarItemView: View {
    let item: DMPTabBarItem
    let isSelected: Bool
    let color: UIColor
    let selectedColor: UIColor

    // Helper to load local image
    private func loadImage(path: String) -> UIImage? {
        return UIImage(contentsOfFile: path)
    }

    var body: some View {
        VStack(spacing: 2) {
            // Icon
            if isSelected, let selectedIconPath = item.selectedIconPath,
               let uiImage = loadImage(path: selectedIconPath) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 24, height: 24)
            } else if !isSelected, let iconPath = item.iconPath,
                      let uiImage = loadImage(path: iconPath) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 24, height: 24)
            } else {
                // No icon: reserve 24pt space for consistent layout
                Spacer().frame(width: 24, height: 24)
            }

            Text(item.text)
                .font(.system(size: 10))
                .foregroundColor(isSelected ? Color(selectedColor) : Color(color))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }
}

struct DMPTabBarView: View {
    let tabBarConfig: DMPTabBarConfig
    @ObservedObject var state: DMPTabBarContainerViewController.TabBarState
    let onTabSelected: (Int) -> Void

    private var borderColor: Color {
        tabBarConfig.borderStyle == "white" ? Color.white : Color.black.opacity(0.2)
    }

    private var bgColor: Color {
        Color(DMPUtil.colorFromHexString(tabBarConfig.backgroundColor) ?? .white)
    }

    private var itemColor: UIColor {
        DMPUtil.colorFromHexString(tabBarConfig.color) ?? UIColor.gray
    }

    private var selectedItemColor: UIColor {
        DMPUtil.colorFromHexString(tabBarConfig.selectedColor) ?? UIColor.systemBlue
    }

    var body: some View {
        VStack(spacing: 0) {
            // Top border (0.5pt)
            Rectangle()
                .fill(borderColor)
                .frame(height: 0.5)
            

            // Tab items row (49pt height, matching 微信小程序 98rpx)
            HStack(spacing: 0) {
                ForEach(Array(tabBarConfig.list.enumerated()), id: \.offset) { index, item in
                    DMPTabBarItemView(
                        item: item,
                        isSelected: index == state.selectedIndex,
                        color: itemColor,
                        selectedColor: selectedItemColor
                    )
                    .onTapGesture {
                        onTabSelected(index)
                    }
                }
            }
            .frame(height: 49)
            .background(bgColor)
        }
        .background(bgColor)
        .edgesIgnoringSafeArea(.bottom)  // 扩展到安全区底部
    }
}

// MARK: - Tab Bar Container View Controller

/// Manages multiple tab page view controllers with visibility control
/// Similar to HarmonyOS DMPTabBarContainerView and Android multi-WebView approach
public class DMPTabBarContainerViewController: UIViewController {

    // The inner navigation controller where mini-app pages are pushed
    public let innerNavigationController: UINavigationController

    // Tab bar configuration
    private let tabBarConfig: DMPTabBarConfig

    // Weak reference to navigator (set by DMPNavigator after creation)
    weak var navigator: DMPNavigator?

    // Weak reference to app (for destroy on back)
    private weak var app: DMPApp?

    // Current selected tab index
    private var selectedIndex: Int = 0

    // All tab page controllers (created upfront for reuse)
    private var tabPageControllers: [DMPPageController] = []

    // Container view for all tab pages
    private let tabPagesContainer = UIView()

    // Hosting controller for the tab bar SwiftUI view
    private var tabBarHostingController: UIHostingController<DMPTabBarView>?

    // Published wrapper to drive SwiftUI updates
    class TabBarState: ObservableObject {
        @Published var selectedIndex: Int = 0
    }
    private let tabBarState = TabBarState()

    public init(tabBarConfig: DMPTabBarConfig, app: DMPApp?) {
        self.tabBarConfig = tabBarConfig
        self.app = app
        self.innerNavigationController = UINavigationController()
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        setupTabPagesContainer()
        setupTabBar()
        createAllTabPages()
    }

    private func setupTabPagesContainer() {
        // Add container for all tab pages
        view.addSubview(tabPagesContainer)
        tabPagesContainer.translatesAutoresizingMaskIntoConstraints = false
    }

    /// Create all tab page controllers upfront (multi-view approach)
    private func createAllTabPages() {
        guard let app = app, let navigator = navigator else {
            print("❌ [TabBarContainer] App or navigator not set")
            return
        }

        print("🏗️ [TabBarContainer] 创建所有 Tab 页面控制器，共 \(tabBarConfig.list.count) 个")

        for (index, tabItem) in tabBarConfig.list.enumerated() {
            let pagePath = tabItem.pagePath
            print("  [\(index)] 创建: \(pagePath)")

            // Create page controller
            let pageController = DMPPageController(
                pagePath: pagePath,
                query: nil,
                appConfig: app.getAppConfig()!,
                app: app,
                navigator: navigator,
                isRoot: true
            )

            // Add to container (all pages exist simultaneously)
            pageController.view.frame = tabPagesContainer.bounds
            pageController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            tabPagesContainer.addSubview(pageController.view)
            addChild(pageController)
            pageController.didMove(toParent: self)

            // Initially hide all except the first one
            pageController.view.isHidden = (index != selectedIndex)

            tabPageControllers.append(pageController)

            // Create page record in navigator
            let webViewId = pageController.getWebView().getWebViewId()
            navigator.createPageRecordForTab(path: pagePath, webViewId: webViewId)

            print("    ✅ WebViewId: \(webViewId)")
        }

        print("✅ [TabBarContainer] 所有 Tab 页面创建完成")
    }

    private func setupTabBar() {
        let state = tabBarState
        let config = tabBarConfig

        let tabBarView = DMPTabBarView(
            tabBarConfig: config,
            state: state,
            onTabSelected: { [weak self] index in
                self?.handleTabSelected(index: index)
            }
        )

        let hosting = UIHostingController(rootView: tabBarView)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        hosting.view.backgroundColor = .clear

        addChild(hosting)
        view.addSubview(hosting.view)
        hosting.didMove(toParent: self)
        tabBarHostingController = hosting

        // 设置容器背景色为 TabBar 背景色
        view.backgroundColor = DMPUtil.colorFromHexString(tabBarConfig.backgroundColor) ?? UIColor.white

        NSLayoutConstraint.activate([
            // Tab pages container fills everything above tab bar
            tabPagesContainer.topAnchor.constraint(equalTo: view.topAnchor),
            tabPagesContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabPagesContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabPagesContainer.bottomAnchor.constraint(equalTo: hosting.view.topAnchor),

            // Tab bar: 在安全区上方 49pt，扩展到屏幕底部
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hosting.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -49),
        ])
    }

    /// Handle tab selection (multi-view approach: just change visibility)
    private func handleTabSelected(index: Int) {
        guard index < tabBarConfig.list.count && index < tabPageControllers.count else { return }

        if index == selectedIndex {
            print("ℹ️ [TabBarContainer] 已在当前 tab: \(index)")
            return
        }

        let targetPath = tabBarConfig.list[index].pagePath
        print("👆 [TabBarContainer] Tab 切换: \(selectedIndex) -> \(index), 路径: \(targetPath)")

        // Get current and target page controllers
        let currentPageController = tabPageControllers[selectedIndex]
        let targetPageController = tabPageControllers[index]

        // Hide current page
        print("  👁️ 隐藏页面: \(selectedIndex)")
        currentPageController.view.isHidden = true

        // Show target page
        print("  👁️ 显示页面: \(index)")
        targetPageController.view.isHidden = false

        // Update selected index
        selectedIndex = index
        tabBarState.selectedIndex = index

        // Update navigator (handles lifecycle and stack)
        if let navigator = navigator {
            let targetWebViewId = targetPageController.getWebView().getWebViewId()
            navigator.updateTabBarSelection(to: targetPath, webViewId: targetWebViewId)
        }

        print("✅ [TabBarContainer] Tab 切换完成")
    }

    /// Update tab selection UI without triggering navigation (called by navigator)
    @MainActor
    public func selectTab(index: Int) {
        guard index < tabPageControllers.count && index != selectedIndex else { return }

        print("📍 [TabBarContainer] selectTab: \(selectedIndex) -> \(index)")

        // Hide current
        tabPageControllers[selectedIndex].view.isHidden = true

        // Show target
        tabPageControllers[index].view.isHidden = false

        // Update state
        selectedIndex = index
        tabBarState.selectedIndex = index
        tabBarState.objectWillChange.send()

        print("✅ [TabBarContainer] selectTab 完成")
    }

    public override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isMovingFromParent {
            app?.destroy()
        }
    }
}
