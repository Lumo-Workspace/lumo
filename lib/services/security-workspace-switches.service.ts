/**
 * LUM-866 — reads one workspace's security-scan switches and folds in the
 * platform ceiling. Every scan entry point (stage A, SARIF ingest, baseline,
 * hunt continuation) asks here before starting work for a workspace.
 */
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import {
  resolveSecurityLayers,
  type EffectiveSecurityLayers,
} from '@/lib/security-scan/workspace-switches'

export async function loadSecurityLayers(
  workspaceId: string
): Promise<EffectiveSecurityLayers> {
  return resolveSecurityLayers(
    await workspaceRepository.findSecuritySwitches(workspaceId)
  )
}
