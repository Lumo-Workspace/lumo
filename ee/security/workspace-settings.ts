/**
 * LUM-1062 — the security plugin's workspace settings (RFC §3.4 设置页):
 * the DONE-block policy (LUM-740), the scan evidence retention (LUM-911) and
 * the three scan switches (LUM-866). The columns stay in the core
 * `Workspace` model; the core serves and writes them only because this
 * contributor owns them. Validators are the ones PATCH /api/workspaces/me
 * applied before the split.
 */
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { WorkspaceSettingsContributor } from '@/lib/plugins/types'
import { securityPolicySchema } from '@/ee/security/security-scan/policy'
import { platformSecurityCeiling } from '@/ee/security/security-scan/workspace-switches'
import { LEARNINGS_SCOPES } from '@/ee/security/security-scan/learnings-scope'
import { autoPauseAfterSchema } from '@/ee/security/validation/security-scan-settings'

export const securityWorkspaceSettings: WorkspaceSettingsContributor = {
  key: 'security',
  columns: {
    // LUM-740: the DONE-block policy table; `null` resets to the default.
    // LLM_JUDGE is not an accepted provenance — see lib/security-scan/policy.ts.
    securityPolicy: securityPolicySchema.nullable().optional(),
    // LUM-911: days a used-up scan keeps its code; 0 = zero retention.
    scanEvidenceRetentionDays: z
      .union([z.literal(0), z.literal(7), z.literal(14), z.literal(30)])
      .optional(),
    // LUM-866: per-workspace security-scan switches (the env stays the ceiling).
    securityScanEnabled: z.boolean().optional(),
    securityAiReviewEnabled: z.boolean().optional(),
    securityHuntEnabled: z.boolean().optional(),
    // LUM-1130: the PR reviewer's request-changes workflow (default off).
    securityRequestChangesEnabled: z.boolean().optional(),
    // LUM-1134: the learnings scope — local | global | auto (default auto).
    securityLearningsScope: z.enum(LEARNINGS_SCOPES).optional(),
    // LUM-1137: pause automatic review after N reviewed commits (0 = never).
    securityReviewAutoPauseAfter: autoPauseAfterSchema.optional(),
  },
  // LUM-907: audited with the core settings (moved out of the core list in
  // LUM-1065; same actions as before).
  audit: {
    'workspace.security_settings_updated': [
      'securityPolicy',
      'securityScanEnabled',
      'securityAiReviewEnabled',
      'securityHuntEnabled',
      'securityRequestChangesEnabled',
      'securityLearningsScope',
      'securityReviewAutoPauseAfter',
    ],
    'workspace.retention_updated': ['scanEvidenceRetentionDays'],
  },
  // LUM-740: `securityPolicy: null` resets to the default — clear the Json
  // column to SQL NULL (Prisma rejects a bare null for a Json column). This
  // mapping lived in the core workspaceRepository.update before LUM-1065.
  toColumnWrite: (column, value) =>
    column === 'securityPolicy' && value === null ? Prisma.DbNull : value,
  // LUM-866: which scan layers the platform allows at all — the settings
  // page shows a layer the env turned off as off and not toggleable.
  meFields: () => ({ securityPlatform: platformSecurityCeiling() }),
  // LUM-901: the claim faithfulness judge sends the merged PR diff to a
  // model, so it is part of the workspace's AI review.
  async aiReviewEnabled(workspaceId) {
    const { loadSecurityLayers } =
      await import('@/ee/security/services/security-workspace-switches.service')
    return (await loadSecurityLayers(workspaceId)).aiReview
  },
}
