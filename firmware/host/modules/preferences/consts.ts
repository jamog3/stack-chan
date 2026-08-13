export const DOMAIN = {
  wifi: 'wifi',
  driver: 'driver',
  ui: 'ui',
  tts: 'tts',
  ai: 'ai',
  led: 'led',
  mcp: 'mcp',
  time: 'time',
  calendar: 'calendar',
} as const

export const PREF_KEYS: readonly [keyof typeof DOMAIN, string, StringConstructor | NumberConstructor][] = Object.freeze(
  [
    [DOMAIN.wifi, 'ssid', String],
    [DOMAIN.wifi, 'password', String],
    [DOMAIN.ui, 'type', String],
    [DOMAIN.ui, 'language', String],
    [DOMAIN.driver, 'type', String],
    [DOMAIN.driver, 'baudrate', Number],
    [DOMAIN.driver, 'offsetPan', Number],
    [DOMAIN.driver, 'offsetTilt', Number],
    [DOMAIN.tts, 'type', String],
    [DOMAIN.tts, 'host', String],
    [DOMAIN.tts, 'port', Number],
    [DOMAIN.tts, 'token', String],
    [DOMAIN.tts, 'volume', Number],
    [DOMAIN.tts, 'voice', String],
    [DOMAIN.tts, 'speed', Number],
    [DOMAIN.ai, 'token', String],
    [DOMAIN.ai, 'context', String],
    [DOMAIN.mcp, 'token', String],
    [DOMAIN.time, 'timezone', String],
    [DOMAIN.calendar, 'clientId', String],
    [DOMAIN.calendar, 'clientSecret', String],
    // JSON-encoded CalendarAccount[] (see host/modules/calendar/google-calendar.ts): one
    // entry per Google account, each with its own refreshToken and calendarIds. A single
    // Preference string is used because PREF_KEYS/Preference only support flat values.
    [DOMAIN.calendar, 'accounts', String],
  ],
  true,
)

export const DEFAULT_FONT = 'OpenSans-Regular-24.bf4'
