import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { MilestoneStatus, TaskStatus } from '@prisma/client'

export interface ApiMilestone {
  id: string
  projectId: string
  name: string
  description: string | null
  status: MilestoneStatus
  startDate: string | null
  targetDate: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  /** Per-status task counts. Server-enriched on list/detail responses. */
  taskCounts?: Record<TaskStatus, number>
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

export const milestonesClient = {
  listByProject(projectId: string) {
    return apiFetch<{ milestones: ApiMilestone[] }>(
      API.milestones.listByProject(projectId)
    )
  },

  getById(milestoneId: string) {
    return apiFetch<{ milestone: ApiMilestone }>(
      API.milestones.byId(milestoneId)
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
}
