import { prisma } from '@/lib/db/prisma'
import {
  PRUNED_PAYLOAD_KEY,
  PRUNE_REASON_USER_DELETED,
} from '@/lib/hook-event/retention'

/** Crossing lookups are chunked so a long session never builds one huge `IN`. */
const CROSSING_LOOKUP_CHUNK = 1000

/** Matches events whose payload carries the LUM-944 user-deleted marker. */
const USER_DELETED_FILTER = {
  payload: {
    path: [PRUNED_PAYLOAD_KEY, 'reason'],
    equals: PRUNE_REASON_USER_DELETED,
  },
}

export interface SessionOwnerRow {
  id: string
  workspaceId: string
  workspaceMemberId: string
}

// ── Session raw record repository (LUM-944) ──────────────────────────────────

export const sessionRawRecordRepository = {
  /** The session's workspace and owning member; null when it does not exist. */
  async findSessionOwner(sessionId: string): Promise<SessionOwnerRow | null> {
    return prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, workspaceId: true, workspaceMemberId: true },
    })
  },

  /** The session plus its subagent sessions — one conversation's record. */
  async listFamilySessionIds(
    sessionId: string,
    workspaceId: string
  ): Promise<string[]> {
    const children = await prisma.session.findMany({
      where: { parentSessionId: sessionId, workspaceId },
      select: { id: true },
    })
    return [sessionId, ...children.map(c => c.id)]
  },

  /** Events of the sessions whose payload is still whole, in id order (keyset). */
  async findUnprunedEventIds(params: {
    workspaceId: string
    sessionIds: string[]
    afterId: string | null
    take: number
  }): Promise<string[]> {
    const { workspaceId, sessionIds, afterId, take } = params
    const rows = await prisma.hookEvent.findMany({
      where: {
        workspaceId,
        sessionId: { in: sessionIds },
        payloadPrunedAt: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take,
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /** The subset of `eventIds` an undispositioned boundary crossing points at. */
  async findOpenCrossingEventIds(eventIds: string[]): Promise<string[]> {
    const found = new Set<string>()
    for (let i = 0; i < eventIds.length; i += CROSSING_LOOKUP_CHUNK) {
      const chunk = eventIds.slice(i, i + CROSSING_LOOKUP_CHUNK)
      const rows = await prisma.boundaryCrossing.findMany({
        where: { hookEventId: { in: chunk }, disposition: null },
        select: { hookEventId: true },
      })
      for (const r of rows) if (r.hookEventId) found.add(r.hookEventId)
    }
    return [...found]
  },

  /** Counts for the delete dialog: all events, and those already deleted by hand. */
  async countEvents(params: {
    workspaceId: string
    sessionIds: string[]
  }): Promise<{ total: number; userDeleted: number }> {
    const where = {
      workspaceId: params.workspaceId,
      sessionId: { in: params.sessionIds },
    }
    const [total, userDeleted] = await Promise.all([
      prisma.hookEvent.count({ where }),
      prisma.hookEvent.count({ where: { ...where, ...USER_DELETED_FILTER } }),
    ])
    return { total, userDeleted }
  },

  /** The most recent hand delete of these sessions: its marker payload. */
  async findLatestUserDeletion(params: {
    workspaceId: string
    sessionIds: string[]
  }): Promise<{ payload: unknown } | null> {
    return prisma.hookEvent.findFirst({
      where: {
        workspaceId: params.workspaceId,
        sessionId: { in: params.sessionIds },
        ...USER_DELETED_FILTER,
      },
      orderBy: { payloadPrunedAt: 'desc' },
      select: { payload: true },
    })
  },

  /** Clerk id of a workspace member, for showing who deleted a record. */
  async findMemberClerkId(workspaceMemberId: string): Promise<string | null> {
    const row = await prisma.workspaceMember.findUnique({
      where: { id: workspaceMemberId },
      select: { clerkId: true },
    })
    return row?.clerkId ?? null
  },
}
