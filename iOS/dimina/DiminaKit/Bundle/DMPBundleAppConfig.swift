//
//  DMPBundleAppConfig.swift
//  dimina
//
//  Created by Lehem on 2025/4/21.
//

import Foundation

public struct DMPTabBarItem {
    public var pagePath: String
    public var text: String
    public var iconPath: String?
    public var selectedIconPath: String?
}

public struct DMPTabBarConfig {
    public var color: String
    public var selectedColor: String
    public var backgroundColor: String
    public var borderStyle: String  // "black" or "white"
    public var list: [DMPTabBarItem]

    public var tabPagePaths: Set<String> {
        Set(list.map { $0.pagePath })
    }
}

public class DMPBundleAppConfig {
    var data: [String: Any]
    var app: [String: Any]
    var modules: [String: Any]
    var pages: [String]?
    var style: String
    var sitemapLocation: String
    var subPackages: [SubPackageConfig]
    var _entryPagePath: String
    var moduleMaps: [String: ModuleConfig]
    var tabBar: DMPTabBarConfig?

    init(data: [String: Any]) {
        self.data = data
        self.app = data["app"] as? [String: Any] ?? [:]
        self.modules = data["modules"] as? [String: Any] ?? [:]

        self.pages = self.app["pages"] as? [String]
        self.style = self.app["style"] as? String ?? ""
        self.sitemapLocation = self.app["sitemapLocation"] as? String ?? ""
        self.subPackages = self.app["subPackages"] as? [SubPackageConfig] ?? []
        self._entryPagePath = self.app["entryPagePath"] as? String ?? ""

        // Parse tabBar config
        if let tabBarDict = self.app["tabBar"] as? [String: Any],
           let list = tabBarDict["list"] as? [[String: Any]], !list.isEmpty {
            let items = list.compactMap { itemDict -> DMPTabBarItem? in
                guard let pagePath = itemDict["pagePath"] as? String,
                      let text = itemDict["text"] as? String else { return nil }
                return DMPTabBarItem(
                    pagePath: pagePath,
                    text: text,
                    iconPath: itemDict["iconPath"] as? String,
                    selectedIconPath: itemDict["selectedIconPath"] as? String
                )
            }
            self.tabBar = DMPTabBarConfig(
                color: tabBarDict["color"] as? String ?? "#999999",
                selectedColor: tabBarDict["selectedColor"] as? String ?? "#1890ff",
                backgroundColor: tabBarDict["backgroundColor"] as? String ?? "#ffffff",
                borderStyle: tabBarDict["borderStyle"] as? String ?? "black",
                list: items
            )
        }
        
        // 初始化 moduleMaps
        var maps = [String: ModuleConfig]()
        
        for (pagePath, moduleData) in self.modules {
            guard let moduleDict = moduleData as? [String: Any] else { continue }
            let root = moduleDict["root"] as? String ?? "main"
            let moduleConfig = ModuleConfig(root: root, pages: [pagePath])
            maps[pagePath] = moduleConfig
        }
        
        self.moduleMaps = maps
    }
    
    func getRootPackage(pagePath: String) -> String {
        return moduleMaps[pagePath]?.root ?? "main"
    }
    
    func isContainsPage(pagePath: String) -> Bool {
        return moduleMaps[pagePath] != nil
    }
    
    func getModuleConfig(pagePath: String) -> ModuleConfig? {
        return moduleMaps[pagePath]
    }
    
    static func fromJsonString(json: String) -> DMPBundleAppConfig? {
        guard let data = json.data(using: .utf8),
              let dictionary = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else {
            return nil
        }
        return DMPBundleAppConfig(data: dictionary)
    }
    
    var entryPagePath: String {
        get {
            if _entryPagePath.isEmpty {
                guard let firstPage = pages?.first else {
                    return ""
                }
                _entryPagePath = firstPage
            }
            return _entryPagePath
        }
        set {
            _entryPagePath = newValue
        }
    }
    
    func getPageConfig(pagePath: String) -> [String: Any] {
        let pagePrivateConfig = modules[pagePath] as? [String: Any] ?? [:]
        let appWindowConfig = app["window"] as? [String: Any] ?? [:]
        
        var mergedConfig = [String: Any]()
        mergedConfig["navigationBarTitleText"] = (pagePrivateConfig["navigationBarTitleText"] as? String) ?? 
                       (appWindowConfig["navigationBarTitleText"] as? String) ?? ""
        mergedConfig["navigationBarBackgroundColor"] = (pagePrivateConfig["navigationBarBackgroundColor"] as? String) ?? 
                       (appWindowConfig["navigationBarBackgroundColor"] as? String) ?? "#FFFFFF"
        mergedConfig["navigationBarTextStyle"] = (pagePrivateConfig["navigationBarTextStyle"] as? String) ?? 
                       (appWindowConfig["navigationBarTextStyle"] as? String) ?? "black"
        mergedConfig["backgroundColor"] = (pagePrivateConfig["backgroundColor"] as? String) ?? 
                       (appWindowConfig["backgroundColor"] as? String) ?? "#FFFFFF"
        mergedConfig["navigationStyle"] = (pagePrivateConfig["navigationStyle"] as? String) ?? 
                       (appWindowConfig["navigationStyle"] as? String) ?? "default"
        mergedConfig["usingComponents"] = pagePrivateConfig["usingComponents"] ?? [:]
        
        return mergedConfig
    }
}

struct ModuleConfig {
    var root: String
    var pages: [String]
}

struct SubPackageConfig {
    var root: String
    var navigationBarTitleText: [String]
}
