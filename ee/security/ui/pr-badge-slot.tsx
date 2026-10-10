'use client'

/**
 * LUM-1062 — the `task.pullRequest.badge` slot: one linked PR's scan badge
 * in the task sidebar (PullRequestsSection before the split, LUM-732 /
 * LUM-892). Every row reads the same react-query key, so one fetch serves
 * the whole list.
 */
import type { ClientSlotProps } from '@/lib/plugins/client'
import { useSecurityScans } from '@/app/workspace/[workspaceUrl]/hooks/useSecurityScans'
import {
  ScanningOffBadge,
  SecurityScanBadge,
  showsScanningOff,
} from './pr-scan-badge'

export function SecurityPrBadge({
  taskId,
  pullRequestId,
}: ClientSlotProps['task.pullRequest.badge']) {
  const { data: security, isLoading, isError } = useSecurityScans(taskId)
  // Review I4: nothing at all while the read is in flight — an unanswered
  // fetch is not "Not scanned" — and an explicit unavailable state once it
  // has failed.
  if (isLoading) return null
  const scan = security?.prs.find(p => p.pr.id === pullRequestId)?.latest
  return security?.scanningOff && showsScanningOff(scan) ? (
    <ScanningOffBadge />
  ) : (
    <SecurityScanBadge scan={scan} unavailable={isError} />
  )
}
