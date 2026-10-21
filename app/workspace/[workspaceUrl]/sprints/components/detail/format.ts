import type { IntlShape } from 'react-intl'

const HOUR = 3600
const DAY = 86400

/**
 * A wait as one coarse unit — "40 min", "26 hours", "3 days". Waits are neutral
 * facts (product ruling), so this only picks a readable unit; colour and
 * emphasis are never derived from it.
 */
export function formatWait(intl: IntlShape, sec: number): string {
  const s = Math.max(0, sec)
  if (s < HOUR)
    return intl.formatMessage(
      { id: 'sprints.detail.wait.minutes' },
      { count: Math.max(1, Math.floor(s / 60)) }
    )
  if (s < 2 * DAY)
    return intl.formatMessage(
      { id: 'sprints.detail.wait.hours' },
      { count: Math.floor(s / HOUR) }
    )
  return intl.formatMessage(
    { id: 'sprints.detail.wait.days' },
    { count: Math.floor(s / DAY) }
  )
}

/** A median dwell in days with one decimal ("1.2"). */
export function formatDwellDays(intl: IntlShape, sec: number): string {
  return intl.formatNumber(sec / DAY, { maximumFractionDigits: 1 })
}

/**
 * A stored stage median (ms) as one unit: minutes or hours under a day, then
 * days with one decimal ("0.9 days" never reads as "21 hours" twice). Neutral
 * text only — no tone derived from the value.
 */
export function formatStageMedian(intl: IntlShape, ms: number): string {
  const s = Math.max(0, ms / 1000)
  if (s < DAY) return formatWait(intl, s)
  return intl.formatMessage(
    { id: 'sprints.detail.retro.stages.days' },
    // A number (not a preformatted string) so plural rules can pick the form.
    { days: Math.round((s / DAY) * 10) / 10 }
  )
}
