import loadPreferences from 'loadPreference'
import { DOMAIN } from 'consts'
import type { CalendarAccount } from 'google-calendar'
import { fetchUpcomingEvents } from 'google-calendar'
import type { Maybe } from 'stackchan-util'
import Timer from 'timer'

const CALENDAR_LOOKAHEAD_MS = 24 * 60 * 60 * 1000
const CALENDAR_REMINDER_LEAD_MS = 30 * 60 * 1000
const CALENDAR_REMINDER_TEXT = '30分後に予定があります。'

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

// Parses the JSON-encoded CalendarAccount[] preference, discarding malformed entries
// rather than failing the whole schedule (one bad account shouldn't block the rest).
function parseCalendarAccounts(json: string | undefined): CalendarAccount[] {
  if (!json) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    trace(`[Calendar] accounts preference is not valid JSON: ${errorMessage(error)}\n`)
    return []
  }
  if (!Array.isArray(parsed)) return []
  const accounts: CalendarAccount[] = []
  for (const entry of parsed) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { refreshToken?: unknown }).refreshToken === 'string' &&
      Array.isArray((entry as { calendarIds?: unknown }).calendarIds)
    ) {
      const { refreshToken, calendarIds } = entry as { refreshToken: string; calendarIds: unknown[] }
      const ids = calendarIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (ids.length > 0) accounts.push({ refreshToken, calendarIds: ids })
    }
  }
  return accounts
}

// On startup, fetches the next 24h of events across all configured Google accounts/calendars
// and schedules a spoken reminder 30 minutes before each one starts; refreshes on the same 24h
// cadence so reminders keep working past the first day. `target.audio.say` is used for the
// reminder (not a fixed bundled voice) since it isn't a scheduled system announcement like the
// hourly time signal.
export function startCalendarReminders(target: { audio: { say: (text: string) => Promise<Maybe<string>> } }) {
  const calendarPreferences = loadPreferences(DOMAIN.calendar) as {
    clientId?: string
    clientSecret?: string
    accounts?: string
  }
  let reminderTimers: ReturnType<typeof Timer.set>[] = []
  const clearReminders = () => {
    for (const timer of reminderTimers) Timer.clear(timer)
    reminderTimers = []
  }
  const announceReminder = async () => {
    try {
      const result = await target.audio.say(CALENDAR_REMINDER_TEXT)
      if ('reason' in result && result.reason) trace(`[Calendar] say error ${result.reason}\n`)
    } catch (error) {
      trace(`[Calendar] say error ${errorMessage(error)}\n`)
    }
  }
  const scheduleReminders = async () => {
    const { clientId, clientSecret, accounts: accountsJson } = calendarPreferences
    const accounts = parseCalendarAccounts(accountsJson)
    clearReminders()
    if (!clientId || !clientSecret || accounts.length === 0) {
      trace('[Calendar] not configured; skipping reminder scheduling\n')
      return
    }
    try {
      const now = new Date()
      const events = await fetchUpcomingEvents(
        { clientId, clientSecret, accounts },
        now,
        new Date(now.getTime() + CALENDAR_LOOKAHEAD_MS),
      )
      for (const event of events) {
        const delay = event.start.getTime() - CALENDAR_REMINDER_LEAD_MS - Date.now()
        if (delay <= 0) continue
        reminderTimers.push(Timer.set(() => void announceReminder(), delay))
      }
      trace(`[Calendar] scheduled ${reminderTimers.length} reminder(s) from ${events.length} event(s)\n`)
    } catch (error) {
      trace(`[Calendar] fetch error ${errorMessage(error)}\n`)
    }
  }
  // Deferred via Timer.set rather than called directly: this function is invoked from deep
  // inside onContextCreated's own (already deep) synchronous call chain at boot, and running
  // the fetch/URL-parsing chain synchronously on top of that stack overflowed XS's JS stack in
  // testing. Timer.set hands the async work a fresh call stack instead (same reason the hourly
  // time signal defers its first run via Timer.set rather than calling announceHour directly).
  Timer.set(() => void scheduleReminders(), 0)
  Timer.repeat(() => void scheduleReminders(), CALENDAR_LOOKAHEAD_MS)
}
