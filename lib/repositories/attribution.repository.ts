import { prisma } from '@/lib/db/prisma'
import type {
  AttributionConfidence,
  AttributionSource,
  Prisma,
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
  sessionId: string | null
  type: string
  createdAt: Date
  attributionSignals: Prisma.JsonValue | null
  payload: Prisma.JsonValue
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

const FAMILY_SESSION_SELECT = {
  id: true,
  parentSessionId: true,
  agentId: true,
  taskId: true,
  bindingSource: true,
  startedAt: true,
} as const

const IDENTIFIER_RE = /^([A-Za-z]{1,10})-(\d+)$/

export const attributionRepository = {
  /** Root session + its direct children + their events (createdAt asc). Null when the root is missing. */
  async loadFamily(rootSessionId: string): Promise<SessionFamily | null> {
    const root = await prisma.session.findUnique({
      where: { id: rootSessionId },
      select: { ...FAMILY_SESSION_SELECT, workspaceId: true },
    })
    if (!root) return null
    const children = await prisma.session.findMany({
      where: { parentSessionId: rootSessionId },
      select: FAMILY_SESSION_SELECT,
      orderBy: { startedAt: 'asc' },
    })
    const { workspaceId, ...rootSession } = root
    const sessions: FamilySession[] = [
      rootSession,
      ...children.map(c => ({
        id: c.id,
        parentSessionId: c.parentSessionId,
        agentId: c.agentId,
        taskId: c.taskId,
        bindingSource: c.bindingSource,
        startedAt: c.startedAt,
      })),
    ]
    const events = await prisma.hookEvent.findMany({
      where: { sessionId: { in: sessions.map(s => s.id) } },
      select: {
        sessionId: true,
        type: true,
        createdAt: true,
        attributionSignals: true,
        payload: true,
        payloadPrunedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    return { workspaceId, sessions, events }
  },

  /** identifier (`LUM-12`) → taskId for live (not soft-deleted) tasks of the workspace; one query. */
  async resolveIdentifiers(
    workspaceId: string,
    identifiers: string[]
  ): Promise<Map<string, string>> {
    const byTeam = new Map<string, number[]>()
    for (const raw of identifiers) {
      const m = IDENTIFIER_RE.exec(raw)
      if (!m) continue
      const team = m[1]!.toUpperCase()
      const number = Number(m[2])
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
