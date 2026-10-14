'use client'

/**
 * LUM-1062 — the security plugin's settings: the PR scan switches card
 * (LUM-866, `settings.workspace.section`) and the scan evidence retention
 * row (LUM-911, `settings.retention.row`). Both read the columns the
 * plugin owns from the workspace row GET /api/workspaces/me serves.
 */
import type { ClientSlotProps } from '@/lib/plugins/client'
import type { PlatformSecurityCeiling } from '@/ee/security/security-scan/workspace-switches'
import { parseLearningsScope } from '@/ee/security/security-scan/learnings-scope'
import { SecurityScanSwitchesCard } from '@/ee/security/components/settings/SecurityScanSwitchesCard'
import { ScanEvidenceRetentionRow } from '@/ee/security/components/settings/ScanEvidenceRetentionRow'
import { PolicyCoverageCard } from '@/ee/security/components/settings/PolicyCoverageCard'
import { RepoReviewSettingsCard } from '@/ee/security/components/settings/RepoReviewSettingsCard'

/** A stored switch; a missing value reads as the column default. */
function switchOf(value: unknown, fallback = true): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function isPlatformCeiling(value: unknown): value is PlatformSecurityCeiling {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.hunt === 'boolean' && typeof v.sandbox === 'boolean'
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
    <>
      <SecurityScanSwitchesCard
        initial={{
          securityScanEnabled: switchOf(workspace.securityScanEnabled),
          securityAiReviewEnabled: switchOf(workspace.securityAiReviewEnabled),
          securityHuntEnabled: switchOf(workspace.securityHuntEnabled),
          // LUM-1130: off unless the workspace turned it on.
          securityRequestChangesEnabled: switchOf(
            workspace.securityRequestChangesEnabled,
            false
          ),
          // LUM-1134: auto unless the workspace chose otherwise.
          securityLearningsScope: parseLearningsScope(
            workspace.securityLearningsScope
          ),
        }}
        huntAvailable={platform.hunt}
        sandboxAvailable={platform.sandbox}
      />
      {/* LUM-1133: automatic review per connected repository. */}
      <RepoReviewSettingsCard />
      {/* LUM-1114: the project rules nothing checks automatically. */}
      <PolicyCoverageCard />
    </>
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
