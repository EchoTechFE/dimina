
import { DMPNetServiceNext } from '../../HttpManager/DMPNetServiceNext';
import { DMPContainerBridgesModule } from '../DMPContainerBridgesModule';
import { DMPBridgeCallback, isMainThread } from '../DMPTSUtil';
import { BusinessError, request } from '@kit.BasicServicesKit';
import { DMPMap } from '@didi-dimina/dimina/ets/Utils/DMPMap';
import { DMPContextUtils } from '../../Utils/DMPContextUtils';
import { DMPFileUrlConvertor } from '../../Bundle/Util/DMPFileUrlConvertor';
export class DMPContainerBridgesModuleHttp extends DMPContainerBridgesModule {
  getExportMethods(): string[] {
    return ['request','downloadFile','uploadFile'];
  }

  request(data: DMPMap, callback: DMPBridgeCallback) {
    const service = new DMPNetServiceNext(data, this.appData.appId, this.appData.jsAppVersion);
    const url: string = data.get('url')

    console.log(`[HTTP Bridge] ========== 开始请求 ==========`)
    console.log(`[HTTP Bridge] URL: ${url}`)
    console.log(`[HTTP Bridge] Method: ${data.get('method') || 'GET'}`)
    console.log(`[HTTP Bridge] Headers: ${JSON.stringify(data.get('header') || {})}`)
    console.log(`[HTTP Bridge] Data: ${JSON.stringify(data.get('data') || {})}`)

    service.request()
      .then(res => {
        console.log(`[HTTP Bridge] 请求成功: ${url}`)
        console.log(`[HTTP Bridge] 响应状态码: ${res.get('statusCode')}`)

        const responseData: object | string = res.get('data')
        console.log(`[HTTP Bridge] 响应数据类型: ${typeof responseData}`)

        if (responseData && typeof responseData === 'object') {
          const keys: string[] = Object.keys(responseData)
          console.log(`[HTTP Bridge] 响应数据字段: ${keys.join(', ')}`)

          // 特别记录 cast-selector 配置的详细信息
          if (url.includes('cast-selector')) {
            console.log(`[HTTP Bridge] 配置请求详情:`)
            console.log(`[HTTP Bridge]   - data 类型: ${typeof responseData}`)
            console.log(`[HTTP Bridge]   - data 字段数: ${keys.length}`)
            console.log(`[HTTP Bridge]   - 完整响应结构: statusCode=${res.get('statusCode')}, has data=${res.get('data') !== undefined}, has header=${res.get('header') !== undefined}`)

            // 尝试输出部分数据内容
            try {
              const dataStr = JSON.stringify(responseData)
              console.log(`[HTTP Bridge]   - data 前200字符: ${dataStr.substring(0, 200)}`)
            } catch (e) {
              console.error(`[HTTP Bridge]   - 无法序列化 data: ${e}`)
            }
          }
        }

        this.invokeSuccessCallback(callback, res)
      })
      .catch((err: Error) => {
        console.error(`[HTTP Bridge] 请求失败: ${url}`)
        console.error(`[HTTP Bridge] 错误信息: ${err.message}`)
        console.error(`[HTTP Bridge] 错误堆栈: ${err.stack}`)
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
