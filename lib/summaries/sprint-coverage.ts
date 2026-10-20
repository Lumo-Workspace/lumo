import type { SprintStatus, TaskStatus } from '@prisma/client'

/** One `(sprintId, status)` aggregation row from the repository groupBy. */
export interface SprintCoverageCountRow {
  sprintId: string | null
  status: TaskStatus
  count: number
}

/** Minimal sprint metadata needed to render a coverage row. */
export interface SprintMeta {
  id: string
  number: number
  name: string
  status: SprintStatus
}

export interface SprintCoverageEntry {
  sprintId: string
  number: number
  name: string
  status: SprintStatus
  taskCount: number
  doneCount: number
}

export interface SprintCoverage {
  /** Covered sprints, sorted by sprint number ascending. */
  sprints: SprintCoverageEntry[]
  /** Count of milestone tasks with no sprint binding. */
  unsprinted: number
}

/**
 * Derive a milestone's sprint coverage from `(sprintId, status)` task counts.
 * Pure and deterministic. `sprintId === null` rows accumulate into `unsprinted`.
 * Counts referencing a sprint absent from `sprints` are ignored. Sprints with
 * no tasks are dropped from the output.
 */
export function computeSprintCoverage(
  counts: SprintCoverageCountRow[],
  sprints: SprintMeta[]
): SprintCoverage {
  const metaById = new Map(sprints.map(s => [s.id, s]))
  const acc = new Map<string, { taskCount: number; doneCount: number }>()
  let unsprinted = 0

  for (const row of counts) {
    if (row.sprintId === null) {
      unsprinted += row.count
      continue
    }
    // BACKLOG is unscheduled and outside coverage (LUM-1057); CANCELED is not
    // delivered work and leaves it too (LUM-1282).
    if (
      !metaById.has(row.sprintId) ||
      row.status === 'BACKLOG' ||
      row.status === 'CANCELED'
    )
      continue
    const entry = acc.get(row.sprintId) ?? { taskCount: 0, doneCount: 0 }
    entry.taskCount += row.count
    if (row.status === 'DONE') entry.doneCount += row.count
    acc.set(row.sprintId, entry)
  }

  const result: SprintCoverageEntry[] = []
  for (const [sprintId, sums] of acc) {
    const meta = metaById.get(sprintId)!
    result.push({
      sprintId,
      number: meta.number,
      name: meta.name,
      status: meta.status,
      taskCount: sums.taskCount,
      doneCount: sums.doneCount,
    })
  }
  result.sort((a, b) => a.number - b.number)

  return { sprints: result, unsprinted }
}
