/**
 * No-op default. Platforms with a controllable backlight (e.g. AXP2101-based
 * boards) override this module via host/modules/power/manifest.json.
 */
export function setBacklightPercent(_percent: number): void {}
