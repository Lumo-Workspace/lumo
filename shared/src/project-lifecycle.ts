/**
 * LUM-1285: project lifecycle rules shared by the server and the CLI.
 *
 * A project's `status` (ACTIVE / PAUSED / CANCELED) and `archivedAt` are human
 * rulings. "Completed" is never stored: it is derived here, for display only,
 * from the project's task counts. Pure — no I/O — so both sides read the same
 * rule.
 */

export const PROJECT_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELED'] as const
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number]

/** Parse a user-typed status (case-insensitive); null when unknown. */
export function parseProjectStatus(raw: string): ProjectStatusValue | null {
  const upper = raw.trim().toUpperCase()
  return (PROJECT_STATUSES as readonly string[]).includes(upper)
    ? (upper as ProjectStatusValue)
    : null
}

/**
 * Task statuses that count as closed for derived project completion. The one
 * place to add a closed status (e.g. a CANCELED task status) later.
 */
export const CLOSED_TASK_STATUSES: readonly string[] = ['DONE']

export function isClosedTaskStatus(status: string): boolean {
  return CLOSED_TASK_STATUSES.includes(status)
}

/**
 * Derived completion: at least one task, and none of them open. `counts` maps
 * task status → number of (non-deleted) tasks in that status.
 */
export function isProjectCompleted(
  counts: Readonly<Record<string, number | undefined>>
): boolean {
  let total = 0
  let open = 0
  for (const [status, n] of Object.entries(counts)) {
    const c = n ?? 0
    total += c
    if (!isClosedTaskStatus(status)) open += c
  }
  return total > 0 && open === 0
}

/** The lifecycle fields a project row carries; absent on older servers. */
export interface ProjectLifecycleLike {
  status?: string | null | undefined
  archivedAt?: string | Date | null | undefined
}

/**
 * Should agents pick up work in this project? Only an ACTIVE, unarchived one.
 * A row without the fields (older server) counts as workable — fail open, the
 * same as before the fields existed.
 */
export function isProjectWorkable(p: ProjectLifecycleLike): boolean {
  if (p.archivedAt) return false
  return (p.status ?? 'ACTIVE') === 'ACTIVE'
}

/**
 * What task create does in this project: `refuse` for a CANCELED or archived
 * project, `warn` for a PAUSED one, `allow` otherwise.
 */
export type TaskCreateGate =
  | { kind: 'allow' }
  | { kind: 'warn'; reason: 'paused' }
  | { kind: 'refuse'; reason: 'canceled' | 'archived' }

export function taskCreateGate(p: ProjectLifecycleLike): TaskCreateGate {
  if (p.archivedAt) return { kind: 'refuse', reason: 'archived' }
  if (p.status === 'CANCELED') return { kind: 'refuse', reason: 'canceled' }
  if (p.status === 'PAUSED') return { kind: 'warn', reason: 'paused' }
  return { kind: 'allow' }
}

/**
 * Date-window rule: when both are set, the target may not precede the start.
 * Accepts Date or anything `new Date()` parses; null/undefined means unset.
 */
export function isValidProjectDateWindow(
  start: Date | string | null | undefined,
  target: Date | string | null | undefined
): boolean {
  if (!start || !target) return true
  return new Date(target).getTime() >= new Date(start).getTime()
}
