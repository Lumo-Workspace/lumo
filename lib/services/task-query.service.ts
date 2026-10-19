import {
  taskRepository,
  type TaskListFilters,
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
   * count, the cursor of the next page (null on the last page) and whether
   * the match set was capped.
   */
  async findForWorkspacePage(
    workspaceId: string,
    filters: WorkspaceTaskFilters,
    page: PageRequest
  ) {
    const { rows, total, truncated } =
      await taskRepository.findByWorkspaceWithFiltersPage(
        workspaceId,
        filters,
        page
      )
    return {
      tasks: rows.map(shapeTask),
      total,
      nextCursor: nextPageCursor(page, rows.length, total),
      // A fuzzy query ranks at most WORKSPACE_TASK_QUERY_LIMIT matches; when
      // it hit that cap, `total` is a floor and the caller must say so.
      truncated,
    }
  },

  /**
   * LUM-1093 / LUM-1233: one page of `lumo task list`, filtered server-side,
   * with the total and the next page's cursor. The assignee scope:
   *   - `assigneeActorIds` / `unassigned` given → exactly those (ORed);
   *   - else `assignee: 'any'` → every assignee in the workspace;
   *   - else the caller only (`meActorId`; no actor → an empty page).
   */
  async findTaskListPage(
    workspaceId: string,
    meActorId: string | null,
    query: TaskListQuery,
    page: PageRequest
  ) {
    const filters = taskListFilters(meActorId, query)
    if (!filters) {
      return { tasks: [], total: 0, nextCursor: null, truncated: false }
    }
    const { rows, total, truncated } = await taskRepository.findTaskListPage(
      workspaceId,
      filters,
      page
    )
    return {
      tasks: rows,
      total,
      nextCursor: nextPageCursor(page, rows.length, total),
      // A fuzzy query ranks at most WORKSPACE_TASK_QUERY_LIMIT matches.
      truncated,
    }
  },
}

/** `lumo task list`'s query: the filters plus the assignee scope. */
export interface TaskListQuery extends TaskListFilters {
  /** `any` = every assignee; absent / `me` = the caller (the default). */
  assignee?: 'me' | 'any' | undefined
}

/**
 * The repository filters for a task-list query (see findTaskListPage), or
 * null when it can only be empty: the default "me" scope for a caller who
 * has no actor.
 */
export function taskListFilters(
  meActorId: string | null,
  query: TaskListQuery
): TaskListFilters | null {
  const { assignee, ...filters } = query
  if (filters.assigneeActorIds?.length || filters.unassigned) return filters
  if (assignee === 'any') return filters
  if (!meActorId) return null
  return { ...filters, assigneeActorIds: [meActorId] }
}
