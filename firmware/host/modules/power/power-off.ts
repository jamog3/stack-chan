/**
 * No-op default. Platforms with a power-management IC that can cut power to
 * the whole board (e.g. AXP2101-based boards) override this module via the
 * subplatform manifest (mirroring set-backlight.ts).
 */
export function powerOff(): void {}
