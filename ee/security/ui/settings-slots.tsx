'use client'

/**
 * LUM-1062 — the security plugin's settings: the PR scan switches card
 * (LUM-866, `settings.codeReview.behavior`), the per-repository review and
 * rule coverage cards (LUM-1339 gave each its own Code review page) and the
 * scan evidence retention row (LUM-911, `settings.retention.row`). Both read the columns the
 * plugin owns from the workspace row GET /api/workspaces/me serves.
 */
import type { ClientSlotProps } from '@/lib/plugins/client'
import type { PlatformSecurityCeiling } from '@/ee/security/security-scan/workspace-switches'
import { parseLearningsScope } from '@/ee/security/security-scan/learnings-scope'
import { parseAutoPauseAfter } from '@/ee/security/security-scan/review-control'
import {
  agentReviewBlocking,
  parseSecurityPolicy,
} from '@/ee/security/security-scan/policy'
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
  return (
    typeof v.hunt === 'boolean' &&
    typeof v.rewardHack === 'boolean' &&
    typeof v.sandbox === 'boolean'
  )
}

export function SecuritySettingsSection({
  workspace,
  me,
}: ClientSlotProps['settings.codeReview.behavior']) {
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
        securityRewardHackEnabled: switchOf(
          workspace.securityRewardHackEnabled
        ),
        // LUM-1130: off unless the workspace turned it on.
        securityRequestChangesEnabled: switchOf(
          workspace.securityRequestChangesEnabled,
          false
        ),
        // LUM-1142: on unless the workspace turned it off.
        securityAllowAuthorApproval: switchOf(
          workspace.securityAllowAuthorApproval
        ),
        // LUM-1134: auto unless the workspace chose otherwise.
        securityLearningsScope: parseLearningsScope(
          workspace.securityLearningsScope
        ),
        // LUM-1137: 5 unless the workspace chose otherwise (0 = never).
        securityReviewAutoPauseAfter: parseAutoPauseAfter(
          workspace.securityReviewAutoPauseAfter
        ),
        // LUM-1259: off unless the workspace opted in (set from the CLI).
        securityLocalScanLogEnabled: switchOf(
          workspace.securityLocalScanLogEnabled,
          false
        ),
      }}
      huntAvailable={platform.hunt}
      rewardHackAvailable={platform.rewardHack}
      sandboxAvailable={platform.sandbox}
      // LUM-1329: the policy's AGENT_REVIEW entries (off by default).
      initialAgentReviewBlocking={agentReviewBlocking(
        parseSecurityPolicy(workspace.securityPolicy)
      )}
    />
  )
}

/** LUM-1133: automatic review per connected repository. */
export function SecurityRepoReviewSettings() {
  return <RepoReviewSettingsCard />
}

/** LUM-1114: the project rules nothing checks automatically. */
export function SecurityPolicyCoverage() {
  return <PolicyCoverageCard />
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
