import type { Prisma } from '@prisma/client'
import {
  sessionRawRecordRepository,
  type SessionOwnerRow,
} from '@/lib/repositories/session-raw-record.repository'
import { hookEventRetentionRepository } from '@/lib/repositories/hook-event-retention.repository'
import {
  buildUserDeletedPayload,
  PRUNED_PAYLOAD_KEY,
} from '@/lib/hook-event/retention'
import { enrichClerkUsers } from '@/lib/utils/clerk-helpers'
import { logger } from '@/lib/logger'

/** Events one delete batch reads and clears. */
export const SESSION_RAW_DELETE_BATCH_SIZE = 500

/**
 * Batches one delete request runs before it returns `done: false` and the
 * client calls again with the cursor — keeps a request inside the function
 * budget on a very long session.
 */
export const SESSION_RAW_DELETE_MAX_BATCHES = 20

/** Page size when the status read walks a session's whole events. */
const STATUS_SCAN_PAGE = 5000

/** Who is asking: their membership in the session's workspace. */
export interface SessionRawRecordViewer {
  workspaceMemberId: string
  workspaceId: string
  role: string
}

export interface SessionRawRecordStatus {
  canDelete: boolean
  /** All events of the session and its subagent sessions. */
  totalEvents: number
  /** Events whose raw text a delete would clear now. */
  deletable: number
  /** Events kept because an undispositioned boundary crossing points at them. */
  keptForCrossings: number
  /** Events whose raw text was already deleted by hand. */
  deleted: number
  /** The latest hand delete; null when there was none. */
  lastDeletion: { at: string; byName: string | null } | null
}

export interface SessionRawRecordDeleteResult {
  /** Events cleared by this call (0 on a repeat). */
  deleted: number
  /** Events this call skipped for an undispositioned crossing. */
  keptForCrossings: number
  /** False when the batch budget ran out first — call again with `cursor`. */
  done: boolean
  /** Keyset cursor for the next call; null when done. */
  cursor: string | null
}

function forbidden(): Error {
  return Object.assign(
    new Error(
      "Only the session's member or a workspace owner can delete its record"
    ),
    { status: 403 }
  )
}

/** The session's member may delete their own record; a workspace OWNER any. */
export function canDeleteSessionRawRecord(
  session: Pick<SessionOwnerRow, 'workspaceId' | 'workspaceMemberId'>,
  viewer: SessionRawRecordViewer
): boolean {
  if (session.workspaceId !== viewer.workspaceId) return false
  return (
    session.workspaceMemberId === viewer.workspaceMemberId ||
    viewer.role === 'OWNER'
  )
}

async function loadSession(sessionId: string): Promise<SessionOwnerRow> {
  const session = await sessionRawRecordRepository.findSessionOwner(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { status: 404 })
  }
  return session
}

function markerOf(payload: unknown): { at?: unknown; by?: unknown } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null
  const marker = (payload as Record<string, unknown>)[PRUNED_PAYLOAD_KEY]
  return marker && typeof marker === 'object'
    ? (marker as { at?: unknown; by?: unknown })
    : null
}

async function displayNameOf(
  workspaceMemberId: unknown
): Promise<string | null> {
  if (typeof workspaceMemberId !== 'string') return null
  try {
    const clerkId =
      await sessionRawRecordRepository.findMemberClerkId(workspaceMemberId)
    if (!clerkId) return null
    return (await enrichClerkUsers([clerkId])).get(clerkId)?.name ?? null
  } catch (err) {
    // The name is a nicety on the status line; the marker keeps the member id.
    logger.warn('[session-raw-record] deleter name lookup failed', { err })
    return null
  }
}

/**
 * LUM-944 — delete one session's raw record (the hook payloads: prompts,
 * commands, file contents, tool output) before any retention window ends.
 * Each event keeps its row and every derived column (type, time, tool name,
 * file path, token usage, turn summary); its payload becomes the same pruned
 * marker the retention sweep writes, with reason USER_DELETED and the
 * deleting member — the marker is the audit record. Session summaries and run
 * summaries are not touched (LUM-917 owns those). Events an undispositioned
 * boundary crossing points at are skipped: they are the crossing's evidence
 * until it is ruled on, after which a second delete clears them.
 */
export const sessionRawRecordService = {
  async getStatus(
    sessionId: string,
    viewer: SessionRawRecordViewer
  ): Promise<SessionRawRecordStatus> {
    const session = await loadSession(sessionId)
    if (!canDeleteSessionRawRecord(session, viewer)) {
      return {
        canDelete: false,
        totalEvents: 0,
        deletable: 0,
        keptForCrossings: 0,
        deleted: 0,
        lastDeletion: null,
      }
    }
    const { workspaceId } = session
    const sessionIds = await sessionRawRecordRepository.listFamilySessionIds(
      sessionId,
      workspaceId
    )

    const unpruned: string[] = []
    let afterId: string | null = null
    for (;;) {
      const page = await sessionRawRecordRepository.findUnprunedEventIds({
        workspaceId,
        sessionIds,
        afterId,
        take: STATUS_SCAN_PAGE,
      })
      unpruned.push(...page)
      if (page.length < STATUS_SCAN_PAGE) break
      afterId = page[page.length - 1]!
    }
    const [kept, counts, latest] = await Promise.all([
      sessionRawRecordRepository.findOpenCrossingEventIds(unpruned),
      sessionRawRecordRepository.countEvents({ workspaceId, sessionIds }),
      sessionRawRecordRepository.findLatestUserDeletion({
        workspaceId,
        sessionIds,
      }),
    ])

    let lastDeletion: SessionRawRecordStatus['lastDeletion'] = null
    const marker = markerOf(latest?.payload)
    if (marker && typeof marker.at === 'string') {
      lastDeletion = { at: marker.at, byName: await displayNameOf(marker.by) }
    }

    return {
      canDelete: true,
      totalEvents: counts.total,
      deletable: unpruned.length - kept.length,
      keptForCrossings: kept.length,
      deleted: counts.userDeleted,
      lastDeletion,
    }
  },

  /**
   * One batched pass of the delete. Idempotent: events already cleared are
   * never read again, so a repeat clears 0. `after` resumes a pass that ran
   * out of batch budget (`done: false`).
   */
  async deleteRawRecord(
    sessionId: string,
    viewer: SessionRawRecordViewer,
    options: {
      after?: string | null
      now?: Date
      /** Test seam: batch size and per-call batch budget. */
      limits?: { batchSize: number; maxBatches: number }
    } = {}
  ): Promise<SessionRawRecordDeleteResult> {
    const { batchSize, maxBatches } = options.limits ?? {
      batchSize: SESSION_RAW_DELETE_BATCH_SIZE,
      maxBatches: SESSION_RAW_DELETE_MAX_BATCHES,
    }
    const session = await loadSession(sessionId)
    if (!canDeleteSessionRawRecord(session, viewer)) throw forbidden()

    const { workspaceId } = session
    const now = options.now ?? new Date()
    const sessionIds = await sessionRawRecordRepository.listFamilySessionIds(
      sessionId,
      workspaceId
    )
    const marker = buildUserDeletedPayload(
      now,
      viewer.workspaceMemberId
    ) as unknown as Prisma.InputJsonValue

    const result: SessionRawRecordDeleteResult = {
      deleted: 0,
      keptForCrossings: 0,
      done: true,
      cursor: null,
    }
    let afterId = options.after ?? null
    for (let batch = 0; ; batch++) {
      if (batch >= maxBatches) {
        result.done = false
        result.cursor = afterId
        break
      }
      const ids = await sessionRawRecordRepository.findUnprunedEventIds({
        workspaceId,
        sessionIds,
        afterId,
        take: batchSize,
      })
      if (ids.length === 0) break
      afterId = ids[ids.length - 1]!

      const kept = new Set(
        await sessionRawRecordRepository.findOpenCrossingEventIds(ids)
      )
      result.keptForCrossings += kept.size
      result.deleted += await hookEventRetentionRepository.prunePayloads(
        ids.filter(id => !kept.has(id)),
        marker,
        now
      )
      if (ids.length < batchSize) break
    }

    logger.info('[session-raw-record] raw record deleted', {
      sessionId,
      workspaceId,
      byWorkspaceMemberId: viewer.workspaceMemberId,
      asOwner: session.workspaceMemberId !== viewer.workspaceMemberId,
      deleted: result.deleted,
      keptForCrossings: result.keptForCrossings,
      done: result.done,
    })
    return result
  },
}
