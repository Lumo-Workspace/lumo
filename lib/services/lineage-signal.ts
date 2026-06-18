import type {
  FragmentJudgedUsage,
  FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'
import type { ContextFragmentType } from '@/lib/services/task-context.service'
import { toLineageFragmentType } from '@/lib/lineage/fragment-type'
import { logger } from '@/lib/logger'
import type { TrustVerdict } from '@/types/lineage'

export type { TrustVerdict }

/**
 * Cold-start grace (LUM-539): a fragment must have returned a usage verdict in at
 * least this many distinct tasks (used != null — true OR false) before we emit a
 * track-record verdict for it, rank it, or treat it as a retire candidate. Below
 * this floor "don't promise intelligence" — and, critically, a fragment that has
 * simply never been audited (auditedTasks = 0) is never pushed toward retirement
 * (abstention is not negative evidence).
 */
export const LINEAGE_MIN_AUDITED_TASKS = 3

/**
 * A fragment is "proven useful" once it has been judged used in at least this
 * many distinct tasks. Proven fragments are always-kept by the relevance gate,
 * protected from cold eviction, and guard against silent supersede.
 */
export const LINEAGE_PROVEN_USED_TASKS = 3

const LABEL_MAX = 60

/** Pre-fetched aggregate input for {@link computeFragmentTrust}. */
export interface TrustStats {
  judged: FragmentJudgedUsage[]
}

export interface FragmentTrustResult {
  /** Qualifying verdicts keyed by `${fragmentType}::${fragmentId}`, insertion
   * order = first-seen order of `refs`. Cold-start fragments are absent. */
  verdicts: Map<string, TrustVerdict>
}

/** One rendered track-record line. */
export interface TrackRecordEntry {
  label: string
  judgedUsedTasks: number
  appearanceTasks: number
  qualified: boolean
  retireCandidate: boolean
}

/** A fragment ranked by its judged-used track record, for P4 (LUM-540) retire. */
export interface RankedFragment {
  fragmentType: string
  fragmentId: string
  verdict: TrustVerdict
  retireCandidate: boolean
}

export function trustKey(fragmentType: string, fragmentId: string): string {
  return `${fragmentType}::${fragmentId}`
}

/** Build a verdict from raw judged-usage stats, or null if below cold-start. */
function toVerdict(stat: FragmentJudgedUsage): TrustVerdict | null {
  if (stat.auditedTasks < LINEAGE_MIN_AUDITED_TASKS) return null
  return {
    judgedUsedTasks: stat.judgedUsedTasks,
    auditedTasks: stat.auditedTasks,
    appearanceTasks: stat.appearanceTasks,
    usefulnessPct: Math.round((stat.judgedUsedTasks / stat.auditedTasks) * 100),
    qualified: stat.judgedUsedTasks >= LINEAGE_PROVEN_USED_TASKS,
  }
}

/**
 * Is this fragment a retire candidate (for P4)? It must have cleared the
 * cold-start grace (audited in >= LINEAGE_MIN_AUDITED_TASKS tasks) AND never once
 * been judged used in that audited sample. Conservative by design: a fragment
 * that was simply never audited (auditedTasks below the floor) is NOT a candidate,
 * honoring the "abstention is not negative evidence" guardrail.
 */
export function isRetireCandidate(v: TrustVerdict): boolean {
  return v.auditedTasks >= LINEAGE_MIN_AUDITED_TASKS && v.judgedUsedTasks === 0
}

/**
 * Pure trust scoring (LUM-539). Iterates `refs` (deduped, first-seen order) and
 * for each emits a judged-used verdict when it clears the cold-start grace; no
 * I/O — all gating lives here so the CLI markdown, web badge, relevance gate,
 * eviction and supersede guards never drift apart.
 */
export function computeFragmentTrust(
  refs: FragmentRef[],
  stats: TrustStats
): FragmentTrustResult {
  const judgedByKey = new Map(
    stats.judged.map(s => [trustKey(s.fragmentType, s.fragmentId), s])
  )

  const verdicts = new Map<string, TrustVerdict>()
  const seen = new Set<string>()

  for (const ref of refs) {
    const key = trustKey(ref.fragmentType, ref.fragmentId)
    if (seen.has(key)) continue
    seen.add(key)

    const stat = judgedByKey.get(key)
    if (!stat) continue
    const verdict = toVerdict(stat)
    if (verdict) verdicts.set(key, verdict)
  }

  return { verdicts }
}

/**
 * Rank fragments by their judged-used track record, coldest first (lowest
 * usefulness → highest priority for P4 retirement), and flag retire candidates.
 * Cold-start fragments (no verdict) are omitted — never rankable, never retired.
 */
export function rankFragmentsByUsefulness(
  refs: FragmentRef[],
  stats: TrustStats
): RankedFragment[] {
  const { verdicts } = computeFragmentTrust(refs, stats)
  const judgedByKey = new Map(
    stats.judged.map(s => [trustKey(s.fragmentType, s.fragmentId), s])
  )
  const ranked: RankedFragment[] = []
  for (const [key, verdict] of verdicts) {
    const stat = judgedByKey.get(key)
    if (!stat) continue
    ranked.push({
      fragmentType: stat.fragmentType,
      fragmentId: stat.fragmentId,
      verdict,
      retireCandidate: isRetireCandidate(verdict),
    })
  }
  ranked.sort(
    (a, b) =>
      a.verdict.usefulnessPct - b.verdict.usefulnessPct ||
      a.verdict.judgedUsedTasks - b.verdict.judgedUsedTasks ||
      b.verdict.auditedTasks - a.verdict.auditedTasks
  )
  return ranked
}

/**
 * Pure render of the judged-used track-record section. Returns "" when there is
 * nothing past the cold-start grace to report.
 */
export function renderLineageSection(entries: TrackRecordEntry[]): string {
  if (entries.length === 0) return ''
  return [
    '## Memory usefulness · judged-used track record',
    '',
    '> Methodology: each line is the fragment’s cross-task judged-used track record — of the N tasks it appeared in, X were judged to have actually used it. A lower bound (never-audited appearances are excluded from the proven/retire calls), not a merge rate. Replaces the retired merge-rate signal (RFC LUM-535).',
    '',
    ...entries.map(formatTrackRecordLine),
  ].join('\n')
}

export function formatTrackRecordLine(e: TrackRecordEntry): string {
  const suffix = e.retireCandidate
    ? ' · retire candidate'
    : e.qualified
      ? ' · proven'
      : ''
  return `- ${e.label} — judged-used in ${e.judgedUsedTasks} of ${e.appearanceTasks} tasks${suffix}`
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
  judgedUsageByFragments: (
    refs: FragmentRef[]
  ) => Promise<FragmentJudgedUsage[]>
}

/**
 * Build the trailing judged-used track-record markdown for a task's context
 * fragments. Maps each fragment to its lineage type, resolves MEMORY ids to
 * canonical (matching how edges were keyed at birth), joins the cross-task
 * judged-usage stats, applies the cold-start grace, and renders. Never throws —
 * any failure degrades to "" so the rest of the context handoff is unaffected.
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
    const judged = await deps.judgedUsageByFragments(refs)
    const { verdicts } = computeFragmentTrust(refs, { judged })

    const entries: TrackRecordEntry[] = []
    const seen = new Set<string>()
    for (const input of inputs) {
      const key = trustKey(input.ref.fragmentType, input.ref.fragmentId)
      if (seen.has(key)) continue
      seen.add(key)
      const v = verdicts.get(key)
      if (!v) continue
      entries.push({
        label: input.label,
        judgedUsedTasks: v.judgedUsedTasks,
        appearanceTasks: v.appearanceTasks,
        qualified: v.qualified,
        retireCandidate: isRetireCandidate(v),
      })
    }
    return renderLineageSection(entries)
  } catch (err) {
    logger.error('assembleLineageSection failed; omitting track record', err)
    return ''
  }
}
