import type { IntlShape } from 'react-intl'

/**
 * Localized relative-time ("ago") formatting (LUM-642). Two tiers, one file:
 *
 * - `formatRelativeAgo` — the compact card label ("5m ago" / "2h ago" /
 *   "3d ago") on the `time.justNow` / `time.mAgo` / `time.hAgo` / `time.dAgo`
 *   keys, replacing the per-card hardcoded-English copies. `now` is required
 *   so call sites stay render-pure (feed it from `useNow()`).
 * - `formatRelativeTime` — the documents-surface label backed by
 *   `Intl.RelativeTimeFormat` (locale-native, no keys), with a short-date
 *   fallback past a week. Deduplicates the DocumentsPage/DocumentEditorPage
 *   copies; the <60s branch is pinned to the "now"-style label.
 */

/** Compact "Xm ago"-shape label via `time.*` i18n keys. */
export function formatRelativeAgo(
  intl: IntlShape,
  date: Date | string,
  now: number
): string {
  const t = (typeof date === 'string' ? new Date(date) : date).getTime()
  const diffMin = Math.max(0, Math.round((now - t) / 60000))
  if (diffMin < 1) return intl.formatMessage({ id: 'time.justNow' })
  if (diffMin < 60)
    return intl.formatMessage({ id: 'time.mAgo' }, { m: diffMin })
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return intl.formatMessage({ id: 'time.hAgo' }, { h: diffH })
  return intl.formatMessage({ id: 'time.dAgo' }, { d: Math.round(diffH / 24) })
}

/** Locale-native relative label ("5 minutes ago" / "现在"), short date past a week. */
export function formatRelativeTime(
  dateStr: string,
  locale: string = 'en'
): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (diffSec < 60) return rtf.format(0, 'second')
  const diffMins = Math.floor(diffSec / 60)
  if (diffMins < 60) return rtf.format(-diffMins, 'minute')
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return rtf.format(-diffHours, 'hour')
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return rtf.format(-diffDays, 'day')
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  })
}
