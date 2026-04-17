package com.didi.dimina.ui.container

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Divider
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.toColorInt
import com.didi.dimina.bean.TabBarConfig
import com.didi.dimina.bean.TabBarItem
import java.io.File

/**
 * TabBar UI component using Jetpack Compose
 */
@Composable
fun TabBarView(
    tabBarConfig: TabBarConfig,
    selectedIndex: Int,
    onTabSelected: (Int) -> Unit
) {
    val borderColor = if (tabBarConfig.borderStyle == "white") {
        Color.White
    } else {
        Color.Black.copy(alpha = 0.2f)
    }

    val bgColor = try {
        Color(tabBarConfig.backgroundColor.toColorInt())
    } catch (_: Exception) {
        Color.White
    }

    val itemColor = try {
        Color(tabBarConfig.color.toColorInt())
    } catch (_: Exception) {
        Color.Gray
    }

    val selectedItemColor = try {
        Color(tabBarConfig.selectedColor.toColorInt())
    } catch (_: Exception) {
        Color.Blue
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(bgColor)
            .windowInsetsPadding(WindowInsets.navigationBars)  // 全面屏适配：自动增加底部安全区高度
    ) {
        // Top border (0.5dp)
        HorizontalDivider(
            color = borderColor,
            thickness = 0.5.dp
        )

        // Tab items row (49dp height, matching 微信小程序 98rpx)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(49.dp)
                .background(bgColor),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            tabBarConfig.list.forEachIndexed { index, item ->
                TabBarItemView(
                    item = item,
                    isSelected = index == selectedIndex,
                    color = itemColor,
                    selectedColor = selectedItemColor,
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onTabSelected(index) }
                )
            }
        }
    }
}

@Composable
fun TabBarItemView(
    item: TabBarItem,
    isSelected: Boolean,
    color: Color,
    selectedColor: Color,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Icon
        val iconPath = if (isSelected) item.selectedIconPath else item.iconPath
        if (!iconPath.isNullOrEmpty()) {
            val iconFile = File(iconPath)
            if (iconFile.exists()) {
                val bitmap = BitmapFactory.decodeFile(iconPath)
                bitmap?.let {
                    Image(
                        bitmap = it.asImageBitmap(),
                        contentDescription = item.text,
                        modifier = Modifier.size(24.dp)
                    )
                }
            } else {
                // Placeholder if icon file doesn't exist - reserve 24dp space
                Spacer(modifier = Modifier.size(24.dp))
            }
        } else {
            // No icon: reserve 24dp space for consistent layout
            Spacer(modifier = Modifier.size(24.dp))
        }

        Spacer(modifier = Modifier.height(2.dp))

        // Text
        Text(
            text = item.text,
            fontSize = 10.sp,
            color = if (isSelected) selectedColor else color,
            textAlign = TextAlign.Center,
            maxLines = 1
        )
    }
}
