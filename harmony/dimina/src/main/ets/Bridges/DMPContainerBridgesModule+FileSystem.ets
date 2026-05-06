import { DMPContainerBridgesModule } from './DMPContainerBridgesModule'
import { DMPBridgeCallback } from './DMPTSUtil'
import { DMPMap } from '../Utils/DMPMap'
import { DMPFileManager } from '../Bundle/Util/DMPFileManager'
import { DMPUnzipManager } from '../Bundle/Util/DMPUnzipManager'
import fs from '@ohos.file.fs'
import { BusinessError } from '@ohos.base'
import { DMPLogger } from '../EventTrack/DMPLogger'
import { Tags } from '../EventTrack/Tags'
import util from '@ohos.util'


interface IFile{
  filePath: string,
  size: number,
  createTime: number
}

export class DMPContainerBridgesModuleFileSystem extends DMPContainerBridgesModule {
  getExportMethods(): string[] {
    return [
      'getFileSystemManager',
      // FileSystemManager 的方法
      'access',
      'accessSync',
      'appendFile',
      'appendFileSync',
      'copyFile',
      'copyFileSync',
      'getFileInfo',
      'mkdir',
      'mkdirSync',
      'readdir',
      'readdirSync',
      'readFile',
      'readFileSync',
      'rename',
      'renameSync',
      'rmdir',
      'rmdirSync',
      'stat',
      'statSync',
      'unlink',
      'unlinkSync',
      'writeFile',
      'writeFileSync',
      'saveFile',
      'removeSavedFile',
      'getSavedFileList',
      'unzip'
    ];
  }

  // 文件管理 / wx.getFileSystemManager
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.getFileSystemManager.html
  // 获取全局唯一的文件管理器
  getFileSystemManager(data: DMPMap, callback: DMPBridgeCallback): DMPMap {
    // 返回 FileSystemManager 标识
    const result = new DMPMap()
    result.set('fsm', 'FileSystemManager')
    return result
  }

  // 判断文件/目录是否存在
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.access.html
  access(data: DMPMap, callback: DMPBridgeCallback) {
    const path: string = data.get('path') as string
    const realPath = this.getRealPath(path)

    try {
      const exists = fs.accessSync(realPath)
      if (exists) {
        this.invokeSuccessCallback(callback, new DMPMap())
      } else {
        this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'access:fail no such file or directory' }), 'fail no such file or directory')
      }
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'access:fail ' + error }), 'fail')
    }
  }

  accessSync(data: DMPMap, callback: DMPBridgeCallback): boolean {
    const params: object = data.toObject()
    const path: string = params[0] as string
    const realPath = this.getRealPath(path)

    try {
      return fs.accessSync(realPath)
    } catch (error) {
      throw new Error('accessSync:fail ' + error)
    }
  }

  // 读取文件内容
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.readFile.html
  readFile(data: DMPMap, callback: DMPBridgeCallback) {
    const filePath: string = data.get('filePath') as string
    const encoding: string = (data.get('encoding') as string) ?? 'utf8'
    const realPath = this.getRealPath(filePath)

    try {
      if (!fs.accessSync(realPath)) {
        this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'readFile:fail no such file or directory' }), 'fail')
        return
      }

      const stat = fs.statSync(realPath)
      let content: string | ArrayBuffer

      if (encoding === 'binary' || encoding === 'base64') {
        // 读取二进制文件
        const file = fs.openSync(realPath, fs.OpenMode.READ_ONLY)
        const buffer = new ArrayBuffer(stat.size)
        fs.readSync(file.fd, buffer)
        fs.closeSync(file)

        if (encoding === 'base64') {
          // 转换为 base64
          const uint8Array = new Uint8Array(buffer)
          content = this.arrayBufferToBase64(uint8Array)
        } else {
          content = buffer
        }
      } else {
        // 读取文本文件
        content = fs.readTextSync(realPath, { offset: 0, length: stat.size, encoding: encoding })
      }

      const result = new DMPMap()
      result.set('data', content)
      this.invokeSuccessCallback(callback, result)
    } catch (error) {
      DMPLogger.e(Tags.BRIDGE, 'readFile error: ' + error)
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'readFile:fail ' + error }), 'fail')
    }
  }

  readFileSync(data: DMPMap, callback: DMPBridgeCallback): string | ArrayBuffer {
    const params: object = data.toObject()
    const filePath: string = params[0] as string
    const encoding: string = (params[1] as string) ?? 'utf8'
    const realPath = this.getRealPath(filePath)

    try {
      const stat = fs.statSync(realPath)

      if (encoding === 'binary' || encoding === 'base64') {
        const file = fs.openSync(realPath, fs.OpenMode.READ_ONLY)
        const buffer = new ArrayBuffer(stat.size)
        fs.readSync(file.fd, buffer)
        fs.closeSync(file)

        if (encoding === 'base64') {
          const uint8Array = new Uint8Array(buffer)
          return this.arrayBufferToBase64(uint8Array)
        }
        return buffer
      } else {
        return fs.readTextSync(realPath, { offset: 0, length: stat.size, encoding: encoding })
      }
    } catch (error) {
      throw new Error('readFileSync:fail ' + error)
    }
  }

  // 写入文件
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.writeFile.html
  writeFile(data: DMPMap, callback: DMPBridgeCallback) {
    const filePath: string = data.get('filePath') as string
    const dataContent: string | ArrayBuffer = data.get('data') as string | ArrayBuffer
    const encoding: string = (data.get('encoding') as string) ?? 'utf8'
    const realPath = this.getRealPath(filePath)

    try {
      const file = fs.openSync(realPath, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)

      if (typeof dataContent === 'string') {
        fs.writeSync(file.fd, dataContent)
      } else {
        fs.writeSync(file.fd, dataContent)
      }

      fs.closeSync(file)
      this.invokeSuccessCallback(callback, new DMPMap())
    } catch (error) {
      DMPLogger.e(Tags.BRIDGE, 'writeFile error: ' + error)
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'writeFile:fail ' + error }), 'fail')
    }
  }

  writeFileSync(data: DMPMap, callback: DMPBridgeCallback): void {
    const params: object = data.toObject()
    const filePath: string = params[0] as string
    const dataContent: string | ArrayBuffer = params[1] as string | ArrayBuffer
    const encoding: string = (params[2] as string) ?? 'utf8'
    const realPath = this.getRealPath(filePath)

    try {
      const file = fs.openSync(realPath, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)

      if (typeof dataContent === 'string') {
        fs.writeSync(file.fd, dataContent)
      } else {
        fs.writeSync(file.fd, dataContent)
      }

      fs.closeSync(file)
    } catch (error) {
      throw new Error('writeFileSync:fail ' + error)
    }
  }

  // 创建目录
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.mkdir.html
  mkdir(data: DMPMap, callback: DMPBridgeCallback) {
    const dirPath: string = data.get('dirPath') as string
    const recursive: boolean = (data.get('recursive') as boolean) ?? false
    const realPath = this.getRealPath(dirPath)

    try {
      fs.mkdirSync(realPath, recursive)
      this.invokeSuccessCallback(callback, new DMPMap())
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'mkdir:fail ' + error }), 'fail')
    }
  }

  mkdirSync(data: DMPMap, callback: DMPBridgeCallback): void {
    const params: object = data.toObject()
    const dirPath: string = params[0] as string
    const recursive: boolean = (params[1] as boolean) ?? false
    const realPath = this.getRealPath(dirPath)

    try {
      fs.mkdirSync(realPath, recursive)
    } catch (error) {
      throw new Error('mkdirSync:fail ' + error)
    }
  }

  // 删除目录
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.rmdir.html
  rmdir(data: DMPMap, callback: DMPBridgeCallback) {
    const dirPath: string = data.get('dirPath') as string
    const recursive: boolean = (data.get('recursive') as boolean) ?? false
    const realPath = this.getRealPath(dirPath)

    try {
      fs.rmdirSync(realPath)
      this.invokeSuccessCallback(callback, new DMPMap())
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'rmdir:fail ' + error }), 'fail')
    }
  }

  rmdirSync(data: DMPMap, callback: DMPBridgeCallback): void {
    const params: object = data.toObject()
    const dirPath: string = params[0] as string
    const realPath = this.getRealPath(dirPath)

    try {
      fs.rmdirSync(realPath)
    } catch (error) {
      throw new Error('rmdirSync:fail ' + error)
    }
  }

  // 删除文件
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.unlink.html
  unlink(data: DMPMap, callback: DMPBridgeCallback) {
    const filePath: string = data.get('filePath') as string
    const realPath = this.getRealPath(filePath)

    try {
      fs.unlinkSync(realPath)
      this.invokeSuccessCallback(callback, new DMPMap())
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'unlink:fail ' + error }), 'fail')
    }
  }

  unlinkSync(data: DMPMap, callback: DMPBridgeCallback): void {
    const params: object = data.toObject()
    const filePath: string = params[0] as string
    const realPath = this.getRealPath(filePath)

    try {
      fs.unlinkSync(realPath)
    } catch (error) {
      throw new Error('unlinkSync:fail ' + error)
    }
  }

  // 读取目录内容
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.readdir.html
  readdir(data: DMPMap, callback: DMPBridgeCallback) {
    const dirPath: string = data.get('dirPath') as string
    const realPath = this.getRealPath(dirPath)

    try {
      const files = fs.listFileSync(realPath)
      const result = new DMPMap()
      result.set('files', files)
      this.invokeSuccessCallback(callback, result)
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'readdir:fail ' + error }), 'fail')
    }
  }

  readdirSync(data: DMPMap, callback: DMPBridgeCallback): string[] {
    const params: object = data.toObject()
    const dirPath: string = params[0] as string
    const realPath = this.getRealPath(dirPath)

    try {
      return fs.listFileSync(realPath)
    } catch (error) {
      throw new Error('readdirSync:fail ' + error)
    }
  }

  // 获取文件信息
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.stat.html
  stat(data: DMPMap, callback: DMPBridgeCallback) {
    const path: string = data.get('path') as string
    const recursive: boolean = (data.get('recursive') as boolean) ?? false
    const realPath = this.getRealPath(path)

    try {
      const stat = fs.statSync(realPath)
      const result = new DMPMap()
      const statMap = new DMPMap()

      statMap.set('mode', stat.mode)
      statMap.set('size', stat.size)
      statMap.set('lastAccessedTime', stat.atime)
      statMap.set('lastModifiedTime', stat.mtime)
      statMap.set('isDirectory', stat.isDirectory())
      statMap.set('isFile', stat.isFile())

      result.set('stats', statMap)
      this.invokeSuccessCallback(callback, result)
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'stat:fail ' + error }), 'fail')
    }
  }

  statSync(data: DMPMap, callback: DMPBridgeCallback): DMPMap {
    const params: object = data.toObject()
    const path: string = params[0] as string
    const recursive: boolean = (params[1] as boolean) ?? false
    const realPath = this.getRealPath(path)

    try {
      const stat = fs.statSync(realPath)
      const statMap = new DMPMap()

      statMap.set('mode', stat.mode)
      statMap.set('size', stat.size)
      statMap.set('lastAccessedTime', stat.atime)
      statMap.set('lastModifiedTime', stat.mtime)
      statMap.set('isDirectory', stat.isDirectory())
      statMap.set('isFile', stat.isFile())

      return statMap
    } catch (error) {
      throw new Error('statSync:fail ' + error)
    }
  }

  // 复制文件
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.copyFile.html
  copyFile(data: DMPMap, callback: DMPBridgeCallback) {
    const srcPath: string = data.get('srcPath') as string
    const destPath: string = data.get('destPath') as string
    const realSrcPath = this.getRealPath(srcPath)
    const realDestPath = this.getRealPath(destPath)

    try {
      fs.copyFileSync(realSrcPath, realDestPath)
      this.invokeSuccessCallback(callback, new DMPMap())
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'copyFile:fail ' + error }), 'fail')
    }
  }

  copyFileSync(data: DMPMap, callback: DMPBridgeCallback): void {
    const params: object = data.toObject()
    const srcPath: string = params[0] as string
    const destPath: string = params[1] as string
    const realSrcPath = this.getRealPath(srcPath)
    const realDestPath = this.getRealPath(destPath)

    try {
      fs.copyFileSync(realSrcPath, realDestPath)
    } catch (error) {
      throw new Error('copyFileSync:fail ' + error)
    }
  }

  // 重命名文件
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.rename.html
  rename(data: DMPMap, callback: DMPBridgeCallback) {
    const oldPath: string = data.get('oldPath') as string
    const newPath: string = data.get('newPath') as string
    const realOldPath = this.getRealPath(oldPath)
    const realNewPath = this.getRealPath(newPath)

    try {
      fs.moveFileSync(realOldPath, realNewPath)
      this.invokeSuccessCallback(callback, new DMPMap())
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'rename:fail ' + error }), 'fail')
    }
  }

  renameSync(data: DMPMap, callback: DMPBridgeCallback): void {
    const params: object = data.toObject()
    const oldPath: string = params[0] as string
    const newPath: string = params[1] as string
    const realOldPath = this.getRealPath(oldPath)
    const realNewPath = this.getRealPath(newPath)

    try {
      fs.moveFileSync(realOldPath, realNewPath)
    } catch (error) {
      throw new Error('renameSync:fail ' + error)
    }
  }

  // 在文件结尾追加内容
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.appendFile.html
  appendFile(data: DMPMap, callback: DMPBridgeCallback) {
    const filePath: string = data.get('filePath') as string
    const dataContent: string | ArrayBuffer = data.get('data') as string | ArrayBuffer
    const encoding: string = (data.get('encoding') as string) ?? 'utf8'
    const realPath = this.getRealPath(filePath)

    try {
      const file = fs.openSync(realPath, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.APPEND)

      if (typeof dataContent === 'string') {
        fs.writeSync(file.fd, dataContent)
      } else {
        fs.writeSync(file.fd, dataContent)
      }

      fs.closeSync(file)
      this.invokeSuccessCallback(callback, new DMPMap())
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'appendFile:fail ' + error }), 'fail')
    }
  }

  appendFileSync(data: DMPMap, callback: DMPBridgeCallback): void {
    const params: object = data.toObject()
    const filePath: string = params[0] as string
    const dataContent: string | ArrayBuffer = params[1] as string | ArrayBuffer
    const encoding: string = (params[2] as string) ?? 'utf8'
    const realPath = this.getRealPath(filePath)

    try {
      const file = fs.openSync(realPath, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.APPEND)

      if (typeof dataContent === 'string') {
        fs.writeSync(file.fd, dataContent)
      } else {
        fs.writeSync(file.fd, dataContent)
      }

      fs.closeSync(file)
    } catch (error) {
      throw new Error('appendFileSync:fail ' + error)
    }
  }

  // 获取文件信息
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.getFileInfo.html
  getFileInfo(data: DMPMap, callback: DMPBridgeCallback) {
    const filePath: string = data.get('filePath') as string
    const realPath = this.getRealPath(filePath)

    try {
      const stat = fs.statSync(realPath)
      const result = new DMPMap()
      result.set('size', stat.size)
      this.invokeSuccessCallback(callback, result)
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'getFileInfo:fail ' + error }), 'fail')
    }
  }

  // 保存临时文件到本地
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.saveFile.html
  saveFile(data: DMPMap, callback: DMPBridgeCallback) {
    const tempFilePath: string = data.get('tempFilePath') as string
    const filePath: string = (data.get('filePath') as string) ?? ''

    const realTempPath = this.getRealPath(tempFilePath)
    const fileManager = DMPFileManager.sharedInstance()

    try {
      let savedPath: string
      if (filePath) {
        savedPath = this.getRealPath(filePath)
      } else {
        // 如果没有指定目标路径，保存到缓存目录
        const fileName = tempFilePath.substring(tempFilePath.lastIndexOf('/') + 1)
        savedPath = fileManager.cacheDir + '/' + fileName
      }

      fs.copyFileSync(realTempPath, savedPath)

      const result = new DMPMap()
      result.set('savedFilePath', savedPath)
      this.invokeSuccessCallback(callback, result)
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'saveFile:fail ' + error }), 'fail')
    }
  }

  // 删除该小程序下已保存的本地缓存文件
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.removeSavedFile.html
  removeSavedFile(data: DMPMap, callback: DMPBridgeCallback) {
    const filePath: string = data.get('filePath') as string
    const realPath = this.getRealPath(filePath)

    try {
      fs.unlinkSync(realPath)
      this.invokeSuccessCallback(callback, new DMPMap())
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'removeSavedFile:fail ' + error }), 'fail')
    }
  }

  // 获取该小程序下已保存的本地缓存文件列表
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.getSavedFileList.html
  getSavedFileList(data: DMPMap, callback: DMPBridgeCallback) {
    const fileManager = DMPFileManager.sharedInstance()
    const cacheDir = fileManager.cacheDir

    try {
      const files = fs.listFileSync(cacheDir)
      const fileList: object[] = []

      for (const fileName of files) {
        const filePath = cacheDir + '/' + fileName
        const stat = fs.statSync(filePath)
        fileList.push({
          filePath: filePath,
          size: stat.size,
          createTime: stat.ctime
        } as IFile)
      }

      const result = new DMPMap()
      result.set('fileList', fileList)
      this.invokeSuccessCallback(callback, result)
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'getSavedFileList:fail ' + error }), 'fail')
    }
  }

  // 解压文件
  // https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.unzip.html
  unzip(data: DMPMap, callback: DMPBridgeCallback) {
    const zipFilePath: string = data.get('zipFilePath') as string
    const targetPath: string = data.get('targetPath') as string
    const realZipPath = this.getRealPath(zipFilePath)
    const realTargetPath = this.getRealPath(targetPath)

    try {
      // 使用已有的 DMPUnzipManager 来解压
      DMPUnzipManager.unzipFileAtPath(realZipPath, realTargetPath,
        (path: string, success: boolean, error: Error | null) => {
          if (success) {
            this.invokeSuccessCallback(callback, new DMPMap())
          } else {
            this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'unzip:fail ' + error }), 'fail')
          }
        })
    } catch (error) {
      this.invokeFailureCallback(callback, new DMPMap({ errMsg: 'unzip:fail ' + error }), 'fail')
    }
  }

  // 辅助方法：将相对路径转换为真实路径
  private getRealPath(path: string): string {
    const fileManager = DMPFileManager.sharedInstance()

    // 微信小程序支持的路径前缀
    if (path.startsWith('wxfile://')) {
      // wxfile:// 本地临时文件路径
      return path.replace('wxfile://', fileManager.cacheDir + '/')
    } else if (path.startsWith('http://') || path.startsWith('https://')) {
      // 网络路径不处理
      return path
    } else if (path.startsWith('/')) {
      // 绝对路径，使用沙盒路径
      return fileManager.sandboxPath + path
    } else {
      // 相对路径，使用沙盒路径
      return fileManager.sandboxPath + '/' + path
    }
  }

  // 辅助方法：ArrayBuffer 转 Base64
  private arrayBufferToBase64(buffer: Uint8Array): string {
    try {
      const base64Helper = new util.Base64Helper()
      return base64Helper.encodeToStringSync(buffer)
    } catch (error) {
      DMPLogger.e(Tags.BRIDGE, 'arrayBufferToBase64 error: ' + error)
      return ''
    }
  }
}
