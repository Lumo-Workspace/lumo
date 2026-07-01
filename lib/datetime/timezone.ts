/** Pure timezone-aware calendar math using native Intl. No external deps. */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Milliseconds to add to a UTC instant to get the wall-clock time in `timeZone`. */
function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = Object.fromEntries(
    dtf.formatToParts(at).map(part => [part.type, part.value])
  ) as Record<string, string>
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  )
  return asUTC - at.getTime()
}

/** Wall-clock Y/M/D of `instant` as seen in `timeZone`. */
function zonedYmd(
  instant: Date,
  timeZone: string
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const p = Object.fromEntries(
    dtf.formatToParts(instant).map(part => [part.type, part.value])
  ) as Record<string, string>
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) }
}

/** UTC instant of local 00:00 for the given wall-clock calendar day in `timeZone`. */
function zonedMidnightFromYmd(
  year: number,
  month: number,
  day: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0)
  const offset = tzOffsetMs(timeZone, new Date(guess))
  return new Date(guess - offset)
}

export function zonedWeekday(instant: Date, timeZone: string): number {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(instant)
  return WEEKDAYS.indexOf(wd as (typeof WEEKDAYS)[number])
}

export function zonedMidnight(instant: Date, timeZone: string): Date {
  const { year, month, day } = zonedYmd(instant, timeZone)
  return zonedMidnightFromYmd(year, month, day, timeZone)
}

export function addZonedDays(
  instant: Date,
  days: number,
  timeZone: string
): Date {
  const { year, month, day } = zonedYmd(instant, timeZone)
  // Normalize calendar overflow via a UTC scratch date, then re-anchor in-zone.
  const cal = new Date(Date.UTC(year, month - 1, day + days))
  return zonedMidnightFromYmd(
    cal.getUTCFullYear(),
    cal.getUTCMonth() + 1,
    cal.getUTCDate(),
    timeZone
  )
}

export function nextZonedWeekdayMidnight(
  from: Date,
  weekday: number,
  timeZone: string
): Date {
  const base = zonedMidnight(from, timeZone)
  const delta = (weekday - zonedWeekday(base, timeZone) + 7) % 7
  return addZonedDays(base, delta, timeZone)
}
