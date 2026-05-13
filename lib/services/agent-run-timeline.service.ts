import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import type { HookEventType, MemoryCategory } from '@prisma/client'

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
  createdAt: string
}

export interface AgentRunMemoryItem {
  id: string
  kind: 'memory'
  category: MemoryCategory
  content: unknown
  createdAt: string
}

export type AgentRunItem = AgentRunHookEvent | AgentRunMemoryItem

export interface AgentRunSession {
  sessionId: string | null
  runNumber: number
  startedAt: string
  lastActivityAt: string
  durationMs: number
  toolCallCount: number
  eventCount: number
  memoryCount: number
  items: AgentRunItem[]
}

export interface AgentRunTimelineResult {
  runs: AgentRunSession[]
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

    const runs: AgentRunSession[] = orderedSessions.map((s, i) => {
      const sessionEvents = eventsBySession.get(s.id) ?? []
      const sessionMemories = memoriesBySession.get(s.id) ?? []
      eventsBySession.delete(s.id)
      memoriesBySession.delete(s.id)
      const items = mergeByTime(sessionEvents, sessionMemories)
      const toolCallCount = sessionEvents.filter(
        e => e.type === 'PRE_TOOL_USE'
      ).length

      return {
        sessionId: s.id,
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
        runNumber: runs.length + 1,
        startedAt: first,
        lastActivityAt: last,
        durationMs: new Date(last).getTime() - new Date(first).getTime(),
        toolCallCount: orphanEvents.filter(e => e.type === 'PRE_TOOL_USE')
          .length,
        eventCount: orphanEvents.length,
        memoryCount: orphanMemories.length,
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
    return { runs: nonEmptyRuns.reverse() }
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
