import type { StalledBlockerItem } from '@/types/summary'

/**
 * Accumulated agent context for one task, aggregated across its sessions.
 *
 * `loopCount` and `totalTokens` are nullable on purpose: Session token columns
 * stay null until a STOP hook carries usage, and historical rows are never
 * backfilled. **Null means "not measured", never "spent zero"** — a task whose
 * sessions never reported usage is unknown, not cheap, so it must not be
 * compared against a threshold as if it were 0.
 */
export interface TaskContextSample {
  taskId: string
  sessionCount: number
  loopCount: number | null
  totalTokens: number | null
}

export interface HighContextConfig {
  /** Cumulative tokens across a task's sessions that count as heavy context. */
  minTokens: number
  /** Cumulative agent turns across a task's sessions that count as heavy. */
  minLoops: number
  /** Upper bound on how many tasks are surfaced as high-context. */
  maxItems: number
}

export const DEFAULT_HIGH_CONTEXT_CONFIG: HighContextConfig = {
  minTokens: 200_000,
  minLoops: 30,
  maxItems: 4,
}

/** True when neither investment dimension was ever measured for this task. */
function isUnmeasured(sample: TaskContextSample): boolean {
  return sample.loopCount === null && sample.totalTokens === null
}

/**
 * Pick the stalled tasks that also carry heavy accumulated context.
 *
 * High-context is deliberately a *subset* of stalled rather than a parallel
 * signal: what makes these tasks worth their own card is not that they are
 * active, but that a lot has already been spent on them and they stopped
 * anyway — the restart cost is high and the sunk context is easy to lose.
 *
 * A task with no measurement on either dimension is never selected. Treating
 * its null as 0 would silently rank it "cheap"; claiming it heavy would be
 * fabrication. Unknown stays unknown, and it still appears in the full stalled
 * table below — it just isn't promoted.
 */
export function selectHighContextTasks(input: {
  stalled: StalledBlockerItem[]
  context: Map<string, TaskContextSample>
  config?: HighContextConfig
}): StalledBlockerItem[] {
  const { stalled, context } = input
  const config = input.config ?? DEFAULT_HIGH_CONTEXT_CONFIG

  const scored: Array<{ item: StalledBlockerItem; weight: number }> = []

  for (const item of stalled) {
    const sample = context.get(item.id)
    if (!sample || isUnmeasured(sample)) continue

    const heavyTokens =
      sample.totalTokens !== null && sample.totalTokens >= config.minTokens
    const heavyLoops =
      sample.loopCount !== null && sample.loopCount >= config.minLoops
    if (!heavyTokens && !heavyLoops) continue

    // Rank by tokens when measured, else fall back to turns scaled into a
    // comparable band so a loops-only task still sorts sensibly against a
    // token-measured one.
    const weight =
      sample.totalTokens ?? (sample.loopCount ?? 0) * config.minTokens
    scored.push({ item, weight })
  }

  return scored
    .sort((a, b) => b.weight - a.weight)
    .slice(0, config.maxItems)
    .map(s => s.item)
}
