/**
 * Task-board filtering: the dimensions the Filter control offers, the value a
 * task carries in each of them, and the predicate that combines a selection.
 *
 * Semantics — **OR within a dimension, AND across dimensions**: picking two
 * statuses widens (either status matches), adding a priority narrows (status
 * AND priority must both match). That is the shape every issue tracker uses,
 * and the one the chips row reads as.
 *
 * Everything here is pure — `now` is passed in (from `useNow`) rather than read
 * off the clock, so filtering can run inside a render-time `useMemo` without
 * breaking render purity.
 */

/**
 * The only fields filtering reads. Structural rather than `MyTask` so the same
 * control serves the project tab (`ApiTask`) and the sprint / milestone / My
 * Tasks boards (`MyTask`) without either shape having to grow toward the other.
 */
export interface FilterableTask {
  status: string
  priority: string
  assigneeActorId: string | null
  projectId: string
  dueDate?: string | null
  tags?: { id: string; name: string }[] | undefined
  project?: { name: string } | undefined
  sprintId?: string | null | undefined
  sprint?: { name: string } | null | undefined
  milestoneId?: string | null | undefined
  milestone?:
    | { name: string; status?: string; archivedAt?: string | null }
    | null
    | undefined
  assignee?: { agent?: { name: string } | null } | null | undefined
}

export const FILTER_DIMENSIONS = [
  'status',
  'priority',
  'assignee',
  'project',
  'milestone',
  'sprint',
  'tag',
  'dueDate',
] as const

export type FilterDimension = (typeof FILTER_DIMENSIONS)[number]

/** Selected values per dimension. A dimension with no entry is not filtering. */
export type TaskFilters = Partial<Record<FilterDimension, string[]>>

/** Sentinel values for "the task has nothing in this dimension". */
export const UNASSIGNED_VALUE = '__unassigned__'
export const UNTAGGED_VALUE = '__untagged__'
export const NO_SPRINT_VALUE = '__no_sprint__'
export const NO_MILESTONE_VALUE = '__no_milestone__'

export const DUE_DATE_BUCKETS = [
  'overdue',
  'today',
  'next7',
  'later',
  'none',
] as const

export type DueDateBucket = (typeof DUE_DATE_BUCKETS)[number]

const DAY_MS = 86_400_000

/** Canonical display order per dimension; dimensions absent here sort by count. */
const CANONICAL_ORDER: Partial<Record<FilterDimension, readonly string[]>> = {
  status: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'],
  priority: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'],
  dueDate: DUE_DATE_BUCKETS,
}

/** Active = the milestone is being worked now: ACTIVE status, not archived. */
export function isActiveMilestone(
  milestone: FilterableTask['milestone']
): boolean {
  if (!milestone) return false
  return milestone.status === 'ACTIVE' && !milestone.archivedAt
}

/**
 * Which due-date bucket a task falls in, relative to `now`.
 *
 * Day boundaries are the viewer's **local** calendar days — deliberately the
 * same convention `formatDueDate` / `isOverdue` render with, so a task labelled
 * "Today" in the list can never land in the `overdue` filter bucket.
 */
export function dueDateBucket(
  due: string | null | undefined,
  now: number
): DueDateBucket {
  if (!due) return 'none'
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return 'none'
  d.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / DAY_MS)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 7) return 'next7'
  return 'later'
}

/**
 * The value(s) a task carries in one dimension. Single-valued everywhere except
 * tags, where a task matches if **any** of its tags is selected.
 */
export function taskFilterValues(
  task: FilterableTask,
  dimension: FilterDimension,
  now: number | null
): string[] {
  switch (dimension) {
    case 'status':
      return [task.status]
    case 'priority':
      return [task.priority]
    case 'assignee':
      return [task.assigneeActorId ?? UNASSIGNED_VALUE]
    case 'project':
      return [task.projectId]
    case 'milestone':
      if (!task.milestoneId) return [NO_MILESTONE_VALUE]
      // Only *active* milestones are in play. A task in a planned / completed /
      // cancelled / archived milestone carries no milestone value at all — it
      // is neither offered as an option nor swept into the "no milestone"
      // bucket (it does have one, just not one this filter reasons about).
      // A milestoneId with no milestone object (stale cached payload) can't be
      // confirmed active, so it is treated the same way.
      return isActiveMilestone(task.milestone) ? [task.milestoneId] : []
    case 'sprint':
      // Sentinel rather than "skip": "not in a sprint" (backlog) is a state
      // people filter *for*, not an absence to be hidden.
      return [task.sprintId ?? NO_SPRINT_VALUE]
    case 'tag': {
      const ids = (task.tags ?? []).map(t => t.id)
      return ids.length > 0 ? ids : [UNTAGGED_VALUE]
    }
    case 'dueDate':
      // `now` is null until the client has mounted (`useNow`); with no clock
      // there is no honest bucket, so the dimension simply carries no value.
      return now === null ? [] : [dueDateBucket(task.dueDate, now)]
  }
}

/** Dimensions with at least one selected value, in canonical dimension order. */
export function activeFilterDimensions(
  filters: TaskFilters
): FilterDimension[] {
  return FILTER_DIMENSIONS.filter(d => (filters[d]?.length ?? 0) > 0)
}

/** How many dimensions are narrowing the list — the Filter button's badge. */
export function countActiveFilters(filters: TaskFilters): number {
  return activeFilterDimensions(filters).length
}

/**
 * Apply a selection. An empty selection returns the input array untouched.
 *
 * A `null` clock (pre-mount) makes the due-date dimension inert rather than
 * dropping every task — the list is briefly unnarrowed on that one axis, which
 * is the honest rendering of "the clock isn't known yet".
 */
export function filterTasks<T extends FilterableTask>(
  tasks: T[],
  filters: TaskFilters,
  now: number | null
): T[] {
  const active = activeFilterDimensions(filters).filter(
    d => d !== 'dueDate' || now !== null
  )
  if (active.length === 0) return tasks
  return tasks.filter(task =>
    active.every(dimension => {
      const selected = filters[dimension] as string[]
      return taskFilterValues(task, dimension, now).some(v =>
        selected.includes(v)
      )
    })
  )
}

export interface FilterValueCount {
  value: string
  /** How many tasks in scope carry this value. */
  count: number
}

/**
 * The distinct values present in `tasks` for a dimension, with counts.
 *
 * Options are derived from the tasks actually in scope, which is what makes the
 * control self-adjusting: a dimension every task agrees on (project on a
 * single-project board, assignee on My Tasks) yields one option and is dropped
 * from the menu by {@link narrowableDimensions} — no per-scope config needed.
 */
export function dimensionValueCounts(
  tasks: FilterableTask[],
  dimension: FilterDimension,
  now: number | null
): FilterValueCount[] {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    for (const value of taskFilterValues(task, dimension, now)) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  const canonical = CANONICAL_ORDER[dimension]
  const entries = [...counts.entries()].map(([value, count]) => ({
    value,
    count,
  }))
  if (canonical) {
    return entries.sort(
      (a, b) => canonical.indexOf(a.value) - canonical.indexOf(b.value)
    )
  }
  return entries.sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value)
  )
}

/**
 * Dimensions worth offering for this task set — those with more than one
 * distinct value, plus any dimension already being filtered on (so an active
 * chip never loses its menu entry once the list narrows to one value).
 */
export function narrowableDimensions(
  tasks: FilterableTask[],
  filters: TaskFilters,
  now: number | null
): FilterDimension[] {
  const active = new Set(activeFilterDimensions(filters))
  return FILTER_DIMENSIONS.filter(
    d => active.has(d) || dimensionValueCounts(tasks, d, now).length > 1
  )
}

/** Drop unknown dimensions / non-string values — used when reading storage. */
export function normalizeFilters(raw: unknown): TaskFilters {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const out: TaskFilters = {}
  for (const dimension of FILTER_DIMENSIONS) {
    const values = source[dimension]
    if (!Array.isArray(values)) continue
    const cleaned = [...new Set(values.filter(v => typeof v === 'string'))]
    if (cleaned.length > 0) out[dimension] = cleaned
  }
  return out
}

/** Add/remove one value in a dimension, dropping the key when it empties. */
export function toggleFilterValue(
  filters: TaskFilters,
  dimension: FilterDimension,
  value: string
): TaskFilters {
  const current = filters[dimension] ?? []
  const next = current.includes(value)
    ? current.filter(v => v !== value)
    : [...current, value]
  const out = { ...filters }
  if (next.length > 0) out[dimension] = next
  else delete out[dimension]
  return out
}

/** Remove a whole dimension — what a chip's × does. */
export function clearFilterDimension(
  filters: TaskFilters,
  dimension: FilterDimension
): TaskFilters {
  const out = { ...filters }
  delete out[dimension]
  return out
}
