interface TaskNode {
  id: string
  parentTaskId: string | null
  viewOrder: number | null
  teamIdentifier: string
  [key: string]: unknown
}

export type TaskWithChildren = TaskNode & { children: TaskWithChildren[] }

/** Build a tree from a flat list of tasks using parentTaskId linkage. */
export function buildTaskTree(tasks: TaskNode[]): TaskWithChildren[] {
  const map = new Map<string, TaskWithChildren>()
  const roots: TaskWithChildren[] = []

  for (const task of tasks) {
    map.set(task.id, { ...task, children: [] })
  }

  for (const task of tasks) {
    const node = map.get(task.id)!
    if (task.parentTaskId && map.has(task.parentTaskId)) {
      map.get(task.parentTaskId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}
