import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { MilestoneStatus, TaskStatus } from '@prisma/client'
import type { MilestoneHealth } from '@/lib/summaries/milestone-health'

export interface ApiMilestone {
  id: string
  projectId: string
  name: string
  slug: string
  description: string | null
  status: MilestoneStatus
  startDate: string | null
  targetDate: string | null
  completedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** Per-status task counts. Server-enriched on list/detail responses. */
  taskCounts?: Record<TaskStatus, number>
  /**
   * Target-date health light. Server-enriched on list/detail responses.
   * `null` when no light applies (terminal status or no target date).
   */
  health?: MilestoneHealth | null
}

export interface MilestoneCreateInput {
  name: string
  description?: string | null
  startDate?: string | null
  targetDate?: string | null
}

export interface MilestoneUpdateInput {
  name?: string
  description?: string | null
  status?: MilestoneStatus
  startDate?: string | null
  targetDate?: string | null
}

/** Which milestones a list request returns, by archive state. */
export type MilestoneListFilter = 'active' | 'archived' | 'all'

export const milestonesClient = {
  listByProject(projectId: string, filter: MilestoneListFilter = 'active') {
    const base = API.milestones.listByProject(projectId)
    // `active` is the server default — omit the param so the URL (and its
    // query cache key) stays stable for the common case.
    const url = filter === 'active' ? base : `${base}?filter=${filter}`
    return apiFetch<{ milestones: ApiMilestone[] }>(url)
  },

  getById(milestoneId: string) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.byId(milestoneId)
    )
  },

  getByProjectAndSlug(projectId: string, slug: string) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.byProjectAndSlug(projectId, slug)
    )
  },

  create(projectId: string, data: MilestoneCreateInput) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.listByProject(projectId),
      { method: 'POST', body: data }
    )
  },

  update(milestoneId: string, data: MilestoneUpdateInput) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.byId(milestoneId),
      { method: 'PATCH', body: data }
    )
  },

  delete(milestoneId: string) {
    return apiFetch<void>(API.milestones.byId(milestoneId), {
      method: 'DELETE',
    })
  },

  reorder(projectId: string, orderedIds: string[]) {
    return apiFetch<{ ok: boolean }>(API.milestones.reorder(projectId), {
      method: 'PATCH',
      body: { orderedIds },
    })
  },

  archive(milestoneId: string) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.archive(milestoneId),
      { method: 'POST' }
    )
  },

  unarchive(milestoneId: string) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.unarchive(milestoneId),
      { method: 'POST' }
    )
  },
}
