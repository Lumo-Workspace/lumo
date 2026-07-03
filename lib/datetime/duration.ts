import type { IntlShape } from 'react-intl'

/**
 * Localized elapsed-duration formatting (LUM-642). One source for every
 * user-facing duration so the units ride the `duration.*` i18n keys instead
 * of hardcoded Latin suffixes ("2h 14m") — the same move LUM-638 made for
 * riskQueue aging. In `en` the output is byte-identical to the previous
 * per-component formatters, so the default-locale rendering (and the tests
 * pinning it) does not shift.
 */

const hoursPart = (intl: IntlShape, hours: number) =>
  intl.formatMessage({ id: 'duration.hours' }, { hours })
const minutesPart = (intl: IntlShape, minutes: number) =>
  intl.formatMessage({ id: 'duration.minutes' }, { minutes })
const secondsPart = (intl: IntlShape, seconds: number) =>
  intl.formatMessage({ id: 'duration.seconds' }, { seconds })

/** Active (non-idle) seconds → a compact "2h 14m" / "3m 5s" / "12s"; 0 → "0s". */
export function formatDurationSec(intl: IntlShape, totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec))
  if (sec === 0) return secondsPart(intl, 0)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const parts: string[] = []
  if (h > 0) parts.push(hoursPart(intl, h))
  if (m > 0) parts.push(minutesPart(intl, m))
  if (s > 0 && h === 0) parts.push(secondsPart(intl, s))
  return parts.join(' ')
}

/** Millisecond duration → "999ms" / "59s" / "294m" / "294m 52s" (minutes never
 *  roll up into hours — run durations keep the flat-minutes read). */
export function formatDurationMs(intl: IntlShape, ms: number): string {
  if (ms < 1000)
    return intl.formatMessage({ id: 'duration.milliseconds' }, { ms })
  const sec = Math.round(ms / 1000)
  if (sec < 60) return secondsPart(intl, sec)
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem === 0
    ? minutesPart(intl, min)
    : `${minutesPart(intl, min)} ${secondsPart(intl, rem)}`
}
