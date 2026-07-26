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

/** Task priorities that count as high-stakes on the declared-importance axis. */
export const HIGH_STAKES_PRIORITIES: readonly string[] = ['URGENT', 'HIGH']

export interface HighStakesConfig {
  /** Cumulative tokens across a task's sessions that count as heavy context. */
  minTokens: number
  /** Cumulative agent turns across a task's sessions that count as heavy. */
  minLoops: number
  /** Upper bound on how many tasks are surfaced as high-stakes. */
  maxItems: number
}

export const DEFAULT_HIGH_STAKES_CONFIG: HighStakesConfig = {
  minTokens: 200_000,
  minLoops: 30,
  maxItems: 4,
}

/** True when neither investment dimension was ever measured for this task. */
function isUnmeasured(sample: TaskContextSample): boolean {
  return sample.loopCount === null && sample.totalTokens === null
}

/**
 * Pick the stalled tasks that carry real stakes.
 *
 * High-stakes is deliberately a *subset* of stalled rather than a parallel
 * signal: what earns these tasks their own card is not that they are active —
 * they stopped — but that the stall costs something. Two independent ways a
 * stall can matter, and either alone qualifies:
 *
 *  - **declared importance** — the task is URGENT/HIGH priority, so somebody
 *    already said it matters, however little work has gone in;
 *  - **sunk investment** — a lot of measured agent context piled up before it
 *    stopped, so restarting is expensive even if nobody ever flagged it.
 *
 * Neither dimension subsumes the other: a freshly-filed URGENT task has no
 * investment yet, and a heavily-reworked LOW task was never declared
 * important. Requiring *both* would hide exactly the cases worth surfacing.
 *
 * A task that is neither declared important nor measurably heavy is never
 * selected. Treating its null spend as 0 would silently rank it "cheap";
 * claiming it heavy would be fabrication. Unknown stays unknown — it still
 * appears in the full stalled table below, it just isn't promoted.
 */
export function selectHighStakesStalls(input: {
  /** Each item carries its own priority — the declared-importance axis. */
  stalled: StalledBlockerItem[]
  /** taskId → accumulated session context, for the sunk-investment axis. */
  context: Map<string, TaskContextSample>
  config?: HighStakesConfig
}): StalledBlockerItem[] {
  const { stalled, context } = input
  const config = input.config ?? DEFAULT_HIGH_STAKES_CONFIG

  const scored: Array<{ item: StalledBlockerItem; weight: number }> = []

  for (const item of stalled) {
    const isDeclaredImportant = HIGH_STAKES_PRIORITIES.includes(item.priority)

    const sample = context.get(item.id)
    const measured = sample && !isUnmeasured(sample) ? sample : null
    const heavyTokens =
      measured?.totalTokens != null && measured.totalTokens >= config.minTokens
    const heavyLoops =
      measured?.loopCount != null && measured.loopCount >= config.minLoops
    const isHeavilyInvested = heavyTokens || heavyLoops

    if (!isDeclaredImportant && !isHeavilyInvested) continue

    // Rank by measured spend where it exists, so the heaviest surface first. A
    // task qualifying purely on priority has no spend to rank on — it sorts on
    // the importance bonus alone rather than being scored as zero-cost.
    const spend =
      measured?.totalTokens ?? (measured?.loopCount ?? 0) * config.minTokens
    const weight = spend + (isDeclaredImportant ? config.minTokens : 0)
    scored.push({ item, weight })
  }

  return scored
    .sort((a, b) => b.weight - a.weight)
    .slice(0, config.maxItems)
    .map(s => s.item)
}
