import { prisma } from '@/lib/db/prisma'
import { parseTaskIdentifier } from '@/lib/attribution/identifier'
import { isBackfillEligible } from '@/lib/attribution/backfill-eligibility'
import { TASK_NOTIFICATION_MARKER } from '@/lib/attribution/signals'
import type { TaskSegmentRow } from '@/lib/attribution/run-attribution'
import { Prisma } from '@prisma/client'
import type {
  AttributionConfidence,
  AttributionSource,
  SessionBindingSource,
  SessionRole,
} from '@prisma/client'
import {
  ID_CHUNK,
  moveOpenCrossingsForEvents,
  RETAG_TX_OPTIONS,
  type EventTaskMove,
} from '@/lib/repositories/open-crossing-move'

/**
 * LUM-932 P2: persistence for per-turn task attribution (observe-only mode).
 * Loads a session family (root + subagent children) with the event fields the
 * engine needs, resolves task identifiers / PR head branches to task ids, and
 * atomically replaces the family's TaskAttributionSegment rows.
 */
// 2: R1 multi-task turns / R2 notification turns (LUM-932 acceptance rulings).
// 3: orchestration hosts are attributed by work output only (LUM-1237).
export const ATTRIBUTION_COMPUTE_VERSION = 3

/** A segment written by an older engine version (LUM-1237 recompute). */
const STALE_SEGMENT: Prisma.TaskAttributionSegmentWhereInput = {
  computeVersion: { lt: ATTRIBUTION_COMPUTE_VERSION },
}

export interface FamilySession {
  id: string
  parentSessionId: string | null
  agentId: string | null
  taskId: string | null
  bindingSource: SessionBindingSource | null
  startedAt: Date
  /** LUM-640: a STEWARD session with a milestone keeps its events task-less. */
  role: SessionRole
  milestoneId: string | null
}

export interface FamilyEvent {
  id: string
  sessionId: string | null
  /** The event's current task attribution. */
  taskId: string | null
  type: string
  createdAt: Date
  attributionSignals: Prisma.JsonValue | null
  /** Null when not loaded: stored signals exist, or the payload was pruned. */
  payload: Prisma.JsonValue | null
  payloadPrunedAt: Date | null
}

export interface SessionFamily {
  workspaceId: string
  /** The root's `attributionVersion` at load time (optimistic lock). */
  attributionVersion: number
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
  attributionVersion: number
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
  role: true,
  milestoneId: true,
} as const

/**
 * LUM-932 P3: one versioned write of a family's attribution. `segments: null`
 * leaves the stored segments as they are.
 */
export interface FamilyCommit {
  rootSessionId: string
  expectedVersion: number
  familyIds: string[]
  segments: SegmentRow[] | null
  eventTaskChanges: { eventId: string; taskId: string | null }[]
}

export interface FamilyCommitResult {
  conflict: boolean
  eventsUpdated: number
  /** Undispositioned crossings moved with their event (any target). */
  crossingsMoved: number
  /** The subset of `crossingsMoved` that went to no task (M1). */
  crossingsMovedToNull: number
  /** Events whose taskId this commit changed, with the old and new task. */
  changedEvents: EventTaskMove[]
}

const NO_COMMIT = {
  eventsUpdated: 0,
  crossingsMoved: 0,
  crossingsMovedToNull: 0,
  changedEvents: [] as EventTaskMove[],
}

/** Rolls the commit transaction back when the root's version moved on. */
class AttributionVersionConflict extends Error {}

async function loadFamilySessions(
  rootSessionId: string,
  opts: { boundOnly: boolean }
): Promise<{
  workspaceId: string
  attributionVersion: number
  sessions: FamilySession[]
} | null> {
  const root = await prisma.session.findUnique({
    where: { id: rootSessionId },
    select: {
      ...FAMILY_SESSION_SELECT,
      workspaceId: true,
      attributionVersion: true,
    },
  })
  if (!root || (opts.boundOnly && !root.taskId)) return null
  const children = await prisma.session.findMany({
    where: { parentSessionId: rootSessionId, workspaceId: root.workspaceId },
    select: FAMILY_SESSION_SELECT,
    orderBy: { startedAt: 'asc' },
  })
  const { workspaceId, attributionVersion, ...rootSession } = root
  return {
    workspaceId,
    attributionVersion,
    sessions: [rootSession, ...children],
  }
}

export const attributionRepository = {
  /** Root session + its direct children + their events (createdAt asc). Null when the root is missing. */
  async loadFamily(rootSessionId: string): Promise<SessionFamily | null> {
    const head = await loadFamilySessions(rootSessionId, { boundOnly: false })
    if (!head) return null
    const { workspaceId, attributionVersion, sessions } = head
    const scope = {
      workspaceId,
      sessionId: { in: sessions.map(s => s.id) },
    }
    const meta = await prisma.hookEvent.findMany({
      where: scope,
      select: {
        id: true,
        sessionId: true,
        taskId: true,
        type: true,
        createdAt: true,
        attributionSignals: true,
        payloadPrunedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    // Payloads only for events never computed at record time (historical
    // rows), and for root task-notification prompts whose stored signals may
    // predate the NOTIFICATION kind.
    const payloadRows = await prisma.hookEvent.findMany({
      where: {
        ...scope,
        payloadPrunedAt: null,
        OR: [
          { attributionSignals: { equals: Prisma.DbNull } },
          {
            sessionId: rootSessionId,
            type: 'USER_PROMPT_SUBMIT',
            // Stored signals that already carry NOTIFICATION need no re-read.
            NOT: {
              attributionSignals: {
                array_contains: [{ kind: 'NOTIFICATION' }],
              },
            },
            payload: {
              path: ['prompt'],
              string_contains: TASK_NOTIFICATION_MARKER,
            },
          },
        ],
      },
      select: { id: true, payload: true },
    })
    const payloads = new Map(payloadRows.map(r => [r.id, r.payload]))
    const events: FamilyEvent[] = meta.map(e => ({
      ...e,
      payload: payloads.get(e.id) ?? null,
    }))
    return { workspaceId, attributionVersion, sessions, events }
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
    const { workspaceId, attributionVersion, sessions } = head
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
    return {
      workspaceId,
      attributionVersion,
      sessions,
      rootPromptCount,
      firstEventAt,
    }
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

  /** LUM-932 P4: every segment attributed to the task, with the owning
   *  session's family position — the task page's "why attributed" read. */
  async listTaskSegments(taskId: string): Promise<TaskSegmentRow[]> {
    const rows = await prisma.taskAttributionSegment.findMany({
      where: { taskId },
      orderBy: { fromAt: 'asc' },
      select: {
        sessionId: true,
        source: true,
        confidence: true,
        fromTurn: true,
        toTurn: true,
        fromAt: true,
        toAt: true,
        evidence: true,
        session: { select: { parentSessionId: true, agentType: true } },
      },
    })
    return rows.map(({ session, ...r }) => ({
      ...r,
      parentSessionId: session.parentSessionId,
      agentType: session.agentType,
    }))
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
   * LUM-1237 history recompute: ids of UNBOUND root sessions that host at
   * least one self-attached subagent (orchestration hosts) and whose family
   * still carries a segment computed by an older engine version — so a
   * re-run with the same `limit` moves on to the next batch instead of
   * re-listing families already recomputed. Oldest first; optional
   * workspace / last-activity filters.
   */
  async listOrchestrationHostRootIds(opts: {
    workspaceId?: string
    since?: Date
    limit: number
  }): Promise<string[]> {
    const rows = await prisma.session.findMany({
      where: {
        parentSessionId: null,
        taskId: null,
        ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
        ...(opts.since ? { lastActivityAt: { gte: opts.since } } : {}),
        children: {
          some: { bindingSource: 'ATTACH', taskId: { not: null } },
        },
        OR: [
          { attributionSegments: { some: STALE_SEGMENT } },
          {
            children: {
              some: { attributionSegments: { some: STALE_SEGMENT } },
            },
          },
        ],
      },
      select: { id: true },
      orderBy: { startedAt: 'asc' },
      take: opts.limit,
    })
    return rows.map(r => r.id)
  },

  /**
   * LUM-1237 history recompute preview: how many UNDISPOSITIONED crossings
   * hang off these events (what a retag would move).
   */
  async countOpenCrossingsForEvents(eventIds: string[]): Promise<number> {
    let total = 0
    for (let i = 0; i < eventIds.length; i += 5000) {
      total += await prisma.boundaryCrossing.count({
        where: {
          disposition: null,
          hookEventId: { in: eventIds.slice(i, i + 5000) },
        },
      })
    }
    return total
  },

  /**
   * LUM-1237: does this root session host a subagent that attached a task
   * itself? (The orchestration-host test of `isOrchestrationHost`, for the
   * record-time provisional tag.)
   */
  async hasSelfAttachedChild(
    workspaceId: string,
    rootSessionId: string
  ): Promise<boolean> {
    const row = await prisma.session.findFirst({
      where: {
        workspaceId,
        parentSessionId: rootSessionId,
        bindingSource: 'ATTACH',
        taskId: { not: null },
      },
      select: { id: true },
    })
    return row !== null
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

  /**
   * LUM-932 P3: taskId of the most recent PRE_TOOL_USE event of `sessionId`
   * with this `tool_use_id`, recorded since `since`; null when none (or it
   * carries no task). One query served by `[sessionId, createdAt]`, the JSON
   * match applied to that session's recent PRE events only.
   */
  async findPreToolUseTask(
    workspaceId: string,
    sessionId: string,
    toolUseId: string,
    since: Date
  ): Promise<string | null> {
    const row = await prisma.hookEvent.findFirst({
      where: {
        sessionId,
        createdAt: { gte: since },
        workspaceId,
        type: 'PRE_TOOL_USE',
        payload: { path: ['tool_use_id'], equals: toolUseId },
      },
      select: { taskId: true },
      orderBy: { createdAt: 'desc' },
    })
    return row?.taskId ?? null
  },

  /**
   * One transaction, starting with a compare-and-bump of the root's
   * attributionVersion (still `expectedVersion`, else `{ conflict: true }`
   * and the whole transaction rolls back): replace the family's segments when given; set HookEvent.taskId for the
   * changed events; move the UNDISPOSITIONED crossings of those events to the
   * event's new task (null when the new attribution is null). Dispositioned
   * crossings are untouched. Every binding write bumps the root version in
   * its own transaction (`bumpFamilyAttributionVersion`), so an attach landing
   * between load and commit makes this commit conflict; in addition, only
   * events of family sessions STILL backfill-eligible (`isBackfillEligible`)
   * are changed — explicit binding always wins.
   */
  async commitFamilyAttribution(
    input: FamilyCommit
  ): Promise<FamilyCommitResult> {
    const { rootSessionId, expectedVersion, familyIds, segments } = input
    try {
      return await prisma.$transaction(async tx => {
        // FIRST statement. Single global lock order, shared with every
        // binding path: family ROOT row -> child session rows -> hook
        // events -> crossings. Bindings bump the root first; taking the
        // root last here could deadlock against them and fail
        // `lumo session attach`. Under READ COMMITTED the UPDATE re-evaluates
        // its WHERE after waiting on a concurrent binding's root lock, so a
        // binding that bumped since the load matches 0 rows -> sentinel ->
        // rollback.
        const { count } = await tx.session.updateMany({
          where: { id: rootSessionId, attributionVersion: expectedVersion },
          data: { attributionVersion: { increment: 1 } },
        })
        if (count === 0) throw new AttributionVersionConflict()

        if (segments) {
          await tx.taskAttributionSegment.deleteMany({
            where: { sessionId: { in: familyIds } },
          })
          if (segments.length > 0) {
            await tx.taskAttributionSegment.createMany({ data: segments })
          }
        }

        const targetOf = new Map(
          input.eventTaskChanges.map(c => [c.eventId, c.taskId])
        )
        if (targetOf.size === 0) {
          return { conflict: false, ...NO_COMMIT }
        }

        // Belt-and-braces with the binding paths' root-version bump: re-check
        // eligibility in-transaction with the SAME predicate the assignment
        // used (explicit binding wins; STEWARD sessions and their children
        // are never backfilled).
        const members = await tx.session.findMany({
          where: { id: { in: familyIds } },
          select: {
            id: true,
            parentSessionId: true,
            taskId: true,
            role: true,
            milestoneId: true,
          },
        })
        const memberById = new Map(members.map(m => [m.id, m]))
        const eligibleIds = members
          .filter(m =>
            isBackfillEligible(
              m,
              m.parentSessionId ? memberById.get(m.parentSessionId) : null
            )
          )
          .map(m => m.id)
        const ids = [...targetOf.keys()]
        const moves: EventTaskMove[] = []
        for (let i = 0; i < ids.length; i += ID_CHUNK) {
          const current = await tx.hookEvent.findMany({
            where: {
              id: { in: ids.slice(i, i + ID_CHUNK) },
              sessionId: { in: eligibleIds },
            },
            select: { id: true, taskId: true },
          })
          for (const e of current) {
            const toTaskId = targetOf.get(e.id) ?? null
            if (e.taskId !== toTaskId)
              moves.push({ eventId: e.id, fromTaskId: e.taskId, toTaskId })
          }
        }

        const byTarget = new Map<string | null, string[]>()
        for (const m of moves) {
          const list = byTarget.get(m.toTaskId)
          if (list) list.push(m.eventId)
          else byTarget.set(m.toTaskId, [m.eventId])
        }
        let eventsUpdated = 0
        for (const [taskId, eventIds] of byTarget) {
          for (let i = 0; i < eventIds.length; i += ID_CHUNK) {
            const { count: n } = await tx.hookEvent.updateMany({
              where: { id: { in: eventIds.slice(i, i + ID_CHUNK) } },
              data: { taskId },
            })
            eventsUpdated += n
          }
        }
        const crossingsMoved = await moveOpenCrossingsForEvents(
          tx,
          moves.filter(m => m.toTaskId !== null)
        )
        const crossingsMovedToNull = await moveOpenCrossingsForEvents(
          tx,
          moves.filter(m => m.toTaskId === null)
        )
        return {
          conflict: false,
          eventsUpdated,
          crossingsMoved: crossingsMoved + crossingsMovedToNull,
          crossingsMovedToNull,
          changedEvents: moves,
        }
      }, RETAG_TX_OPTIONS)
    } catch (error) {
      // Safety net: the lock order is root-first everywhere, but if Postgres
      // still aborts this commit (P2034 deadlock/serialization) it is just a
      // lost race — retry.
      if (
        error instanceof AttributionVersionConflict ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034')
      )
        return { conflict: true, ...NO_COMMIT }
      throw error
    }
  },
}
