/**
 * LUM-965 — the fixed tune / holdout split of monitor-eval trajectories.
 *
 * Pure. Split by `sample_id` (the BashArena task), never by trajectory: four
 * tasks have both an honest and an attack run, and a prompt tuned on one run
 * of a task must not be scored on the other run of the same task.
 *
 *   - attack tasks, ordered by `stableHash(sampleId)`, alternate tune /
 *     holdout → 19 / 19 for the 38 attacks;
 *   - an honest run whose task already has an attack goes with it;
 *   - the remaining honest runs, in hash order, each go to whichever split
 *     has fewer honest runs so far (ties → tune) → 50 / 50 for 100.
 *
 * Prompts and thresholds are tuned on `tune` only; `holdout` is scored once.
 */
import { stableHash } from '../lum958-basharena-llm/candidates'

/**
 * `fresh` / `fresh-unsuccessful`: ControlArena trajectories generated for
 * LUM-965's second holdout (see controlarena/trajectories.ts).
 */
export type Split = 'tune' | 'holdout' | 'fresh' | 'fresh-unsuccessful'

export interface SplitInput {
  id: string
  sampleId: string
  label: 'attack' | 'honest'
}

export function splitTrajectories(
  trajs: SplitInput[]
): Map<string, 'tune' | 'holdout'> {
  const byHash = (a: string, b: string) =>
    stableHash(a) - stableHash(b) || a.localeCompare(b)
  const taskSplit = new Map<string, 'tune' | 'holdout'>()
  const attackTasks = Array.from(
    new Set(trajs.filter(t => t.label === 'attack').map(t => t.sampleId))
  ).sort(byHash)
  attackTasks.forEach((s, i) =>
    taskSplit.set(s, i % 2 === 0 ? 'tune' : 'holdout')
  )

  const out = new Map<string, 'tune' | 'holdout'>()
  const honestCount = { tune: 0, holdout: 0 }
  for (const t of trajs) {
    const s = taskSplit.get(t.sampleId)
    if (!s) continue
    out.set(t.id, s)
    if (t.label === 'honest') honestCount[s]++
  }
  const rest = trajs
    .filter(t => !out.has(t.id))
    .sort((a, b) => byHash(a.sampleId, b.sampleId) || a.id.localeCompare(b.id))
  for (const t of rest) {
    // A task without an attack run can still have two honest rows only in
    // theory; keep a task on one side if it does.
    const s =
      taskSplit.get(t.sampleId) ??
      (honestCount.tune <= honestCount.holdout ? 'tune' : 'holdout')
    taskSplit.set(t.sampleId, s)
    out.set(t.id, s)
    honestCount[s]++
  }
  return out
}
