import loadPreferences from 'loadPreference'
import { DOMAIN } from 'consts'
import type { CalendarAccount } from 'google-calendar'
import { fetchUpcomingEvents } from 'google-calendar'
import Timer from 'timer'
import { TTS as LocalTTS } from 'tts-local'
import { canonicalizeVolume } from 'volume-model'

const CALENDAR_LOOKAHEAD_MS = 24 * 60 * 60 * 1000

// Each reminder fires once per event, `leadMs` before its start. `parts` are keys into the
// bundled speech-parts resources (see scripts/speeches/speeches_speech_parts.js) — the same
// pre-generated VOICEVOX Zundamon voice the hourly time signal uses, independent of whatever
// config.tts is set to.
const REMINDERS: { leadMs: number; parts: string[] }[] = [
  { leadMs: 30 * 60 * 1000, parts: ['calendarReminder30Min'] },
  { leadMs: 1 * 60 * 1000, parts: ['calendarReminder1Min'] },
]

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

export type CalendarReminderHooks = {
  // Called right before a reminder starts speaking, and once it's done. The caller wires
  // these to the same wake/sleep motions used elsewhere (the top-touch wake motion and the
  // hourly time signal's sleep transition), so a reminder firing looks the same as those.
  // onReminderStart is awaited before speech begins, so the look-up motion finishes first.
  onReminderStart?: () => Promise<void> | void
  onReminderEnd?: () => void
}

// On startup, fetches the next 24h of events across all configured Google accounts/calendars
// and schedules the reminders in REMINDERS for each one; refreshes on the same 24h cadence so
// reminders keep working past the first day.
export function startCalendarReminders(
  target: { setMouthOpen: (value: number) => void },
  hooks: CalendarReminderHooks = {},
) {
  const calendarPreferences = loadPreferences(DOMAIN.calendar) as {
    clientId?: string
    clientSecret?: string
    accounts?: string
  }
  // Mirrors the hourly time signal's setup (on-context-created.ts): a dedicated LocalTTS
  // instance bundled with pre-generated Zundamon audio, independent of config.tts, with the
  // onPlayed/onDone wiring reproduced here since this TTS instance bypasses robot.audio.
  const volume = canonicalizeVolume(loadPreferences(DOMAIN.tts).volume)
  const reminderTTS = new LocalTTS({
    sampleRate: 24000,
    volume,
    onPlayed: (playedVolume) => target.setMouthOpen(playedVolume === 0 ? 0 : Math.min(playedVolume / 2000, 1.0)),
    onDone: () => target.setMouthOpen(0),
  })
  let reminderTimers: ReturnType<typeof Timer.set>[] = []
  const clearReminders = () => {
    for (const timer of reminderTimers) Timer.clear(timer)
    reminderTimers = []
  }
  const announceReminder = async (parts: string[]) => {
    try {
      await hooks.onReminderStart?.()
      await reminderTTS.playSequence(parts)
    } catch (error) {
      trace(`[Calendar] say error ${errorMessage(error)}\n`)
    } finally {
      hooks.onReminderEnd?.()
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
        for (const reminder of REMINDERS) {
          const delay = event.start.getTime() - reminder.leadMs - Date.now()
          if (delay <= 0) continue
          reminderTimers.push(Timer.set(() => void announceReminder(reminder.parts), delay))
        }
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
