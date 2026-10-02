import { prisma } from '@/lib/db/prisma'
import { parseTaskIdentifier } from '@/lib/attribution/identifier'
import { Prisma } from '@prisma/client'
import type {
  AttributionConfidence,
  AttributionSource,
  SessionBindingSource,
} from '@prisma/client'

/**
 * LUM-932 P2: persistence for per-turn task attribution (observe-only mode).
 * Loads a session family (root + subagent children) with the event fields the
 * engine needs, resolves task identifiers / PR head branches to task ids, and
 * atomically replaces the family's TaskAttributionSegment rows.
 */
export const ATTRIBUTION_COMPUTE_VERSION = 1

export interface FamilySession {
  id: string
  parentSessionId: string | null
  agentId: string | null
  taskId: string | null
  bindingSource: SessionBindingSource | null
  startedAt: Date
}

export interface FamilyEvent {
  id: string
  sessionId: string | null
  type: string
  createdAt: Date
  attributionSignals: Prisma.JsonValue | null
  /** Null when not loaded: stored signals exist, or the payload was pruned. */
  payload: Prisma.JsonValue | null
  payloadPrunedAt: Date | null
}

export interface SessionFamily {
  workspaceId: string
  sessions: FamilySession[]
  events: FamilyEvent[]
}

export interface SegmentRow {
  workspaceId: string
  sessionId: string
  taskId: string
  fromTurn: number
  toTurn: number
  fromAt: Date
  toAt: Date | null
  source: AttributionSource
  confidence: AttributionConfidence
  evidence: Prisma.InputJsonValue
  computeVersion: number
}

/**
 * A bound root's family without its events: what explicit segments need
 * (root prompt count for the turn range, first event time per session).
 */
export interface BoundFamilyShape {
  workspaceId: string
  sessions: FamilySession[]
  rootPromptCount: number
  firstEventAt: Map<string, Date>
}

/** A stored segment's fields that decide whether a recompute changed anything. */
export interface StoredSegment {
  sessionId: string
  taskId: string
  fromTurn: number
  toTurn: number
  fromAt: Date
  toAt: Date | null
  source: AttributionSource
  confidence: AttributionConfidence
  computeVersion: number
  evidence: Prisma.JsonValue
}

const FAMILY_SESSION_SELECT = {
  id: true,
  parentSessionId: true,
  agentId: true,
  taskId: true,
  bindingSource: true,
  startedAt: true,
} as const

async function loadFamilySessions(
  rootSessionId: string,
  opts: { boundOnly: boolean }
): Promise<{ workspaceId: string; sessions: FamilySession[] } | null> {
  const root = await prisma.session.findUnique({
    where: { id: rootSessionId },
    select: { ...FAMILY_SESSION_SELECT, workspaceId: true },
  })
  if (!root || (opts.boundOnly && !root.taskId)) return null
  const children = await prisma.session.findMany({
    where: { parentSessionId: rootSessionId, workspaceId: root.workspaceId },
    select: FAMILY_SESSION_SELECT,
    orderBy: { startedAt: 'asc' },
  })
  const { workspaceId, ...rootSession } = root
  return { workspaceId, sessions: [rootSession, ...children] }
}

export const attributionRepository = {
  /** Root session + its direct children + their events (createdAt asc). Null when the root is missing. */
  async loadFamily(rootSessionId: string): Promise<SessionFamily | null> {
    const head = await loadFamilySessions(rootSessionId, { boundOnly: false })
    if (!head) return null
    const { workspaceId, sessions } = head
    const scope = {
      workspaceId,
      sessionId: { in: sessions.map(s => s.id) },
    }
    const meta = await prisma.hookEvent.findMany({
      where: scope,
      select: {
        id: true,
        sessionId: true,
        type: true,
        createdAt: true,
        attributionSignals: true,
        payloadPrunedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    // Payloads only for events never computed at record time (historical rows).
    const payloadRows = await prisma.hookEvent.findMany({
      where: {
        ...scope,
        attributionSignals: { equals: Prisma.DbNull },
        payloadPrunedAt: null,
      },
      select: { id: true, payload: true },
    })
    const payloads = new Map(payloadRows.map(r => [r.id, r.payload]))
    const events: FamilyEvent[] = meta.map(e => ({
      ...e,
      payload: payloads.get(e.id) ?? null,
    }))
    return { workspaceId, sessions, events }
  },

  /**
   * Light load for an explicitly bound root: sessions, the root's prompt count
   * and each session's first event time — no event rows. Null when the root
   * is missing or not bound to a task (callers then use `loadFamily`).
   */
  async loadBoundFamilyShape(
    rootSessionId: string
  ): Promise<BoundFamilyShape | null> {
    const head = await loadFamilySessions(rootSessionId, { boundOnly: true })
    if (!head) return null
    const { workspaceId, sessions } = head
    const [rootPromptCount, firsts] = await Promise.all([
      prisma.hookEvent.count({
        where: {
          workspaceId,
          sessionId: rootSessionId,
          type: 'USER_PROMPT_SUBMIT',
        },
      }),
      prisma.hookEvent.groupBy({
        by: ['sessionId'],
        where: { workspaceId, sessionId: { in: sessions.map(s => s.id) } },
        _min: { createdAt: true },
      }),
    ])
    const firstEventAt = new Map<string, Date>()
    for (const row of firsts) {
      if (row.sessionId && row._min.createdAt)
        firstEventAt.set(row.sessionId, row._min.createdAt)
    }
    return { workspaceId, sessions, rootPromptCount, firstEventAt }
  },

  /** The family's stored segments, comparable fields only. */
  async listFamilySegments(
    familySessionIds: string[]
  ): Promise<StoredSegment[]> {
    return prisma.taskAttributionSegment.findMany({
      where: { sessionId: { in: familySessionIds } },
      select: {
        sessionId: true,
        taskId: true,
        fromTurn: true,
        toTurn: true,
        fromAt: true,
        toAt: true,
        source: true,
        confidence: true,
        computeVersion: true,
        evidence: true,
      },
    })
  },

  /** identifier (`LUM-12`) → taskId for live (not soft-deleted) tasks of the workspace; one query. */
  async resolveIdentifiers(
    workspaceId: string,
    identifiers: string[]
  ): Promise<Map<string, string>> {
    const byTeam = new Map<string, number[]>()
    for (const raw of identifiers) {
      const parsed = parseTaskIdentifier(raw)
      if (!parsed) continue
      const { team, number } = parsed
      const list = byTeam.get(team) ?? []
      if (!list.includes(number)) list.push(number)
      byTeam.set(team, list)
    }
    const out = new Map<string, string>()
    if (byTeam.size === 0) return out
    const rows = await prisma.task.findMany({
      where: {
        deletedAt: null,
        OR: [...byTeam].map(([identifier, numbers]) => ({
          team: { identifier, workspaceId },
          number: { in: numbers },
        })),
      },
      select: {
        id: true,
        number: true,
        team: { select: { identifier: true } },
      },
    })
    for (const r of rows) {
      out.set(`${r.team.identifier.toUpperCase()}-${r.number}`, r.id)
    }
    return out
  },

  /** head branch → taskId of the most recently updated linked PR (live tasks only). */
  async taskIdsForBranches(
    workspaceId: string,
    branches: string[]
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const unique = [...new Set(branches)]
    if (unique.length === 0) return out
    const rows = await prisma.pullRequest.findMany({
      where: {
        workspaceId,
        headBranch: { in: unique },
        taskId: { not: null },
        task: { deletedAt: null },
      },
      select: { headBranch: true, taskId: true },
      orderBy: { updatedAt: 'desc' },
    })
    for (const r of rows) {
      if (r.taskId && !out.has(r.headBranch)) out.set(r.headBranch, r.taskId)
    }
    return out
  },

  /** Root session ids the member explicitly attached to a task, active since `since`. */
  async listExplicitRootSessionsForMember(
    workspaceMemberId: string,
    since: Date,
    limit = 50
  ): Promise<string[]> {
    const rows = await prisma.session.findMany({
      where: {
        workspaceMemberId,
        parentSessionId: null,
        bindingSource: 'ATTACH',
        taskId: { not: null },
        lastActivityAt: { gte: since },
      },
      select: { id: true },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
    })
    return rows.map(r => r.id)
  },

  /**
   * LUM-932 P3: taskId of the open (`toAt: null`) INFERRED segment of the
   * first session in `sessionIds` (priority order) that has one; within that
   * session the open segment with the latest `fromAt`. One query.
   */
  async findOpenSegmentTask(
    workspaceId: string,
    sessionIds: string[]
  ): Promise<string | null> {
    if (sessionIds.length === 0) return null
    const rows = await prisma.taskAttributionSegment.findMany({
      where: {
        workspaceId,
        sessionId: { in: sessionIds },
        toAt: null,
        source: 'INFERRED',
        // A trashed task is no attribution target.
        task: { deletedAt: null },
      },
      select: { sessionId: true, taskId: true },
      orderBy: { fromAt: 'desc' },
    })
    for (const id of sessionIds) {
      const hit = rows.find(r => r.sessionId === id)
      if (hit) return hit.taskId
    }
    return null
  },

  /** Atomically replace every segment of the family's sessions. */
  async replaceFamilySegments(
    familySessionIds: string[],
    rows: SegmentRow[]
  ): Promise<void> {
    await prisma.$transaction(async tx => {
      await tx.taskAttributionSegment.deleteMany({
        where: { sessionId: { in: familySessionIds } },
      })
      if (rows.length > 0) {
        await tx.taskAttributionSegment.createMany({ data: rows })
      }
    })
  },
}
