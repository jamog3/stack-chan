/* eslint-disable prefer-const */

import type AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import { waitForCompletion } from 'stackchan-util'
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
  // parts), awaiting each clip's completion before starting the next so
  // concatenated fragments read as one continuous utterance.
  async playSequence(keys: string[], volume?: number): Promise<void> {
    for (const key of keys) {
      await waitForCompletion((callback) => this.stream(key, volume, callback))
    }
  }
}
