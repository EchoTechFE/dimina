import { DMPContainerBridgesModule } from './DMPContainerBridgesModule'

import { DMPBridgeCallback } from './DMPTSUtil'
import { DMPDeviceUtil } from '../Utils/DMPDeviceUtils'
import { DMPMap } from '../Utils/DMPMap'
import { DMPPageStyle } from '../DPages/DMPPageStyle'


export class DMPContainerBridgesModuleMenu extends DMPContainerBridgesModule {
  getExportMethods(): string[] {
    return [
      'getMenuButtonBoundingClientRect',
      'hideShareMenu',
      'showShareMenu'
    ];
  }

  // 界面 / 菜单 / wx.getMenuButtonBoundingClientRect
  // https://developers.weixin.qq.com/miniprogram/dev/api/ui/menu/wx.getMenuButtonBoundingClientRect.html
  getMenuButtonBoundingClientRect(data: DMPMap, callback: DMPBridgeCallback) {
    const whData = DMPDeviceUtil.getSafeAreaAndDisplayWHSync()

    const width = 87;
    const height = 32;
    const top = whData.get('statusBarHeight') as number;
    const right = whData.get('windowWidth') - 10;
    const left = right - width;
    const bottom = top + height;

    const menuButtonBoundingClientRect = new DMPMap({
      top: top,
      left: left,
      width: width,
      height: height,
      bottom: bottom,
      right: right,
    })
    return menuButtonBoundingClientRect
  }

  // 界面 / 菜单 / wx.hideShareMenu
  // https://developers.weixin.qq.com/miniprogram/dev/api/share/wx.hideShareMenu.html
  // 隐藏当前页面的转发按钮
  hideShareMenu(data: DMPMap, callback: DMPBridgeCallback, webViewId: number) {
    const navStyle =
      DMPMap.createFromDMPMap(this.app.navigatorManager.getPageRecordById(webViewId)?.pageStyle?.navStyle)
    navStyle.set('enableShareMenu', false)
    const pageRecord = this.app.navigatorManager.getPageRecordById(webViewId)
    if (pageRecord) {
      pageRecord.pageStyle = new DMPPageStyle(navStyle ?? new DMPMap(), this.app.appIndex)
    }
    this.invokeSuccessCallback(callback, new DMPMap())
  }

  // 界面 / 菜单 / wx.showShareMenu
  // https://developers.weixin.qq.com/miniprogram/dev/api/share/wx.showShareMenu.html
  // 显示当前页面的转发按钮
  showShareMenu(data: DMPMap, callback: DMPBridgeCallback, webViewId: number) {
    const navStyle =
      DMPMap.createFromDMPMap(this.app.navigatorManager.getPageRecordById(webViewId)?.pageStyle?.navStyle)
    navStyle.set('enableShareMenu', true)

    // 参数 withShareTicket: 是否使用带 shareTicket 的转发
    const withShareTicket: boolean = (data.get('withShareTicket') as boolean) ?? false
    navStyle.set('withShareTicket', withShareTicket)

    const pageRecord = this.app.navigatorManager.getPageRecordById(webViewId)
    if (pageRecord) {
      pageRecord.pageStyle = new DMPPageStyle(navStyle ?? new DMPMap(), this.app.appIndex)
    }
    this.invokeSuccessCallback(callback, new DMPMap())
  }
}



