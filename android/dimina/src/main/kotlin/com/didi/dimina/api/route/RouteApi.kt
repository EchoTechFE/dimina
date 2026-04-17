package com.didi.dimina.api.route

import android.content.Intent
import com.didi.dimina.api.APIResult
import com.didi.dimina.api.AsyncResult
import com.didi.dimina.api.BaseApiHandler
import com.didi.dimina.bean.MiniProgram
import com.didi.dimina.common.ApiUtils
import com.didi.dimina.core.MiniApp
import com.didi.dimina.ui.container.DiminaActivity
import org.json.JSONObject

/**
 * Navigation API implementation
 * Author: Doslin
 *
 * Handles all page navigation operations:
 * - navigateTo: Navigate to a new page
 * - redirectTo: Replace current page with a new one
 * - navigateBack: Navigate back to the previous page
 */
class RouteApi : BaseApiHandler() {
    private companion object {
        const val NAVIGATE_TO = "navigateTo"
        const val REDIRECT_TO = "redirectTo"
        const val NAVIGATE_BACK = "navigateBack"
        const val RE_LAUNCH = "reLaunch"
        const val SWITCH_TAB = "switchTab"
    }

    override val apiNames = setOf(NAVIGATE_TO, REDIRECT_TO, NAVIGATE_BACK, RE_LAUNCH, SWITCH_TAB)

    override fun handleAction(
        activity: DiminaActivity,
        appId: String,
        apiName: String,
        params: JSONObject,
        responseCallback: (String) -> Unit,
    ): APIResult {
        return when (apiName) {
            NAVIGATE_TO -> {
                val url = params.optString("url", "")
                if (url.isEmpty()) {
                    return ApiUtils.createErrorResponse(apiName, "URL cannot be empty")
                }

                MiniApp.getInstance().openApp(
                    activity, MiniProgram(
                        appId = appId,
                        root = false,
                        path = url,
                    )
                )
                AsyncResult(JSONObject().apply {
                    put("errMsg", "$NAVIGATE_TO:ok")
                })
            }

            // 关闭当前页面，跳转到应用内的某个页面
            REDIRECT_TO -> {
                val url = params.optString("url", "")
                if (url.isEmpty()) {
                    return ApiUtils.createErrorResponse(apiName, "URL cannot be empty")
                }

                // 在当前 Activity 中更新路径
                activity.updatePath(url)

                AsyncResult(JSONObject().apply {
                    put("errMsg", "$REDIRECT_TO:ok")
                })
            }

            NAVIGATE_BACK -> {
                // Implementation of navigating back
                activity.runOnUiThread {
                    activity.onBackPressed()
                }

                // Send success response
                AsyncResult(JSONObject().apply {
                    put("errMsg", "$NAVIGATE_BACK:ok")
                })
            }

            // 关闭所有页面，打开到应用内的某个页面
            RE_LAUNCH -> {
                val url = params.optString("url", "")
                if (url.isEmpty()) {
                    return ApiUtils.createErrorResponse(apiName, "URL cannot be empty")
                }

                var miniProgram = activity.getMiniProgram()
                DiminaActivity.launch(
                    activity, MiniProgram(
                        appId = appId,
                        name = miniProgram.appId,
                        root = true, // Set as root since we're clearing the stack
                        path = url,
                        versionCode = miniProgram.versionCode,
                        versionName = miniProgram.versionName
                    ),
                    // Clear all activities below the top and reuse the top activity if it exists
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
                )
                AsyncResult(JSONObject().apply {
                    put("errMsg", "$RE_LAUNCH:ok")
                })
            }

            // Switch to a tabBar page, closing all non-tabBar pages
            SWITCH_TAB -> {
                val url = params.optString("url", "")
                if (url.isEmpty()) {
                    return ApiUtils.createErrorResponse(apiName, "URL cannot be empty")
                }

                // Notify activity to switch tab
                activity.switchTab(url)

                AsyncResult(JSONObject().apply {
                    put("errMsg", "$SWITCH_TAB:ok")
                })
            }

            else -> {
                super.handleAction(activity, appId, apiName, params, responseCallback)
            }
        }
    }
}