'use client'

/**
 * LUM-1062 — the security plugin's PR scan badges (moved out of the core
 * pr-helpers.tsx; the core places them through the `task.pullRequest.badge`
 * slot).
 */
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  ShieldQuestion,
} from 'lucide-react'
import { useIntl } from 'react-intl'
import { isOverSizeLimitOnly } from '@/ee/security/components/TaskDetailTimeline/security-summary'
import type { SecurityScanView } from '@/ee/security/services/pr-security-scan.service'

const SEVERITY_TONE: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  HIGH: 'text-danger-text',
  MEDIUM: 'text-warning-text',
  LOW: 'text-muted-foreground',
}

/**
 * LUM-732 — per-PR security-scan badge. Six states (plus LUM-1079's
 * "too large to scan"): scanning / clean /
 * findings (count, toned by the worst severity) / failed / not scanned /
 * status unavailable. Hierarchy by typography and icon; semantic colour for
 * clean (success), MEDIUM (warning) and HIGH (destructive).
 *
 * `unavailable` is the read-side failure (review I4) and is deliberately NOT
 * folded into "not scanned": one says the PR was never scanned, the other says
 * we could not find out — rendering a fetch error as the former is a claim
 * about the PR made from an absence of data about it.
 */
export function SecurityScanBadge({
  scan,
  unavailable = false,
}: {
  scan: SecurityScanView | null | undefined
  unavailable?: boolean
}) {
  const intl = useIntl()
  const worst =
    scan?.findings.reduce<'LOW' | 'MEDIUM' | 'HIGH' | null>((acc, f) => {
      const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 }
      return !acc || rank[f.severity] > rank[acc] ? f.severity : acc
    }, null) ?? null

  let icon: React.ReactElement
  let label: string
  let tone = 'text-muted-foreground'
  let state = 'none'
  if (unavailable) {
    icon = <ShieldQuestion size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.unavailable' })
    state = 'unavailable'
  } else if (!scan) {
    icon = <ShieldQuestion size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.none' })
  } else if (scan.status === 'PENDING' || scan.status === 'RUNNING') {
    icon = <Loader2 size={12} className='animate-spin' />
    label = intl.formatMessage({ id: `securityScan.status.${scan.status}` })
    state = 'scanning'
  } else if (scan.prTooLarge) {
    // LUM-1079: the PR was too large to scan — a limit on the change, said
    // as such: never "Scan didn't finish", never "Clean".
    icon = <ShieldQuestion size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.tooLarge' })
    tone = 'text-warning-text'
    state = 'too-large'
  } else if (scan.status === 'FAILED') {
    icon = <ShieldOff size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.FAILED' })
    state = 'failed'
  } else if (scan.findings.length === 0 && scan.stages.external === 'PENDING') {
    // LUM-735: CI has pushed SARIF before but not for this sha yet — the
    // scan is still effectively in progress, not merely "incomplete".
    icon = <Loader2 size={12} className='animate-spin' />
    label = intl.formatMessage({ id: 'securityScan.status.pendingExternal' })
    state = 'scanning'
  } else if (scan.findings.length === 0 && isOverSizeLimitOnly(scan)) {
    // LUM-832: a layer was skipped because the change was over its size cap
    // (like CodeRabbit's limit) — stated as such, not "not fully checked yet".
    icon = <ShieldQuestion size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.overSizeLimit' })
    tone = 'text-warning-text'
    state = 'over-size-limit'
  } else if (scan.findings.length === 0 && scan.coverage === 'TURNED_OFF') {
    // LUM-892: a layer was turned off in settings — the customer's choice,
    // so neither "Clean" nor the warning tone of an unfinished scan.
    icon = <ShieldQuestion size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.turnedOff' })
    state = 'turned-off'
  } else if (scan.findings.length === 0 && !scan.complete) {
    // LUM-735 / spec P9: a layer failed, is not configured, or was cut off.
    // Nothing was found, but nothing can be claimed either — never green.
    icon = <ShieldQuestion size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.incomplete' })
    tone = 'text-warning-text'
    state = 'incomplete'
  } else if (scan.findings.length === 0) {
    icon = <ShieldCheck size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.CLEAN' })
    tone = 'text-success-text'
    state = 'clean'
  } else {
    icon = <ShieldAlert size={12} />
    label = intl.formatMessage(
      { id: 'securityScan.status.FINDINGS' },
      { count: scan.findings.length }
    )
    tone = SEVERITY_TONE[worst ?? 'LOW']
    state = 'findings'
  }

  return (
    <SecurityBadgeShell state={state} tone={tone}>
      {icon}
      {label}
    </SecurityBadgeShell>
  )
}

/** The one badge frame both security badge variants render into. */
function SecurityBadgeShell({
  state,
  tone,
  children,
}: {
  state: string
  tone: string
  children: React.ReactNode
}) {
  return (
    <span
      data-testid='security-scan-badge'
      data-state={state}
      className={`inline-flex items-center gap-1 text-[10px] font-medium ${tone}`}
    >
      {children}
    </span>
  )
}

/**
 * LUM-892 — shown instead of `SecurityScanBadge` when the workspace turned
 * scanning off and the PR has nothing open: an earlier "Clean" was for an
 * older commit and must not keep standing as the PR's answer. A PR with
 * findings keeps `SecurityScanBadge` — those findings are still real.
 */
export function ScanningOffBadge() {
  const intl = useIntl()
  return (
    <SecurityBadgeShell state='scanning-off' tone='text-muted-foreground'>
      <ShieldQuestion size={12} />
      {intl.formatMessage({ id: 'securityScan.status.scanningOff' })}
    </SecurityBadgeShell>
  )
}

/** LUM-892 — does a scanning-off workspace replace this PR's badge? */
export function showsScanningOff(
  scan: Pick<SecurityScanView, 'findings'> | null | undefined
): boolean {
  return !scan || scan.findings.length === 0
}
