/**
 * LUM-1062 — the security plugin's workspace settings (RFC §3.4 设置页):
 * the DONE-block policy (LUM-740), the scan evidence retention (LUM-911) and
 * the three scan switches (LUM-866). The columns stay in the core
 * `Workspace` model; the core serves and writes them only because this
 * contributor owns them. Validators are the ones PATCH /api/workspaces/me
 * applied before the split.
 */
import { z } from 'zod'
import type { WorkspaceSettingsContributor } from '@/lib/plugins/types'
import { securityPolicySchema } from '@/lib/security-scan/policy'
import { platformSecurityCeiling } from '@/lib/security-scan/workspace-switches'

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
  },
  // LUM-866: which scan layers the platform allows at all — the settings
  // page shows a layer the env turned off as off and not toggleable.
  meFields: () => ({ securityPlatform: platformSecurityCeiling() }),
  // LUM-901: the claim faithfulness judge sends the merged PR diff to a
  // model, so it is part of the workspace's AI review.
  async aiReviewEnabled(workspaceId) {
    const { loadSecurityLayers } =
      await import('@/lib/services/security-workspace-switches.service')
    return (await loadSecurityLayers(workspaceId)).aiReview
  },
}
