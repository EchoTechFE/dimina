import { DMPMap } from '../../Utils/DMPMap'
import { DMPBridgeCallback } from '../DMPTSUtil'
import { DMPContainerBridgesModule } from '../DMPContainerBridgesModule'
import { InnerAudioTask } from './InnerAudioTask'
import { media } from '@kit.MediaKit'
import { DMPLogger } from '../../EventTrack/DMPLogger'

const TAG = 'DMPAudioBridge'

// 全局音频管理器
class AudioManager {
  private audioMap: Map<string, media.AVPlayer> = new Map()

  async createPlayer(audioId: string, src: string): Promise<media.AVPlayer> {
    const player = await media.createAVPlayer()

    // 设置状态变化回调
    player.on('stateChange', (state) => {
      DMPLogger.i(TAG, `Audio ${audioId} state changed to: ${state}`)
    })

    // 设置错误回调
    player.on('error', (err) => {
      DMPLogger.e(TAG, `Audio ${audioId} error: ${JSON.stringify(err)}`)
    })

    this.audioMap.set(audioId, player)

    if (src) {
      player.url = src
    }

    return player
  }

  getPlayer(audioId: string): media.AVPlayer | undefined {
    return this.audioMap.get(audioId)
  }

  async destroyPlayer(audioId: string): Promise<void> {
    const player = this.audioMap.get(audioId)
    if (player) {
      await player.release()
      this.audioMap.delete(audioId)
    }
  }

  async destroyAll(): Promise<void> {
    const entries = Array.from(this.audioMap.entries())
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const player = entry[1]
      await player.release()
    }
    this.audioMap.clear()
  }
}

const audioManager = new AudioManager()

export class DMPContainerBridgesModuleAudio extends DMPContainerBridgesModule {
  getExportMethods(): string[] {
    return [
      'innerAudioPlay',
      'innerAudioPause',
      'innerAudioStop',
      'innerAudioSeek',
      'innerAudioDestroy',
      'audioPlay',
      'audioPause',
      'audioSeek',
      'audioSetSrc'
    ]
  }

  // ========== InnerAudioContext 方法 ==========

  /**
   * 播放内部音频
   */
  async innerAudioPlay(data: DMPMap, callback: DMPBridgeCallback) {
    const audioId: string = data.get('audioId')
    DMPLogger.i(TAG, `innerAudioPlay: ${audioId}`)

    try {
      let player = audioManager.getPlayer(audioId)

      if (!player) {
        // 如果播放器不存在，创建一个新的
        DMPLogger.i(TAG, `Creating new player for ${audioId}`)
        player = await audioManager.createPlayer(audioId, '')
      }

      await player.play()
      this.invokeSuccessCallback(callback, null)
    } catch (err) {
      DMPLogger.e(TAG, `innerAudioPlay error: ${JSON.stringify(err)}`)
      this.invokeFailureCallback(callback, null, `播放失败: ${err}`)
    }
  }

  /**
   * 暂停内部音频
   */
  async innerAudioPause(data: DMPMap, callback: DMPBridgeCallback) {
    const audioId: string = data.get('audioId')
    DMPLogger.i(TAG, `innerAudioPause: ${audioId}`)

    try {
      const player = audioManager.getPlayer(audioId)
      if (player) {
        await player.pause()
      }
      this.invokeSuccessCallback(callback, null)
    } catch (err) {
      DMPLogger.e(TAG, `innerAudioPause error: ${JSON.stringify(err)}`)
      this.invokeFailureCallback(callback, null, `暂停失败: ${err}`)
    }
  }

  /**
   * 停止内部音频
   */
  async innerAudioStop(data: DMPMap, callback: DMPBridgeCallback) {
    const audioId: string = data.get('audioId')
    DMPLogger.i(TAG, `innerAudioStop: ${audioId}`)

    try {
      const player = audioManager.getPlayer(audioId)
      if (player) {
        await player.stop()
      }
      this.invokeSuccessCallback(callback, null)
    } catch (err) {
      DMPLogger.e(TAG, `innerAudioStop error: ${JSON.stringify(err)}`)
      this.invokeFailureCallback(callback, null, `停止失败: ${err}`)
    }
  }

  /**
   * 跳转到指定位置
   */
  async innerAudioSeek(data: DMPMap, callback: DMPBridgeCallback) {
    const audioId: string = data.get('audioId')
    const position: number = data.get('position') ?? 0
    DMPLogger.i(TAG, `innerAudioSeek: ${audioId}, position: ${position}`)

    try {
      const player = audioManager.getPlayer(audioId)
      if (player) {
        await player.seek(position * 1000) // 转换为毫秒
      }
      this.invokeSuccessCallback(callback, null)
    } catch (err) {
      DMPLogger.e(TAG, `innerAudioSeek error: ${JSON.stringify(err)}`)
      this.invokeFailureCallback(callback, null, `跳转失败: ${err}`)
    }
  }

  /**
   * 销毁内部音频
   */
  async innerAudioDestroy(data: DMPMap, callback: DMPBridgeCallback) {
    const audioId: string = data.get('audioId')
    DMPLogger.i(TAG, `innerAudioDestroy: ${audioId}`)

    try {
      await audioManager.destroyPlayer(audioId)
      this.invokeSuccessCallback(callback, null)
    } catch (err) {
      DMPLogger.e(TAG, `innerAudioDestroy error: ${JSON.stringify(err)}`)
      this.invokeFailureCallback(callback, null, `销毁失败: ${err}`)
    }
  }

  // ========== AudioContext 方法（旧版 API）==========

  /**
   * 播放音频（旧版）
   */
  async audioPlay(data: DMPMap, callback: DMPBridgeCallback) {
    const audioId: string = data.get('audioId')
    DMPLogger.i(TAG, `audioPlay: ${audioId}`)

    try {
      let player = audioManager.getPlayer(audioId)

      if (!player) {
        player = await audioManager.createPlayer(audioId, '')
      }

      await player.play()
      this.invokeSuccessCallback(callback, null)
    } catch (err) {
      DMPLogger.e(TAG, `audioPlay error: ${JSON.stringify(err)}`)
      this.invokeFailureCallback(callback, null, `播放失败: ${err}`)
    }
  }

  /**
   * 暂停音频（旧版）
   */
  async audioPause(data: DMPMap, callback: DMPBridgeCallback) {
    const audioId: string = data.get('audioId')
    DMPLogger.i(TAG, `audioPause: ${audioId}`)

    try {
      const player = audioManager.getPlayer(audioId)
      if (player) {
        await player.pause()
      }
      this.invokeSuccessCallback(callback, null)
    } catch (err) {
      DMPLogger.e(TAG, `audioPause error: ${JSON.stringify(err)}`)
      this.invokeFailureCallback(callback, null, `暂停失败: ${err}`)
    }
  }

  /**
   * 跳转音频位置（旧版）
   */
  async audioSeek(data: DMPMap, callback: DMPBridgeCallback) {
    const audioId: string = data.get('audioId')
    const position: number = data.get('position') ?? 0
    DMPLogger.i(TAG, `audioSeek: ${audioId}, position: ${position}`)

    try {
      const player = audioManager.getPlayer(audioId)
      if (player) {
        await player.seek(position * 1000) // 转换为毫秒
      }
      this.invokeSuccessCallback(callback, null)
    } catch (err) {
      DMPLogger.e(TAG, `audioSeek error: ${JSON.stringify(err)}`)
      this.invokeFailureCallback(callback, null, `跳转失败: ${err}`)
    }
  }

  /**
   * 设置音频源（旧版）
   */
  async audioSetSrc(data: DMPMap, callback: DMPBridgeCallback) {
    const audioId: string = data.get('audioId')
    const src: string = data.get('src') ?? ''
    DMPLogger.i(TAG, `audioSetSrc: ${audioId}, src: ${src}`)

    try {
      let player = audioManager.getPlayer(audioId)

      if (!player) {
        player = await audioManager.createPlayer(audioId, src)
      } else {
        player.url = src
      }

      this.invokeSuccessCallback(callback, null)
    } catch (err) {
      DMPLogger.e(TAG, `audioSetSrc error: ${JSON.stringify(err)}`)
      this.invokeFailureCallback(callback, null, `设置音频源失败: ${err}`)
    }
  }
}
