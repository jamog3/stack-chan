import { fetch } from 'fetch'
import Headers from 'headers'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const EVENTS_URL_BASE = 'https://www.googleapis.com/calendar/v3/calendars/'

export type CalendarEvent = {
  calendarId: string
  summary: string
  start: Date
}

// A single Google account authorized against the shared OAuth client below, with the
// set of calendar IDs (in that account) to fetch. Different Google accounts issue
// unrelated refreshTokens even when authorized through the same clientId/clientSecret,
// so each account needs its own entry.
export type CalendarAccount = {
  refreshToken: string
  calendarIds: string[]
}

export type GoogleCalendarConfig = {
  clientId: string
  clientSecret: string
  accounts: CalendarAccount[]
}

async function readJson(response: { status: number; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<unknown> {
  if (2 !== Math.idiv(response.status, 100)) {
    throw new Error(`http request failed, status ${response.status}`)
  }
  return JSON.parse(String.fromArrayBuffer(await response.arrayBuffer()))
}

async function getAccessToken(
  config: Pick<GoogleCalendarConfig, 'clientId' | 'clientSecret'>,
  refreshToken: string,
): Promise<string> {
  const body = [
    `client_id=${encodeURIComponent(config.clientId)}`,
    `client_secret=${encodeURIComponent(config.clientSecret)}`,
    `refresh_token=${encodeURIComponent(refreshToken)}`,
    'grant_type=refresh_token',
  ].join('&')
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: new Headers([['Content-Type', 'application/x-www-form-urlencoded']]),
    body,
  })
  const json = (await readJson(response)) as { access_token?: string }
  if (!json.access_token) throw new Error('token refresh response missing access_token')
  return json.access_token
}

async function fetchCalendarEvents(
  calendarId: string,
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
): Promise<CalendarEvent[]> {
  const url =
    `${EVENTS_URL_BASE}${encodeURIComponent(calendarId)}/events` +
    `?timeMin=${encodeURIComponent(timeMin.toISOString())}` +
    `&timeMax=${encodeURIComponent(timeMax.toISOString())}` +
    '&singleEvents=true&orderBy=startTime'
  const response = await fetch(url, {
    method: 'GET',
    headers: new Headers([['Authorization', `Bearer ${accessToken}`]]),
  })
  const json = (await readJson(response)) as {
    items?: { summary?: string; start?: { dateTime?: string } }[]
  }
  const items = json.items ?? []
  const events: CalendarEvent[] = []
  for (const item of items) {
    // All-day events only carry a `date` (no `dateTime`); they have no specific
    // start time to count a 30-minute lead-time from, so they're skipped.
    if (!item.start?.dateTime) continue
    events.push({
      calendarId,
      summary: item.summary ?? '',
      start: new Date(item.start.dateTime),
    })
  }
  return events
}

// Fetches events across every calendar of every configured account in the
// [timeMin, timeMax) window and returns them merged and sorted by start time.
export async function fetchUpcomingEvents(
  config: GoogleCalendarConfig,
  timeMin: Date,
  timeMax: Date,
): Promise<CalendarEvent[]> {
  const perAccount = await Promise.all(
    config.accounts.map(async (account) => {
      const accessToken = await getAccessToken(config, account.refreshToken)
      const perCalendar = await Promise.all(
        account.calendarIds.map((calendarId) => fetchCalendarEvents(calendarId, accessToken, timeMin, timeMax)),
      )
      return perCalendar.flat()
    }),
  )
  return perAccount.flat().sort((a, b) => a.start.getTime() - b.start.getTime())
}
