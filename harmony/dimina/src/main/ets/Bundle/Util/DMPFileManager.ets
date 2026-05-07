
import fs from '@ohos.file.fs';
import { BusinessError } from '@ohos.base';
import { DMPLaunchType } from '../../DApp/config/DMPAppConfig';
import { DMPRawFileUtils } from '../../Utils/DMPRawFileUtils';
import { DMPUnzipManager } from './DMPUnzipManager';
import { DMPVersionUtil } from '../../Utils/DMPVersionUtils';
import { DMPMap } from '../../Utils/DMPMap';
import { DMPLogger } from '../../EventTrack/DMPLogger';
import { Tags } from '../../EventTrack/Tags';
import { DMPContextUtils } from '../../Utils/DMPContextUtils';
import { DMPBundleLoadInfo } from '../Model/DMPBundleLoadInfo';

const DMPPackageRootDir: string = '/dimina';
const DMPResourceDirectoryName: string = "resource";
const DMPTmpResourceDirectoryName: string = "tmp";
const DMPStoreResourceDirectoryName: string = "store";
const DMPLocalPkgDir = 'jsapp';
const DMPLocalJsSdkDir = 'jssdk';
const DMPLocalJsSdkName = 'main.zip'


export class DMPFileManager {
  private static instance: DMPFileManager;
  public sandboxPath: string = ''
  public cacheDir: string = ''
  private pathMap: Map<string, string> = new Map();

  private constructor() {
    this.configSandboxPath();
  }

  configSandboxPath() {
    if (this.sandboxPath!) {
      return;
    }
    // 获取应用文件路径
    let context = DMPContextUtils.getUIAbilityContext();
    this.cacheDir = context.cacheDir;

    let filesDir = context.filesDir;
    let sandbox = filesDir + DMPPackageRootDir;
    this.sandboxPath = sandbox;
    fs.mkdir(sandbox, true);
  }

  public async initRootDir(appId: string) {
    let appRootPath = this.getJSAppDir(appId);
    let isExist = fs.accessSync(appRootPath)
    if (!isExist) {
      await fs.mkdir(appRootPath, true)
    }
  }

  deleteBundleByAppId(appId: string) {
    const dir = this.getJSAppDir(appId)
    fs.rmdirSync(dir)
    DMPLogger.d(Tags.BUNDLE, `删除 appId=${appId} 缓存包`)
  }

  async createAppVersionDir(appId: string, versionCode: string): Promise<string> {
    let path = this.getJSAppVersionDir(appId, versionCode);
    let isExist = fs.accessSync(path);
    if (!isExist) {
      await fs.mkdir(path, true)
    }
    return path;
  }

  async createSdkVersionDir(versionCode: string): Promise<string> {
    let path = this.getJSSdkVersionDir(versionCode);
    let isExist = fs.accessSync(path);
    if (!isExist) {
      await fs.mkdir(path, true)
    }
    return path;
  }


  //小程序根目录
  public getJSAppDir(appId: string): string {
    return this.sandboxPath + '/' + appId;
  }

  public getJSAppVersionDir(appId: string, version: string): string {
    return this.getJSAppDir(appId) + '/' + version;
  }

  //jssdk根目录
  public getJSSdkDir(): string {
    return this.sandboxPath + '/jssdk';
  }

  //jssdk某个版本路径 jssdk/version/main
  public getJSSdkVersionDevDir(version: string) {
    return this.getJSSdkDir() + '/' + version + '/main';
  }

  private getJSSdkVersionDir(versionCode: string): string {
    return this.getJSSdkDir() + '/' + versionCode;
  }

  //每个jsApp的config
  public getJSAppConfigPath(appId: string): string {
    return this.getJSAppDir(appId) + '/config.json'
  }

  //jssdk config
  public getJSSDKConfigPath(): string {
    return this.getJSSdkDir() + '/config.json'
  }

  private getLocalJsAppZip(appId: string): string {
    return `${DMPLocalPkgDir}/${appId}/${appId}.zip`;
  }

  private getLocalJsAppConfig(appId: string): string {
    return DMPLocalPkgDir + '/' + appId + '/config.json';
  }

  private getLocalJSSdkZipPath(): string {
    return DMPLocalJsSdkDir + '/' + DMPLocalJsSdkName;
  }

  private getLocalJSSdkConfigPath(): string {
    return DMPLocalJsSdkDir + '/config.json';
  }

  static fileExist(path: string, launchType?: DMPLaunchType): boolean {
    if (launchType === DMPLaunchType.DebugUrl) {
      return true;
    }
    return fs.accessSync(path);
  }

  static mkdir(path: string) {
    fs.mkdirSync(path, true)
  }

  loadJSAppConfig(appId: string): DMPMap | null {
    let path = this.getJSAppConfigPath(appId)
    return this.readFileToJson(path)
  }

  loadJSSdkConfig(): DMPMap | null {
    let path = this.getJSSDKConfigPath()
    return this.readFileToJson(path)
  }

  //保留3个版本
  async clearJSAppHistoryBundle(bundleLoadInfo: DMPBundleLoadInfo) {
    let dir = this.getJSAppDir(bundleLoadInfo.appId);
    await DMPVersionUtil.clearHistory(bundleLoadInfo.cacheJSAppBundleConfig?.versionCode.toString() ?? '', dir);
  }

  //保留3个版本
  async clearJSSdkHistoryBundle(bundleLoadInfo: DMPBundleLoadInfo) {
    let jsSdkRootPath = this.getJSSdkDir();
    await DMPVersionUtil.clearHistory(bundleLoadInfo.cacheJSSdkBundleConfig?.versionCode.toString() ?? '', jsSdkRootPath);
  }

  async copyJSAppAndUnZip(appId: string, appVersion: string) {
    const jsAppDir = this.getJSAppDir(appId)
    const jsAppVersionDir = this.getJSAppVersionDir(appId, appVersion)
    if (!fs.accessSync(jsAppDir)) {
      await fs.mkdir(jsAppDir)
    }
    if (fs.accessSync(jsAppVersionDir)) {
      fs.rmdirSync(jsAppVersionDir)
    }
    const targetJSAppModuleDir = jsAppVersionDir;
    if (!fs.accessSync(targetJSAppModuleDir)) {
      await fs.mkdir(targetJSAppModuleDir, true)
    }

    const localJsAppConfig = this.getLocalJsAppConfig(appId)
    const localJsAppZip = this.getLocalJsAppZip(appId)
    const targetJsAppZipPath = `${jsAppVersionDir}/${appId}.zip`
    const targetJsAppConfigPath = jsAppVersionDir + '/config.json'
    DMPLogger.d(Tags.LOAD_LOCAL_BUNDLE, "targetJsAppZipPath=" + targetJsAppZipPath)
    DMPLogger.d(Tags.LOAD_LOCAL_BUNDLE, "targetJsAppConfigPath=" + targetJsAppConfigPath)
    DMPRawFileUtils.copyRawFileToSandBox(DMPContextUtils.getUIAbilityContext(), localJsAppConfig, targetJsAppConfigPath)
    DMPRawFileUtils.copyRawFileToSandBox(DMPContextUtils.getUIAbilityContext(), localJsAppZip, targetJsAppZipPath)
    const unZipJsAppDir = targetJSAppModuleDir;
    DMPLogger.d(Tags.LOAD_LOCAL_BUNDLE, "unZipJsAppDir=" + unZipJsAppDir)
    if (!fs.accessSync(unZipJsAppDir)) {
      await fs.mkdir(unZipJsAppDir)
    }
    const result = await DMPUnzipManager.unzipFileAtPathAsync(targetJsAppZipPath, unZipJsAppDir);
    if (result) {
      fs.unlinkSync(targetJsAppZipPath)
      //写入配置
      fs.copyFileSync(targetJsAppConfigPath, this.getJSAppConfigPath(appId))
    } else {
      throw Error("解压JsApp底包失败")
    }
  }

  async copyJSSDKAndUnZip(version: string) {
    const jsSdkDir = this.getJSSdkDir()
    const jsSdkVersionDir = this.getJSSdkVersionDir(version);
    if (!fs.accessSync(jsSdkDir)) {
      await fs.mkdir(jsSdkDir)
    }
    if (fs.accessSync(jsSdkVersionDir)) {
      fs.rmdirSync(jsSdkVersionDir)
    }
    await fs.mkdir(jsSdkVersionDir)
    const localJSSdkConfigPath = this.getLocalJSSdkConfigPath()
    const localJSSdkZipPath = this.getLocalJSSdkZipPath()
    const targetFileFullPath = jsSdkVersionDir + '/' + DMPLocalJsSdkName;
    const targetConfigFullPath = jsSdkVersionDir + '/config.json';
    DMPRawFileUtils.copyRawFileToSandBox(DMPContextUtils.getUIAbilityContext(), localJSSdkConfigPath,
      targetConfigFullPath)
    DMPRawFileUtils.copyRawFileToSandBox(DMPContextUtils.getUIAbilityContext(), localJSSdkZipPath, targetFileFullPath)
    const result = await DMPUnzipManager.unzipFileAtPathAsync(targetFileFullPath, jsSdkVersionDir);
    if (result) {
      fs.unlinkSync(targetFileFullPath)
      //写入配置
      fs.copyFileSync(targetConfigFullPath, this.getJSSDKConfigPath())
    } else {
      throw Error("解压JSSdk底包失败")
    }

  }

  public static sharedInstance(): DMPFileManager {
    if (!DMPFileManager.instance) {
      DMPFileManager.instance = new DMPFileManager();
    }
    return DMPFileManager.instance;
  }

  // 文件管理基础方法
  static moveFile(src: string, dest: string) {
    fs.stat(src, (err: BusinessError, stat: fs.Stat) => {
      if (stat.isDirectory()) {
        fs.moveDir(src, dest, (err: BusinessError) => {
        })
      } else {
        fs.moveFile(src, dest, 0, (err: BusinessError) => {
        });
      }
    })
  }

  //读取文本文件
  readFileToText(path: string): string {
    try {
      if (!fs.accessSync(path)) {
        return ''
      }
      let stat = fs.statSync(path);
      let text = fs.readTextSync(path, { offset: 0, length: stat.size });
      return text;
    } catch (e) {
      DMPLogger.e('e=' + e.toString())
      return ''
    }
  }

  //读取文件内容转化Map
  readFileToJson(path: string): DMPMap | null {
    try {
      if (!fs.accessSync(path)) {
        return null;
      }
      let stat = fs.statSync(path);
      let text = fs.readTextSync(path, { offset: 0, length: stat.size });
      return DMPMap.createFromString(text)
    } catch (e) {
      return null;
    }
  }

  writeJsonToFile(path: string, json: string): Boolean {
    try {
      DMPLogger.d("writeJsonToFile" + path);
      fs.createStreamSync(path, 'w');
      let file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
      fs.writeSync(file.fd, json);
      fs.closeSync(file);
      DMPLogger.d("writeJsonToFile success")
      return true;
    } catch (e) {
      DMPLogger.e("writeJsonToFile failed" + e.toString())
      return false;
    }
  }


  stringToArrayBuffer(str: string) {
    let utf8 = unescape(encodeURIComponent(str));
    let ab = new ArrayBuffer(utf8.length);
    let view = new Uint8Array(ab);
    for (let i = 0; i < utf8.length; i++) {
      view[i] = utf8.charCodeAt(i);
    }
    return ab;
  }

  static removeFile(filePath: string) {
    fs.unlink(filePath).then(() => {
      DMPLogger.d("remove unzip success")
    }).catch(() => {
      DMPLogger.e("remove unzip fail")
    })
  }

  // --- 2024年03月25日 下面是 lehem 添加，文件系统使用 ---
  createLocalBundleDirectoryForApp(appId: string, sandbox?: string) {
    // 默认值是沙盒路径
    sandbox = sandbox ?? this.sandboxPath;
    let appBundlePath: string = `${sandbox}/${appId}`
    let resourcePath: string = `${sandbox}/${appId}/${DMPResourceDirectoryName}`
    let tmpDir: string = `${resourcePath}/${DMPTmpResourceDirectoryName}`
    let storeDir: string = `${resourcePath}/${DMPStoreResourceDirectoryName}`

    try {
      fs.mkdir(tmpDir, true)
      fs.mkdir(storeDir, true)
    } catch (error) {
      DMPLogger.e('Failed to mkdir. And the error is: ' + error)
    }
    this.saveToPath(appId, appBundlePath);
  }

  appResourceDirectory(appId: string): string {
    return this.bundlePath(appId) + '/' + DMPResourceDirectoryName;
  }

  appTmpDirectory(appId: string): string {
    return this.appResourceDirectory(appId) + '/' + DMPTmpResourceDirectoryName;
  }



  private bundlePath(appId: string): string {
    return this.pathMap[appId]
  }

  private saveToPath(appId: string, path: string) {
    this.pathMap[appId] = path;
  }
}
