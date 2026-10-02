import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import {
  toModelCosts,
  mergeModelCosts,
  withInFlightCost,
  type ModelCost,
  type ModelUsage,
} from '@/lib/services/model-cost'
import { enrichClerkUsers } from '@/lib/utils/clerk-helpers'
import { activeDurationMs } from '@/lib/agent-run/active-time'
import { parseChildSessionId } from '@/lib/session/child-session-id'
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
  /** LLM-generated one-paragraph summary of the whole run; null until the
   *  generation service has synthesized one (LUM-481). */
  runSummary: string | null
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
    /** Sum of per-run loop counts, or null when no run captured one. Null
     *  renders as "loops n/a" rather than a misleading 0. */
    loopCount: number | null
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
      loopCount: number
      lists: (ModelCost[] | null)[]
    }
  >()
  for (const r of runs) {
    if (!r.workspaceMemberId) continue
    const cur = acc.get(r.workspaceMemberId) ?? {
      clerkId: null,
      runCount: 0,
      loopCount: 0,
      lists: [],
    }
    cur.runCount += 1
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
    const [sessions, childSessions, events, memories] = await Promise.all([
      sessionRepository.listForTask(taskId, 50),
      sessionRepository.listChildrenForTask(taskId),
      hookEventRepository.findByTaskId(taskId),
      memoryRepository.findByTaskIdWithSession(taskId),
    ])

    // LUM-932 (spec §8): subagent child sessions fold into their parent's
    // run. A child that attached its own task under an unbound parent still
    // shows as the parent's run here — read the parent row as a "host" whose
    // own cost belongs elsewhere and is not counted on this task.
    const boundIds = new Set(sessions.map(s => s.id))
    const hostIds = [
      ...new Set(
        childSessions
          .map(c => c.parentSessionId)
          .filter((id): id is string => !!id && !boundIds.has(id))
      ),
    ]
    const hostSessions = await sessionRepository.listTimelineRowsByIds(hostIds)
    const hostOnly = new Set(hostSessions.map(s => s.id))
    const childCostByParent = new Map<string, (ModelCost[] | null)[]>()
    for (const c of childSessions) {
      if (!c.parentSessionId) continue
      const list = childCostByParent.get(c.parentSessionId) ?? []
      list.push(sessionCost(c))
      childCostByParent.set(c.parentSessionId, list)
    }
    const runKey = (sessionId: string | null) =>
      sessionId
        ? (parseChildSessionId(sessionId)?.parentSessionId ?? sessionId)
        : null

    // Bucket events + memories by run (top-level session id).
    const eventsBySession = new Map<string | null, AgentRunHookEvent[]>()
    // A run's own events (not its subagents') — active time is turn-based on
    // the top-level session's prompts/STOPs.
    const ownEventsBySession = new Map<string, AgentRunHookEvent[]>()
    for (const ev of events) {
      const key = runKey(ev.sessionId ?? null)
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
      if (key && ev.sessionId === key) {
        const own = ownEventsBySession.get(key) ?? []
        own.push(list[list.length - 1]!)
        ownEventsBySession.set(key, own)
      }
    }

    const memoriesBySession = new Map<string | null, AgentRunMemoryItem[]>()
    for (const m of memories) {
      const key = runKey(m.sourceSessionId ?? null)
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
    const orderedSessions = [...sessions, ...hostSessions].sort(
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
      const isHost = hostOnly.has(s.id)
      // Own cost (a host's own burn belongs to another task / unattributed)
      // plus every child session of this run whose work belongs to the task.
      const childCosts = childCostByParent.get(s.id) ?? []
      const ownCost = isHost ? null : sessionCost(s)
      const merged =
        childCosts.length > 0 ? mergeModelCosts([ownCost, ...childCosts]) : null
      const costByModel = merged ? (merged.length > 0 ? merged : null) : ownCost

      return {
        sessionId: s.id,
        agent: s.agent,
        runNumber: i + 1,
        startedAt: s.startedAt.toISOString(),
        lastActivityAt: s.lastActivityAt.toISOString(),
        // Active time: Σ per-turn (STOP − prompt), excluding inter-turn idle —
        // a span (lastActivityAt − startedAt) would count a resumed session's
        // idle gap. See lib/agent-run/active-time.
        durationMs: activeDurationMs(ownEventsBySession.get(s.id) ?? []),
        toolCallCount,
        eventCount: sessionEvents.length,
        memoryCount: sessionMemories.length,
        runSummary: isHost ? null : s.runSummary,
        cost: costByModel
          ? { byModel: costByModel, loopCount: isHost ? null : s.loopCount }
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
        durationMs: activeDurationMs(orphanEvents),
        toolCallCount: orphanEvents.filter(e => e.type === 'PRE_TOOL_USE')
          .length,
        eventCount: orphanEvents.length,
        memoryCount: orphanMemories.length,
        runSummary: null,
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
    // Sum only runs that captured a loop count; stay null when none did, so the
    // aggregate badge shows "loops n/a" instead of a misleading 0 (LUM-311).
    const capturedLoops = ordered
      .map(r => r.cost?.loopCount)
      .filter((n): n is number => typeof n === 'number')
    const totals = {
      runCount: ordered.length,
      loopCount: capturedLoops.length
        ? capturedLoops.reduce((n, c) => n + c, 0)
        : null,
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

/**
 * Settled per-model cost, plus the in-flight remainder mid-turn events wrote
 * to the flat columns but no STOP has settled yet (LUM-345) — so a live run
 * shows its burn here just like the delivery card does. The liveUsageByModel
 * snapshot attributes that remainder per model where available; anything it
 * doesn't cover stays on the sentinel row.
 */
function sessionCost(
  s: Parameters<typeof withInFlightCost>[1] & {
    usageByModel: unknown
    liveUsageByModel: unknown
  }
): ModelCost[] | null {
  return withInFlightCost(
    toModelCosts(s.usageByModel as Record<string, ModelUsage> | null),
    s,
    s.liveUsageByModel as Record<string, ModelUsage> | null
  )
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
