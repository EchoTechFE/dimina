package com.didi.dimina.ui.container

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.content.res.Resources
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.animation.AccelerateDecelerateInterpolator
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.toColorInt
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.didi.dimina.Dimina
import com.didi.dimina.bean.AppConfig
import com.didi.dimina.bean.BridgeOptions
import com.didi.dimina.bean.MergedPageConfig
import com.didi.dimina.bean.MiniProgram
import com.didi.dimina.bean.PathInfo
import com.didi.dimina.common.LogUtils
import com.didi.dimina.common.PathUtils
import com.didi.dimina.common.Utils
import com.didi.dimina.common.VersionUtils
import com.didi.dimina.core.Bridge
import com.didi.dimina.core.MiniApp
import com.didi.dimina.ui.theme.DiminaAndroidTheme
import com.didi.dimina.ui.view.ActionSheet
import com.didi.dimina.ui.view.ContactPicker
import com.didi.dimina.ui.view.DiminaWebView
import com.didi.dimina.ui.view.MediaPickerRoot
import com.didi.dimina.ui.view.MediaType
import com.didi.dimina.bean.TabBarConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import org.json.JSONObject
import java.io.File
import java.io.IOException
import kotlin.math.cos
import kotlin.math.sin

/**
 * Author: Doslin
 */
class DiminaActivity : ComponentActivity() {
    private val tag = "DiminaActivity"
    private val isLoading = mutableStateOf(true)

    // UI state for navigation bar
    private val showNavigationBar = mutableStateOf(true)
    private val navigationBarTitle = mutableStateOf("")
    private val navigationBarTextColor = mutableStateOf(Color.Black)
    private val navigationBarBackgroundColor = mutableStateOf("#FFFFFF")
    private val backgroundColor = mutableStateOf("#FFFFFF")

    // State for ActionSheet
    private val showActionSheet = mutableStateOf(false)
    private var actionTextColor = "#000000"
    private var actionSheetOptions = listOf<String>()
    private var actionSheetCallback: ((Int) -> Unit)? = null

    private val mediaType = mutableStateOf(MediaType.NONE)
    private val maxImageCount = mutableIntStateOf(1)

    // TabBar state
    private var tabBarConfig = mutableStateOf<TabBarConfig?>(null)
    private val selectedTabIndex = mutableIntStateOf(0)
    private val tabBarPagePaths = mutableSetOf<String>()
    private var currentTabPath = mutableStateOf<String?>(null)
    private var configLoaded = mutableStateOf(false)

    // TabBar page instances (multiple WebViews for state preservation)
    private val tabBarWebViews = mutableMapOf<String, WebView>()
    private val tabBarBridges = mutableMapOf<String, Bridge>()

    // WebView初始化完成后的回调列表
    private val webViewReadyCallbacks = mutableListOf<(WebView) -> Unit>()

    // 页面加载完成回调
    private var pageReadyCallback: (() -> Unit)? = null

    // Current active WebView and bridge (may be tabBar or regular page)
    private var webView: WebView? = null
    private var bridge: Bridge? = null

    // App configuration
    private lateinit var appConfig: AppConfig

    // Reference to the MiniApp instance
    private lateinit var miniApp: MiniApp

    // Current MiniProgram
    private lateinit var miniProgram: MiniProgram

    // Contact picker for handling contact-related operations
    private lateinit var contactPicker: ContactPicker

    private var imageChooseCallback: ((List<String>) -> Unit)? = null
    
    private var adjustBottom = 0.0

    // 屏幕高度
    private var screenHeight = 0


    /**
     * 调整WebView的位置以适应键盘
     * @param bottom 元素到屏幕底部的距离，单位为像素
     */
    fun adjustViewPosition(bottom: Double) {
        // 获取设备像素比率（density）
        val density = Resources.getSystem().displayMetrics.density
        // CSS 像素转换为物理像素
        adjustBottom = bottom * density
    }

    fun handleChooseMedia(
        type: MediaType,
        count: Int,
        allowAlbum: Boolean,
        allowCamera: Boolean,
        callback: (List<String>) -> Unit,
    ) {
        imageChooseCallback = callback

        if (allowCamera && !allowAlbum) {
            // 只允许相机
            openSystemCamera()
        } else if (allowAlbum && !allowCamera) {
            // 只允许相册
            openSystemGallery(type, count)
        } else {
            // 设置ActionSheet的状态和回调
            showActionSheet(listOf("拍摄", "从相册选择")) { index ->
                when (index) {
                    0 -> openSystemCamera()
                    1 -> openSystemGallery(type, count)
                }
            }
        }
    }

    fun showActionSheet(
        options: List<String>,
        itemColor: String = "#000000",
        callback: (Int) -> Unit,
    ) {
        actionTextColor = itemColor
        actionSheetOptions = options
        actionSheetCallback = callback
        showActionSheet.value = true
    }

    fun handleAddContact(callback: (Boolean) -> Unit) {
        contactPicker.handleAddContact(callback)
    }

    fun handleChooseContact(callback: (Boolean, JSONObject) -> Unit) {
        contactPicker.handleChooseContact(callback)
    }

    private fun openSystemGallery(type: MediaType, maxCount: Int) {
        // Set the maximum number of images that can be selected
        maxImageCount.intValue = maxCount
        // Show the MediaPicker UI
        mediaType.value = type
    }

    private fun openSystemCamera() {
        mediaType.value = MediaType.CAMERA
    }


    fun getSoftKeyboardHeight(rootView: View, callback: (Int) -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            rootView.setOnApplyWindowInsetsListener { _, insets ->
                // 获取软键盘的高度（px）
                val imeHeight = insets.getInsets(WindowInsets.Type.ime()).bottom
                callback(imeHeight)
                insets // 返回 insets 以保持默认行为
            }
        } else {
            ViewCompat.setOnApplyWindowInsetsListener(rootView) { _, insets ->
                val imeHeight = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                callback(imeHeight)
                insets
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        
        // 获取屏幕高度
        screenHeight = resources.displayMetrics.heightPixels

        // 设置键盘监听
        getSoftKeyboardHeight(window.decorView.rootView) { keyBoardHeight ->
            withWebView { webView ->
                if (adjustBottom > 0 && adjustBottom < keyBoardHeight) {
                    val translationY = adjustBottom - keyBoardHeight
                    webView.translationY = translationY.toFloat()
                    LogUtils.d(tag, "调整WebView位置: translationY=$translationY, bottom=$adjustBottom, keyboardHeight=$keyBoardHeight")
                } else {
                    adjustBottom = 0.0
                    webView.translationY = 0f
                }
            }
        }

        // 接收 MiniProgram 对象
        val program = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(MINI_PROGRAM_KEY, MiniProgram::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(MINI_PROGRAM_KEY) as? MiniProgram
        }

        if (program == null) {
            finish()
            return
        }

        // Get MiniApp instance and JsCore for this MiniProgram
        try {
            miniApp = MiniApp.getInstance()
            miniProgram = program
            LogUtils.d(
                tag,
                "Successfully obtained MiniApp instance and JsCore for appId: ${miniProgram.appId}"
            )
        } catch (e: Exception) {
            LogUtils.e(tag, "Failed to get MiniApp instance or JsCore: ${e.message}")
            finish()
            return
        }

        // Initialize the ContactPicker
        contactPicker = ContactPicker(this)

        setContent {
            DiminaAndroidTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    DiminaContent(
                        miniProgram = miniProgram,
                        isLoading = isLoading,
                        modifier = Modifier.padding(
                            0.dp,
                            0.dp,
                            0.dp,
                            innerPadding.calculateBottomPadding()
                        )
                    )
                }
            }
        }

        // 使用协程初始化JS引擎并加载小程序
        CoroutineScope(Dispatchers.Main).launch {
            initialize()
        }
    }


    /**
     * Create and initialize the QuickJS engine after UI setup
     */
    private suspend fun initialize() {
        // 在IO线程中执行耗时操作
        withContext(Dispatchers.IO) {
            // 1.解压小程序资源包 jsApp
            val appId = miniProgram.appId
            try {
                // 判断是否需要更新小程序包的逻辑：
                // 1. 是小程序首页入口
                // 2. 如果是调试模式，只要版本号大于本地版本就解压
                // 3. 如果是发布模式，需要应用版本已升级且小程序版本号大于本地版本才解压
                val shouldExtract = if (miniProgram.root) {
                    val localVersion = VersionUtils.getAppVersion(appId)
                    val isDebugMode = Dimina.getInstance().isDebugMode()
                    val appVersionUpdated = VersionUtils.isAppVersionUpdated(this@DiminaActivity)
                    
                    when {
                        isDebugMode -> {
                            // 调试模式：版本号大于本地版本就解压
                            miniProgram.versionCode > localVersion
                        }
                        appVersionUpdated -> {
                            // 发布模式且应用版本已升级：版本号大于本地版本才解压
                            miniProgram.versionCode > localVersion
                        }
                        else -> false
                    }
                } else false
                // 使用上面的shouldExtract变量来决定是否解压
                if (shouldExtract) {
                    if (Utils.unzipAssets(this@DiminaActivity, "jsapp/$appId/$appId.zip", "jsapp/$appId")) {
                        VersionUtils.setAppVersion(appId, miniProgram.versionCode)
                        LogUtils.d(tag, "Mini program extraction completed successfully")
                    } else {
                        LogUtils.e(tag, "Failed to extract mini program for appId: $appId")
                    }
                }
            } catch (e: Exception) {
                LogUtils.e(tag, "Error extracting mini program: ${e.message}")
                withContext(Dispatchers.Main) { finish() }
                return@withContext
            }

            // 2.读取配置文件 - Only after extraction is complete
            try {
                val config = readAppConfig("jsapp/$appId")
                if (config == null) {
                    LogUtils.e(tag, "Failed to read app config for appId: $appId")
                    withContext(Dispatchers.Main) { finish() }
                    return@withContext
                }
                appConfig = config
                LogUtils.d(tag, "Successfully loaded app config")
            } catch (e: Exception) {
                LogUtils.e(tag, "Error reading app config: ${e.message}")
                withContext(Dispatchers.Main) { finish() }
                return@withContext
            }

            // 3.读取页面配置
            val entryPagePath =
                miniProgram.path ?: appConfig.app.entryPagePath ?: run {
                    withContext(Dispatchers.Main) { finish() }
                    return@withContext
                }
            val pathInfo = Utils.queryPath(entryPagePath)
            val pageConfig = appConfig.modules[pathInfo.pagePath]
            val mergedPageConfig = Utils.mergePageConfig(appConfig.app, pageConfig)

            // 切换到主线程设置UI
            withContext(Dispatchers.Main) {
                // 4.设置 TabBar 配置（如果存在）
                val hasTabBar = appConfig.app.tabBar != null
                appConfig.app.tabBar?.let { config ->
                    tabBarConfig.value = config
                    tabBarPagePaths.clear()
                    tabBarPagePaths.addAll(config.list.map { it.pagePath })
                    LogUtils.d(tag, "TabBar config loaded with ${config.list.size} tabs")

                    // Set current tab path to entry page (triggers TabBar WebView creation)
                    currentTabPath.value = pathInfo.pagePath
                }

                // 5.设置标题栏以及状态栏颜色模式
                setInitialStyle(mergedPageConfig)

                // Mark config as loaded to trigger WebView creation
                configLoaded.value = true

                // 6.创建通信 bridge
                // Important: For TabBar apps, don't create bridge here!
                // The TabBar WebView onInitReady will create the bridge when WebView is ready
                if (!hasTabBar) {
                    withWebView { webView ->
                        val entryPageBridge = createBridge(
                            BridgeOptions(
                                pathInfo = pathInfo,
                                scene = 1001,
                                jscore = miniApp.getJsCore(appId, this@DiminaActivity),
                                webview = webView,
                                isRoot = true,
                                root = pageConfig?.root ?: "main",
                                appId = miniProgram.appId,
                                pages = appConfig.app.pages,
                                configInfo = mergedPageConfig
                            )
                        )
                        // Add bridge to MiniApp's bridge list for this appId
                        miniApp.addBridge(miniProgram.appId, entryPageBridge)

                        withWebViewPageLoaded {
                            LogUtils.d(tag, "Page loaded, starting bridge")
                            entryPageBridge.start()
                        }
                    }
                } else {
                    LogUtils.d(tag, "TabBar app detected, bridge will be created when TabBar WebView is ready")
                }
            }
        }


    }

    private fun createBridge(options: BridgeOptions): Bridge {
        val bridge = Bridge(options = options, parent = this)
        bridge.init()
        this.bridge = bridge
        return bridge
    }


    private fun setInitialStyle(config: MergedPageConfig) {
        // Set navigation bar visibility based on navigationStyle
        showNavigationBar.value = config.navigationStyle != "custom"

        // Set navigation bar title
        navigationBarTitle.value = config.navigationBarTitleText

        // Set navigation bar background color
        navigationBarBackgroundColor.value = config.navigationBarBackgroundColor

        // Set page background color
        backgroundColor.value = config.backgroundColor

        // Update status bar style based on text style
        this.updateActionColorStyle(config.navigationBarTextStyle)
    }

    fun setNavigationBarTitle(title: String) {
        navigationBarTitle.value = title
    }

    fun setNavigationBarColor(frontColor:String, backgroundColor: String) {
        updateActionColorStyle(frontColor)
        navigationBarBackgroundColor.value = backgroundColor
    }

    /**
     * 设置状态栏样式
     */
    private fun updateActionColorStyle(color: String) {
        if (color == "white" || color == "#ffffff") {
            navigationBarTextColor.value = Color.White
        } else {
            navigationBarTextColor.value = Color.Black
        }
        runOnUiThread {
            WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars =
                color != "white"
        }
    }

    fun pageScrollTo(scrollTop: Int, duration: Int) {
        withWebView { webView ->
            try {
                if (duration > 0) {
                    // Get current scroll position
                    runOnUiThread {
                        val startScroll = webView.scrollY
                        val distance = scrollTop - startScroll

                        // Create and configure the animator
                        ValueAnimator.ofFloat(0f, 1f).apply {
                            this.duration = duration.toLong()
                            interpolator =
                                AccelerateDecelerateInterpolator() // Smooth ease-in-out effect

                            addUpdateListener { animation ->
                                val fraction = animation.animatedValue as Float
                                val newScroll = startScroll + (distance * fraction).toInt()
                                webView.scrollTo(0, newScroll)
                            }

                            addListener(object : AnimatorListenerAdapter() {
                                override fun onAnimationEnd(animation: Animator) {
                                    LogUtils.d(
                                        tag,
                                        "Scroll animation completed to position: $scrollTop"
                                    )
                                }
                            })

                            start()
                        }
                    }
                } else {
                    // Immediate scroll without animation
                    webView.scrollTo(0, scrollTop)
                    LogUtils.d(tag, "Immediate scroll to position: $scrollTop")
                }
            } catch (e: Exception) {
                LogUtils.e(tag, "Error during page scroll: ${e.message}")
            }
        }
    }


    /**
     * Reads and parses the app-config.json file from the extracted mini program
     * @return The AppConfig containing the app configuration, or null if failed
     */
    private fun readAppConfig(target: String, root: String = "main"): AppConfig? {
        try {
            // Check both possible locations for app-config.json
            val miniProgramDir = File(filesDir, target)
            var configFile = File(miniProgramDir, "${root}/app-config.json")

            // If not found in main/app-config.json, try app-config.json directly
            if (!configFile.exists()) {
                configFile = File(miniProgramDir, "app-config.json")
                if (!configFile.exists()) {
                    // Log the directory structure to help debug
                    LogUtils.e(tag, "app-config.json not found in the package")
                    logDirectoryStructure(miniProgramDir)
                    return null
                }
            }

            // Parse the JSON file
            val appConfigContent = configFile.readText()
            val json = Json { ignoreUnknownKeys = true }
            return json.decodeFromString<AppConfig>(appConfigContent)

        } catch (e: IOException) {
            LogUtils.e(tag, "Error reading app config: ${e.message}")
            e.printStackTrace()
            return null
        } catch (e: Exception) {
            LogUtils.e(tag, "Unexpected error reading config: ${e.message}")
            e.printStackTrace()
            return null
        }
    }

    /**
     * Helper method to log the directory structure for debugging
     */
    private fun logDirectoryStructure(directory: File, indent: String = "") {
        LogUtils.d(tag, "${indent}Directory: ${directory.name}")
        directory.listFiles()?.forEach { file ->
            if (file.isDirectory) {
                logDirectoryStructure(file, "$indent  ")
            } else {
                LogUtils.d(tag, "$indent  File: ${file.name} (${file.length()} bytes)")
            }
        } ?: LogUtils.d(tag, "${indent}Empty or not a directory")
    }

    /**
     * 安全地执行WebView操作，如果WebView尚未初始化，则将操作添加到回调队列中
     * @param action 要在WebView上执行的操作
     * @return true如果操作立即执行，false如果操作被加入队列
     */
    private fun withWebView(action: (WebView) -> Unit): Boolean {
        return webView?.let {
            action(it)
            true
        } ?: run {
            Log.w(tag, "WebView not initialized yet, adding to callback queue")
            webViewReadyCallbacks.add(action)
            false
        }
    }

    private fun withWebViewPageLoaded(action: () -> Unit) {
        pageReadyCallback = action
    }

    /**
     * 当WebView初始化完成时调用此方法
     * @param webView 初始化完成的WebView实例
     */
    private fun onWebViewReady(webView: WebView) {
        this.webView = webView
        LogUtils.d(tag, "WebView is now initialized and ready")

        // 执行所有等待的回调
        val callbacks = ArrayList(webViewReadyCallbacks) // 创建副本以避免并发修改
        webViewReadyCallbacks.clear()

        callbacks.forEach { callback ->
            try {
                callback(webView)
                LogUtils.d(tag, "Executed queued WebView callback")
            } catch (e: Exception) {
                LogUtils.e(tag, "Error executing WebView callback: ${e.message}")
            }
        }
    }

    private fun onPageReady() {
        pageReadyCallback?.invoke()
    }

    fun onDomReady() {
        // 6.隐藏加载动画
        LogUtils.d(
            tag,
            "Mini program initialization complete, hiding loading indicator"
        )
        isLoading.value = false
    }

    override fun onResume() {
        super.onResume()
        bridge?.let {
            it.appShow()
            it.pageShow()
        }
    }

    override fun onPause() {
        bridge?.let {
            it.appHide()
            it.pageHide()
        }
        super.onPause()
    }

    override fun onDestroy() {
        bridge?.let { cBridge ->
            miniApp.removeBridge(miniProgram.appId, cBridge)?.let { cApp ->
                cApp.destroy()
                if (miniApp.isBridgeListEmpty(miniProgram.appId)) {
                    // Clear resources for this specific MiniProgram
                    miniApp.clear(miniProgram.appId)
                } else if (miniApp.isBridgeListEmpty()) {
                    miniApp.clearAll()
                }
            }
        }
        super.onDestroy()
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    fun DiminaContent(
        miniProgram: MiniProgram,
        isLoading: State<Boolean>,
        modifier: Modifier = Modifier,
    ) {
        if (showActionSheet.value) {
            ActionSheet(
                buttonLabelsColor = actionTextColor,
                buttonLabels = actionSheetOptions,
                onButtonClick = { index ->
                    actionSheetCallback?.invoke(index)
                    showActionSheet.value = false
                },
                onDismiss = {
                    actionSheetCallback?.invoke(-1)
                    showActionSheet.value = false
                }
            )
        }
        MediaPickerRoot(
            type = mediaType.value,
            maxCount = maxImageCount.intValue,
            context = this,
            onSelected = { uris ->
                // Convert URIs to file paths
                val paths =
                    uris.mapNotNull { uri -> PathUtils.uriToTempFile(this@DiminaActivity, uri) }
                // Invoke the callback with the selected image paths
                imageChooseCallback?.invoke(paths)
                // Reset the callback and hide the picker
                imageChooseCallback = null
                mediaType.value = MediaType.NONE
            },
        )
        // Convert color strings to Color objects
        val bgColor = try {
            Color(backgroundColor.value.toColorInt())
        } catch (_: Exception) {
            Color.White
        }

        val navBarBgColor = try {
            Color(navigationBarBackgroundColor.value.toColorInt())
        } catch (_: Exception) {
            Color.White
        }

        // Set status bar color
        @Suppress("DEPRECATION")
        window.statusBarColor = navBarBgColor.toArgb()

        Scaffold(
            topBar = {
                // Only show the navigation bar when not loading and showNavigationBar is true
                if (!isLoading.value && showNavigationBar.value) {
                    CenterAlignedTopAppBar(
                        title = {
                            Text(
                                text = navigationBarTitle.value,
                                style = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold, color = navigationBarTextColor.value)
                            )
                        },
                        colors = TopAppBarDefaults.topAppBarColors(
                            containerColor = navBarBgColor
                        ),
                        navigationIcon = {
                            IconButton(onClick = { finish() }) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                                    contentDescription = "Back",
                                    tint = navigationBarTextColor.value,
                                    modifier = Modifier.size(30.dp)
                                )
                            }
                        }
                    )
                }
            },
            bottomBar = {
                // Show TabBar if config exists and not loading
                if (!isLoading.value && tabBarConfig.value != null) {
                    TabBarView(
                        tabBarConfig = tabBarConfig.value!!,
                        selectedIndex = selectedTabIndex.intValue,
                        onTabSelected = { index ->
                            val targetPath = tabBarConfig.value!!.list[index].pagePath
                            switchTab(targetPath)
                        }
                    )
                }
            },
            modifier = modifier.fillMaxSize()
        ) { innerPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = innerPadding.calculateTopPadding())
                    .background(bgColor)
            ) {
                // Only create WebViews after config is loaded to avoid initial WebView disposal
                if (configLoaded.value) {
                    // If tabBar is enabled, create multiple WebViews for each tab
                    if (tabBarConfig.value != null) {
                        // Create a WebView for each tabBar page
                        tabBarConfig.value?.list?.forEach { tabItem ->
                        val isVisible = currentTabPath.value == tabItem.pagePath
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .then(
                                    if (isVisible) Modifier else Modifier.alpha(0f)
                                )
                        ) {
                            DiminaWebView(
                                onInitReady = { webView ->
                                    LogUtils.d(tag, "TabBar WebView onInitReady: ${tabItem.pagePath}, isVisible: $isVisible")
                                    tabBarWebViews[tabItem.pagePath] = webView
                                    if (isVisible) {
                                        try {
                                            LogUtils.d(tag, "Setting up visible tab: ${tabItem.pagePath}")
                                            onWebViewReady(webView)

                                            // Create bridge for this tab if not exists
                                            if (tabBarBridges[tabItem.pagePath] == null) {
                                                LogUtils.d(tag, "Creating initial bridge for visible tab: ${tabItem.pagePath}")

                                                // tabItem.pagePath is already a path like "pages/index/index"
                                                // Create PathInfo with null query (no query params)
                                                val pathInfo = PathInfo(pagePath = tabItem.pagePath, query = null)
                                                val pageConfig = appConfig.modules[tabItem.pagePath]
                                                val mergedPageConfig = Utils.mergePageConfig(appConfig.app, pageConfig)

                                                LogUtils.d(tag, "Bridge options - pathInfo: $pathInfo, root: ${pageConfig?.root ?: "main"}")

                                                val options = BridgeOptions(
                                                    pathInfo = pathInfo,
                                                    scene = 1001,
                                                    jscore = miniApp.getJsCore(miniProgram.appId, this@DiminaActivity),
                                                    webview = webView,
                                                    isRoot = true,
                                                    root = pageConfig?.root ?: "main",
                                                    appId = miniProgram.appId,
                                                    pages = appConfig.app.pages,
                                                    configInfo = mergedPageConfig
                                                )

                                                LogUtils.d(tag, "Creating Bridge instance...")
                                                val newBridge = Bridge(options = options, parent = this@DiminaActivity)

                                                LogUtils.d(tag, "Initializing Bridge...")
                                                newBridge.init(false)

                                                // Store bridge in cache, but DON'T set global bridge yet
                                                // Will be set and started in onPageCompleted
                                                tabBarBridges[tabItem.pagePath] = newBridge
                                                miniApp.addBridge(miniProgram.appId, newBridge)

                                                LogUtils.d(tag, "Bridge created and cached for: ${tabItem.pagePath} (not started yet)")
                                            } else {
                                                LogUtils.d(tag, "Bridge already exists for: ${tabItem.pagePath}")
                                            }
                                        } catch (e: Exception) {
                                            LogUtils.e(tag, "Error creating bridge for TabBar page: ${tabItem.pagePath} - ${e.message}")
                                            e.printStackTrace()
                                        }
                                    }
                                },
                                onPageCompleted = {
                                    LogUtils.d(tag, "TabBar WebView onPageCompleted: ${tabItem.pagePath}, isVisible: $isVisible")
                                    if (isVisible) {
                                        try {
                                            LogUtils.d(tag, "Page completed for visible tab: ${tabItem.pagePath}")
                                            onPageReady()

                                            // Start bridge after page loaded
                                            tabBarBridges[tabItem.pagePath]?.let { tabBridge ->
                                                LogUtils.d(tag, "Starting bridge for tab: ${tabItem.pagePath}")
                                                bridge = tabBridge
                                                tabBridge.start()
                                                LogUtils.d(tag, "Bridge started successfully for: ${tabItem.pagePath}")
                                            } ?: run {
                                                LogUtils.w(tag, "No bridge found for tab: ${tabItem.pagePath}")
                                            }
                                        } catch (e: Exception) {
                                            LogUtils.e(tag, "Error starting bridge for TabBar page: ${tabItem.pagePath} - ${e.message}")
                                            e.printStackTrace()
                                        }
                                    }
                                },
                                identifier = "tabbar_${tabItem.pagePath}",
                                modifier = Modifier.fillMaxSize()
                            )
                        }
                    }
                    } else {
                        // No tabBar, use single WebView
                        DiminaWebView(
                            onInitReady = { webView -> onWebViewReady(webView) },
                            onPageCompleted = { onPageReady() },
                        )
                    }
                }

                // 加载遮罩层使用 AnimatedVisibility 只添加淡出效果
                AnimatedVisibility(
                    visible = isLoading.value && miniProgram.root,
                    exit = fadeOut(animationSpec = tween(300)),
                    modifier = Modifier.fillMaxSize()
                ) {
                    LoadingAnimation(miniProgram)
                }
            }
        }
    }

    @Composable
    fun LoadingAnimation(miniProgram: MiniProgram) {
        // 使用 remember 记忆颜色值，避免每次重组时重新创建
        val iconColor = remember { Color(Utils.generateColorFromName(miniProgram.name)) }
        val trackColor = remember { Color.LightGray.copy(alpha = 0.3f) }
        val dotColor = remember { Color(0xFF4CAF50) }
        val firstLetter = remember { miniProgram.name.substring(0, 1) }

        // 使用 InfiniteTransition 创建无限循环动画
        val infiniteTransition = rememberInfiniteTransition(label = "loadingRotation")
        val rotation by infiniteTransition.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(
                animation = tween(
                    durationMillis = 1000,
                    easing = LinearEasing
                ),
                repeatMode = RepeatMode.Restart
            ),
            label = "rotation"
        )

        // 添加背景的Box作为遮罩层
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.White), // 添加背景遮住后面的 Webview
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Box(
                    modifier = Modifier.size(80.dp),
                    contentAlignment = Alignment.Center
                ) {
                    val dotRadiusDp = 4.dp

                    Canvas(
                        modifier = Modifier.fillMaxSize()
                    ) {
                        // 预计算常量值，避免在绘制时重复计算
                        val minSize = minOf(size.width, size.height)
                        val circleRadius = minSize / 4
                        val centerX = size.width / 2
                        val centerY = size.height / 2
                        val orbitRadius = circleRadius * 1.5f
                        val dotRadius = dotRadiusDp.toPx()

                        // 绘制大圆（背景）
                        drawCircle(
                            color = iconColor,
                            radius = circleRadius,
                            center = Offset(centerX, centerY)
                        )

                        // 绘制轨道
                        drawCircle(
                            color = trackColor,
                            radius = orbitRadius,
                            center = Offset(centerX, centerY),
                            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx())
                        )

                        // 绘制小圆点（旋转）- 只有这部分需要在每一帧更新
                        val angleInRadians = Math.toRadians(rotation.toDouble()).toFloat()
                        val dotX = centerX + orbitRadius * cos(angleInRadians)
                        val dotY = centerY + orbitRadius * sin(angleInRadians)

                        drawCircle(
                            color = dotColor,
                            radius = dotRadius,
                            center = Offset(dotX, dotY)
                        )
                    }

                    Text(
                        text = firstLetter,
                        color = Color.White,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                // 底部文本
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = miniProgram.name,
                    style = TextStyle(
                        fontSize = 16.sp,
                        color = Color.Black,
                        fontWeight = FontWeight.Medium
                    )
                )
            }
        }
    }

    /**
     * 更新当前页面的路径并重新加载
     * @param url 新的页面路径
     */
    fun updatePath(url: String) {
        runOnUiThread {
            // 获取当前的 bridge
            bridge?.let { currentBridge ->
                val pathInfo = Utils.queryPath(url)
                val pageConfig = appConfig.modules[pathInfo.pagePath]
                val mergedPageConfig = Utils.mergePageConfig(appConfig.app, pageConfig)

                // 更新页面配置和样式
                setInitialStyle(mergedPageConfig)

                currentBridge.destroy(true)
                // 更新当前 bridge 的配置
                currentBridge.updateOptions(
                    pathInfo = pathInfo,
                    root = pageConfig?.root ?: "main",
                    configInfo = mergedPageConfig
                )
                currentBridge.init(false)
                withWebViewPageLoaded {
                    LogUtils.d(tag, "Page loaded, restarting bridge")
                    currentBridge.start()
                }
            }
        }
    }

    /**
     * Switch to a tabBar page, closing all non-tabBar pages
     */
    fun switchTab(url: String) {
        runOnUiThread {
            val pathInfo = Utils.queryPath(url)
            val pagePath = pathInfo.pagePath

            // Check if the path is a valid tabBar page
            if (!tabBarPagePaths.contains(pagePath)) {
                LogUtils.w(tag, "Attempted to switch to non-tabBar page: $pagePath")
                return@runOnUiThread
            }

            // Check if already on this tab
            if (currentTabPath.value == pagePath) {
                LogUtils.d(tag, "Already on tab: $pagePath")
                return@runOnUiThread
            }

            // Update selected tab index
            tabBarConfig.value?.list?.indexOfFirst { it.pagePath == pagePath }?.let { index ->
                selectedTabIndex.intValue = index
            }

            LogUtils.d(tag, "Switching from tab: ${currentTabPath.value} to: $pagePath")

            // Get or create the WebView for this tab
            val targetWebView = tabBarWebViews[pagePath]
            val cachedBridge = tabBarBridges[pagePath]

            if (targetWebView != null) {
                // Switch to the target tab's WebView
                webView = targetWebView
                LogUtils.d(tag, "Switched to tab WebView: $pagePath")

                if (cachedBridge != null) {
                    // Bridge already exists, just switch to it
                    bridge = cachedBridge
                    LogUtils.d(tag, "Using cached bridge for tab: $pagePath")
                } else {
                    // First time loading this tab, create bridge
                    LogUtils.d(tag, "Creating new bridge for tab: $pagePath")
                    val pathInfo = Utils.queryPath(url)
                    val pageConfig = appConfig.modules[pathInfo.pagePath]
                    val mergedPageConfig = Utils.mergePageConfig(appConfig.app, pageConfig)

                    setInitialStyle(mergedPageConfig)

                    // Create and initialize bridge for this tab
                    val options = BridgeOptions(
                        pathInfo = pathInfo,
                        scene = 1001,
                        jscore = miniApp.getJsCore(miniProgram.appId, this),
                        webview = targetWebView,
                        isRoot = true,
                        root = pageConfig?.root ?: "main",
                        appId = miniProgram.appId,
                        pages = appConfig.app.pages,
                        configInfo = mergedPageConfig
                    )
                    val newBridge = Bridge(options = options, parent = this)
                    newBridge.init(false)

                    bridge = newBridge
                    tabBarBridges[pagePath] = newBridge

                    withWebViewPageLoaded {
                        newBridge.start()
                    }
                }
            } else {
                LogUtils.w(tag, "WebView for tab not found: $pagePath")
            }

            // Update current tab path to trigger UI update
            currentTabPath.value = pagePath
            LogUtils.d(tag, "Switched to tab: $pagePath")
        }
    }

    /**
     * Note about TabBar state preservation:
     *
     * Android uses a single Activity with single WebView architecture.
     * Unlike iOS (multi-ViewController) or HarmonyOS (DRouter with multiple pages),
     * true WebView state preservation requires multiple WebView instances.
     *
     * Current implementation:
     * - Caches Bridge instances for each tabBar page
     * - Reloads page content when switching (inevitable with single WebView)
     * - JavaScript state may be preserved in Bridge, but DOM state is reloaded
     *
     * For full state preservation (like iOS), we would need:
     * - Multiple DiminaWebView instances (one per tabBar page)
     * - Visibility control to show/hide WebViews
     * - Higher memory usage but better UX
     */

    fun getMiniProgram(): MiniProgram {
        return this.miniProgram
    }

    companion object {
        const val MINI_PROGRAM_KEY = "mini_program"

        fun launch(
            context: Context,
            miniProgram: MiniProgram,
            flag: Int? = null,
        ) {
            val intent = Intent(context, DiminaActivity::class.java).apply {
                putExtra(MINI_PROGRAM_KEY, miniProgram)
                flag?.let {
                    addFlags(flag)
                }
            }
            context.startActivity(intent)
        }
    }
}