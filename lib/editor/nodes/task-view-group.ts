import type { ApiTask } from '@/app/workspace/[workspaceUrl]/types'

export interface TaskGroup {
  key: string
  label: string
  tasks: ApiTask[]
}

const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const
const STATUS_LABEL: Record<string, string> = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
}

/**
 * Bucket tasks for the task-view list. Pure + deterministic. `projectNames` /
 * `milestoneNames` map ids → display names (label falls back to the id).
 * `ungroupedLabel` is the (localized) header for tasks missing the group value.
 */
export function groupTasks(
  tasks: ApiTask[],
  groupBy: 'none' | 'status' | 'project' | 'milestone',
  projectNames: Record<string, string>,
  milestoneNames: Record<string, string>,
  ungroupedLabel: string
): TaskGroup[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: '', tasks }]
  }
  if (groupBy === 'status') {
    return STATUS_ORDER.map(s => ({
      key: s,
      label: STATUS_LABEL[s] ?? s,
      tasks: tasks.filter(t => t.status === s),
    })).filter(g => g.tasks.length > 0)
  }
  const idOf = (t: ApiTask): string | null =>
    groupBy === 'project' ? t.projectId : (t.milestoneId ?? null)
  const nameOf = (id: string): string =>
    (groupBy === 'project' ? projectNames[id] : milestoneNames[id]) ?? id

  const buckets = new Map<string, ApiTask[]>()
  const noneBucket: ApiTask[] = []
  for (const t of tasks) {
    const id = idOf(t)
    if (!id) {
      noneBucket.push(t)
      continue
    }
    const arr = buckets.get(id)
    if (arr) arr.push(t)
    else buckets.set(id, [t])
  }
  const groups: TaskGroup[] = [...buckets.entries()]
    .map(([id, ts]) => ({ key: id, label: nameOf(id), tasks: ts }))
    .sort((a, b) => a.label.localeCompare(b.label))
  if (noneBucket.length) {
    groups.push({ key: '__none__', label: ungroupedLabel, tasks: noneBucket })
  }
  return groups
}
