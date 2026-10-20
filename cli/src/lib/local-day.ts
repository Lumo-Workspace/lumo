/**
 * LUM-821: calendar days ↔ instants for due dates.
 *
 * The web DueDatePicker stores a due date as the author's LOCAL midnight
 * (`new Date(y, m, d).toISOString()`), so the CLI must do the same in the
 * shell's timezone — writing, filtering and displaying — or a UTC+8 user's
 * "Sep 30" would read back as Sep 29.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Local midnight of YYYY-MM-DD (+plusDays) as an ISO instant; null if invalid. */
export function localDayStart(day: string, plusDays = 0): string | null {
  const m = DAY_RE.exec(day)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  // Round-trip: rejects Feb 31 and friends, which Date silently rolls over.
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return null
  }
  date.setDate(date.getDate() + plusDays)
  return date.toISOString()
}

/** The local calendar day (YYYY-MM-DD) an ISO instant falls on. */
export function localDayLabel(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * LUM-1285: is `day` a real calendar day `YYYY-MM-DD`? Zone-free (the value is
 * stored as that UTC day, like milestone dates), so no local conversion.
 */
export function isCalendarDay(day: string): boolean {
  const m = DAY_RE.exec(day)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  )
}
