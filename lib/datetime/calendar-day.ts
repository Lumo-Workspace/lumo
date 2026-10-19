/**
 * Calendar-day keys (`YYYY-MM-DD`) ↔ the local-midnight `Date` a calendar
 * widget works with. Milestone and audit-log dates are calendar days, not
 * moments: the API takes the key and stores it as UTC midnight. The picker
 * shows days in the viewer's zone, so the round-trip goes through local
 * components on both sides — never `toISOString()`, which would shift the day
 * by the viewer's UTC offset.
 */

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})/

/** `2026-06-01` (or a full ISO string) → local midnight of Jun 1. */
export function dayKeyToLocalDate(
  key: string | null | undefined
): Date | undefined {
  const m = key ? DAY_KEY.exec(key) : null
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** A day picked in the viewer's zone → its `YYYY-MM-DD` key. */
export function localDateToDayKey(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
