import { systemDateTime } from '@kit.BasicServicesKit';

export class DMPLogger {
  static commonTag = "[dimina]"
  static isOpenDebugLog = true
  static onLog: ((level: string, tag: string, message: string) => void) | null = null

  static w(tag: string = '', ...args: string[]) {
    console.warn(`${tag}`, ...args)
    DMPLogger.onLog?.('warn', tag, args.join(' '))
  }

  static i(tag: string = '', ...args: string[]) {
    console.info(`${tag}`, ...args)
    DMPLogger.onLog?.('info', tag, args.join(' '))
  }

  static d(tag: string = '', ...args: string[]) {
    console.debug(`${tag}[${systemDateTime.getTime()}]`, ...args)
    DMPLogger.onLog?.('debug', tag, args.join(' '))
  }

  static e(tag: string = '', ...args: string[]) {
    console.error(`${tag}`, ...args)
    DMPLogger.onLog?.('error', tag, args.join(' '))
  }
}