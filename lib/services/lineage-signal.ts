import type {
  FragmentMergeRate,
  FragmentUsageRate,
  FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'
import type { ContextFragmentType } from '@/lib/services/task-context.service'
import { toLineageFragmentType } from '@/lib/lineage/fragment-type'
import { logger } from '@/lib/logger'

/**
 * Cold-start gate: a fragment must have appeared in at least this many RESOLVED
 * (non-UNKNOWN-outcome) tasks before we print a merge-rate signal for it.
 * Hardwired — "don't promise intelligence" below the sample floor.
 */
export const LINEAGE_MIN_RESOLVED_TASKS = 3

/** Cold-start gate for the stronger usage signal: a fragment must have been
 * voted used=true in at least this many resolved tasks before its usage-based
 * merge rate is shown (else it falls back to the presence signal). */
export const LINEAGE_MIN_USED_TASKS = 3

const LABEL_MAX = 60

export interface LineageSignalEntry {
  label: string
  resolvedTasks: number
  mergedTasks: number
}

export interface UsageSignalEntry {
  label: string
  usedResolvedTasks: number
  usedMergedTasks: number
}

/** A per-fragment trust verdict derived from lineage edges, calibrated per
 * LUM-300: a strong `usage` signal (agent voted it used) preferred over a weak
 * `presence` signal (merely co-loaded). Unqualified fragments get NO verdict. */
export interface TrustVerdict {
  kind: 'usage' | 'presence'
  /** Denominator: distinct resolved tasks (usage → used-resolved). */
  resolvedTasks: number
  /** Numerator: distinct merged tasks (usage → used-merged). */
  mergedTasks: number
  /** Math.round(merged / resolved * 100). */
  pct: number
}

/** Pre-fetched aggregate inputs for {@link computeFragmentTrust}. */
export interface TrustStats {
  /** countResolvedTasks() — global distinct tasks with a resolved edge. */
  universe: number
  presence: FragmentMergeRate[]
  usage: FragmentUsageRate[]
}

export interface FragmentTrustResult {
  /** Qualifying verdicts keyed by `${fragmentType}::${fragmentId}`, insertion
   * order = first-seen order of `refs`. */
  verdicts: Map<string, TrustVerdict>
  /** Count of deduped fragments dropped for zero presence-variance (appeared in
   * every resolved task). Backs the CLI's "已排除 N 个全量加载" note. */
  excludedZeroVariance: number
}

function trustKey(fragmentType: string, fragmentId: string): string {
  return `${fragmentType}::${fragmentId}`
}

/**
 * Pure trust scoring. Iterates `refs` (deduped, first-seen order), and for each:
 *   1. usage signal if usedResolvedTasks >= LINEAGE_MIN_USED_TASKS → kind 'usage'
 *   2. else presence: needs a stat, NOT zero-variance (resolvedTasks===universe
 *      when universe>0 → excluded+counted), and resolvedTasks >= the cold-start
 *      floor → kind 'presence'
 *   3. else no verdict.
 * No I/O — all gating lives here so the CLI markdown and web badge never drift.
 */
export function computeFragmentTrust(
  refs: FragmentRef[],
  stats: TrustStats
): FragmentTrustResult {
  const presenceByKey = new Map(
    stats.presence.map(s => [trustKey(s.fragmentType, s.fragmentId), s])
  )
  const usageByKey = new Map(
    stats.usage.map(s => [trustKey(s.fragmentType, s.fragmentId), s])
  )

  const verdicts = new Map<string, TrustVerdict>()
  let excludedZeroVariance = 0
  const seen = new Set<string>()

  for (const ref of refs) {
    const key = trustKey(ref.fragmentType, ref.fragmentId)
    if (seen.has(key)) continue
    seen.add(key)

    const usage = usageByKey.get(key)
    if (usage && usage.usedResolvedTasks >= LINEAGE_MIN_USED_TASKS) {
      verdicts.set(key, {
        kind: 'usage',
        resolvedTasks: usage.usedResolvedTasks,
        mergedTasks: usage.usedMergedTasks,
        pct: Math.round(
          (usage.usedMergedTasks / usage.usedResolvedTasks) * 100
        ),
      })
      continue
    }

    const stat = presenceByKey.get(key)
    if (!stat) continue
    if (stats.universe > 0 && stat.resolvedTasks === stats.universe) {
      excludedZeroVariance++
      continue
    }
    if (stat.resolvedTasks < LINEAGE_MIN_RESOLVED_TASKS) continue
    verdicts.set(key, {
      kind: 'presence',
      resolvedTasks: stat.resolvedTasks,
      mergedTasks: stat.mergedTasks,
      pct: Math.round((stat.mergedTasks / stat.resolvedTasks) * 100),
    })
  }

  return { verdicts, excludedZeroVariance }
}

/**
 * Pure render: usage signal first (strong), presence fallback (weak), then the
 * zero-variance-exclusion note. Returns "" only when there's nothing to say.
 */
export function renderLineageSection(
  usageEntries: UsageSignalEntry[],
  presenceEntries: LineageSignalEntry[],
  excludedCount: number
): string {
  const presenceQualifying = presenceEntries.filter(
    e => e.resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS
  )
  if (
    usageEntries.length === 0 &&
    presenceQualifying.length === 0 &&
    excludedCount === 0
  ) {
    return ''
  }

  const note =
    excludedCount > 0
      ? [
          '',
          `> 已排除 ${excludedCount} 个全量加载(零存在方差)的 fragment:它们出现在每个已闭合任务里,merge 率等于团队 base rate,无判别力。`,
        ]
      : []

  return [
    '## 飞轮信号 · 历史 merge 贡献',
    '',
    '> 口径:优先「真实使用信号」(agent 完结时投票用过的);样本不足回退到「仅共同加载」弱信号。分母 = 去重已闭合任务,分子 = 其中 merged。历史相关性,非因果。',
    '',
    ...usageEntries.map(formatUsageSignalLine),
    ...presenceQualifying.map(
      e => `${formatLineageSignalLine(e)} · 仅共同加载,弱信号`
    ),
    ...note,
  ].join('\n')
}

export function formatLineageSignalLine(e: LineageSignalEntry): string {
  // resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS (>=1) here, so no divide-by-zero.
  const pct = Math.round((e.mergedTasks / e.resolvedTasks) * 100)
  return `- ${e.label} — 出现在 ${e.resolvedTasks} 个已闭合任务·${e.mergedTasks} merged (${pct}%)`
}

export function formatUsageSignalLine(e: UsageSignalEntry): string {
  // usedResolvedTasks >= LINEAGE_MIN_USED_TASKS (>=1) here, so no divide-by-zero.
  const pct = Math.round((e.usedMergedTasks / e.usedResolvedTasks) * 100)
  return `- ${e.label} — 用过的 ${e.usedResolvedTasks} 个已闭合任务·${e.usedMergedTasks} merged (${pct}%) · 真实使用信号`
}

function fragmentLabel(
  type: ContextFragmentType,
  id: string,
  memoryContentById: Map<string, string>
): string {
  if (type === 'MEMORY') {
    const content = memoryContentById.get(id)
    if (content && content.trim().length > 0) {
      const oneLine = content.replace(/\s+/g, ' ').trim()
      const snippet =
        oneLine.length > LABEL_MAX ? `${oneLine.slice(0, LABEL_MAX)}…` : oneLine
      return `[MEMORY] "${snippet}"`
    }
  }
  return `[${type}] ${id.slice(0, 8)}`
}

export interface LineageSignalDeps {
  resolveCanonicalFragment: (type: string, id: string) => Promise<string>
  mergeRateByFragments: (refs: FragmentRef[]) => Promise<FragmentMergeRate[]>
  usageMergeRateByFragments: (
    refs: FragmentRef[]
  ) => Promise<FragmentUsageRate[]>
  countResolvedTasks: () => Promise<number>
}

/**
 * Build the trailing flywheel-signal markdown for a task's context fragments.
 * Maps each fragment to its lineage type, resolves MEMORY ids to canonical
 * (matching how edges were keyed at birth), joins task-deduped merge stats,
 * applies the cold-start gate, and renders. Never throws — any failure degrades
 * to "" so the rest of the context handoff is unaffected.
 */
export async function assembleLineageSection(
  fragments: { type: ContextFragmentType; id: string }[],
  memoryContentById: Map<string, string>,
  deps: LineageSignalDeps
): Promise<string> {
  try {
    const inputs: { ref: FragmentRef; label: string }[] = []
    for (const f of fragments) {
      const lineageType = toLineageFragmentType(f.type)
      if (!lineageType) continue
      const canonicalId = await deps.resolveCanonicalFragment(lineageType, f.id)
      inputs.push({
        ref: { fragmentType: lineageType, fragmentId: canonicalId },
        label: fragmentLabel(f.type, f.id, memoryContentById),
      })
    }
    if (inputs.length === 0) return ''

    const refs = inputs.map(i => i.ref)
    const [universe, presenceStats, usageStats] = await Promise.all([
      deps.countResolvedTasks(),
      deps.mergeRateByFragments(refs),
      deps.usageMergeRateByFragments(refs),
    ])
    const presenceByKey = new Map(
      presenceStats.map(s => [`${s.fragmentType}::${s.fragmentId}`, s])
    )
    const usageByKey = new Map(
      usageStats.map(s => [`${s.fragmentType}::${s.fragmentId}`, s])
    )

    const usageEntries: UsageSignalEntry[] = []
    const presenceEntries: LineageSignalEntry[] = []
    let excludedCount = 0
    const seen = new Set<string>()
    for (const input of inputs) {
      const key = `${input.ref.fragmentType}::${input.ref.fragmentId}`
      if (seen.has(key)) continue
      seen.add(key)

      // Prefer the real "agent used it" signal once it has enough sample.
      const usage = usageByKey.get(key)
      if (usage && usage.usedResolvedTasks >= LINEAGE_MIN_USED_TASKS) {
        usageEntries.push({
          label: input.label,
          usedResolvedTasks: usage.usedResolvedTasks,
          usedMergedTasks: usage.usedMergedTasks,
        })
        continue
      }

      // Fall back to presence — but drop zero-variance "always loaded" fragments.
      const stat = presenceByKey.get(key)
      if (!stat) continue
      if (universe > 0 && stat.resolvedTasks === universe) {
        excludedCount++
        continue
      }
      presenceEntries.push({
        label: input.label,
        resolvedTasks: stat.resolvedTasks,
        mergedTasks: stat.mergedTasks,
      })
    }
    return renderLineageSection(usageEntries, presenceEntries, excludedCount)
  } catch (err) {
    logger.error('assembleLineageSection failed; omitting flywheel signal', err)
    return ''
  }
}
