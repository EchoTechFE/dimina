
import { DMPNetServiceNext } from '../../HttpManager/DMPNetServiceNext';
import { DMPContainerBridgesModule } from '../DMPContainerBridgesModule';
import { DMPBridgeCallback, isMainThread } from '../DMPTSUtil';
import { BusinessError, request } from '@kit.BasicServicesKit';
import { DMPMap } from '../../Utils/DMPMap';
import { DMPContextUtils } from '../../Utils/DMPContextUtils';
import { DMPFileUrlConvertor } from '../../Bundle/Util/DMPFileUrlConvertor';
export class DMPContainerBridgesModuleHttp extends DMPContainerBridgesModule {
  getExportMethods(): string[] {
    return ['request','downloadFile','uploadFile'];
  }

  request(data: DMPMap, callback: DMPBridgeCallback) {
    const service = new DMPNetServiceNext(data, this.appData.appId, this.appData.jsAppVersion);

    service.request()
      .then(res => {
        this.invokeSuccessCallback(callback, res)
      })
      .catch((err: Error) => {
        this.invokeFailureCallback(callback, null, err.message)
      })
  }


  getNameFromFile(path: string): string {
    if (path) {
      let names = path.split("/")
      if (names && names.length > 0) {
        return names[names.length-1]
      }
    }
    return ''
  }

  getNameFromFileName(fileName:string):string{
    if (fileName) {
      let names = fileName.split(".")
      if (names && names.length > 0) {
        return names[0]
      }
    }
    return ''
  }

  getTypeFromFile(path: string): string {
    if (path) {
      let names = path.split(".")
      if (names && names.length > 0) {
        return names[names.length-1]
      }
    }
    return ''
  }

  downloadFile(data: DMPMap, callback: DMPBridgeCallback) {
    const url: string = data.get('url')
    let context = DMPContextUtils.getUIAbilityContext()
    const timestamp = new Date().getTime().toString();
    const fileType: string = this.getTypeFromFile(url)
    const localPath: string = `${context.tempDir}/${timestamp}.` + fileType
    try {
      request.downloadFile(context, {
        url: url,
        filePath: localPath
      }).then((downloadTask) => {
        downloadTask.on('complete', () => {
          const tempFilePath =  DMPFileUrlConvertor.localPathFromVPath(localPath)
          const params = new DMPMap()
          params.set('tempFilePath', tempFilePath)
          params.set('statusCode', 200)
          this.invokeSuccessCallback(callback, params)
        })
      }).catch((err: BusinessError) => {
        this.invokeFailureCallback(callback, null, '')
      });
    } catch (err) {
      this.invokeFailureCallback(callback, null, '')
    }

  }

  async uploadFile(param: DMPMap, callback: DMPBridgeCallback) {
    const url: string = param.getString('url')!;
    let filePath: string = param.getString('filePath')!;
    filePath = DMPFileUrlConvertor.localPathFromVPath(filePath)
    const formData: object = param.get('formData');
    const header: object = param.get('header');
    const fileName = this.getNameFromFile(filePath)

    const uri =  DMPFileUrlConvertor.uri2UploadImageFilePath(filePath)

    // 上传任务配置项
    let files: Array<request.File> = [
      { filename: fileName, name: 'file', uri: uri, type: 'application/octet-stream' }
    ]
    const data: Array<request.RequestData> = [];
    const formDataMap = new DMPMap(formData)
    formDataMap.toMap<string,string>().forEach((v,k,map)=>{
      data.push({name:k,value:v})
    })
    let uploadConfig: request.UploadConfig = {
      url: url,
      header: header,
      method: 'POST',
      files: files,
      data: data
    }
    // 将本地应用文件上传至网络服务器
    try {
      request.uploadFile(DMPContextUtils.getUIAbilityContext(), uploadConfig)
        .then((uploadTask: request.UploadTask) => {
          uploadTask.on('complete', (taskStates: Array<request.TaskState>) => {
            for (let i = 0; i < taskStates.length; i++) {
              console.info(`upload complete taskState: ${JSON.stringify(taskStates[i])}`);
               this.invokeSuccessCallback(callback,new DMPMap({"statusCode":taskStates[i]['responseCode'],"data":taskStates[i]['path']}))
            }
          });
        })
        .catch((err: BusinessError) => {
          this.invokeFailureCallback(callback,null,'上传失败')
        })
    } catch (error) {
      this.invokeFailureCallback(callback,null,'上传失败')
    }

  }

}
