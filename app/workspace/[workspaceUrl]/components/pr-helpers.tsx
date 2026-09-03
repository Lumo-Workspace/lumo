'use client'

import {
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  ShieldQuestion,
} from 'lucide-react'
import { useIntl } from 'react-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { SecurityScanView } from '@/lib/services/pr-security-scan.service'

export function PrStateBadge({ state }: { state: string }) {
  if (state === 'merged') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'>
        Merged
      </span>
    )
  }
  if (state === 'closed') {
    return (
      <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'>
        Closed
      </span>
    )
  }
  return (
    <span className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'>
      Open
    </span>
  )
}

export function CiIcon({ status }: { status: string | null }) {
  const intl = useIntl()

  let trigger: React.ReactElement
  let labelId: string

  if (status === 'success') {
    trigger = <CheckCircle2 size={13} className='text-emerald-500 shrink-0' />
    labelId = 'task.ciSuccess'
  } else if (status === 'failure') {
    trigger = <XCircle size={13} className='text-red-500 shrink-0' />
    labelId = 'task.ciFailure'
  } else if (status === 'pending') {
    trigger = (
      <Loader2
        size={13}
        className='text-muted-foreground shrink-0 animate-spin'
      />
    )
    labelId = 'task.ciPending'
  } else {
    trigger = (
      <span
        aria-hidden
        className='block w-[13px] h-[13px] shrink-0'
        data-testid='ci-icon-placeholder'
      />
    )
    labelId = 'task.ciUnknown'
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>{intl.formatMessage({ id: labelId })}</TooltipContent>
    </Tooltip>
  )
}

const SEVERITY_TONE: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  HIGH: 'text-destructive',
  MEDIUM: 'text-warning',
  LOW: 'text-muted-foreground',
}

/**
 * LUM-732 — per-PR security-scan badge. Six states: scanning / clean /
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
  } else if (scan.status === 'FAILED') {
    icon = <ShieldOff size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.FAILED' })
    state = 'failed'
  } else if (scan.findings.length === 0) {
    icon = <ShieldCheck size={12} />
    label = intl.formatMessage({ id: 'securityScan.status.CLEAN' })
    tone = 'text-success'
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
    <span
      data-testid='security-scan-badge'
      data-state={state}
      className={`inline-flex items-center gap-1 text-[10px] font-medium ${tone}`}
    >
      {icon}
      {label}
    </span>
  )
}
