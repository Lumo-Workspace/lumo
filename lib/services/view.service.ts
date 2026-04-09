import { viewRepository } from '@/lib/repositories/view.repository'

// ── View Service ───────────────────────────────────────────────────────────

export const viewService = {
  /** Get or create a personal KANBAN view for a member's "My Tasks". */
  async getOrCreateMemberKanban(workspaceId: string, memberId: string) {
    return viewRepository.findOrCreateMemberKanban(workspaceId, memberId)
  },

  /** Get or create a KANBAN view for a project board. */
  async getOrCreateProjectKanban(workspaceId: string, projectId: string) {
    return viewRepository.findOrCreateProjectKanban(workspaceId, projectId)
  },

  /** Get task order map for a view (taskId → order). */
  async getTaskOrderMap(viewId: string) {
    const taskOrders = await viewRepository.findTaskOrders(viewId)
    return new Map(taskOrders.map(o => [o.taskId, o.order]))
  },

  /** Upsert a task's order within a view, with authorization checks. */
  async upsertTaskOrder(
    viewId: string,
    taskId: string,
    groupKey: string,
    order: number,
    callerClerkId: string
  ) {
    const view = await viewRepository.findById(viewId)
    if (!view) {
      throw Object.assign(new Error('View not found'), { status: 404 })
    }

    const workspaceId = view.project?.workspaceId ?? view.member?.workspaceId
    if (!workspaceId) {
      throw Object.assign(new Error('View has no workspace'), { status: 400 })
    }

    // Check caller belongs to this workspace
    const member = await viewRepository.findMemberByWorkspaceAndClerkId(
      workspaceId,
      callerClerkId
    )
    if (!member) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    // Personal views: only the owner can update
    if (view.memberId && view.member?.clerkId !== callerClerkId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    await viewRepository.upsertTaskOrder(viewId, taskId, groupKey, order)
  },
}
