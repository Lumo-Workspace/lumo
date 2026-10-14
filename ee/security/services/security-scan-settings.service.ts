import { miscRepository } from '@/lib/repositories/misc.repository'
import {
  DEFAULT_WORKSPACE_SECURITY_SWITCHES,
  platformSecurityCeiling,
  resolveSecurityLayers,
  type EffectiveSecurityLayers,
  type PlatformSecurityCeiling,
  type WorkspaceSecuritySwitches,
} from '@/ee/security/security-scan/workspace-switches'
import { workspaceService } from '@/lib/services/workspace.service'
import type { AuditContext } from '@/lib/services/audit.service'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

/**
 * LUM-1002 — the PR security-scan switches as one read/write unit, so the CLI
 * (`lumo workspace security-scan`) and the settings card speak the same
 * shape. Writes go through `workspaceService.updateWorkspace`, which keeps
 * the OWNER check and the LUM-907 audit event in one place.
 */

export interface SecurityScanSettings {
  /** What the workspace stored (a missing row reads as the defaults). */
  switches: WorkspaceSecuritySwitches
  /** What the platform env allows at all — the ceiling. */
  platform: PlatformSecurityCeiling
  /** Which layers will actually run: switches under the ceiling. */
  effective: EffectiveSecurityLayers
  /** Whether the caller may change the switches (OWNER) — lets the CLI refuse
   *  up front instead of asking for confirmation and then hitting a 403. */
  canEdit: boolean
}

/** The caller a read or write is made for. */
export interface SecurityScanSettingsCaller {
  workspaceId: string
  memberId: string
}

/** A partial switch change, or `all` to set every switch at once. */
export type SecurityScanSettingsUpdate =
  | (Partial<WorkspaceSecuritySwitches> & { all?: undefined })
  | { all: boolean }

/**
 * `all: false` = disable all, `all: true` = enable all (the three layer
 * switches — `all` never touches the request-changes workflow, LUM-1130,
 * or the learnings scope, LUM-1134);
 * else as given.
 */
export function switchesForUpdate(update: SecurityScanSettingsUpdate): {
  [K in keyof WorkspaceSecuritySwitches]?:
    | WorkspaceSecuritySwitches[K]
    | undefined
} {
  if (update.all !== undefined) {
    return {
      securityScanEnabled: update.all,
      securityAiReviewEnabled: update.all,
      securityHuntEnabled: update.all,
    }
  }
  return {
    securityScanEnabled: update.securityScanEnabled,
    securityAiReviewEnabled: update.securityAiReviewEnabled,
    securityHuntEnabled: update.securityHuntEnabled,
    securityRequestChangesEnabled: update.securityRequestChangesEnabled,
    // LUM-1134: the learnings scope (local | global | auto).
    securityLearningsScope: update.securityLearningsScope,
  }
}

export const securityScanSettingsService = {
  async get(caller: SecurityScanSettingsCaller): Promise<SecurityScanSettings> {
    const [stored, role] = await Promise.all([
      securityColumnsRepository.findSecuritySwitches(caller.workspaceId),
      miscRepository.findMemberRoleById(caller.memberId),
    ])
    if (!stored) {
      throw Object.assign(new Error('Workspace not found'), { status: 404 })
    }
    const switches = { ...DEFAULT_WORKSPACE_SECURITY_SWITCHES, ...stored }
    return {
      switches,
      platform: platformSecurityCeiling(),
      effective: resolveSecurityLayers(switches),
      canEdit: role === 'OWNER',
    }
  },

  /**
   * OWNER only (enforced by `updateWorkspace`); returns the new settings.
   * The role comes from the caller's member row, so a CLI bearer (whose
   * identity carries no role) meets the same gate as the browser.
   */
  async update(
    caller: SecurityScanSettingsCaller & { workspaceSlug: string },
    update: SecurityScanSettingsUpdate,
    audit?: AuditContext
  ): Promise<SecurityScanSettings> {
    const role = await miscRepository.findMemberRoleById(caller.memberId)
    await workspaceService.updateWorkspace(
      caller.workspaceId,
      role ?? '',
      caller.workspaceSlug,
      switchesForUpdate(update),
      audit
    )
    return this.get(caller)
  },
}
