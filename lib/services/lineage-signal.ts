import type {
  FragmentMergeRate,
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

const LABEL_MAX = 60

export interface LineageSignalEntry {
  label: string
  resolvedTasks: number
  mergedTasks: number
}

/** Pure render: gate + format. Returns "" when nothing qualifies. */
export function renderLineageSection(entries: LineageSignalEntry[]): string {
  const qualifying = entries.filter(
    e => e.resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS
  )
  if (qualifying.length === 0) return ''
  return [
    '## 飞轮信号 · 历史 merge 贡献',
    '',
    '> 口径:分母 = 该片段出现过且 outcome 已确定(merged/否)的去重任务数;分子 = 其中已 merged 的。仅显示样本 ≥ 3 个已闭合任务。这是历史相关性,非因果。',
    '',
    ...qualifying.map(formatLineageSignalLine),
  ].join('\n')
}

export function formatLineageSignalLine(e: LineageSignalEntry): string {
  // resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS (>=1) here, so no divide-by-zero.
  const pct = Math.round((e.mergedTasks / e.resolvedTasks) * 100)
  return `- ${e.label} — 出现在 ${e.resolvedTasks} 个已闭合任务·${e.mergedTasks} merged (${pct}%)`
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

    const stats = await deps.mergeRateByFragments(inputs.map(i => i.ref))
    const statByKey = new Map(
      stats.map(s => [`${s.fragmentType}::${s.fragmentId}`, s])
    )

    const entries: LineageSignalEntry[] = []
    const seen = new Set<string>()
    for (const input of inputs) {
      const key = `${input.ref.fragmentType}::${input.ref.fragmentId}`
      if (seen.has(key)) continue
      seen.add(key)
      const stat = statByKey.get(key)
      if (!stat) continue
      entries.push({
        label: input.label,
        resolvedTasks: stat.resolvedTasks,
        mergedTasks: stat.mergedTasks,
      })
    }
    return renderLineageSection(entries)
  } catch (err) {
    logger.error('assembleLineageSection failed; omitting flywheel signal', err)
    return ''
  }
}
