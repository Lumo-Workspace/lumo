'use client'

/**
 * LUM-1062 — the security plugin's settings: the PR scan switches card
 * (LUM-866, `settings.workspace.section`) and the scan evidence retention
 * row (LUM-911, `settings.retention.row`). Both read the columns the
 * plugin owns from the workspace row GET /api/workspaces/me serves.
 */
import type { ClientSlotProps } from '@/lib/plugins/client'
import type { PlatformSecurityCeiling } from '@/lib/security-scan/workspace-switches'
import { SecurityScanSwitchesCard } from '@/app/workspace/[workspaceUrl]/components/settings/SecurityScanSwitchesCard'
import { ScanEvidenceRetentionRow } from '@/app/workspace/[workspaceUrl]/components/settings/ScanEvidenceRetentionRow'

/** A stored switch; a missing value reads as the column default (on). */
function switchOf(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true
}

function isPlatformCeiling(value: unknown): value is PlatformSecurityCeiling {
  return typeof value === 'object' && value !== null && 'hunt' in value
}

export function SecuritySettingsSection({
  workspace,
  me,
}: ClientSlotProps['settings.workspace.section']) {
  // LUM-866: which scan layers the platform env allows at all; the card is
  // drawn only once the server said so.
  const platform = me.securityPlatform
  if (!isPlatformCeiling(platform)) return null
  return (
    <SecurityScanSwitchesCard
      initial={{
        securityScanEnabled: switchOf(workspace.securityScanEnabled),
        securityAiReviewEnabled: switchOf(workspace.securityAiReviewEnabled),
        securityHuntEnabled: switchOf(workspace.securityHuntEnabled),
      }}
      huntAvailable={platform.hunt}
      sandboxAvailable={platform.sandbox}
    />
  )
}

export function SecurityScanEvidenceRetention({
  workspace,
}: ClientSlotProps['settings.retention.row']) {
  const days = workspace.scanEvidenceRetentionDays
  return (
    <ScanEvidenceRetentionRow
      initialDays={typeof days === 'number' ? days : null}
    />
  )
}
