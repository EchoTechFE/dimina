import web_webview from '@ohos.web.webview'
import { DMPApp } from '../DApp/DMPApp'
import { DMPLaunchType } from '../DApp/config/DMPAppConfig'
import { WebViewLifeCycle } from './DMPWebViewLifeCycle'
import { DMPWebComponent } from './DMPWebComponent'
import { DMPWebViewProxy } from './DMPWebViewProxy'

const DMP_DEFAULT_PAGE_FRAME: string = 'pageFrame.html'

interface DMPJavaScriptProxy {
  object: object;
  name: string;
  methodList: Array<string>;
  asyncMethodList: Array<string>;
  controller: WebviewController;
}

export class DMPWebViewController extends web_webview.WebviewController {
  webViewId: number
  private webViewProxy: DMPWebViewProxy
  webContainer: DMPWebComponent | undefined | null
  app: DMPApp;
  subController?: DMPWebViewController;
  webViewLifeCycle: WebViewLifeCycle = new WebViewLifeCycle()
  isPageEnd: Boolean = false;

  constructor(webViewId: number, app: DMPApp) {
    super()
    this.app = app
    this.webViewId = webViewId
    // Cannot read property appIndex of undefined
    this.webViewProxy = new DMPWebViewProxy(this.webViewId, app.appIndex)
  }

  // 老 api，只能注册一个对象
  genProxy() {
    let jsp: DMPJavaScriptProxy = {
      object: this.webViewProxy,
      name: "DiminaRenderBridge",
      methodList: ["invoke"],
      asyncMethodList: ["publish"],
      controller: this
    }

    return jsp
  }

  getWebViewProxy() {
    return this.webViewProxy
  }

  //公共配置
  initConfig() {
    this.setCustomUserAgent(`${this.getUserAgent()} dimina miniProgram ${this.app.appConfig?.userAgent ?? ''}`);
  }

  loadPath(): string {
    let app: DMPApp = this.app;
    let path: string = '';

    if (app.appConfig.launchAppType === DMPLaunchType.DebugUrl) {
      const mainPkgPath = app.bundleManager.getCurrentJSSdkDir();
      const pagePath = DMP_DEFAULT_PAGE_FRAME;
      const path = `${mainPkgPath}/${pagePath}`
      return path;
    } else {
      path = 'https://mpservice.qiandao.com/pageFrame.html';
    }

    return path;
  }

  notifyPageEnd() {
    this.isPageEnd = true;
    this.webViewLifeCycle.notifyPageEnd()
  }

  notifyPageBegin() {
    this.webViewLifeCycle.notifyPageBegin()
  }
}