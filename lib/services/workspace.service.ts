import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpdateWorkspaceInput {
  name?: string | undefined
  slug?: string | undefined
  summaryEnabled?: boolean | undefined
  summaryFrequency?: string | undefined
  summaryLocale?: string | undefined
  riskOverdueRatio?: number | undefined
  riskStalledDays?: number | undefined
  riskStalledMinCount?: number | undefined
  riskAgentFailRatio?: number | undefined
  riskStalePrDays?: number | undefined
  riskThroughputDrop?: number | undefined
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

    const data: Record<string, unknown> = {}
    if (input.name !== undefined) data.name = input.name
    if (input.slug !== undefined) data.slug = input.slug
    if (input.summaryEnabled !== undefined)
      data.summaryEnabled = input.summaryEnabled
    if (input.summaryFrequency !== undefined)
      data.summaryFrequency = input.summaryFrequency
    if (input.summaryLocale !== undefined)
      data.summaryLocale = input.summaryLocale
    if (input.riskOverdueRatio !== undefined)
      data.riskOverdueRatio = input.riskOverdueRatio
    if (input.riskStalledDays !== undefined)
      data.riskStalledDays = input.riskStalledDays
    if (input.riskStalledMinCount !== undefined)
      data.riskStalledMinCount = input.riskStalledMinCount
    if (input.riskAgentFailRatio !== undefined)
      data.riskAgentFailRatio = input.riskAgentFailRatio
    if (input.riskStalePrDays !== undefined)
      data.riskStalePrDays = input.riskStalePrDays
    if (input.riskThroughputDrop !== undefined)
      data.riskThroughputDrop = input.riskThroughputDrop

    return workspaceRepository.update(workspaceId, data)
  },

  /** Delete workspace. Only OWNER role is allowed. */
  async deleteWorkspace(workspaceId: string, role: string) {
    if (role !== 'OWNER') {
      throw Object.assign(new Error('Only admins can delete a workspace'), {
        status: 403,
      })
    }

    await workspaceRepository.delete(workspaceId)
  },
}
