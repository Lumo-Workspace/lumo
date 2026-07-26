import { TOP_N, type TallyEntry } from './types'

/** One (task, signal value) observation; a null key is "not classified". */
export interface Observation {
  taskId: string
  key: string | null
}

/** A boundary crossing reduced to what the tally needs. */
export interface CrossingRow {
  taskId: string
  category: string
  disposition: string | null
}

/**
 * Count DISTINCT TASKS per key, descending, ties broken by key name so the
 * same input always renders the same line. Per-task dedupe is the point: the
 * anchor answers "how many tasks in this class hit X", not "how many rows".
 */
export function tallyByTask(obs: Observation[], topN = TOP_N): TallyEntry[] {
  const tasksByKey = new Map<string, Set<string>>()
  for (const o of obs) {
    if (o.key == null) continue
    const tasks = tasksByKey.get(o.key) ?? new Set<string>()
    tasks.add(o.taskId)
    tasksByKey.set(o.key, tasks)
  }
  return [...tasksByKey.entries()]
    .map(([key, tasks]) => ({ key, count: tasks.size }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, topN)
}

/**
 * Crossings worth showing as prior art: still open (no disposition yet) or
 * judged CONFIRMED. FALSE_POSITIVE and AUTO_LEGIT were already adjudicated as
 * not-real — counting them would feed adjudicated noise back as evidence.
 */
export function crossingObservations(rows: CrossingRow[]): Observation[] {
  return rows
    .filter(r => r.disposition == null || r.disposition === 'CONFIRMED')
    .map(r => ({ taskId: r.taskId, key: r.category }))
}

/**
 * How many tasks in the class delivered a contract that was still being
 * added to / edited after work started (LUM-610 independence signal, one
 * signal per task).
 */
export function countPostStartContractTasks(
  signals: Array<{ postStartChanges: number }>
): number {
  return signals.filter(s => s.postStartChanges > 0).length
}
