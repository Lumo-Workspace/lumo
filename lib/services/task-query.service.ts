import {
  taskRepository,
  type WorkspaceTaskFilters,
} from '@/lib/repositories/task.repository'

function shapeTask(t: any) {
  return {
    ...t,
    teamIdentifier: t.team?.identifier ?? '',
    parent: t.parent
      ? {
          id: t.parent.id,
          title: t.parent.title,
          number: t.parent.number,
          teamIdentifier: t.parent.team?.identifier ?? '',
        }
      : null,
    _count: t._count,
    childrenDoneCount: Array.isArray(t.children) ? t.children.length : 0,
  }
}

export const taskQueryService = {
  /**
   * Workspace-wide task query, scoped to the caller's workspace.
   * `workspaceId` comes from the authenticated identity, so the stored
   * block config can only narrow — never widen — the visible scope.
   */
  async findForWorkspace(workspaceId: string, filters: WorkspaceTaskFilters) {
    const tasks = await taskRepository.findByWorkspaceWithFilters(
      workspaceId,
      filters
    )
    return tasks.map(shapeTask)
  },
}
