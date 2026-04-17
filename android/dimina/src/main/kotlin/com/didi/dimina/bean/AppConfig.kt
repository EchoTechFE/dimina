package com.didi.dimina.bean

import kotlinx.serialization.Serializable

/**
 * Author: Doslin
 */
@Serializable
data class AppConfig(
    val app: App,
    val modules: Map<String, PageModule>
)

@Serializable
data class App(
    val entryPagePath: String? = null,
    val pages: List<String>,
    val window: WindowConfig? = null,
    val tabBar: TabBarConfig? = null,
    val subPackages: List<SubPackage>? = null,
    val networkTimeout: NetworkTimeout? = null,
    val debug: Boolean? = null
)

@Serializable
data class WindowConfig(
    val navigationBarTextStyle: String? = null,
    val navigationBarTitleText: String? = null,
    val navigationBarBackgroundColor: String? = null,
    val backgroundColor: String? = null,
    val navigationStyle: String? = null,
)

@Serializable
data class TabBarConfig(
    val color: String,
    val selectedColor: String,
    val borderStyle: String,
    val backgroundColor: String,
    val list: List<TabBarItem>
)

@Serializable
data class TabBarItem(
    val pagePath: String,
    val iconPath: String? = null,
    val selectedIconPath: String? = null,
    val text: String
)

@Serializable
data class SubPackage(
    val root: String,
    val pages: List<String>
)

@Serializable
data class NetworkTimeout(
    val request: Int,
    val connectSocket: Int,
    val uploadFile: Int,
    val downloadFile: Int
)

@Serializable
data class PageModule(
    val navigationBarTitleText: String? = null,
    val root: String? = null,
    val enablePullDownRefresh: Boolean? = null,
    val navigationBarBackgroundColor: String? = null,
    val navigationBarTextStyle: String? = null,
    val backgroundColor: String? = null,
    val navigationStyle: String? = null,
    val usingComponents: Map<String, String>? = null
)