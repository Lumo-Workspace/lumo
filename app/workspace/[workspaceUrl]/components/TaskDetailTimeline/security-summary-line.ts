import type { IntlShape } from 'react-intl'
import type { TaskSecurityScans } from '@/lib/services/pr-security-scan.service'
import { summarizeSecurityScans } from './security-summary'

/** One qualifying clause after the verdict. */
export interface SecurityCaveat {
  text: string
  /** `warning` when a scan of ours did not finish or went over a size
   *  limit; `muted` when the customer turned checks off (their choice). */
  tone: 'warning' | 'muted'
}

/**
 * LUM-1012 — the Security scan Records row's verdict: one word or count
 * ("Clean", "2 open findings"), plus a clause for each reason some scan could
 * not back that verdict ("1 scan over the size limit").
 */
export interface SecurityVerdict {
  text: string
  caveats: SecurityCaveat[]
}

export function formatSecurityVerdict(
  intl: IntlShape,
  data: TaskSecurityScans
): SecurityVerdict {
  const summary = summarizeSecurityScans(data.prs)
  const caveats: SecurityCaveat[] = []
  if (summary.incomplete > 0)
    caveats.push({
      text: intl.formatMessage(
        { id: 'record.security.incomplete' },
        { count: summary.incomplete }
      ),
      tone: 'warning',
    })
  // LUM-832: over the size limit is not "not fully checked yet" — nothing is
  // coming later; the change was too large.
  if (summary.overSizeLimit > 0)
    caveats.push({
      text: intl.formatMessage(
        { id: 'record.security.overSizeLimit' },
        { count: summary.overSizeLimit }
      ),
      tone: 'warning',
    })
  // LUM-892: turned off in settings — the customer's choice, no warning tone.
  if (summary.turnedOff > 0)
    caveats.push({
      text: intl.formatMessage(
        { id: 'record.security.turnedOff' },
        { count: summary.turnedOff }
      ),
      tone: 'muted',
    })
  if (data.scanningOff && summary.turnedOff === 0)
    caveats.push({
      text: intl.formatMessage({ id: 'securityScan.status.scanningOff' }),
      tone: 'muted',
    })
  // Review F1 / LUM-566 (honesty): "Clean" only when nothing qualifies it —
  // otherwise zero findings is "no open findings", followed by the reason.
  const text =
    summary.findings > 0
      ? intl.formatMessage(
          { id: 'record.security.verdict.open' },
          { count: summary.findings }
        )
      : caveats.length === 0
        ? intl.formatMessage({ id: 'securityScan.status.CLEAN' })
        : intl.formatMessage({ id: 'record.security.verdict.noOpen' })
  return { text, caveats }
}
