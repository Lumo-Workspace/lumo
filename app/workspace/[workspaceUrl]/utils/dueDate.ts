/**
 * Format a due date for display.
 * Returns: "Today", "Tomorrow", "Apr 10", "Apr 10, 2027", or "" if null.
 */
export function formatDueDate(
  date: string | null | undefined,
  locale: string = 'en',
  messages?: { today?: string; tomorrow?: string }
): string {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()

  const todayLabel = messages?.today ?? 'Today'
  const tomorrowLabel = messages?.tomorrow ?? 'Tomorrow'

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(d, now)) return todayLabel

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameDay(d, tomorrow)) return tomorrowLabel

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }

  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Returns true if the given due date is strictly before today.
 */
export function isOverdue(date: string | null | undefined): boolean {
  if (!date) return false
  const d = new Date(date)
  const today = new Date()
  d.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}
