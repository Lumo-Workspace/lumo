import { cmpString, cmpDate } from '../hooks/useTableSort'
import { compareTaskPriority } from '@/lib/task/priority'

export type TaskOrdering =
  | 'manual'
  | 'title'
  | 'priority'
  | 'assignee'
  | 'created'
  | 'updated'

export const ORDERING_LABELS: Record<TaskOrdering, string> = {
  manual: 'Manual',
  title: 'Title',
  priority: 'Priority',
  assignee: 'Assignee',
  created: 'Created',
  updated: 'Updated',
}

export const ORDERING_OPTIONS: TaskOrdering[] = [
  'manual',
  'title',
  'priority',
  'assignee',
  'created',
  'updated',
]

// Fixed default direction per ordering field.
// Each can be overridden via the optional `direction` param.
const DEFAULT_DIRECTION: Record<TaskOrdering, 'asc' | 'desc'> = {
  manual: 'asc',
  title: 'asc',
  priority: 'asc', // URGENT=0 sorts first when ascending
  assignee: 'asc',
  created: 'desc', // newest first
  updated: 'desc', // newest first
}

interface SortableTask {
  order?: number
  title: string
  priority: string
  assignee?: {
    type: string
    member?: { clerkId: string } | null
    agent?: { name: string } | null
  } | null
  assigneeActorId?: string | null
  createdAt?: string
  updatedAt: string
}

/**
 * Returns the display name for an assignee, used for alphabetical sorting.
 * Agents have a name; human members are looked up via the optional getMemberName
 * callback. Unassigned tasks return an empty string so they sort last.
 */
function resolveAssigneeName(
  task: SortableTask,
  getMemberName?: (clerkId: string) => string | undefined
): string {
  if (!task.assignee) return ''
  if (task.assignee.type === 'AGENT') return task.assignee.agent?.name ?? ''
  if (task.assignee.member && getMemberName) {
    return getMemberName(task.assignee.member.clerkId) ?? ''
  }
  return ''
}

/**
 * Sort tasks by the given ordering field.
 *
 * @param tasks         Array of tasks to sort (not mutated)
 * @param ordering      Which field to order by
 * @param direction     Override the default sort direction for this ordering
 * @param getMemberName Optional lookup: clerkId → member display name (needed for assignee sort)
 */
export function sortTasks<T extends SortableTask>(
  tasks: T[],
  ordering: TaskOrdering,
  direction?: 'asc' | 'desc',
  getMemberName?: (clerkId: string) => string | undefined
): T[] {
  const dir = direction ?? DEFAULT_DIRECTION[ordering]
  const sign = dir === 'asc' ? 1 : -1

  return [...tasks].sort((a, b) => {
    let cmp: number

    switch (ordering) {
      case 'manual':
        cmp = (a.order ?? 0) - (b.order ?? 0)
        break

      case 'title':
        cmp = cmpString(a.title, b.title)
        break

      case 'priority': {
        // LUM-1284: unassessed (NONE) sorts last regardless of direction,
        // like unassigned in the assignee sort.
        const na = a.priority === 'NONE'
        const nb = b.priority === 'NONE'
        if (na && !nb) return 1
        if (!na && nb) return -1
        cmp = compareTaskPriority(a.priority, b.priority)
        break
      }

      case 'assignee': {
        const na = resolveAssigneeName(a, getMemberName)
        const nb = resolveAssigneeName(b, getMemberName)
        // Unassigned (empty string) sorts last regardless of direction
        if (!na && nb) return 1
        if (na && !nb) return -1
        cmp = cmpString(na, nb)
        break
      }

      case 'created':
        cmp = cmpDate(a.createdAt ?? '', b.createdAt ?? '')
        break

      case 'updated':
        cmp = cmpDate(a.updatedAt, b.updatedAt)
        break

      default:
        return 0
    }

    // Tiebreaker: updatedAt descending (most recently changed first)
    if (cmp === 0 && ordering !== 'updated') {
      return -cmpDate(a.updatedAt, b.updatedAt)
    }

    return sign * cmp
  })
}
