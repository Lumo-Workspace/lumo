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

export async function loadSecurityLayers(
  workspaceId: string
): Promise<EffectiveSecurityLayers> {
  return resolveSecurityLayers(
    await securityColumnsRepository.findSecuritySwitches(workspaceId),
    process.env,
    workspaceId
  )
}
