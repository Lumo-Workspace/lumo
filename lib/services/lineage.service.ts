import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { toModelCosts } from '@/lib/services/model-cost'
import type { ModelUsage } from '@/lib/services/model-cost'
import { taskRepository } from '@/lib/repositories/task.repository'
import { logger } from '@/lib/logger'
import type { LineageFragmentType, LineageOutcome } from '@prisma/client'
import { computeFragmentTrust, trustKey } from '@/lib/services/lineage-signal'
import type { TrustVerdict } from '@/types/lineage'

export interface SessionStartEdgeInput {
  workspaceId: string
  taskId: string
  /** Always present — callers must guard `binding.bound` + sessionId first. */
  sessionId: string
  /** Fragments actually injected this session-start (post-budget). */
  fragments: FragmentRef[]
}

/** Stable key for in-memory de-dup, mirrors the DB unique constraint's fragment half. */
function fragmentKey(f: FragmentRef): string {
  return `${f.fragmentType}::${f.fragmentId}`
}

export interface LineageCost {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  loopCount: number
}
export interface LineageFragmentEntry {
  fragmentType: string
  fragmentId: string
  sourceLabel: string
  outcome: LineageOutcome
  used: boolean | null
}
export interface LineageGroup {
  kind: 'session' | 'orphan'
  sessionId: string | null
  label: string
  includedAt: string
  cost: LineageCost | null
  fragments: LineageFragmentEntry[]
}
export interface LineageDto {
  task: { identifier: string; title: string; status: string }
  totals: {
    /** Distinct cost-bearing session groups (excludes the orphan bucket). */
    runCount: number
    fragmentCount: number
    edgeCount: number
    tokens: {
      input: number
      output: number
      cacheRead: number
      cacheCreation: number
      total: number
    }
    loopCount: number
    outcomes: Record<LineageOutcome, number>
  }
  groups: LineageGroup[]
}

const ORPHAN = '__orphan__'

function emptyOutcomes(): Record<LineageOutcome, number> {
  return { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 }
}

export const lineageService = {
  /**
   * Persist one lineage edge per fragment a bound session consumed at
   * session-start. MEMORY ids are canonicalized (promoted PROJECT id, not the
   * pre-consolidation TASK cuid). Duplicates that collapse after canonicalization
   * are dropped in-memory; the DB unique index + `skipDuplicates` absorb re-fires
   * of the same session. `outcome` is left UNKNOWN at insert; if the task is already DONE it is then
   * stamped MERGED in the same call (LUM-296), else stamped later by LUM-277.
   *
   * Best-effort: must never throw — it runs inside the hook's `waitUntil` and a
   * failure must not affect context injection.
   */
  async recordSessionStartEdges(input: SessionStartEdgeInput): Promise<void> {
    try {
      const { workspaceId, taskId, sessionId, fragments } = input
      if (fragments.length === 0) return

      const resolved: FragmentRef[] = await Promise.all(
        fragments.map(async f => ({
          fragmentType: f.fragmentType,
          fragmentId: await memoryProvenanceRepository.resolveCanonicalFragment(
            f.fragmentType,
            f.fragmentId
          ),
        }))
      )

      const seen = new Set<string>()
      const unique = resolved.filter(f => {
        const key = fragmentKey(f)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      await lineageEdgeRepository.createMany(
        unique.map(f => ({
          workspaceId,
          taskId,
          fragmentType: f.fragmentType,
          fragmentId: f.fragmentId,
          sessionId,
        }))
      )

      // LUM-296: edges are usually born *after* the task's terminal event, so
      // the event-forward outcome triggers (webhook / task→DONE) already fired
      // and will never re-fire. If the task is already DONE, stamp the new
      // edges MERGED now. Monotonic + idempotent (stampOutcomeByTask), and
      // safe for reopened tasks: a reopened task is status != DONE, so its
      // rework edges correctly stay UNKNOWN until it is DONE again. Stragglers
      // and edges born before this path shipped (historical backfill) are caught
      // by the cron sweep.
      const status = await taskRepository.getStatus(taskId)
      if (status === 'DONE') {
        await lineageEdgeRepository.stampOutcomeByTask(taskId, 'MERGED')
      }
    } catch (err) {
      // Best-effort: log and swallow.
      logger.error('lineageService.recordSessionStartEdges failed', err)
    }
  },

  /**
   * Aggregate a task's LineageEdge rows into its causal trail: fragments
   * (canonicalized + source-labelled) grouped by the session that consumed
   * them, with cost attributed ONCE per group (never per edge — a session that
   * injected many fragments must not multiply its token cost). Returns null
   * when the identifier doesn't resolve (caller → 404).
   */
  async getLineageForIdentifier(
    workspaceId: string,
    // Reserved for a future per-member permission check; unused until scoped
    // lineage access is implemented. Kept for API-shape stability with the route.
    _memberId: string,
    identifier: string
  ): Promise<LineageDto | null> {
    // Dynamic import: keep task.service (and its heavy task-mutation graph:
    // task-state / task-creation / pr-sync / lineage-outcome) out of this
    // module's static graph. recordSessionStartEdges above runs on the hot
    // session-start path and must stay lightweight; a static taskService import
    // would also drag that graph (and the @ai-sdk/gateway jest trap) into every
    // test that loads this service. See project_ai_sdk_gateway_jest_trap.
    const { taskService } = await import('@/lib/services/task.service')
    const resolved = await taskService.resolveIdentifier(
      workspaceId,
      identifier
    )
    if (!resolved) return null

    const edges = await lineageEdgeRepository.listByTaskWithCost(resolved.id)

    // Session-group cost source (LUM-301): sum this task's per-turn token
    // deltas (HookEvent.usageByModel, LUM-298) per session. Session cost
    // columns are cumulative and keep growing after the task is done — reading
    // them attributed unrelated later work to this task and drifted the total
    // up forever. The per-turn deltas, scoped to the turns tagged to this task,
    // are bounded and stop accruing once the task's work stops.
    const turnRows = await hookEventRepository.findTurnUsageByTask(resolved.id)
    const costBySession = new Map<string, LineageCost>()
    for (const row of turnRows) {
      if (!row.sessionId) continue
      const acc = costBySession.get(row.sessionId) ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 0,
        loopCount: 0,
      }
      // Each STOP turn tagged to this task counts as one loop — a bounded,
      // task-scoped substitute for the cumulative Session.loopCount.
      acc.loopCount += 1
      const costs = toModelCosts(
        row.usageByModel as Record<string, ModelUsage> | null
      )
      for (const c of costs ?? []) {
        acc.input += c.input
        acc.output += c.output
        acc.cacheRead += c.cacheRead
        acc.cacheCreation += c.cacheCreation
        acc.total += c.total
      }
      costBySession.set(row.sessionId, acc)
    }

    // 1. Canonicalize each fragment id (MEMORY may drift across consolidation).
    //    Zip edge+canonical so later steps never index a parallel array under
    //    noUncheckedIndexedAccess. N+1 per MEMORY edge (each is a ≤MAX_RESOLVE_DEPTH
    //    walk, usually 1 hop); acceptable for this off-hot-path audit view.
    const withCanon = await Promise.all(
      edges.map(async e => ({
        e,
        cid: await memoryProvenanceRepository.resolveCanonicalFragment(
          e.fragmentType,
          e.fragmentId
        ),
      }))
    )

    // 2. Bucket canonical ids by type and hydrate human-readable labels.
    const refsByType = new Map<LineageFragmentType, string[]>()
    for (const { e, cid } of withCanon) {
      const arr = refsByType.get(e.fragmentType) ?? []
      arr.push(cid)
      refsByType.set(e.fragmentType, arr)
    }
    const labels = await lineageSourceRepository.labelsByType(refsByType)
    const labelFor = (type: string, id: string): string =>
      labels.get(`${type}::${id}`) ?? `${type} (source removed)`

    // 3. Group by session ?? orphan, preserving first-seen order
    //    (edges arrive oldest-first).
    const order: string[] = []
    const groups = new Map<string, LineageGroup>()
    const seenFragment = new Set<string>()
    const outcomes = emptyOutcomes()

    for (const { e, cid } of withCanon) {
      outcomes[e.outcome] += 1
      seenFragment.add(`${e.fragmentType}::${cid}`)

      const gkey = e.sessionId ?? ORPHAN
      let g = groups.get(gkey)
      if (!g) {
        // Resolve cost once per group: session groups use the per-turn delta
        // sum (costBySession) instead of the cumulative Session columns
        // (LUM-301 — see above). Orphan edges carry no cost.
        const cost: LineageCost | null = e.sessionId
          ? (costBySession.get(e.sessionId) ?? null)
          : null
        g = {
          kind: e.sessionId ? 'session' : 'orphan',
          sessionId: e.sessionId,
          label: e.sessionId
            ? `Session ${e.sessionId.slice(0, 8)}`
            : 'Unattributed',
          includedAt: e.includedAt.toISOString(),
          cost,
          fragments: [],
        }
        groups.set(gkey, g)
        order.push(gkey)
      }
      g.fragments.push({
        fragmentType: e.fragmentType,
        fragmentId: cid,
        sourceLabel: labelFor(e.fragmentType, cid),
        outcome: e.outcome,
        used: e.used,
      })
    }

    const groupList = order.map(k => groups.get(k)!)

    // 4. Totals — cost summed ONCE per group.
    const tokens = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
      total: 0,
    }
    let loopCount = 0
    let runCount = 0
    for (const g of groupList) {
      if (g.kind !== 'orphan') runCount += 1
      if (g.cost) {
        tokens.input += g.cost.input
        tokens.output += g.cost.output
        tokens.cacheRead += g.cost.cacheRead
        tokens.cacheCreation += g.cost.cacheCreation
        tokens.total += g.cost.total
        loopCount += g.cost.loopCount
      }
    }

    return {
      task: {
        identifier: resolved.identifier,
        title: resolved.title,
        status: resolved.status,
      },
      totals: {
        runCount,
        fragmentCount: seenFragment.size,
        edgeCount: edges.length,
        tokens,
        loopCount,
        outcomes,
      },
      groups: groupList,
    }
  },

  /**
   * Per-memory trust verdicts for the web badge (LUM-303). Resolves each memory
   * id to its canonical fragment (matching how edges were keyed at birth),
   * scores via the shared `computeFragmentTrust`, and maps verdicts back to the
   * ORIGINAL ids the UI knows. Unqualified ids are omitted. Best-effort: any
   * failure degrades to `{}` so the memory tab never breaks on the decoration.
   */
  async fragmentTrustForMemories(
    memoryIds: string[]
  ): Promise<Record<string, TrustVerdict>> {
    if (memoryIds.length === 0) return {}
    try {
      const pairs = await Promise.all(
        memoryIds.map(async id => ({
          id,
          canonical: await memoryProvenanceRepository.resolveCanonicalFragment(
            'MEMORY',
            id
          ),
        }))
      )
      const refs: FragmentRef[] = pairs.map(p => ({
        fragmentType: 'MEMORY',
        fragmentId: p.canonical,
      }))
      const [universe, presence, usage] = await Promise.all([
        lineageEdgeRepository.countResolvedTasks(),
        lineageEdgeRepository.mergeRateByFragments(refs),
        lineageEdgeRepository.usageMergeRateByFragments(refs),
      ])
      const { verdicts } = computeFragmentTrust(refs, {
        universe,
        presence,
        usage,
      })
      const out: Record<string, TrustVerdict> = {}
      for (const p of pairs) {
        const v = verdicts.get(trustKey('MEMORY', p.canonical))
        if (v) out[p.id] = v
      }
      return out
    } catch (err) {
      logger.error('fragmentTrustForMemories failed; returning empty', err)
      return {}
    }
  },
}
