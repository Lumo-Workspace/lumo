/**
 * LUM-866 — reads one workspace's security-scan switches and folds in the
 * platform ceiling. Every scan entry point (stage A, SARIF ingest, baseline,
 * hunt continuation) asks here before starting work for a workspace.
 */
import {
  resolveSecurityLayers,
  type EffectiveSecurityLayers,
} from '@/ee/security/security-scan/workspace-switches'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { aiFeaturesService } from '@/lib/services/ai-features.service'

/**
 * LUM-1338: the workspace's "AI code review" switch (or a deployment without
 * a model) turns every model-backed layer off; the static scan stays. Each
 * reads as turned off, never as a clean result.
 */
export async function loadSecurityLayers(
  workspaceId: string
): Promise<EffectiveSecurityLayers> {
  const layers = resolveSecurityLayers(
    await securityColumnsRepository.findSecuritySwitches(workspaceId),
    process.env,
    workspaceId
  )
  if (await aiFeaturesService.isEnabled({ workspaceId }, 'prCodeReview'))
    return layers
  return {
    ...layers,
    aiReview: false,
    hunt: false,
    rewardHack: false,
    aiReviewTurnedOff: layers.aiReviewTurnedOff || layers.aiReview,
    huntTurnedOff: layers.huntTurnedOff || layers.hunt,
    rewardHackTurnedOff: layers.rewardHackTurnedOff || layers.rewardHack,
  }
}
