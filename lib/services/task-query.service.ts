import {
  taskRepository,
  type AssignedTaskFilters,
  type WorkspaceTaskFilters,
} from '@/lib/repositories/task.repository'
import { nextPageCursor, type PageRequest } from '@/lib/validation/pagination'

function shapeTask(t: any) {
  return {
    ...t,
    teamIdentifier: t.team?.identifier ?? '',
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

  /**
   * LUM-1093: one page of the workspace task query with the total match
   * count and the cursor of the next page (null on the last page).
   */
  async findForWorkspacePage(
    workspaceId: string,
    filters: WorkspaceTaskFilters,
    page: PageRequest
  ) {
    const { rows, total } = await taskRepository.findByWorkspaceWithFiltersPage(
      workspaceId,
      filters,
      page
    )
    return {
      tasks: rows.map(shapeTask),
      total,
      nextCursor: nextPageCursor(page, rows.length, total),
    }
  },

  /**
   * LUM-1093: one page of the caller's assigned tasks (`lumo task list`),
   * filtered server-side, with the total and the next page's cursor.
   */
  async findAssignedPage(
    workspaceId: string,
    actorId: string,
    filters: AssignedTaskFilters,
    page: PageRequest
  ) {
    const { rows, total } = await taskRepository.findAssignedTasksPage(
      workspaceId,
      actorId,
      filters,
      page
    )
    return {
      tasks: rows,
      total,
      nextCursor: nextPageCursor(page, rows.length, total),
    }
  },
}
