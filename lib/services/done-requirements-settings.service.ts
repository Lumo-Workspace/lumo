/**
 * LUM-1334 — read and change the workspace's DONE requirement switches
 * (`lumo workspace done-requirements`, and the settings card through the
 * generic PATCH /api/workspaces/me). The change goes through
 * `workspaceService.updateWorkspace`: OWNER only, audited.
 */
import { miscRepository } from '@/lib/repositories/misc.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { workspaceService } from '@/lib/services/workspace.service'
import type { AuditContext } from '@/lib/services/audit.service'
import type { DoneRequirementsUpdate } from '@/lib/validation/done-requirements'

export interface DoneRequirementsCaller {
  memberId: string
  workspaceId: string
  workspaceSlug: string
}

export interface DoneRequirementsSettings {
  testCase: boolean
  review: boolean
  /** The caller may change them (OWNER). */
  canEdit: boolean
}

export const doneRequirementsSettingsService = {
  async get(caller: DoneRequirementsCaller): Promise<DoneRequirementsSettings> {
    const [role, switches] = await Promise.all([
      miscRepository.findMemberRoleById(caller.memberId),
      workspaceRepository.findDoneRequirements(caller.workspaceId),
    ])
    if (!switches)
      throw Object.assign(new Error('Workspace not found'), { status: 404 })
    return { ...switches, canEdit: role === 'OWNER' }
  },

  /** OWNER only (enforced by `updateWorkspace`); returns the new settings. */
  async update(
    caller: DoneRequirementsCaller,
    update: DoneRequirementsUpdate,
    audit?: AuditContext
  ): Promise<DoneRequirementsSettings> {
    const role = await miscRepository.findMemberRoleById(caller.memberId)
    await workspaceService.updateWorkspace(
      caller.workspaceId,
      role ?? '',
      caller.workspaceSlug,
      {
        ...(update.testCase !== undefined
          ? { doneRequiresTestCase: update.testCase }
          : {}),
        ...(update.review !== undefined
          ? { doneRequiresReview: update.review }
          : {}),
      },
      audit
    )
    return this.get(caller)
  },
}
