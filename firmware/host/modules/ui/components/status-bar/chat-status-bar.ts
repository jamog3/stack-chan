import type { Port as PiuPort } from 'piu/MC'
import { Container, Content, Label, Port, Skin, Style } from 'piu/MC'
import { ActionButton } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'

export const ChatStatusBarState = Object.freeze({
  FAILED: 0,
  DISCONNECTED: 1,
  DISCONNECTING: 2,
  CONNECTING: 3,
  CONNECTED: 4,
  SPEAKING: 5,
  LISTENING: 6,
  WAITING: 7,
} as const)

export type ChatStatusBarState = (typeof ChatStatusBarState)[keyof typeof ChatStatusBarState]

const barHeight = 44
export const FACE_ACTIONS_VISIBLE_MS = 4000
const levelHeight = 16
const levelWidth = 4
const iconSize = 16
const iconTop = (barHeight - iconSize) / 2
const defaultIconLeft = 8
const faceStatusScale = 2
const batteryIconLeft = 8
const batteryIconWidth = 24 * faceStatusScale
const batteryIconHeight = 16 * faceStatusScale
const batteryIconTop = (barHeight - batteryIconHeight) / 2
const batteryStatusIconLeft = batteryIconLeft + batteryIconWidth + 4
const clockWidth = 64 * faceStatusScale
const clockLeft = (UI.screenWidth - clockWidth) / 2
const minimumValidTimeMs = 1672722071_000
const clockRefreshIntervalMs = 1000
const batteryRefreshIntervalMs = 60_000
const footerHeight = 48
const footerPadding = 8
const footerColumnWidth = 140
const footerRefreshIntervalMs = 5000

export type BatteryLevelReader = () => number | undefined

export type EnvironmentSample = Readonly<{
  temperatureC: number
  humidityPercent: number
  co2: number
}>

export type EnvironmentReader = () => EnvironmentSample | undefined

export type ChatStatusBarOptions = Readonly<{
  now?: () => Date
  readBatteryLevel?: BatteryLevelReader
  readEnvironment?: EnvironmentReader
}>

export type AppBarMode = Readonly<
  { kind: 'face' } | { kind: 'launcher'; title: string } | { kind: 'app'; title: string }
>

type ChatStatusSkins = {
  bar: Skin
  chrome: Skin
  levelTrack: Skin
  levelFill: Skin
  errorFill: Skin
  microphone: Skin
  indicator: Skin
}

type ClockData = {
  now: () => Date
}

type BatteryData = {
  reader?: BatteryLevelReader
  visible: boolean
}

type EnvironmentData = {
  reader?: EnvironmentReader
  visible: boolean
}

type ClockBehaviorContract = {
  onVisibilityChanged(label: Label, visible: boolean): void
}

type BatteryBehaviorContract = {
  onVisibilityChanged(port: PiuPort, visible: boolean): void
}

type EnvironmentBehaviorContract = {
  onVisibilityChanged(container: Container, visible: boolean): void
}

export function formatAppBarTime(date: Date): string {
  const epoch = date.getTime()
  if (!Number.isFinite(epoch) || epoch <= minimumValidTimeMs) return '--:--'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function batteryLevelToSegments(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0
  if (level <= 25) return 1
  if (level <= 50) return 2
  if (level <= 75) return 3
  return 4
}

function setControlVisible(control: Container | undefined, visible: boolean): void {
  if (!control) return
  control.visible = visible
  control.active = visible
}

let cachedSkins: ChatStatusSkins | null = null

function getSkins(): ChatStatusSkins {
  if (!cachedSkins) {
    cachedSkins = {
      bar: new Skin({ fill: 'transparent' }),
      chrome: new Skin({ fill: '#202428' }),
      levelTrack: new Skin({ fill: '#2c2c2c' }),
      levelFill: new Skin({ fill: '#4caf50' }),
      errorFill: new Skin({ fill: '#ff5252' }),
      microphone: new Skin({
        texture: { path: 'microphone.png' },
        color: ['#ffffff', '#ffffff'],
        x: 0,
        y: 0,
        width: iconSize,
        height: iconSize,
        states: iconSize,
      }),
      indicator: new Skin({
        texture: { path: 'indicator.png' },
        color: ['#ffffff'],
        x: 0,
        y: 0,
        width: iconSize,
        height: iconSize,
        variants: iconSize,
      }),
    }
  }
  return cachedSkins
}

type FooterStyles = {
  left: InstanceType<typeof Style>
  center: InstanceType<typeof Style>
  right: InstanceType<typeof Style>
}

// Fixed at 2x the body font size (matching the clock's k8x12-24), independent of
// locale: the digits/°/％/p/m glyphs footer text needs don't require localization,
// and no CJK variant of this larger size exists.
const footerFont = 'k8x12-24'

let cachedFooterStyles: FooterStyles | null = null

function getFooterStyles(): FooterStyles {
  if (cachedFooterStyles) return cachedFooterStyles
  cachedFooterStyles = {
    left: new Style({ font: footerFont, color: UI.colors.text, horizontal: 'left', vertical: 'middle' }),
    center: new Style({ font: footerFont, color: UI.colors.text, horizontal: 'center', vertical: 'middle' }),
    right: new Style({ font: footerFont, color: UI.colors.text, horizontal: 'right', vertical: 'middle' }),
  }
  return cachedFooterStyles
}

class IndicatorBehavior extends Behavior {
  #frame = 0

  onDisplaying(content: Content) {
    content.variant = 0
  }

  onTimeChanged(content: Content) {
    this.#frame = (this.#frame + 1) % 4
    content.variant = this.#frame
  }
}

class ClockBehavior extends Behavior implements ClockBehaviorContract {
  #data?: ClockData
  #displaying = false
  #visible = true
  #lastValue = ''

  onCreate(_label: Label, data: ClockData) {
    this.#data = data
  }

  onDisplaying(label: Label) {
    this.#displaying = true
    this.updateTimer(label)
  }

  onUndisplaying(label: Label) {
    this.#displaying = false
    label.stop()
  }

  onTimeChanged(label: Label) {
    this.update(label)
  }

  onVisibilityChanged(label: Label, visible: boolean) {
    this.#visible = visible
    label.visible = visible
    this.updateTimer(label)
  }

  updateTimer(label: Label) {
    if (!this.#displaying || !this.#visible) {
      label.stop()
      return
    }
    if (label.running) return
    this.update(label)
    label.interval = clockRefreshIntervalMs
    label.start()
  }

  update(label: Label) {
    const value = formatAppBarTime(this.#data?.now() ?? new Date())
    if (value === this.#lastValue) return
    this.#lastValue = value
    label.string = value
  }
}

class BatteryBehavior extends Behavior implements BatteryBehaviorContract {
  #data?: BatteryData
  #available = false
  #displaying = false
  #segments = 0

  onCreate(_port: PiuPort, data: BatteryData) {
    this.#data = data
  }

  onDisplaying(port: PiuPort) {
    this.#displaying = true
    this.updateTimer(port)
  }

  onUndisplaying(port: PiuPort) {
    this.#displaying = false
    port.stop()
  }

  onTimeChanged(port: PiuPort) {
    this.sample(port)
  }

  onVisibilityChanged(port: PiuPort, visible: boolean) {
    if (this.#data) this.#data.visible = visible
    port.visible = visible && this.#available
    this.updateTimer(port)
  }

  updateTimer(port: PiuPort) {
    if (!this.#displaying || !this.#data?.visible || !this.#data.reader) {
      port.stop()
      return
    }
    if (port.running) return
    this.sample(port)
    port.interval = batteryRefreshIntervalMs
    port.start()
  }

  sample(port: PiuPort) {
    let level: number | undefined
    try {
      level = this.#data?.reader?.()
    } catch {
      level = undefined
    }
    const available = typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 100
    const segments = available ? batteryLevelToSegments(level as number) : 0
    const changed = available !== this.#available || segments !== this.#segments
    this.#available = available
    this.#segments = segments
    port.visible = (this.#data?.visible ?? true) && available
    if (changed) port.invalidate()
  }

  onDraw(port: PiuPort) {
    const color = UI.colors.text
    port.fillColor(color, 0, 2 * faceStatusScale, 20 * faceStatusScale, 2 * faceStatusScale)
    port.fillColor(color, 0, 12 * faceStatusScale, 20 * faceStatusScale, 2 * faceStatusScale)
    port.fillColor(color, 0, 4 * faceStatusScale, 2 * faceStatusScale, 8 * faceStatusScale)
    port.fillColor(color, 18 * faceStatusScale, 4 * faceStatusScale, 2 * faceStatusScale, 8 * faceStatusScale)
    port.fillColor(color, 20 * faceStatusScale, 6 * faceStatusScale, 3 * faceStatusScale, 4 * faceStatusScale)
    for (let index = 0; index < this.#segments; index += 1) {
      port.fillColor(
        color,
        (3 + index * 4) * faceStatusScale,
        5 * faceStatusScale,
        3 * faceStatusScale,
        6 * faceStatusScale,
      )
    }
  }
}

class EnvironmentBehavior extends Behavior implements EnvironmentBehaviorContract {
  #data?: EnvironmentData
  #displaying = false
  #left?: Label
  #center?: Label
  #right?: Label

  onCreate(container: Container, data: EnvironmentData) {
    this.#data = data
    this.#left = container.content('footerLeft') as Label
    this.#center = container.content('footerCenter') as Label
    this.#right = container.content('footerRight') as Label
  }

  onDisplaying(container: Container) {
    this.#displaying = true
    this.updateTimer(container)
  }

  onUndisplaying(container: Container) {
    this.#displaying = false
    container.stop()
  }

  onTimeChanged(_container: Container) {
    this.sample()
  }

  onVisibilityChanged(container: Container, visible: boolean) {
    if (this.#data) this.#data.visible = visible
    container.visible = visible
    this.updateTimer(container)
  }

  updateTimer(container: Container) {
    if (!this.#displaying || !this.#data?.visible || !this.#data.reader) {
      container.stop()
      return
    }
    if (container.running) return
    this.sample()
    container.interval = footerRefreshIntervalMs
    container.start()
  }

  sample() {
    let value: EnvironmentSample | undefined
    try {
      value = this.#data?.reader?.()
    } catch {
      value = undefined
    }
    if (!value) return
    if (this.#left) this.#left.string = `${Math.round(value.temperatureC)}°C`
    if (this.#center) this.#center.string = `${Math.round(value.humidityPercent)}％`
    if (this.#right) this.#right.string = `${Math.round(value.co2)}ppm`
  }
}

class ChatStatusBarBehavior extends Behavior {
  #mode: AppBarMode = { kind: 'face' }
  #state: ChatStatusBarState = ChatStatusBarState.DISCONNECTED
  #connectionPending = false
  #inputLevel = 0
  #bar?: Container
  #levelTrack?: Container
  #levelFill?: Content
  #statusIcon?: Content
  #indicator?: Content
  #menuButton?: Container
  #appsButton?: Container
  #backButton?: Container
  #title?: Label
  #clock?: Label
  #battery?: PiuPort
  #footer?: Container
  #faceBarVisible = false
  #miniAppsAvailable = false

  onCreate(container: Container) {
    const bar = container.content('bar') as Container
    this.#bar = bar
    this.#statusIcon = bar.content('statusIcon') as Content
    this.#indicator = bar.content('statusIndicator') as Content
    this.#levelTrack = bar.content('levelTrack') as Container
    this.#levelFill = this.#levelTrack?.first as Content
    this.#menuButton = bar.content('menuButton') as Container
    this.#appsButton = bar.content('appsButton') as Container
    this.#backButton = bar.content('backButton') as Container
    this.#title = bar.content('title') as Label
    this.#clock = bar.content('clock') as Label
    this.#battery = bar.content('battery') as PiuPort
    this.#footer = container.content('footer') as Container
    this.setFaceBarVisible(true)
  }

  onDisplaying(container: Container) {
    this.showFaceBar(container)
  }

  onAppBarReveal(container: Container) {
    this.showFaceBar(container)
  }

  onFinished(container: Container) {
    if (this.#mode.kind !== 'face') return
    this.setFaceBarVisible(false)
    container.stop()
  }

  onUndisplaying(container: Container) {
    this.#clock?.stop()
    this.#battery?.stop()
    this.#footer?.stop()
    this.#indicator?.stop()
    container.stop()
  }

  onAppBarMode(container: Container, mode: AppBarMode) {
    this.#mode = mode
    const faceMode = mode.kind === 'face'
    const skins = getSkins()
    if (this.#bar) this.#bar.skin = faceMode ? skins.bar : skins.chrome
    if (this.#title) {
      this.#title.string = faceMode ? '' : mode.title
      this.#title.visible = !faceMode
    }
    setControlVisible(this.#backButton, !faceMode)
    if (faceMode) this.showFaceBar(container)
    else {
      this.#faceBarVisible = false
      container.visible = true
      this.updateFaceActions()
      container.stop()
      this.updateUI()
    }
  }

  onMiniAppAvailability(_container: Container, available: boolean) {
    this.#miniAppsAvailable = available
    this.updateFaceActions()
  }

  onChatState(_container: Container, state: ChatStatusBarState, _error?: string) {
    this.#state = state
    this.updateUI()
  }

  onChatInputLevel(_container: Container, level: number) {
    this.#inputLevel = level
    this.updateLevel()
  }

  onConnectionIndicator(_container: Container, visible: boolean) {
    if (this.#connectionPending === visible) return
    this.#connectionPending = visible
    this.updateUI()
  }

  updateUI() {
    if (!this.#levelTrack || !this.#levelFill || !this.#statusIcon || !this.#indicator) return
    const faceMode = this.#mode.kind === 'face'
    const faceChromeVisible = faceMode && this.#faceBarVisible
    // ChatAudioIO.SPEAKING means user input.
    const isUserSpeaking = this.#state === ChatStatusBarState.SPEAKING
    const isConnecting = this.#state === ChatStatusBarState.CONNECTING || this.#connectionPending
    const persistentInputVisible = faceMode && !faceChromeVisible && isUserSpeaking && !isConnecting
    const faceStatusVisible = faceChromeVisible || persistentInputVisible
    const skins = getSkins()
    if (this.#bar) {
      this.#bar.visible = !faceMode || faceStatusVisible
      this.#bar.skin = !faceMode || faceChromeVisible ? skins.chrome : skins.bar
    }
    const clockBehavior = this.#clock?.behavior as ClockBehaviorContract | undefined
    if (this.#clock) clockBehavior?.onVisibilityChanged(this.#clock, faceChromeVisible)
    const batteryBehavior = this.#battery?.behavior as BatteryBehaviorContract | undefined
    if (this.#battery) batteryBehavior?.onVisibilityChanged(this.#battery, faceChromeVisible)
    const environmentBehavior = this.#footer?.behavior as EnvironmentBehaviorContract | undefined
    if (this.#footer) environmentBehavior?.onVisibilityChanged(this.#footer, faceChromeVisible)
    if (!faceStatusVisible) {
      this.#levelTrack.visible = false
      this.#statusIcon.visible = false
      this.#indicator.visible = false
      this.#indicator.stop()
      return
    }
    // The face AppBar owns the top-left system area while it is visible. Once
    // its four-second reveal ends, input status replaces it at the natural
    // left edge instead of remaining shifted beside an absent battery icon.
    this.#levelTrack.visible = persistentInputVisible
    this.#statusIcon.visible = persistentInputVisible
    this.#statusIcon.state = 0
    this.#indicator.visible = faceChromeVisible && isConnecting
    if (this.#indicator.visible) {
      this.#indicator.interval = 250
      this.#indicator.time = 0
      this.#indicator.start()
    } else {
      this.#indicator.stop()
      this.#indicator.variant = 0
    }
    this.#levelFill.skin = this.#state === ChatStatusBarState.FAILED ? skins.errorFill : skins.levelFill
    this.updateLevel()
  }

  updateLevel() {
    if (!this.#levelTrack || !this.#levelFill) return
    const ratio = Math.min(Math.max(this.#inputLevel / 2000, 0), 1)
    const height = Math.round(levelHeight * ratio)
    if (this.#levelFill.height === height) return
    this.#levelFill.height = height
  }

  showFaceBar(container: Container) {
    if (this.#mode.kind !== 'face') return
    this.setFaceBarVisible(true)
    container.stop()
    container.duration = FACE_ACTIONS_VISIBLE_MS
    container.time = 0
    container.start()
  }

  setFaceBarVisible(visible: boolean) {
    this.#faceBarVisible = visible && this.#mode.kind === 'face'
    this.updateFaceActions()
    this.updateUI()
  }

  updateFaceActions() {
    const faceActionsVisible = this.#faceBarVisible && this.#mode.kind === 'face'
    setControlVisible(this.#menuButton, faceActionsVisible)
    if (this.#appsButton) {
      const appsVisible = faceActionsVisible && this.#miniAppsAvailable
      setControlVisible(this.#appsButton, appsVisible)
    }
  }
}

export const ChatStatusBar = Container.template((options: ChatStatusBarOptions = {}) => {
  const skins = getSkins()
  const styles = uiStyles()
  const footerStyles = getFooterStyles()
  const statusIconLeft = defaultIconLeft
  const indicatorLeft = options.readBatteryLevel ? batteryStatusIconLeft : defaultIconLeft
  const levelLeft = statusIconLeft + iconSize + 4
  return {
    name: 'ChatStatusBar',
    anchor: 'APP_BAR',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    active: false,
    contents: [
      new Container(null, {
        name: 'bar',
        left: 0,
        right: 0,
        top: 0,
        height: barHeight,
        skin: skins.bar,
        contents: [
          new ActionButton(
            {
              name: 'backButton',
              icon: 'back',
              action: 'onMiniAppBack',
              enabled: true,
            },
            { left: 0, top: 0, width: 44, height: 44, visible: false, active: false },
          ),
          new Label(null, {
            name: 'title',
            left: 48,
            right: 12,
            top: 0,
            bottom: 0,
            visible: false,
            string: '',
            style: styles.title,
          }),
          new Port(
            {
              reader: options.readBatteryLevel,
              visible: true,
            } satisfies BatteryData,
            {
              name: 'battery',
              left: batteryIconLeft,
              top: batteryIconTop,
              width: batteryIconWidth,
              height: batteryIconHeight,
              active: false,
              visible: false,
              Behavior: BatteryBehavior,
            },
          ),
          new Label(
            {
              now: options.now ?? (() => new Date()),
            } satisfies ClockData,
            {
              name: 'clock',
              left: clockLeft,
              top: 0,
              width: clockWidth,
              bottom: 0,
              active: false,
              string: '--:--',
              style: styles.brand,
              Behavior: ClockBehavior,
            },
          ),
          new Content(null, {
            name: 'statusIcon',
            left: statusIconLeft,
            top: iconTop,
            width: iconSize,
            height: iconSize,
            skin: skins.microphone,
            state: 0,
            visible: false,
          }),
          new Content(null, {
            name: 'statusIndicator',
            left: indicatorLeft,
            top: iconTop,
            width: iconSize,
            height: iconSize,
            skin: skins.indicator,
            variant: 0,
            // Piu Content hit testing follows `active` even while `visible` is false.
            // The indicator is never interactive and must not cover the Back button.
            active: false,
            visible: false,
            Behavior: IndicatorBehavior,
          }),
          new Container(null, {
            name: 'levelTrack',
            left: levelLeft,
            top: iconTop,
            width: levelWidth,
            height: levelHeight,
            skin: skins.levelTrack,
            contents: [
              new Content(null, {
                left: 0,
                bottom: 0,
                width: levelWidth,
                height: 0,
                skin: skins.levelFill,
              }),
            ],
          }),
          new ActionButton(
            {
              name: 'appsButton',
              icon: 'apps',
              action: 'onMiniAppLauncher',
              enabled: true,
            },
            { right: 44, top: 0, width: 44, height: 44, visible: false, active: false },
          ),
          new ActionButton(
            {
              name: 'menuButton',
              icon: 'menu',
              action: 'onDrawerToggle',
            },
            { right: 0, top: 0, width: 44, height: 44 },
          ),
        ],
      }),
      new Container(
        {
          reader: options.readEnvironment,
          visible: true,
        } satisfies EnvironmentData,
        {
          name: 'footer',
          left: 0,
          right: 0,
          bottom: 0,
          height: footerHeight,
          active: false,
          visible: false,
          contents: [
            new Label(null, {
              name: 'footerLeft',
              left: footerPadding,
              width: footerColumnWidth,
              bottom: 0,
              height: footerHeight,
              string: '',
              style: footerStyles.left,
            }),
            new Label(null, {
              name: 'footerCenter',
              left: 0,
              right: 0,
              bottom: 0,
              height: footerHeight,
              string: '',
              style: footerStyles.center,
            }),
            new Label(null, {
              name: 'footerRight',
              right: footerPadding,
              width: footerColumnWidth,
              bottom: 0,
              height: footerHeight,
              string: '',
              style: footerStyles.right,
            }),
          ],
          Behavior: EnvironmentBehavior,
        },
      ),
    ],
    Behavior: ChatStatusBarBehavior,
  }
})
