import { getAxp2101Power } from 'axp2101-power-capture'

// LCD backlight is driven by DLDO1 (AXP2101). Register map mirrors
// host/platforms/m5stackchan_cores3/setup-target.js:
// - 0x90 bit 0x80 is the DLDO1 rail enable (power fully off when clear).
// - 0x99 holds the brightness level, 1-100% mapped to 20-28.
const DLDO1_ENABLE_BIT = 0x80
const BACKLIGHT_ENABLE_REGISTER = 0x90
const BACKLIGHT_LEVEL_REGISTER = 0x99
const BACKLIGHT_LEVEL_MIN_REGISTER_VALUE = 20
const BACKLIGHT_LEVEL_RANGE = 8

export function setBacklightPercent(percent: number): void {
  const axp2101 = getAxp2101Power()
  if (!axp2101) return

  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const enableByte = axp2101.readByte(BACKLIGHT_ENABLE_REGISTER)
  if (clamped === 0) {
    axp2101.writeByte(BACKLIGHT_ENABLE_REGISTER, enableByte & ~DLDO1_ENABLE_BIT)
    return
  }

  axp2101.writeByte(BACKLIGHT_ENABLE_REGISTER, enableByte | DLDO1_ENABLE_BIT)
  axp2101.writeByte(
    BACKLIGHT_LEVEL_REGISTER,
    BACKLIGHT_LEVEL_MIN_REGISTER_VALUE + Math.floor((clamped * BACKLIGHT_LEVEL_RANGE) / 100),
  )
}
