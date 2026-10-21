/**
 * LUM-1281 — where a closed sprint's carried-over tasks went.
 *
 * Folds the SPRINT_CHANGED activities written when tasks left the sprint
 * (`payload.fromSprintId === sprintId`, the same rows the summary counts as
 * `stats.spillover`) into one row per task: the task's latest move out wins.
 * `to: null` means the payload sent the task back to the backlog.
 *
 * Pure — no prisma, repository or service imports (client-safe DTO types).
 */

export interface SprintSpilloverItem {
  taskId: string
  identifier: string
  title: string
  /** Destination sprint; null = back to the backlog. */
  to: { number: number; name: string } | null
}

export interface SpilloverActivity {
  taskId: string
  payload: unknown
}

export interface SpilloverTaskRef {
  id: string
  identifier: string
  title: string
}

export interface SpilloverSprintRef {
  id: string
  number: number
  name: string
}

/** The destination sprint id a SPRINT_CHANGED payload names; null = backlog. */
export function spilloverDestinationId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const to = (payload as { toSprintId?: unknown }).toSprintId
  return typeof to === 'string' ? to : null
}

/** Latest destination id per task, from activities ordered oldest first. */
export function latestDestinations(
  activities: SpilloverActivity[]
): Map<string, string | null> {
  const byTask = new Map<string, string | null>()
  for (const a of activities)
    byTask.set(a.taskId, spilloverDestinationId(a.payload))
  return byTask
}

/**
 * One row per carried-over task, in `tasks` order. Tasks the caller cannot
 * see (other workspace, trashed) are absent from `tasks` and so dropped; a
 * destination sprint that no longer resolves reads as the backlog.
 */
export function foldSpillover(
  destinations: Map<string, string | null>,
  tasks: SpilloverTaskRef[],
  sprints: SpilloverSprintRef[]
): SprintSpilloverItem[] {
  const sprintById = new Map(sprints.map(s => [s.id, s]))
  const items: SprintSpilloverItem[] = []
  for (const t of tasks) {
    if (!destinations.has(t.id)) continue
    const toId = destinations.get(t.id) ?? null
    const to = toId ? sprintById.get(toId) : undefined
    items.push({
      taskId: t.id,
      identifier: t.identifier,
      title: t.title,
      to: to ? { number: to.number, name: to.name } : null,
    })
  }
  return items
}
