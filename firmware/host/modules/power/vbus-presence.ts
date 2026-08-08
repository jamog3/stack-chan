/**
 * No-op default. Platforms with a power-management IC that reports VBUS
 * presence (e.g. AXP2101-based boards) override this module via the
 * subplatform manifest (mirroring set-backlight.ts).
 */
export function isVbusPresent(): boolean | undefined {
  return undefined
}
