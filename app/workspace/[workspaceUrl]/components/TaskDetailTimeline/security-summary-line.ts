import type { IntlShape } from 'react-intl'
import type { TaskSecurityScans } from '@/lib/services/pr-security-scan.service'
import { summarizeSecurityScans } from './security-summary'

/**
 * The security scan's one-line rollup ("7 PRs · 3 findings (all LOW) · 2 code
 * scans didn't finish"). Shared by the scan panel and the Record tab's
 * collapsed Security scan row (LUM-1009) so the two can never word it
 * differently.
 */
export function formatSecuritySummaryLine(
  intl: IntlShape,
  data: TaskSecurityScans
): string {
  const summary = summarizeSecurityScans(data.prs)
  const severityNote = summary.allLow
    ? ` (${intl.formatMessage({ id: 'record.security.allLow' })})`
    : ''
  // Review F1 (honesty): with a scan still incomplete, zero findings is not
  // "no findings" — it is "no findings *on the scans that finished*". The
  // composite `record.security.summary` bakes its own =0 branch, so that case
  // is composed from the PR-count clause plus the qualified one instead.
  const qualifyZero =
    summary.findings === 0 &&
    (summary.incomplete > 0 ||
      summary.overSizeLimit > 0 ||
      summary.turnedOff > 0 ||
      data.scanningOff)
  const summaryText = qualifyZero
    ? [
        intl.formatMessage(
          { id: 'record.security.prs' },
          { count: summary.prs }
        ),
        intl.formatMessage({ id: 'record.security.noneOnComplete' }),
      ].join(' · ')
    : intl.formatMessage(
        { id: 'record.security.summary' },
        { prs: summary.prs, findings: summary.findings, severityNote }
      )
  const incompleteText =
    summary.incomplete > 0
      ? intl.formatMessage(
          { id: 'record.security.incomplete' },
          { count: summary.incomplete }
        )
      : ''
  // LUM-832: a layer skipped for size is not "not fully checked yet" —
  // nothing is coming later; the change was over the limit.
  const overSizeLimitText =
    summary.overSizeLimit > 0
      ? intl.formatMessage(
          { id: 'record.security.overSizeLimit' },
          { count: summary.overSizeLimit }
        )
      : ''
  // LUM-892: turned off in settings — the customer's choice, its own clause.
  const turnedOffText =
    summary.turnedOff > 0
      ? intl.formatMessage(
          { id: 'record.security.turnedOff' },
          { count: summary.turnedOff }
        )
      : ''
  const failedText =
    summary.externalFailed > 0
      ? intl.formatMessage(
          { id: 'record.security.failed' },
          { count: summary.externalFailed }
        )
      : ''
  return [
    summaryText,
    incompleteText,
    overSizeLimitText,
    turnedOffText,
    failedText,
  ]
    .filter(Boolean)
    .join(' · ')
}
