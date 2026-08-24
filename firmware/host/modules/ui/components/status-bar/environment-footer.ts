import { Container, Label, Style } from 'piu/MC'
import { UI } from 'ui-theme'

const footerHeight = 48
const footerPadding = 8
const footerColumnWidth = 140
const footerRefreshIntervalMs = 5000

// Fixed at 2x the body font size (matching the clock's k8x12-24), independent of
// locale: the digits/°/％/p/m glyphs footer text needs don't require localization,
// and no CJK variant of this larger size exists.
const footerFont = 'k8x12-24'

export type EnvironmentSample = Readonly<{
  temperatureC: number
  humidityPercent: number
  co2: number
}>

export type EnvironmentReader = () => EnvironmentSample | undefined

export type EnvironmentFooterOptions = Readonly<{
  reader?: EnvironmentReader
}>

export type EnvironmentFooterContract = {
  onVisibilityChanged(container: Container, visible: boolean): void
}

type EnvironmentData = {
  reader?: EnvironmentReader
  visible: boolean
}

type FooterStyles = {
  left: InstanceType<typeof Style>
  center: InstanceType<typeof Style>
  right: InstanceType<typeof Style>
}

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

class EnvironmentFooterBehavior extends Behavior implements EnvironmentFooterContract {
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

// Standalone container, not a Container.template: chat-status-bar composes it as a
// single sibling content so upstream churn there stays a one-line diff.
export function createEnvironmentFooter(options: EnvironmentFooterOptions = {}): Container {
  const footerStyles = getFooterStyles()
  return new Container(
    {
      reader: options.reader,
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
      Behavior: EnvironmentFooterBehavior,
    },
  )
}
