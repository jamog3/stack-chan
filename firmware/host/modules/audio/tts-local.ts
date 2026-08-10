/* eslint-disable prefer-const */

import type AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

/* global trace, SharedArrayBuffer */

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  sampleRate?: number
  volume?: number
}

export class TTS {
  audio?: AudioOut
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  streaming: boolean
  sampleRate: number
  volume: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
    this.sampleRate = props.sampleRate ?? 11025
    this.volume = props.volume ?? 0.5
  }
  stream(key: string, volume?: number, callback?: TTSCompletion): void {
    runTTSPlayback(this, callback, (lifecycle) => {
      const audio = lifecycle.openAudio({ streams: 1, sampleRate: this.sampleRate }, volume ?? this.volume)
      lifecycle.attach(
        new ResourceStreamer({
          path: `${key}.maud`,
          audio: {
            out: audio,
            stream: 0,
            sampleRate: this.sampleRate,
          },
          onPlayed: lifecycle.onPlayed,
          onReady: lifecycle.onReady,
          onError: lifecycle.onError,
          onDone: lifecycle.onDone,
        }),
      )
    })
  }
  // Plays a list of resource keys back-to-back (e.g. digit/place-value speech
  // parts) on a single AudioOut/I2S session. Chaining separate stream() calls
  // would open and close the I2S channel per clip, and re-initializing the
  // channel on ESP32 produces an audible click at each clip boundary; keeping
  // one AudioOut alive for the whole sequence avoids that.
  async playSequence(keys: string[], volume?: number): Promise<void> {
    if (keys.length === 0) return
    await new Promise<void>((resolve, reject) => {
      runTTSPlayback(
        this,
        (error) => (error ? reject(error) : resolve()),
        (lifecycle) => {
          const audio = lifecycle.openAudio({ streams: 1, sampleRate: this.sampleRate }, volume ?? this.volume)
          let index = 0
          const playNext = (): void => {
            if (index >= keys.length) {
              lifecycle.onDone()
              return
            }
            const key = keys[index]
            index += 1
            lifecycle.attach(
              new ResourceStreamer({
                path: `${key}.maud`,
                audio: {
                  out: audio,
                  stream: 0,
                  sampleRate: this.sampleRate,
                },
                onPlayed: lifecycle.onPlayed,
                onReady: lifecycle.onReady,
                onError: lifecycle.onError,
                onDone: playNext,
              }),
            )
          }
          playNext()
        },
      )
    })
  }
}
