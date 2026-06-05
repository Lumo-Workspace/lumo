import type { WorkspaceTaskFilterArgs } from '@/lib/api-client/tasks'

export type TaskViewMode = 'list' | 'kanban'
export type TaskViewGroupBy = 'none' | 'status' | 'project' | 'milestone'

export interface TaskViewConfig {
  version: 1
  view: TaskViewMode
  groupBy: TaskViewGroupBy
  filters: WorkspaceTaskFilterArgs
}

export const DEFAULT_TASK_VIEW_CONFIG: TaskViewConfig = {
  version: 1,
  view: 'list',
  groupBy: 'none',
  filters: {},
}

const GROUP_BY_VALUES: readonly TaskViewGroupBy[] = [
  'none',
  'status',
  'project',
  'milestone',
]

function isGroupBy(value: unknown): value is TaskViewGroupBy {
  return (
    typeof value === 'string' &&
    (GROUP_BY_VALUES as readonly string[]).includes(value)
  )
}

/**
 * Defensive: a malformed / version-mismatched `data-task-view-config` must
 * never throw during document render — it degrades to the default config.
 * Unknown enum values fall back to defaults; filters are passed through only
 * when they are a plain object.
 */
export function parseTaskViewConfig(
  raw: string | null | undefined
): TaskViewConfig {
  if (!raw) return DEFAULT_TASK_VIEW_CONFIG
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_TASK_VIEW_CONFIG
    const obj = parsed as Record<string, unknown>
    const filters =
      obj.filters &&
      typeof obj.filters === 'object' &&
      !Array.isArray(obj.filters)
        ? (obj.filters as WorkspaceTaskFilterArgs)
        : {}
    return {
      version: 1,
      view: obj.view === 'kanban' ? 'kanban' : 'list',
      groupBy: isGroupBy(obj.groupBy) ? obj.groupBy : 'none',
      filters,
    }
  } catch {
    return DEFAULT_TASK_VIEW_CONFIG
  }
}
