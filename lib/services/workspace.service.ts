import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'
import { workspaceDeletionService } from '@/lib/services/workspace-deletion.service'
import type { SecurityPolicy } from '@/lib/security-scan/policy'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpdateWorkspaceInput {
  name?: string | undefined
  slug?: string | undefined
  summaryEnabled?: boolean | undefined
  summaryFrequency?: string | undefined
  summaryLocale?: string | undefined
  verificationMaxRounds?: number | undefined
  acceptanceMode?: boolean | undefined
  /** LUM-740: already validated by `securityPolicySchema`; null = reset. */
  securityPolicy?: SecurityPolicy | null | undefined
}

// ── Workspace Service ───────────────────────────────────────────────────────

export const workspaceService = {
  /** Create a new workspace with full initialisation (team, member, actors). */
  async createWorkspace(
    userId: string,
    data: { name: string; slug?: string | undefined }
  ) {
    const slug = data.slug ?? generateWorkspaceSlug(data.name)

    return workspaceRepository.create({
      name: data.name,
      slug,
      clerkId: userId,
    })
  },

  /** Update workspace settings. Only OWNER role is allowed. */
  async updateWorkspace(
    workspaceId: string,
    role: string,
    currentSlug: string,
    input: UpdateWorkspaceInput
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only admins can update workspace settings'),
        { status: 403 }
      )
    }

    // Check slug uniqueness if changing
    if (input.slug && input.slug !== currentSlug) {
      const unique = await workspaceRepository.isSlugUnique(
        input.slug,
        workspaceId
      )
      if (!unique) {
        throw Object.assign(new Error('This URL is already taken'), {
          status: 409,
        })
      }
    }

    const data: import('@/lib/repositories/workspace.repository').WorkspaceUpdateData =
      {}
    if (input.name !== undefined) data.name = input.name
    if (input.slug !== undefined) data.slug = input.slug
    if (input.summaryEnabled !== undefined)
      data.summaryEnabled = input.summaryEnabled
    if (input.summaryFrequency !== undefined)
      data.summaryFrequency = input.summaryFrequency
    if (input.summaryLocale !== undefined)
      data.summaryLocale = input.summaryLocale
    if (input.verificationMaxRounds !== undefined)
      data.verificationMaxRounds = input.verificationMaxRounds
    if (input.acceptanceMode !== undefined)
      data.acceptanceMode = input.acceptanceMode
    if (input.securityPolicy !== undefined)
      data.securityPolicy = input.securityPolicy

    return workspaceRepository.update(workspaceId, data)
  },

  /**
   * Delete workspace. Only OWNER role is allowed. LUM-861: removes every row
   * and blob the workspace owns and leaves a deletion receipt.
   */
  async deleteWorkspace(
    workspaceId: string,
    role: string,
    requestedByClerkId: string
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(new Error('Only admins can delete a workspace'), {
        status: 403,
      })
    }

    await workspaceDeletionService.deleteWorkspace(
      workspaceId,
      requestedByClerkId
    )
  },
}
