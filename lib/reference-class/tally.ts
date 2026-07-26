import type { BoundaryCrossingDisposition } from '@prisma/client'
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
  disposition: BoundaryCrossingDisposition | null
}

/**
 * Does a disposed crossing still count as prior art for the class?
 *
 * A `Record<PrismaEnum, boolean>` rather than a string comparison, on purpose
 * and for the same reason copy.ts uses Record maps: adding a
 * BoundaryCrossingDisposition value to the schema without deciding here fails
 * `tsc --noEmit`, which the PR checklist already runs. A `=== 'CONFIRMED'`
 * check would have silently dropped the new value instead. The enum is
 * imported as a TYPE only — this module must stay free of runtime
 * `@prisma/client` imports.
 *
 * A null disposition (still open, not adjudicated) is handled at the call site
 * because it is the absence of a value, not one of them.
 */
export const CROSSING_DISPOSITION_COUNTS: Record<
  BoundaryCrossingDisposition,
  boolean
> = {
  CONFIRMED: true,
  // Already adjudicated as not-real — counting them would feed adjudicated
  // noise back to the next agent as evidence.
  FALSE_POSITIVE: false,
  AUTO_LEGIT: false,
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
 * Crossings worth showing as prior art: still open (no disposition yet) or a
 * disposition that {@link CROSSING_DISPOSITION_COUNTS} admits.
 */
export function crossingObservations(rows: CrossingRow[]): Observation[] {
  return rows
    .filter(
      r => r.disposition == null || CROSSING_DISPOSITION_COUNTS[r.disposition]
    )
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
