import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { getEdgeCost } from '@/lib/repositories/lineage-cost'
import { logger } from '@/lib/logger'
import type { LineageFragmentType, LineageOutcome } from '@prisma/client'

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
}
export interface LineageGroup {
  kind: 'run' | 'session' | 'orphan'
  runId: string | null
  sessionId: string | null
  label: string
  includedAt: string
  cost: LineageCost | null
  fragments: LineageFragmentEntry[]
}
export interface LineageDto {
  task: { identifier: string; title: string; status: string }
  totals: {
    /** Distinct cost-bearing groups (runs + sessions; excludes the orphan bucket). */
    runCount: number
    fragmentCount: number
    edgeCount: number
    tokens: { input: number; output: number; cacheRead: number; cacheCreation: number; total: number }
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
   * of the same session. `outcome` is left UNKNOWN (stamped later by LUM-277);
   * `runId` stays NULL (session-start precedes any agent run).
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
    } catch (err) {
      // Best-effort: log and swallow.
      logger.error('lineageService.recordSessionStartEdges failed', err)
    }
  },

  /**
   * Aggregate a task's LineageEdge rows into its causal trail: fragments
   * (canonicalized + source-labelled) grouped by the run/session that consumed
   * them, with cost attributed ONCE per group (never per edge — a run that
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
    const resolved = await taskService.resolveIdentifier(workspaceId, identifier)
    if (!resolved) return null

    const edges = await lineageEdgeRepository.listByTaskWithCost(resolved.id)

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

    // 3. Group by run ?? session ?? orphan, preserving first-seen order
    //    (edges arrive oldest-first).
    const order: string[] = []
    const groups = new Map<string, LineageGroup>()
    const seenFragment = new Set<string>()
    const outcomes = emptyOutcomes()

    for (const { e, cid } of withCanon) {
      outcomes[e.outcome] += 1
      seenFragment.add(`${e.fragmentType}::${cid}`)

      const gkey = e.runId ?? e.sessionId ?? ORPHAN
      let g = groups.get(gkey)
      if (!g) {
        // Resolve cost once per group. For run groups every edge shares the
        // same run, so the cost is identical. For session groups we snapshot
        // from the first (oldest) edge — session cost columns are cumulative
        // and may not be finalized mid-session; the audit view shows the value
        // as of the first injection. getEdgeCost prefers run over session,
        // matching the run-first grouping key.
        const c = getEdgeCost({
          runId: e.runId,
          run: e.run,
          sessionId: e.sessionId,
          session: e.session,
        })
        g = {
          kind: e.runId ? 'run' : e.sessionId ? 'session' : 'orphan',
          runId: e.runId,
          sessionId: e.sessionId,
          label: e.runId
            ? `Run ${e.runId.slice(0, 8)}`
            : e.sessionId
              ? `Session ${e.sessionId.slice(0, 8)}`
              : 'Unattributed',
          includedAt: e.includedAt.toISOString(),
          cost: c
            ? {
                input: c.inputTokens,
                output: c.outputTokens,
                cacheRead: c.cacheReadTokens,
                cacheCreation: c.cacheCreationTokens,
                total:
                  c.inputTokens +
                  c.outputTokens +
                  c.cacheReadTokens +
                  c.cacheCreationTokens,
                loopCount: c.loopCount,
              }
            : null,
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
      })
    }

    const groupList = order.map(k => groups.get(k)!)

    // 4. Totals — cost summed ONCE per group.
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }
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
}
