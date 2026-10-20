/**
 * LUM-1284: the task priority scale. `NONE` means "not assessed" and is the
 * default for new tasks, so an unassessed task no longer looks like a real
 * MEDIUM ruling. Ordering everywhere is URGENT > HIGH > MEDIUM > LOW > NONE
 * (unassessed sorts last).
 */
export const TASK_PRIORITIES = [
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
] as const

export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number]

/** Priorities a person actually assessed (everything but NONE). */
export const ASSESSED_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

/** Most urgent first; NONE last. For pickers, filters and segment order. */
export const PRIORITY_DISPLAY_ORDER: readonly TaskPriorityValue[] = [
  'URGENT',
  'HIGH',
  'MEDIUM',
  'LOW',
  'NONE',
]

/** Sort weight: lower sorts first (URGENT = 0 … NONE = 4). */
export const PRIORITY_SORT_WEIGHT: Record<TaskPriorityValue, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
}

/** Comparator: most urgent first, NONE (and unknown values) last. */
export function compareTaskPriority(a: string, b: string): number {
  const wa = PRIORITY_SORT_WEIGHT[a as TaskPriorityValue] ?? 5
  const wb = PRIORITY_SORT_WEIGHT[b as TaskPriorityValue] ?? 5
  return wa - wb
}
