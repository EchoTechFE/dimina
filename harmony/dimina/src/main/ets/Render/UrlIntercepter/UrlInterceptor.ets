import { DMPFileUrlConvertor } from '../../Bundle/Util/DMPFileUrlConvertor';
import { DMPAppManager } from '../../DApp/DMPAppManager';
import fs from '@ohos.file.fs';
import { DMPLogger } from '../../EventTrack/DMPLogger';
import { Tags } from '../../EventTrack/Tags';
import { DMPApp } from '../../DApp/DMPApp';

interface InterceptRequestEvent {
  request: WebResourceRequest;
}

export class RequestCallback {
  appIndex: number

  constructor(appIndex: number) {
    this.appIndex = appIndex;
  }

  callback(event?: InterceptRequestEvent) {
    const app = DMPAppManager.sharedInstance().getApp(this.appIndex)
    if (event && app) {
      const url = event.request.getRequestUrl();
      DMPLogger.d(Tags.LAUNCH, "webview onInterceptRequest url=" + url);
      DMPLogger.d(Tags.WEB_COMPONENT, "url=" + url);
      if (url.startsWith('difile://')) {
        return RequestCallback.handleDIFileRequest(url, app);
      }
      if (RequestCallback.isWebResourceRequest(url)) {
        return RequestCallback.handleWebResourceRequest(url, app);
      } else {
        return null;
      }
    }

    return null;
  }

  private static isWebResourceRequest(url: string): boolean {
    return url.endsWith('.js') || url.endsWith('.css') || url.endsWith('.html') || url.endsWith('.png') ||
    url.endsWith('.jpg') || url.endsWith('.ico') || url.endsWith('.jpeg') || url.endsWith('.webp') ||
    url.endsWith('.gif');
  }

  private static handleWebResourceRequest(url: string, app: DMPApp): WebResourceResponse | null {
    const sandboxFilePath = RequestCallback.getSandboxFilePath(url, app);
    if (!RequestCallback.hasFile(sandboxFilePath)) {
      DMPLogger.d(Tags.WEB_COMPONENT, `${sandboxFilePath} 不存在`);
      return null;
    }
    DMPLogger.d(Tags.WEB_COMPONENT, `${sandboxFilePath}`);
    const response = RequestCallback.buildResponse(sandboxFilePath);
    const extension = RequestCallback.getFileExtension(sandboxFilePath);
    RequestCallback.setResponseMimeType(response, extension);
    return response;
  }

  private static handleDIFileRequest(url: string, app: DMPApp): WebResourceResponse | null {
    const filePath = DMPFileUrlConvertor.localPathFromVPath(url);
    if (filePath == null || !RequestCallback.hasFile(filePath)) {
      return null;
    }
    const response = RequestCallback.buildResponse(filePath);
    response.setResponseMimeType('image/*');
    return response;
  }

  private static buildResponse(filePath: string): WebResourceResponse {
    const file = fs.openSync(filePath, fs.OpenMode.READ_ONLY);
    const response = new WebResourceResponse();
    response.setResponseData(file.fd);
    response.setResponseCode(200);
    response.setReasonMessage('OK');
    response.setResponseIsReady(true);
    response.setResponseEncoding('utf-8');
    return response;
  }

  private static setResponseMimeType(response: WebResourceResponse, extension: string): void {
    switch (extension) {
      case 'html':
        response.setResponseMimeType('text/html');
        break;
      case 'js':
        response.setResponseMimeType('text/javascript');
        break;
      case 'css':
        response.setResponseMimeType('text/css');
        break;
      default:
        DMPLogger.e(Tags.WEB_COMPONENT, `未适配(${extension}类型)资源加载`);
        response.setResponseMimeType('application/octet-stream');
        break;
    }
  }

  private static getSandboxFilePath(url: string, app: DMPApp): string {
    const bundleManager = app!.bundleManager;
    const bundleInfo = bundleManager.getBundleInfo();
    const appId = bundleInfo.appId;
    if (url.startsWith('https://mpservice.qiandao.com/')) {
      const isFromAppBundle = url.includes(appId);
      const processUrl = isFromAppBundle
        ? url.replace(`https://mpservice.qiandao.com/${appId}/`, '')
        : url.replace('https://mpservice.qiandao.com/', '');
      const sandboxDir = isFromAppBundle
        ? bundleManager.getCurrentJSAppDir()
        : bundleManager.getCurrentJSSdkDir();

      return `${sandboxDir}/${processUrl}`;
    } else {
      //debugUrl 不处理
      return url;
    }
  }

  private static getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }

  private static hasFile(filePath: string): boolean {
    return fs.accessSync(filePath);
  }
}