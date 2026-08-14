import loadPreferences from 'loadPreference'
import type { StackchanAppBehavior } from 'app-behavior'
import { AppController } from 'app-controller'
import { DogFace, ImageFace, SimpleFace } from 'behaviors/face'
import { DEFAULT_BRIGHTNESS_PERCENT } from 'brightness-model'
import { startCalendarReminders } from 'calendar-reminders'
import type { CameraImageType } from 'camera'
import { type CameraPreviewFrame, createCameraPreviewDialog, prepareCameraPreviewFrame } from 'camera-preview'
import { DOMAIN } from 'consts'
import { Emoticon, type EmoticonKey } from 'effects/emoticon'
import { Emotion } from 'face-state'
import { type HandAnimationName, isHandAnimationName } from 'hands'
import type { MotionType } from 'imu'
import { localize } from 'localization'
import config from 'mc/config'
import { numberToSpeechParts } from 'number-speech'
import type { Content as PiuContent } from 'piu/MC'
import { powerOff } from 'power-off'
import { type Scd40Sample, tryGetSharedScd40 } from 'scd40'
import { setBacklightPercent } from 'set-backlight'
import { randomBetween, wait } from 'stackchan-util'
import Timer from 'timer'
import { TTS as LocalTTS } from 'tts-local'
import { isVbusPresent } from 'vbus-presence'
import { canonicalizeVolume } from 'volume-model'

const FORWARD = {
  y: 0,
  p: 0,
  r: 0,
}
const LEFT = {
  ...FORWARD,
  y: Math.PI / 6,
}
const RIGHT = {
  ...FORWARD,
  y: -Math.PI / 6,
}
const DOWN = {
  ...FORWARD,
  p: Math.PI / 32,
}
const UP = {
  ...FORWARD,
  p: -Math.PI / 6,
}
const RECORD_PLAYBACK_DURATION_MS = 2000
const CAMERA_PREVIEW_DURATION_MS = 5000
const CAMERA_PREVIEW_STOP_DELAY_MS = 120
// Capture at the GC0308's native QQVGA size. The preview renderer scales this
// to 200x120; requesting 200 pixels wide selects the larger 240x176 mode and
// increases both the contiguous DMA requirement and frame overflow pressure.
const CAMERA_PREVIEW_CAPTURE_WIDTH = 160
const CAMERA_PREVIEW_CAPTURE_HEIGHT = 120
const CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE: CameraImageType =
  (config as { format?: string }).format === 'RGB565BE' ? 'rgb565be' : 'rgb565le'
const TOUCH_PANEL_PETTING_WINDOW_MS = 1500
const TOUCH_PANEL_HAPPY_DURATION_MS = 5000
const TOUCH_PANEL_PET_MOTION_STEP_MS = 220
const TOUCH_PANEL_PET_MOTION_STEP_SEC = TOUCH_PANEL_PET_MOTION_STEP_MS / 1000
const MOTION_DETECT_COLD_DURATION_MS = 5000
const SPEECH_SYNTHESIS_TEXT = 'こんにちわ。すたっくちゃんです。'
const ONE_HOUR_MS = 60 * 60 * 1000
const CO2_POLL_INTERVAL_MS = 30 * 1000
const TIME_SIGNAL_BALLOON_HIDE_DELAY_MS = 1500
const TIME_SIGNAL_KYORO_STEP_SEC = 0.6
const TIME_SIGNAL_KYORO_STEP_PAUSE_MS = 300
// setPose resolves once the command reaches the servo, not once it arrives, so this
// pads the wait beyond the commanded move duration to avoid cutting the motion short.
const TIME_SIGNAL_KYORO_SAFETY_MARGIN_MS = 400
const TIME_SIGNAL_KYORO_STEP_WAIT_MS =
  TIME_SIGNAL_KYORO_STEP_SEC * 1000 + TIME_SIGNAL_KYORO_STEP_PAUSE_MS + TIME_SIGNAL_KYORO_SAFETY_MARGIN_MS
const TIME_SIGNAL_SCREEN_OFF_DELAY_MS = 10000
const TIME_SIGNAL_SCREEN_ON_SETTLE_MS = 500
const TIME_SIGNAL_SLEEP_DELAY_MS = 5000
const IDLE_SLEEPY_DELAY_MS = 15000
const IDLE_SCREEN_OFF_DELAY_MS = 5000
const VBUS_POLL_INTERVAL_MS = 2000
const VBUS_LOSS_SHUTDOWN_DELAY_MS = 10 * 60 * 1000
const VBUS_LOSS_SHUTDOWN_STREAK = Math.round(VBUS_LOSS_SHUTDOWN_DELAY_MS / VBUS_POLL_INTERVAL_MS)

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

function msUntilNextHour(now = new Date()): number {
  return ONE_HOUR_MS - ((now.getMinutes() * 60 + now.getSeconds()) * 1000 + now.getMilliseconds())
}

export const onContextCreated: NonNullable<StackchanAppBehavior['onContextCreated']> = (robot) => {
  const emotions: Emotion[] = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.HOT, Emotion.SLEEPY, Emotion.NEUTRAL]
  const emotionOptions = [
    { value: String(Emotion.NEUTRAL), label: localize('drawer.emotion.neutral') },
    { value: String(Emotion.HAPPY), label: localize('drawer.emotion.happy') },
    { value: String(Emotion.ANGRY), label: localize('drawer.emotion.angry') },
    { value: String(Emotion.SAD), label: localize('drawer.emotion.sad') },
    { value: String(Emotion.HOT), label: localize('drawer.emotion.hot') },
    { value: String(Emotion.SLEEPY), label: localize('drawer.emotion.sleepy') },
  ]
  let speechVisible = false
  let emoticonEffect: PiuContent | null = null
  let currentEmotion: Emotion = Emotion.NEUTRAL
  let pettingRestoreTimer: ReturnType<typeof Timer.set> | undefined
  let pettingPreviousEmotion: Emotion | undefined
  let pettingPreviousRotation: typeof robot.pose.body.rotation | undefined
  let pettingMotionActive = false
  let pettingHoldTimer: ReturnType<typeof Timer.set> | undefined
  let motionDetectRestoreTimer: ReturnType<typeof Timer.set> | undefined
  let motionDetectPreviousEmotion: Emotion | undefined
  // Handles for the hourly time signal's delayed sleep-transition/screen-off timers
  // (scheduled in announceHour's finally block below); declared here so clearIdleTimers,
  // defined further down, can cancel them from any wake path.
  let timeSignalSleepTimer: ReturnType<typeof Timer.set> | undefined
  let timeSignalScreenOffTimer: ReturnType<typeof Timer.set> | undefined
  const emotionKeyMap: Record<Emotion, EmoticonKey | null> = {
    [Emotion.HAPPY]: 'heart',
    [Emotion.ANGRY]: 'angry',
    [Emotion.SAD]: 'tear',
    [Emotion.HOT]: 'sweat',
    [Emotion.SLEEPY]: 'sleepy',
    [Emotion.NEUTRAL]: null,
    [Emotion.DOUBTFUL]: null,
    [Emotion.COLD]: null,
  }
  const setEmotionWithEffect = (target: typeof robot, nextEmotion: Emotion) => {
    currentEmotion = nextEmotion
    target.setEmotion(nextEmotion)
    if (emoticonEffect) {
      target.ui.removeEffect(emoticonEffect)
      emoticonEffect = null
    }
    const key = emotionKeyMap[nextEmotion]
    if (key) {
      emoticonEffect = new Emoticon({ key, name: 'emotion' })
      target.ui.addEffect(emoticonEffect)
    }
  }
  const poseForRotation = (rotation: typeof robot.pose.body.rotation) => ({
    position: { ...robot.pose.body.position },
    rotation,
  })
  const runPettingHoldMotion = async (upRotation: typeof robot.pose.body.rotation) => {
    try {
      await robot.setPose(poseForRotation(upRotation), TOUCH_PANEL_PET_MOTION_STEP_SEC)
    } catch (error) {
      trace(`[TouchPanel] pet hold motion error ${errorMessage(error)}\n`)
      try {
        await robot.setTorque(false)
      } catch (torqueError) {
        trace(`[TouchPanel] pet hold torque release error ${errorMessage(torqueError)}\n`)
      }
    }
  }
  const runPettingMotion = async (
    upRotation: typeof robot.pose.body.rotation,
    leftRight: (direction: number) => typeof robot.pose.body.rotation,
    firstDirection: number,
  ) => {
    try {
      await robot.setTorque(true)
      // Multiple visible steps make this read as head shaking, not a single pose change.
      await robot.setPose(poseForRotation(leftRight(firstDirection)), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      await wait(TOUCH_PANEL_PET_MOTION_STEP_MS)
      await robot.setPose(poseForRotation(leftRight(-firstDirection)), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      await wait(TOUCH_PANEL_PET_MOTION_STEP_MS)
      await robot.setPose(poseForRotation(leftRight(firstDirection * 0.55)), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      await wait(TOUCH_PANEL_PET_MOTION_STEP_MS)
      // Keep the happy reaction looking upward until the restore timer returns to the original pose.
      await robot.setPose(poseForRotation(upRotation), TOUCH_PANEL_PET_MOTION_STEP_SEC)
      pettingHoldTimer = Timer.set(() => {
        pettingHoldTimer = undefined
        void runPettingHoldMotion(upRotation)
      }, TOUCH_PANEL_PET_MOTION_STEP_MS * 2)
    } catch (error) {
      trace(`[TouchPanel] pet motion error ${errorMessage(error)}\n`)
      try {
        await robot.setTorque(false)
      } catch (torqueError) {
        trace(`[TouchPanel] pet motion torque release error ${errorMessage(torqueError)}\n`)
      }
    } finally {
      pettingMotionActive = false
    }
  }
  const runPettingRestoreMotion = async (rotation: typeof robot.pose.body.rotation) => {
    try {
      await robot.setPose(poseForRotation(rotation), TOUCH_PANEL_PET_MOTION_STEP_SEC)
    } catch (error) {
      trace(`[TouchPanel] restore motion error ${errorMessage(error)}\n`)
    } finally {
      try {
        await robot.setTorque(false)
      } catch (torqueError) {
        trace(`[TouchPanel] restore torque release error ${errorMessage(torqueError)}\n`)
      }
    }
  }

  let faceMode: 'simple' | 'dog' | 'image' = 'simple'
  let handAnimation: HandAnimationName = 'none'
  let cameraPreviewTimer: ReturnType<typeof Timer.set> | undefined
  const syncFaceMode = (
    app = robot.ui.application as { distribute?: (event: string, payload: unknown) => void } | undefined,
  ) => {
    app?.distribute?.('onFaceMode', faceMode)
  }
  const syncHandAnimation = () => robot.ui.setHandAnimation(handAnimation)
  const closeDrawer = () => robot.ui.closeDrawer()
  const createCurrentFace = () =>
    faceMode === 'dog' ? new DogFace({}) : faceMode === 'image' ? new ImageFace({}) : new SimpleFace({})
  const restoreCameraPreview = () => {
    if (cameraPreviewTimer) {
      Timer.clear(cameraPreviewTimer)
      cameraPreviewTimer = undefined
    }
    // Restore the preserved face main component (keeps the current avatar mode/emotion).
    robot.ui.showFace()
    robot.hideBalloon()
  }
  robot.drawer.addDrawerButton({
    key: 'toggleFace',
    label: localize('drawer.face'),
    kind: 'choice',
    value: faceMode,
    options: [
      { value: 'simple', label: localize('drawer.face.simple') },
      { value: 'dog', label: localize('drawer.face.dog') },
      { value: 'image', label: localize('drawer.face.image') },
    ],
    callback: (target, value) => {
      if (value !== 'simple' && value !== 'dog' && value !== 'image') return
      faceMode = value
      target.ui.setFace(createCurrentFace())
      const app = target.ui.application as { distribute?: (event: string, payload: unknown) => void } | undefined
      syncFaceMode(app)
    },
  })
  syncFaceMode()
  robot.drawer.addDrawerButton({
    key: 'cycleEmotion',
    label: localize('drawer.emotion'),
    kind: 'choice',
    value: String(currentEmotion),
    options: emotionOptions,
    callback: (target, value) => {
      const nextEmotion = Number(value) as Emotion
      if (!emotions.includes(nextEmotion) && nextEmotion !== Emotion.NEUTRAL) return
      let canceledPettingMotion = false
      if (pettingRestoreTimer) {
        Timer.clear(pettingRestoreTimer)
        pettingRestoreTimer = undefined
        pettingPreviousEmotion = undefined
        canceledPettingMotion = true
      }
      if (pettingHoldTimer) {
        Timer.clear(pettingHoldTimer)
        pettingHoldTimer = undefined
        canceledPettingMotion = true
      }
      if (canceledPettingMotion) {
        void target
          .setTorque(false)
          .catch((error) => trace(`[TouchPanel] canceled petting torque release error ${errorMessage(error)}\n`))
      }
      setEmotionWithEffect(target, nextEmotion)
    },
  })
  robot.drawer.addDrawerButton({
    key: 'toggleSpeech',
    label: localize('drawer.balloon'),
    kind: 'toggle',
    initialState: speechVisible,
    callback: (target) => {
      speechVisible = !speechVisible
      if (speechVisible) {
        target.showBalloon('Hello from Stack-chan')
      } else {
        target.hideBalloon()
      }
      robot.drawer.setDrawerButtonState('toggleSpeech', speechVisible)
    },
  })
  robot.drawer.addDrawerButton({
    key: 'speakStackchan',
    label: 'Speak',
    callback: async (target) => {
      closeDrawer()
      try {
        const result = await target.audio.say(SPEECH_SYNTHESIS_TEXT)
        if ('reason' in result) trace(`[SpeechSynthesis] ${result.reason}\n`)
      } catch (error) {
        trace(`[SpeechSynthesis] error ${errorMessage(error)}\n`)
      }
    },
  })
  robot.drawer.addDrawerButton({
    key: 'handAnimation',
    label: '手',
    kind: 'choice',
    value: handAnimation,
    options: [
      { value: 'none', label: '無し' },
      { value: 'rock-paper-scissors', label: 'グーチョキパー' },
      { value: 'clap', label: '拍手' },
      { value: 'thinking', label: '考え中' },
    ],
    callback: (target, value) => {
      if (!isHandAnimationName(value)) return
      handAnimation = value
      target.ui.setHandAnimation(handAnimation)
      target.ui.closeDrawer()
    },
  })
  syncHandAnimation()

  const runCameraPreview = async (target: typeof robot) => {
    let frame: Awaited<ReturnType<typeof target.camera.capture>> | undefined
    let previewFrame: CameraPreviewFrame | undefined
    const stopCameraAfterPreviewPaint = () =>
      new Promise<void>((resolve) => {
        Timer.set(() => {
          try {
            trace('[CameraPreview] camera stop begin\n')
            const result = target.camera.stop()
            if (result && typeof (result as { then?: unknown }).then === 'function') {
              ;(result as Promise<void>).then(
                () => {
                  trace('[CameraPreview] camera stop done\n')
                  resolve()
                },
                (stopError: unknown) => {
                  trace(`[CameraPreview] stop error ${errorMessage(stopError)}\n`)
                  resolve()
                },
              )
            } else {
              trace('[CameraPreview] camera stop done\n')
              resolve()
            }
          } catch (stopError) {
            trace(`[CameraPreview] stop error ${errorMessage(stopError)}\n`)
            resolve()
          }
        }, CAMERA_PREVIEW_STOP_DELAY_MS)
      })
    try {
      target.showBalloon('starting camera...')
      await target.camera.start({
        width: CAMERA_PREVIEW_CAPTURE_WIDTH,
        height: CAMERA_PREVIEW_CAPTURE_HEIGHT,
        imageType: CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE,
      })
      frame = await target.camera.capture({
        width: CAMERA_PREVIEW_CAPTURE_WIDTH,
        height: CAMERA_PREVIEW_CAPTURE_HEIGHT,
        imageType: CAMERA_PREVIEW_CAPTURE_IMAGE_TYPE,
      })
      if (!frame) {
        trace('[CameraPreview] capture returned no frame\n')
        target.showBalloon('camera unavailable')
        return
      }
      previewFrame = prepareCameraPreviewFrame(frame)
      // Swap the whole main area for a full-area preview dialog; AppBar/Drawer stay active on top.
      // The dialog draws its own caption, so no preview-time balloon is needed.
      target.ui.setMain(
        createCameraPreviewDialog(previewFrame, {
          onRender: (mode) => {
            trace(`[CameraPreview] render mode=${mode}\n`)
          },
          onDismiss: restoreCameraPreview,
        }),
      )
      trace(
        `[CameraPreview] rendered ${previewFrame.width}x${previewFrame.height} ${previewFrame.imageType} via Piu Port\n`,
      )
      closeDrawer()
      if (cameraPreviewTimer) Timer.clear(cameraPreviewTimer)
      cameraPreviewTimer = Timer.set(restoreCameraPreview, CAMERA_PREVIEW_DURATION_MS)
    } catch (error) {
      trace(`[CameraPreview] error ${errorMessage(error)}\n`)
      try {
        target.showBalloon('camera error')
      } catch (balloonError) {
        trace(`[CameraPreview] error balloon failed ${errorMessage(balloonError)}\n`)
      }
    } finally {
      if (frame) {
        trace('[CameraPreview] frame close begin\n')
        frame.close?.()
        trace('[CameraPreview] frame close done\n')
      }
      await stopCameraAfterPreviewPaint()
      hideBalloonLater(1200)
    }
  }
  if (robot.camera.available !== false) {
    robot.drawer.addDrawerButton({
      key: 'cameraPreview',
      label: localize('drawer.camera'),
      icon: 'camera',
      callback: (target) => runCameraPreview(target),
    })
  }

  /**
   * Look around (Drawer toggle)
   */
  let isFollowing = false
  const toggleLookAround = async () => {
    const nextFollowing = !isFollowing
    try {
      await robot.setTorque(nextFollowing)
      isFollowing = nextFollowing
      robot.drawer.setDrawerButtonState('toggleLookAround', isFollowing)
      const text = isFollowing ? 'looking' : 'look away'
      robot.showBalloon(text)
      await wait(1000)
      robot.hideBalloon()
    } catch (error) {
      trace(`[Look] toggle error ${errorMessage(error)}\n`)
      robot.drawer.setDrawerButtonState('toggleLookAround', isFollowing)
    }
  }
  const targetLoop = () => {
    if (!isFollowing) {
      robot.lookAway()
      return
    }
    const x = randomBetween(0.4, 1.0)
    const y = randomBetween(-0.4, 0.4)
    const z = randomBetween(-0.02, 0.2)
    trace(`looking at: [${x}, ${y}, ${z}]\n`)
    robot.lookAt([x, y, z])
  }
  Timer.repeat(targetLoop, 5000)
  robot.drawer.addDrawerButton({
    key: 'toggleLookAround',
    label: localize('drawer.lookAround'),
    kind: 'toggle',
    initialState: isFollowing,
    callback: toggleLookAround,
  })

  /**
   * Time signal (hourly announcement)
   */
  let timeSignalEnabled = true
  // Pre-generated (VOICEVOX Zundamon) audio bundled as resources; independent of
  // config.tts, so the hourly announcement always uses this voice regardless of
  // which TTS backend robot.audio.say() is configured to use elsewhere.
  // Match the platform's fixed AudioOut sample rate (host/modules/audio/manifest.json
  // esp32/m5stackchan_cores3 defines.audioOut.sampleRate); the resource compiler
  // resamples bundled wav files to this rate, so playback must request the same rate.
  // Volume follows the same global preference the rest of the app's TTS uses
  // (set via the drawer/setup volume control), so this stays in sync with it.
  const timeSignalVolume = canonicalizeVolume(loadPreferences(DOMAIN.tts).volume)
  // Mirrors runtime-audio.ts's onPlayed/onDone wiring so the mouth animates in sync,
  // since this TTS instance bypasses robot.audio and isn't wired up automatically.
  const timeSignalTTS = new LocalTTS({
    sampleRate: 24000,
    volume: timeSignalVolume,
    onPlayed: (playedVolume) => robot.setMouthOpen(playedVolume === 0 ? 0 : Math.min(playedVolume / 2000, 1.0)),
    onDone: () => robot.setMouthOpen(0),
  })
  // setPose resolves once the servo starts moving, not once it arrives, so each
  // step waits out the move duration itself (plus a settle pause) before the next.
  const lookUp = async (target: typeof robot) => {
    await target.setPose(poseForRotation(UP), TIME_SIGNAL_KYORO_STEP_SEC)
    await wait(TIME_SIGNAL_KYORO_STEP_WAIT_MS)
  }
  // Enables torque (unless look-around already has it), runs `motion`, then
  // releases torque again and restores the look-around pause. Shared by every
  // one-off servo animation (kyoro-kyoro, sleep pose, wake look-up) so they
  // don't fight look-around's auto-tracking loop for the servo serial bus.
  const runServoAnimation = async (target: typeof robot, label: string, motion: () => Promise<void>) => {
    const wasFollowing = isFollowing
    if (wasFollowing) isFollowing = false
    try {
      if (!wasFollowing) await target.setTorque(true)
      await motion()
    } catch (error) {
      trace(`[${label}] motion error ${errorMessage(error)}\n`)
    } finally {
      if (!wasFollowing) {
        try {
          await target.setTorque(false)
        } catch (torqueError) {
          trace(`[${label}] torque release error ${errorMessage(torqueError)}\n`)
        }
      }
      isFollowing = wasFollowing
    }
  }
  const performKyoroKyoro = (target: typeof robot) =>
    runServoAnimation(target, 'TimeSignal', async () => {
      const [firstSide, secondSide] = Math.random() < 0.5 ? [LEFT, RIGHT] : [RIGHT, LEFT]
      await target.setPose(poseForRotation(firstSide), TIME_SIGNAL_KYORO_STEP_SEC)
      await wait(TIME_SIGNAL_KYORO_STEP_WAIT_MS)
      await target.setPose(poseForRotation(secondSide), TIME_SIGNAL_KYORO_STEP_SEC)
      await wait(TIME_SIGNAL_KYORO_STEP_WAIT_MS)
      await lookUp(target)
    })
  const performSleepTransition = async (target: typeof robot) => {
    await runServoAnimation(target, 'TimeSignal', async () => {
      await target.setPose(poseForRotation(FORWARD), TIME_SIGNAL_KYORO_STEP_SEC)
      await wait(TIME_SIGNAL_KYORO_STEP_WAIT_MS)
    })
    setEmotionWithEffect(target, Emotion.SLEEPY)
  }
  // Shared by both the hourly time signal and the general idle timeout: dim the
  // display, level the head back to horizontal, reset the face, and release
  // servo torque so it isn't holding a pose while the screen is off.
  const enterScreenOff = async (target: typeof robot) => {
    setBacklightPercent(0)
    setEmotionWithEffect(target, Emotion.NEUTRAL)
    try {
      await target.setPose(poseForRotation(FORWARD), TIME_SIGNAL_KYORO_STEP_SEC)
      await wait(TIME_SIGNAL_KYORO_STEP_WAIT_MS)
    } catch (error) {
      trace(`[ScreenOff] level pose error ${errorMessage(error)}\n`)
    } finally {
      try {
        await target.setTorque(false)
      } catch (error) {
        trace(`[ScreenOff] torque release error ${errorMessage(error)}\n`)
      }
    }
  }
  // Cached from the polling loop below; announceHour reads it instead of
  // querying the sensor itself so the hourly announcement never blocks on I2C.
  let lastSensorReading: Scd40Sample | undefined
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
  const announceHour = async (target: typeof robot) => {
    // Only speak while USB power is connected; isVbusPresent() returns
    // undefined on platforms without VBUS reporting, where this never skips.
    if (isVbusPresent() === false) {
      trace('[TimeSignal] USB not connected; skipping announcement\n')
      return
    }
    const hour = new Date().getHours()
    const text = `${hour}時になりました。`
    wakeScreen({ lookUpOnWake: false })
    // wakeScreen schedules the generic idle-sleepy/screen-off timers, but the
    // full announcement (time signal + env reading) can run longer than
    // IDLE_SLEEPY_DELAY_MS; without this, idle timeout fires mid-speech.
    // The finally block below schedules this announcement's own timers instead.
    clearIdleTimers()
    await wait(TIME_SIGNAL_SCREEN_ON_SETTLE_MS)
    await performKyoroKyoro(target)
    target.showBalloon(text)
    try {
      await timeSignalTTS.playSequence([`hour${hour}`, 'hourSuffix'])
      if (lastSensorReading) {
        const { co2, temperatureC, humidityPercent } = lastSensorReading
        const roundedTemperature = clamp(Math.round(temperatureC), -99, 99)
        const roundedHumidity = clamp(Math.round(humidityPercent), 0, 100)
        // Rounded to the nearest 100ppm so only the thousands/hundreds parts
        // need to be read (tens/ones are dropped rather than spoken exactly).
        const roundedCo2 = clamp(Math.round(co2 / 100) * 100, 0, 9900)
        target.showBalloon(
          `現在の室温は${roundedTemperature}°C、湿度は${roundedHumidity}%、CO2レベルは${roundedCo2}ppmです。`,
        )
        await timeSignalTTS.playSequence([
          'envIntro',
          ...numberToSpeechParts(roundedTemperature),
          'envDegreeToHumidity',
          ...numberToSpeechParts(roundedHumidity),
          'envPercentToCo2',
          ...numberToSpeechParts(roundedCo2),
          'envPpmEnd',
        ])
      }
    } catch (error) {
      trace(`[TimeSignal] say error ${errorMessage(error)}\n`)
    } finally {
      Timer.set(() => target.hideBalloon(), TIME_SIGNAL_BALLOON_HIDE_DELAY_MS)
      timeSignalScreenOffTimer = Timer.set(() => {
        timeSignalScreenOffTimer = undefined
        void enterScreenOff(target)
      }, TIME_SIGNAL_SCREEN_OFF_DELAY_MS)
      timeSignalSleepTimer = Timer.set(() => {
        timeSignalSleepTimer = undefined
        void performSleepTransition(target)
      }, TIME_SIGNAL_SLEEP_DELAY_MS)
    }
  }
  // Re-derives msUntilNextHour() from the live clock before each reschedule
  // (rather than a fixed ONE_HOUR_MS Timer.repeat) so a clock correction that
  // lands after this timer was first armed (e.g. SNTP sync completing only
  // after the user continues past a "no WiFi" boot prompt, offline) doesn't
  // leave the announcement permanently offset from the real top of the hour.
  const scheduleNextHourlyAnnouncement = () => {
    Timer.set(() => {
      if (timeSignalEnabled) void announceHour(robot)
      scheduleNextHourlyAnnouncement()
    }, msUntilNextHour())
  }
  scheduleNextHourlyAnnouncement()
  // SCD40 (M5Stack CO2 Unit) is optional external hardware; tryGetSharedScd40
  // silently returns undefined when it isn't attached, so polling is a no-op
  // on boards without it.
  Timer.repeat(() => {
    const sensor = tryGetSharedScd40()
    if (!sensor?.isDataReady()) return
    lastSensorReading = sensor.readMeasurement()
    const { co2, temperatureC, humidityPercent } = lastSensorReading
    trace(`[SCD40] co2=${co2}ppm temperature=${temperatureC.toFixed(1)}C humidity=${humidityPercent.toFixed(1)}%\n`)
  }, CO2_POLL_INTERVAL_MS)
  /**
   * USB power-loss shutdown: dimming the backlight alone leaves the ESP32,
   * servos, and mic running, which barely helps battery life. Once VBUS has
   * been away for VBUS_LOSS_SHUTDOWN_STREAK consecutive polls (debounced
   * against brief USB blips), release servo torque and cut board power via
   * the PMIC. isVbusPresent() returns undefined on platforms without VBUS
   * reporting, where this never fires. Powering back on happens at the PMIC
   * level when VBUS is reinserted; there is no software wake path here.
   */
  let vbusLossStreak = 0
  let isPoweringOffForVbusLoss = false
  Timer.repeat(() => {
    if (isPoweringOffForVbusLoss) return
    const vbusPresent = isVbusPresent()
    if (vbusPresent === undefined || vbusPresent) {
      vbusLossStreak = 0
      return
    }
    vbusLossStreak += 1
    if (vbusLossStreak < VBUS_LOSS_SHUTDOWN_STREAK) return
    isPoweringOffForVbusLoss = true
    trace('[Power] VBUS lost; powering off to conserve battery\n')
    void (async () => {
      setBacklightPercent(0)
      try {
        await robot.setTorque(false)
      } catch (error) {
        trace(`[Power] torque release error ${errorMessage(error)}\n`)
      }
      powerOff()
    })()
  }, VBUS_POLL_INTERVAL_MS)
  robot.drawer.addDrawerButton({
    key: 'toggleTimeSignal',
    label: '時報',
    kind: 'toggle',
    initialState: timeSignalEnabled,
    callback: () => {
      timeSignalEnabled = !timeSignalEnabled
      robot.drawer.setDrawerButtonState('toggleTimeSignal', timeSignalEnabled)
    },
  })
  // Manually triggers the same announcement as the hourly timer, bypassing
  // timeSignalEnabled and the USB-connected check, for testing on the bench.
  robot.drawer.addDrawerButton({
    key: 'testTimeSignal',
    label: '時報テスト',
    kind: 'action',
    callback: (target) => {
      closeDrawer()
      void announceHour(target)
    },
  })

  /**
   * Calendar reminders (Google Calendar). Logic lives in its own module (see
   * calendar-reminders.ts) rather than as closures inline here: this function is
   * already enormous, and XS's per-function stack frame is sized for its local/closure
   * count, so piling more closures directly into it risks a JS stack overflow at
   * startup on-device (observed while developing this feature).
   */
  // wakeScreen/clearIdleTimers/performSleepTransition are referenced via wrapper closures
  // (not passed directly) since all three are declared further down in this function; the
  // wrappers defer the identifier lookup until a reminder actually fires, well after the
  // whole function has finished running, avoiding a temporal-dead-zone error at this call site.
  startCalendarReminders(robot, {
    onReminderStart: async () => {
      await wakeScreen()
      // wakeScreen also schedules the generic idle-sleepy/screen-off timers, but a reminder
      // can speak longer than IDLE_SLEEPY_DELAY_MS; without this, idle timeout could show the
      // sleepy face mid-speech. onReminderEnd below drives the sleep transition explicitly
      // instead (mirrors announceHour's identical handling for the hourly time signal).
      clearIdleTimers()
    },
    onReminderEnd: () => void performSleepTransition(robot),
  })

  /**
   * Servo test (Drawer action)
   */
  let isMoving = false
  const runServoTest = async () => {
    if (isMoving) return
    isMoving = true
    let failed = false
    const rotations = [LEFT, RIGHT, DOWN, UP, FORWARD]
    try {
      isFollowing = false
      robot.lookAway()
      robot.drawer.setDrawerButtonState('toggleLookAround', false)
      robot.showBalloon('moving...')
      await robot.setTorque(true)
      for (const rotation of rotations) {
        await robot.setPose(poseForRotation(rotation))
        await wait(1000)
      }
    } catch (error) {
      failed = true
      trace(`[ServoTest] motion error ${errorMessage(error)}\n`)
      robot.showBalloon('servo error')
    } finally {
      try {
        await robot.setTorque(false)
      } catch (error) {
        failed = true
        trace(`[ServoTest] torque release error ${errorMessage(error)}\n`)
        robot.showBalloon('servo error')
      }
      isMoving = false
      if (failed) {
        Timer.set(() => robot.hideBalloon(), 1200)
      } else {
        robot.hideBalloon()
      }
    }
  }
  const startServoTest = () =>
    runServoTest().catch((error) => {
      isMoving = false
      trace(`[ServoTest] unexpected error ${errorMessage(error)}\n`)
    })
  robot.drawer.addDrawerButton({
    key: 'servoTest',
    label: localize('drawer.servo'),
    icon: 'play',
    callback: startServoTest,
  })

  /**
   * LED test(Drawer action)
   */
  if (Object.keys(robot.led).length) {
    const ledName = Object.keys(robot.led)[0] as string
    let isLighting = false
    const toggleLED = () => {
      isLighting = !isLighting
      if (isLighting) {
        robot.lightRainbow(ledName)
      } else {
        robot.lightOff(ledName)
      }
      robot.drawer.setDrawerButtonState('toggleLED', isLighting)
    }
    robot.drawer.addDrawerButton({
      key: 'toggleLED',
      label: 'LED',
      kind: 'toggle',
      initialState: isLighting,
      callback: toggleLED,
    })
  }

  /**
   * Audio tests (Drawer actions)
   */
  let isAudioTesting = false
  const hideBalloonLater = (delay = 900) => {
    Timer.set(() => {
      robot.hideBalloon()
    }, delay)
  }
  const runPlayTone = async () => {
    if (isAudioTesting) return
    isAudioTesting = true
    robot.showBalloon('playing tone...')
    try {
      trace('[AudioTest] playTone start\n')
      await robot.tone(880, 400, 0.35)
      trace('[AudioTest] playTone complete\n')
      robot.showBalloon('tone complete')
    } catch (error) {
      trace(`[AudioTest] playTone error ${errorMessage(error)}\n`)
      robot.showBalloon('tone error')
    } finally {
      isAudioTesting = false
      hideBalloonLater()
    }
  }
  const runRecordPlayback = async () => {
    if (isAudioTesting) return
    isAudioTesting = true
    robot.showBalloon('recording...')
    try {
      trace(`[AudioTest] record start duration=${RECORD_PLAYBACK_DURATION_MS}\n`)
      const buffer = await robot.record(RECORD_PLAYBACK_DURATION_MS)
      trace(`[AudioTest] record complete bytes=${buffer.byteLength}\n`)
      if (buffer.byteLength === 0) {
        robot.showBalloon('record failed')
        return
      }

      trace('[AudioTest] playback start\n')
      robot.showBalloon('playing...')
      const played = await robot.playAudio(buffer)
      trace(`[AudioTest] playback complete played=${played}\n`)
      robot.showBalloon(played ? 'playback complete' : `recorded ${buffer.byteLength} bytes`)
    } catch (error) {
      trace(`[AudioTest] record playback error ${errorMessage(error)}\n`)
      robot.showBalloon('audio error')
    } finally {
      isAudioTesting = false
      hideBalloonLater(1200)
    }
  }
  robot.drawer.addDrawerButton({
    key: 'playTone',
    label: localize('drawer.playSound'),
    icon: 'play',
    callback: runPlayTone,
  })
  robot.drawer.addDrawerButton({
    key: 'recordPlayback',
    label: localize('drawer.recordAndPlay'),
    icon: 'microphone',
    callback: runRecordPlayback,
  })

  /**
   * Change color (Drawer action)
   */
  let colorMode: 'dark' | 'light' = 'light'
  const colorOptions = [
    { value: 'light', label: localize('drawer.color.light'), color: '#ffffff' },
    { value: 'dark', label: localize('drawer.color.dark'), color: '#000000' },
  ]
  function selectColor(_target: typeof robot, value?: string) {
    if (value === 'dark' || value === 'light') applyColor(value)
  }
  const registerColorDrawerButton = () => {
    robot.drawer.addDrawerButton({
      key: 'toggleColor',
      label: localize('drawer.colorScheme'),
      kind: 'swatch',
      value: colorMode,
      options: colorOptions,
      callback: selectColor,
    })
  }
  const applyColor = (value: 'dark' | 'light') => {
    colorMode = value
    if (colorMode === 'light') {
      robot.setColor('primary', 0xff, 0xff, 0xff)
      robot.setColor('secondary', 0x00, 0x00, 0x00)
    } else {
      robot.setColor('primary', 0x00, 0x00, 0x00)
      robot.setColor('secondary', 0xff, 0xff, 0xff)
    }
    registerColorDrawerButton()
  }
  registerColorDrawerButton()

  if (robot.imu != null) {
    const motionEmotionMap: Record<MotionType, Emotion> = {
      upsideDown: Emotion.SAD,
      fallenForward: Emotion.ANGRY,
      fallenBackward: Emotion.ANGRY,
      fallenLeft: Emotion.ANGRY,
      fallenRight: Emotion.ANGRY,
      shake: Emotion.HOT,
    }
    robot.imu.start()
    robot.imu.onEvent = (event) => {
      const type = event.motion
      trace(`[IMU] motion detected: ${type}\n`)
      if (motionDetectPreviousEmotion === undefined) motionDetectPreviousEmotion = currentEmotion
      if (motionDetectRestoreTimer) Timer.clear(motionDetectRestoreTimer)

      const motionEmotion = motionEmotionMap[type]
      setEmotionWithEffect(robot, motionEmotion)
      motionDetectRestoreTimer = Timer.set(() => {
        if (currentEmotion === motionEmotion) {
          const restoreEmotion = motionDetectPreviousEmotion ?? Emotion.NEUTRAL
          trace(`[IMU] restore emotion ${restoreEmotion}\n`)
          setEmotionWithEffect(robot, restoreEmotion)
        }
        motionDetectPreviousEmotion = undefined
        motionDetectRestoreTimer = undefined
      }, MOTION_DETECT_COLD_DURATION_MS)
    }
  }

  /**
   * Idle screen timeout: after IDLE_SLEEPY_DELAY_MS with no interaction, show a
   * sleepy face; after IDLE_SCREEN_OFF_DELAY_MS more, dim the display off and
   * reset the face to neutral. Any interaction (buttons, head touch sensor,
   * screen touch) wakes the screen back up and resets the face to neutral too.
   */
  let idleSleepyTimer: ReturnType<typeof Timer.set> | undefined
  let idleScreenOffTimer: ReturnType<typeof Timer.set> | undefined
  // clearIdleTimers doubles as the reset point for every "something is awake now" path
  // (buttons, touch, calendar reminders, the hourly time signal itself), so the time
  // signal's own delayed sleep-transition/screen-off timers are cleared here too. Without
  // this, a calendar reminder (or any other wake event) starting within the few seconds
  // after an hourly announcement finishes would still get interrupted by that stale timer
  // firing mid-speech, since nothing else references it once scheduled.
  const clearIdleTimers = () => {
    if (timeSignalSleepTimer) {
      Timer.clear(timeSignalSleepTimer)
      timeSignalSleepTimer = undefined
    }
    if (timeSignalScreenOffTimer) {
      Timer.clear(timeSignalScreenOffTimer)
      timeSignalScreenOffTimer = undefined
    }
    if (idleSleepyTimer) {
      Timer.clear(idleSleepyTimer)
      idleSleepyTimer = undefined
    }
    if (idleScreenOffTimer) {
      Timer.clear(idleScreenOffTimer)
      idleScreenOffTimer = undefined
    }
  }
  const scheduleIdleTimers = () => {
    clearIdleTimers()
    idleSleepyTimer = Timer.set(() => {
      idleSleepyTimer = undefined
      // Reuses the time signal's level-then-sleepy transition so both paths
      // settle to a horizontal pose before showing the sleepy face.
      void performSleepTransition(robot)
      idleScreenOffTimer = Timer.set(() => {
        idleScreenOffTimer = undefined
        void enterScreenOff(robot)
      }, IDLE_SCREEN_OFF_DELAY_MS)
    }, IDLE_SLEEPY_DELAY_MS)
  }
  // The time signal skips lookUpOnWake because performKyoroKyoro already ends
  // by looking up 30 degrees (after its own left/right glance); other wake
  // sources (buttons, touch) have no motion of their own, so they get it here.
  // Returns a promise that resolves once the look-up motion finishes (or immediately if
  // skipped), so callers that need to wait for it (e.g. calendar reminders, which speak
  // only after the motion completes) can await it; existing callers that fire-and-forget
  // simply don't await the return value, unchanged from before.
  const wakeScreen = (options: { lookUpOnWake?: boolean } = {}): Promise<void> => {
    setBacklightPercent(DEFAULT_BRIGHTNESS_PERCENT)
    setEmotionWithEffect(robot, Emotion.NEUTRAL)
    scheduleIdleTimers()
    if (options.lookUpOnWake !== false) {
      return runServoAnimation(robot, 'Idle', () => lookUp(robot))
    }
    return Promise.resolve()
  }
  // Screen taps reach the face via Piu's bubbled 'onFaceTouch' event dispatched
  // to AppController, not through robot.touch (which no view code wires up), so
  // hook the prototype method rather than an instance callback.
  const originalOnFaceTouch = AppController.prototype.onFaceTouch
  AppController.prototype.onFaceTouch = function (this: AppController) {
    wakeScreen()
    originalOnFaceTouch.call(this)
  }
  scheduleIdleTimers()

  if (robot.button != null) {
    if (robot.button.a != null) {
      robot.button.a.onEvent = (event) => {
        wakeScreen()
        if (!event.pressed) {
          return
        }
        void toggleLookAround().catch((error) => trace(`[Button] look error ${errorMessage(error)}\n`))
      }
    }
    if (robot.button.b != null) {
      robot.button.b.onEvent = (event) => {
        wakeScreen()
        if (!event.pressed) {
          return
        }
        void startServoTest()
      }
    }
    if (robot.button.c != null) {
      robot.button.c.onEvent = (event) => {
        wakeScreen()
        if (!event.pressed) {
          return
        }
        applyColor(colorMode === 'light' ? 'dark' : 'light')
      }
    }
  }

  if (robot.touch != null) {
    // Wrap rather than replace: robot.touch drives the screen's own tap
    // handling, so this must not swallow whatever handler is already wired up.
    const previousTouchHandler = robot.touch.onEvent
    robot.touch.onEvent = (event) => {
      wakeScreen()
      previousTouchHandler?.(event)
    }
  }

  if (robot.touchPanel != null) {
    let lastForwardSwipeTicks: number | undefined
    let lastBackwardSwipeTicks: number | undefined
    robot.touchPanel.onEvent = (event) => {
      wakeScreen()
      const type = event.gesture
      trace(`[TouchPanel] gesture: ${type}\n`)
      if (type !== 'forwardSwipe' && type !== 'backwardSwipe') return

      if (type === 'forwardSwipe') lastForwardSwipeTicks = event.ticks
      else lastBackwardSwipeTicks = event.ticks

      const hasRecentForwardSwipe =
        lastForwardSwipeTicks !== undefined && event.ticks - lastForwardSwipeTicks <= TOUCH_PANEL_PETTING_WINDOW_MS
      const hasRecentBackwardSwipe =
        lastBackwardSwipeTicks !== undefined && event.ticks - lastBackwardSwipeTicks <= TOUCH_PANEL_PETTING_WINDOW_MS
      if (hasRecentForwardSwipe && hasRecentBackwardSwipe) {
        trace('[TouchPanel] petting detected: set emotion HAPPY with heart effect\n')
        if (pettingPreviousEmotion === undefined) pettingPreviousEmotion = currentEmotion
        if (pettingPreviousRotation === undefined) pettingPreviousRotation = { ...robot.pose.body.rotation }
        if (pettingRestoreTimer) Timer.clear(pettingRestoreTimer)
        if (pettingHoldTimer) {
          Timer.clear(pettingHoldTimer)
          pettingHoldTimer = undefined
        }
        setEmotionWithEffect(robot, Emotion.HAPPY)
        if (!pettingMotionActive) {
          pettingMotionActive = true
          const baseRotation = pettingPreviousRotation
          const yawAmount = randomBetween(Math.PI / 15, Math.PI / 10)
          const pitch = Math.max(-Math.PI / 4, baseRotation.p - randomBetween(Math.PI / 10, Math.PI / 8))
          const firstDirection = Math.random() < 0.5 ? -1 : 1
          const upRotation = { ...baseRotation, p: pitch }
          const leftRight = (direction: number) => ({
            ...baseRotation,
            p: pitch,
            y: Math.max(-Math.PI / 6, Math.min(Math.PI / 6, baseRotation.y + direction * yawAmount)),
          })
          trace(
            `[TouchPanel] pet motion shake yaw=${yawAmount.toFixed(3)} pitch=${pitch.toFixed(3)} direction=${firstDirection}\n`,
          )
          void runPettingMotion(upRotation, leftRight, firstDirection).catch((error) =>
            trace(`[TouchPanel] pet motion rejected ${errorMessage(error)}\n`),
          )
        }
        pettingRestoreTimer = Timer.set(() => {
          const restoreEmotion = pettingPreviousEmotion ?? Emotion.NEUTRAL
          trace(`[TouchPanel] restore emotion ${restoreEmotion}\n`)
          setEmotionWithEffect(robot, restoreEmotion)
          if (pettingHoldTimer) {
            Timer.clear(pettingHoldTimer)
            pettingHoldTimer = undefined
          }
          if (pettingPreviousRotation) {
            void runPettingRestoreMotion(pettingPreviousRotation).catch((error) =>
              trace(`[TouchPanel] restore motion rejected ${errorMessage(error)}\n`),
            )
          }
          pettingPreviousEmotion = undefined
          pettingPreviousRotation = undefined
          pettingRestoreTimer = undefined
        }, TOUCH_PANEL_HAPPY_DURATION_MS)
        lastForwardSwipeTicks = undefined
        lastBackwardSwipeTicks = undefined
      }
    }
  }
}
