
import { DMPBundleInstallConfig } from './Model/DMPBundleInstallConfig';
import { DMPBundleLoadInfo } from './Model/DMPBundleLoadInfo';
import { DMPBundleLoader } from './Loader/DMPBundleLoader';
import { DMPReleaseBundleLoader } from './Loader/DMPReleaseBundleLoader';
import { DMPLaunchType } from '../DApp/config/DMPAppConfig';
import { DMPBundleAppConfigNext } from './Model/DMPBundleAppConfigNext';
import { DMPApp } from '../DApp/DMPApp';


export class DMPBundleManager {
  //包安装配置
  installConfig!: DMPBundleInstallConfig;
  //包加载器
  bundleLoader!: DMPBundleLoader;
  bundleAppConfigNext: DMPBundleAppConfigNext | null = null
  private app: DMPApp

  constructor(app: DMPApp) {
    this.app = app;
  }

  async install(installConfig: DMPBundleInstallConfig, launchBundleReady: ((config: DMPBundleLoadInfo) => void) | null,
    loadComplete?: (config: DMPBundleLoadInfo) => void | null,
    loadError?: (code: number, errMsg: string) => void | null) {
    this.installConfig = installConfig;
    switch (installConfig.launchAppType) {
      case DMPLaunchType.OnLine:
        this.bundleLoader = new DMPReleaseBundleLoader(this.app);
        break;
      default:
        throw Error('占不支持此类型')
    }
    await this.bundleLoader.install(installConfig, launchBundleReady, loadComplete, loadError)

  }

  getBundleInfo(): DMPBundleLoadInfo {
    if (!this.bundleLoader.installBundleInfo) {
      throw Error('dimina app is not running')
    }
    return this.bundleLoader.installBundleInfo!;
  }

  //加载 main.js, 返回path
  async requestServiceJsUri(): Promise<string> {
    return await this.bundleLoader.requestServiceJsUri();
  }

  //加载 logic.js, 返回path
  async requestLogicJsUri(): Promise<string> {
    return await this.bundleLoader.requestLogicJsUri();
  }

  //加载配置文件
  async loadConfigFile(): Promise<void> {
    const data = await this.bundleLoader.requestConfigFile();
    this.bundleAppConfigNext = DMPBundleAppConfigNext.fromJsonString(data)
  }

  //小程序包模块配置信息
  getJsAppModuleConfig(): DMPBundleAppConfigNext {
    if (this.bundleAppConfigNext) {
      return this.bundleAppConfigNext;
    }
    throw Error('please invoke loadConfigFile first')
  }

  //获取dm_bundle_v2/jssdk/version/dev
  getCurrentJSSdkDir(): string {
    return this.bundleLoader.getJSSdkDir();
  }

  //获取dm_bundle_v2/appId/code
  getCurrentJSAppDir(): string {
    return this.bundleLoader.getJsAppDir();
  }

  //获取dm_bundle_v2/appId路径
  getAppRootDir(): string {
    return this.bundleLoader.getAppRootDir();
  }
}