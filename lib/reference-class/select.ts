import {
  MAX_CLASS_SIZE,
  MIN_CLASS_SIZE,
  type CandidateLayers,
  type ClassLevel,
  type DeliveredTask,
  type ReferenceClass,
} from './types'

/**
 * Collapse repeat deliveries to one row per task (keeping the most recent),
 * newest first. A reopened task that delivered twice must not count twice.
 */
function latestPerTask(rows: DeliveredTask[]): DeliveredTask[] {
  const byTask = new Map<string, DeliveredTask>()
  for (const row of rows) {
    const prior = byTask.get(row.taskId)
    if (!prior || prior.frozenAt.getTime() < row.frozenAt.getTime()) {
      byTask.set(row.taskId, row)
    }
  }
  return [...byTask.values()].sort(
    (a, b) => b.frozenAt.getTime() - a.frozenAt.getTime()
  )
}

/**
 * Pick the reference class: narrowest layer that clears MIN_CLASS_SIZE, each
 * layer capped at the MAX_CLASS_SIZE most recent deliveries. The task being
 * drafted is always excluded — it has not delivered, and including it would
 * make the class partly self-referential.
 *
 * Reporting INSUFFICIENT is a correct outcome, not a failure: a distribution
 * over three tasks would read as evidence while carrying none.
 */
export function selectReferenceClass(
  layers: CandidateLayers,
  excludeTaskId: string
): ReferenceClass {
  const ordered: Array<[ClassLevel, DeliveredTask[] | null]> = [
    ['MILESTONE', layers.milestone],
    ['PROJECT', layers.project],
    ['WORKSPACE', layers.workspace],
  ]

  for (const [level, rows] of ordered) {
    if (rows == null) continue
    const eligible = latestPerTask(
      rows.filter(r => r.taskId !== excludeTaskId)
    ).slice(0, MAX_CLASS_SIZE)
    if (eligible.length >= MIN_CLASS_SIZE) {
      return {
        kind: 'SELECTED',
        level,
        taskIds: eligible.map(r => r.taskId),
        size: eligible.length,
      }
    }
  }
  return { kind: 'INSUFFICIENT' }
}
