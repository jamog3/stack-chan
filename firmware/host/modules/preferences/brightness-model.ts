// Kept in sync with the AXP2101 default in
// host/modules/power/platforms/axp2101-power-capture.js (DEFAULT_BRIGHTNESS_PERCENT).
export const DEFAULT_BRIGHTNESS_PERCENT = 15
export const MIN_BRIGHTNESS_PERCENT = 1
export const MAX_BRIGHTNESS_PERCENT = 100

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function finiteBrightnessNumber(value: unknown): number | undefined {
  const candidate = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined
}

export function normalizeBrightness(value: unknown, fallback = DEFAULT_BRIGHTNESS_PERCENT): number {
  const normalizedFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? clamp(Math.round(fallback), MIN_BRIGHTNESS_PERCENT, MAX_BRIGHTNESS_PERCENT)
      : DEFAULT_BRIGHTNESS_PERCENT
  const numericValue = finiteBrightnessNumber(value)
  return numericValue === undefined
    ? normalizedFallback
    : clamp(Math.round(numericValue), MIN_BRIGHTNESS_PERCENT, MAX_BRIGHTNESS_PERCENT)
}

export type BrightnessPreferenceResolution = Readonly<{
  brightness: number
  storageValue: string
  needsWrite: boolean
}>

export function resolveBrightnessPreference(
  value: unknown,
  fallback = DEFAULT_BRIGHTNESS_PERCENT,
): BrightnessPreferenceResolution {
  const brightness = normalizeBrightness(value, fallback)
  const storageValue = String(brightness)
  return {
    brightness,
    storageValue,
    needsWrite: typeof value !== 'string' || storageValue !== value,
  }
}
