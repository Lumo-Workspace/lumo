/**
 * Format a timestamp according to the app's display rules:
 *  < 1 min         → "just now"
 *  1–59 min        → "23m ago"
 *  same day        → "Today 2:23 PM"
 *  yesterday       → "Yesterday"
 *  this year       → "Mar 21"
 *  older           → "Mar 21, 2025"
 */
export function formatTimestamp(
  date: Date | string,
  locale: string = 'en',
  messages?: {
    justNow?: string
    mAgo?: (m: number) => string
    today?: string
    yesterday?: string
  }
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffMs / 60000)

  const justNow = messages?.justNow ?? 'just now'
  const mAgo = messages?.mAgo ?? ((m: number) => `${m}m ago`)
  const todayLabel = messages?.today ?? 'Today'
  const yesterdayLabel = messages?.yesterday ?? 'Yesterday'

  if (diffSec < 60) return justNow
  if (diffMin < 60) return mAgo(diffMin)

  const sameDate = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDate(d, now)) {
    const time = d.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
    })
    return `${todayLabel} ${time}`
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDate(d, yesterday)) return yesterdayLabel

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }

  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
