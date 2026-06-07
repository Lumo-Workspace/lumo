import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import {
  toModelCosts,
  mergeModelCosts,
  type ModelCost,
  type ModelUsage,
} from '@/lib/services/model-cost'
import { enrichClerkUsers } from '@/lib/utils/clerk-helpers'
import type { HookEventType, MemoryCategory } from '@prisma/client'
import { TaskArtifactAgent } from '@prisma/client'

// Wire-format types returned to the client. Kept separate from Prisma
// row shapes so the API surface stays decoupled from schema changes.

export interface AgentRunHookEvent {
  id: string
  kind: 'hook'
  type: HookEventType
  toolName: string | null
  payload: unknown
  /** LLM-generated turn summary, only populated for STOP / STOP_FAILURE
   *  events that have been processed by the turn-summary service. */
  turnSummary: string | null
  /** Per-turn per-model cost (STOP rows only); null elsewhere. */
  turnCost: { byModel: ModelCost[] } | null
  createdAt: string
}

export interface AgentRunMemoryItem {
  id: string
  kind: 'memory'
  category: MemoryCategory
  agent: TaskArtifactAgent
  content: unknown
  createdAt: string
}

export type AgentRunItem = AgentRunHookEvent | AgentRunMemoryItem

export interface AgentRunSession {
  sessionId: string | null
  agent: TaskArtifactAgent
  runNumber: number
  startedAt: string
  lastActivityAt: string
  durationMs: number
  toolCallCount: number
  eventCount: number
  memoryCount: number
  /** Per-run cost split by model; null when nothing captured. */
  cost: { byModel: ModelCost[]; loopCount: number | null } | null
  /** Owning member (Clerk-resolved name + avatar) shown in the run header;
   *  null for orphan / unlinked runs with no member (LUM-308). */
  member: { workspaceMemberId: string; name: string; imageUrl: string } | null
  items: AgentRunItem[]
}

/**
 * Per-person token spend on a task (LUM-307). One entry per workspace member
 * who has at least one run with captured cost — the natural attribution unit
 * is the run (= a Session), since a Session is owned end-to-end by one member.
 * Members whose runs captured no usage (historical / pre-LUM-281 rows) are
 * omitted, mirroring `totals.byModel`, rather than shown as a row of zeros.
 */
export interface AgentRunMemberCost {
  workspaceMemberId: string
  clerkId: string | null
  runCount: number
  turnCount: number
  loopCount: number
  byModel: ModelCost[]
}

/** Wire shape: aggregation + Clerk-resolved display name / avatar. */
export interface AgentRunMemberStat extends AgentRunMemberCost {
  name: string
  imageUrl: string
}

export interface AgentRunTimelineResult {
  runs: AgentRunSession[]
  totals: {
    runCount: number
    turnCount: number
    loopCount: number
    byModel: ModelCost[]
  }
  /** Token spend grouped by the member who owns each run. Sorted by spend
   *  desc; empty when no run on this task captured usage. */
  perMember: AgentRunMemberStat[]
}

/** Per-run input to {@link aggregateRunsByMember}; null member = orphan run. */
export interface MemberRunInput {
  workspaceMemberId: string | null
  clerkId: string | null
  turnCount: number
  loopCount: number | null
  byModel: ModelCost[] | null
}

/**
 * Group runs by workspace member and sum their token cost. Pure — no I/O, so
 * the grouping rules are unit-testable in isolation from the DB and Clerk:
 *  - runs with no member (unlinked / orphan sessions) are dropped;
 *  - a member whose merged cost is empty (all runs captured no usage) is
 *    omitted entirely, so callers render nothing rather than a zero row;
 *  - clerkId is backfilled from the first run that carries one;
 *  - output is sorted by total spend desc, tie-broken by member id for
 *    deterministic ordering across requests.
 */
export function aggregateRunsByMember(
  runs: MemberRunInput[]
): AgentRunMemberCost[] {
  const acc = new Map<
    string,
    {
      clerkId: string | null
      runCount: number
      turnCount: number
      loopCount: number
      lists: (ModelCost[] | null)[]
    }
  >()
  for (const r of runs) {
    if (!r.workspaceMemberId) continue
    const cur = acc.get(r.workspaceMemberId) ?? {
      clerkId: null,
      runCount: 0,
      turnCount: 0,
      loopCount: 0,
      lists: [],
    }
    cur.runCount += 1
    cur.turnCount += r.turnCount
    cur.loopCount += r.loopCount ?? 0
    cur.lists.push(r.byModel)
    if (!cur.clerkId && r.clerkId) cur.clerkId = r.clerkId
    acc.set(r.workspaceMemberId, cur)
  }

  const out: AgentRunMemberCost[] = []
  for (const [workspaceMemberId, v] of acc) {
    const byModel = mergeModelCosts(v.lists)
    if (byModel.length === 0) continue
    out.push({
      workspaceMemberId,
      clerkId: v.clerkId,
      runCount: v.runCount,
      turnCount: v.turnCount,
      loopCount: v.loopCount,
      byModel,
    })
  }

  const spend = (m: AgentRunMemberCost) =>
    m.byModel.reduce((n, c) => n + c.total, 0)
  return out.sort((a, b) => {
    const d = spend(b) - spend(a)
    if (d !== 0) return d
    return a.workspaceMemberId.localeCompare(b.workspaceMemberId)
  })
}

/** STOP / STOP_FAILURE items on a run = its turn count. */
function countTurns(run: AgentRunSession): number {
  return run.items.filter(
    i => i.kind === 'hook' && (i.type === 'STOP' || i.type === 'STOP_FAILURE')
  ).length
}

export const agentRunTimelineService = {
  /**
   * Build the Agent Run timeline for a task: every Claude Code Session that
   * touched this task, with its hook events and sedimented memories merged
   * in createdAt order. Runs are returned newest-first so the UI can render
   * "Run #N" at the top with older runs collapsed below.
   *
   * Events whose sessionId never linked to a Session row (malformed hook
   * payload, pre-Session-linking events) are bucketed under sessionId=null
   * as a single trailing "Unlinked" run so they're still visible.
   */
  async getTimeline(taskId: string): Promise<AgentRunTimelineResult> {
    const [sessions, events, memories] = await Promise.all([
      sessionRepository.listForTask(taskId, 50),
      hookEventRepository.findByTaskId(taskId),
      memoryRepository.findByTaskIdWithSession(taskId),
    ])

    // Bucket events + memories by sessionId.
    const eventsBySession = new Map<string | null, AgentRunHookEvent[]>()
    for (const ev of events) {
      const key = ev.sessionId ?? null
      const list = eventsBySession.get(key) ?? []
      list.push({
        id: ev.id,
        kind: 'hook',
        type: ev.type,
        toolName: ev.toolName,
        payload: ev.payload,
        turnSummary: ev.turnSummary,
        turnCost:
          ev.type === 'STOP' || ev.type === 'STOP_FAILURE'
            ? (() => {
                const byModel = toModelCosts(
                  ev.usageByModel as Record<string, ModelUsage> | null
                )
                return byModel ? { byModel } : null
              })()
            : null,
        createdAt: ev.createdAt.toISOString(),
      })
      eventsBySession.set(key, list)
    }

    const memoriesBySession = new Map<string | null, AgentRunMemoryItem[]>()
    for (const m of memories) {
      const key = m.sourceSessionId ?? null
      const list = memoriesBySession.get(key) ?? []
      list.push({
        id: m.id,
        kind: 'memory',
        category: m.category,
        agent: m.agent,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })
      memoriesBySession.set(key, list)
    }

    // Order sessions oldest-first so runNumber assignment is stable across
    // requests; reverse before returning so the UI sees newest first.
    const orderedSessions = [...sessions].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
    )

    // sessionId -> owning member, for the per-person cost rollup below.
    const memberBySession = new Map<
      string,
      { workspaceMemberId: string | null; clerkId: string | null }
    >()
    for (const s of orderedSessions) {
      memberBySession.set(s.id, {
        workspaceMemberId: s.workspaceMemberId ?? null,
        clerkId: s.member?.clerkId ?? null,
      })
    }

    const runs: AgentRunSession[] = orderedSessions.map((s, i) => {
      const sessionEvents = eventsBySession.get(s.id) ?? []
      const sessionMemories = memoriesBySession.get(s.id) ?? []
      eventsBySession.delete(s.id)
      memoriesBySession.delete(s.id)
      const items = mergeByTime(sessionEvents, sessionMemories)
      const toolCallCount = sessionEvents.filter(
        e => e.type === 'PRE_TOOL_USE'
      ).length
      const costByModel = toModelCosts(
        s.usageByModel as Record<string, ModelUsage> | null
      )

      return {
        sessionId: s.id,
        agent: s.agent,
        runNumber: i + 1,
        startedAt: s.startedAt.toISOString(),
        lastActivityAt: s.lastActivityAt.toISOString(),
        durationMs: Math.max(
          0,
          s.lastActivityAt.getTime() - s.startedAt.getTime()
        ),
        toolCallCount,
        eventCount: sessionEvents.length,
        memoryCount: sessionMemories.length,
        cost: costByModel
          ? { byModel: costByModel, loopCount: s.loopCount }
          : null,
        member: null, // resolved after Clerk enrichment below
        items,
      }
    })

    // Anything still in the maps belongs to an unlinked bucket (no Session
    // row yet, or sessionId was missing from the hook payload). Surface as a
    // single trailing "Run" so events aren't silently dropped.
    const orphanEvents: AgentRunHookEvent[] = []
    for (const list of eventsBySession.values()) orphanEvents.push(...list)
    const orphanMemories: AgentRunMemoryItem[] = []
    for (const list of memoriesBySession.values()) orphanMemories.push(...list)

    if (orphanEvents.length > 0 || orphanMemories.length > 0) {
      const items = mergeByTime(orphanEvents, orphanMemories)
      const first = items[0]?.createdAt ?? new Date(0).toISOString()
      const last = items[items.length - 1]?.createdAt ?? first
      runs.push({
        sessionId: null,
        agent: TaskArtifactAgent.CLAUDE_CODE,
        runNumber: runs.length + 1,
        startedAt: first,
        lastActivityAt: last,
        durationMs: new Date(last).getTime() - new Date(first).getTime(),
        toolCallCount: orphanEvents.filter(e => e.type === 'PRE_TOOL_USE')
          .length,
        eventCount: orphanEvents.length,
        memoryCount: orphanMemories.length,
        cost: null,
        member: null,
        items,
      })
    }

    const nonEmptyRuns = runs.filter(
      r => r.toolCallCount > 0 || r.memoryCount > 0
    )

    // Re-number after filtering.
    nonEmptyRuns.forEach((r, i) => {
      r.runNumber = i + 1
    })

    // Newest run first.
    const ordered = nonEmptyRuns.reverse()
    const totals = {
      runCount: ordered.length,
      turnCount: ordered.reduce((n, r) => n + countTurns(r), 0),
      loopCount: ordered.reduce((n, r) => n + (r.cost?.loopCount ?? 0), 0),
      byModel: mergeModelCosts(ordered.map(r => r.cost?.byModel ?? null)),
    }

    // Resolve the owning member of each run once; reused for both the run
    // header (member field) and the per-person rollup below.
    const runOwners = ordered.map(r =>
      r.sessionId ? (memberBySession.get(r.sessionId) ?? null) : null
    )

    // Per-person rollup: attribute each run to its owning member (orphan runs
    // with sessionId=null have no member and are dropped by the aggregator).
    const memberCosts = aggregateRunsByMember(
      ordered.map((r, i) => {
        const owner = runOwners[i]
        return {
          workspaceMemberId: owner?.workspaceMemberId ?? null,
          clerkId: owner?.clerkId ?? null,
          turnCount: countTurns(r),
          loopCount: r.cost?.loopCount ?? null,
          byModel: r.cost?.byModel ?? null,
        }
      })
    )

    // Enrich every clerkId that owns a run OR carries cost — the run header
    // shows the person even on runs that captured no usage, so we can't scope
    // enrichment to cost-bearing members alone.
    const clerkIds = new Set<string>()
    for (const o of runOwners) if (o?.clerkId) clerkIds.add(o.clerkId)
    for (const m of memberCosts) if (m.clerkId) clerkIds.add(m.clerkId)
    const enriched = await enrichClerkUsers([...clerkIds])

    const display = (clerkId: string | null) => {
      const user = clerkId ? enriched.get(clerkId) : undefined
      return { name: user?.name ?? 'Unknown', imageUrl: user?.imageUrl ?? '' }
    }

    const runsWithMember: AgentRunSession[] = ordered.map((r, i) => {
      const owner = runOwners[i]
      if (!owner?.workspaceMemberId) return r
      return {
        ...r,
        member: {
          workspaceMemberId: owner.workspaceMemberId,
          ...display(owner.clerkId),
        },
      }
    })

    const perMember: AgentRunMemberStat[] = memberCosts.map(m => ({
      ...m,
      ...display(m.clerkId),
    }))

    return { runs: runsWithMember, totals, perMember }
  },
}

function mergeByTime(
  events: AgentRunHookEvent[],
  memories: AgentRunMemoryItem[]
): AgentRunItem[] {
  const merged: AgentRunItem[] = [...events, ...memories]
  merged.sort((a, b) => {
    const t = a.createdAt.localeCompare(b.createdAt)
    if (t !== 0) return t
    return a.id.localeCompare(b.id)
  })
  return merged
}
