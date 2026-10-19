import {
  Prisma,
  type FeedbackKind,
  type FeedbackSource,
  type FeedbackStatus,
} from '@prisma/client'
import { scopedPrisma as prisma, unscoped } from '@/lib/db/workspace-scope'
import {
  redactStoredFields,
  STORAGE_REDACTED_FIELDS,
} from '@/lib/security-scan/storage-redaction'

/**
 * LUM-1240 — persistence for customer feedback to the Lumo team. Every query
 * here pins `workspaceId` and runs on the tenant-checked client (LUM-979
 * `scopedPrisma`): there is no "find by id", so a caller cannot reach another
 * workspace's row by guessing an id.
 * No authorization or business logic (rate limits, redaction counting) —
 * that lives in `feedbackService`.
 */

const SELECT = {
  id: true,
  number: true,
  kind: true,
  status: true,
  title: true,
  steps: true,
  expected: true,
  actual: true,
  evidence: true,
  environment: true,
  taskRef: true,
  sessionId: true,
  submittedVia: true,
  secretsRedacted: true,
  statusChangedAt: true,
  createdAt: true,
  updatedAt: true,
  submittedByMemberId: true,
  replies: {
    select: { body: true, createdAt: true },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.FeedbackSelect

const LIST_SELECT = {
  id: true,
  number: true,
  kind: true,
  status: true,
  title: true,
  createdAt: true,
  submittedByMemberId: true,
  _count: { select: { replies: true } },
} satisfies Prisma.FeedbackSelect

/**
 * LUM-1240 batch 2 — the Lumo team's triage queue reads every workspace by
 * design. The staff check (`isLumoStaff`) runs in the route before any of
 * these is reached.
 */
const STAFF_SCOPE = 'LUM-1240 staff feedback triage: cross-workspace by design'

const STAFF_SELECT = {
  ...SELECT,
  seq: true,
  workspaceId: true,
  statusChangedById: true,
  workspace: { select: { name: true, slug: true } },
  replies: {
    select: { body: true, createdAt: true, authorMemberId: true },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.FeedbackSelect

const STAFF_LIST_SELECT = {
  ...LIST_SELECT,
  seq: true,
  workspaceId: true,
  workspace: { select: { name: true, slug: true } },
} satisfies Prisma.FeedbackSelect

export type FeedbackRow = Prisma.FeedbackGetPayload<{ select: typeof SELECT }>
export type FeedbackListRow = Prisma.FeedbackGetPayload<{
  select: typeof LIST_SELECT
}>

export type StaffFeedbackRow = Prisma.FeedbackGetPayload<{
  select: typeof STAFF_SELECT
}>
export type StaffFeedbackListRow = Prisma.FeedbackGetPayload<{
  select: typeof STAFF_LIST_SELECT
}>

export interface StaffFeedbackListFilter {
  status?: FeedbackStatus | undefined
  kind?: FeedbackKind | undefined
  workspaceId?: string | undefined
  /** Only rows with a seq below this one (newest-first paging). */
  beforeSeq?: number | undefined
  take: number
}

export interface StaffFeedbackUpdate {
  status?: { to: FeedbackStatus; byMemberId: string; at: Date } | undefined
  reply?: { body: string; authorMemberId: string } | undefined
}

export interface CreateFeedbackRow {
  workspaceId: string
  kind: FeedbackKind
  title: string
  steps: string[]
  expected: string | null
  actual: string | null
  evidence: Prisma.InputJsonValue
  environment: Prisma.InputJsonValue | null
  taskRef: string | null
  sessionId: string | null
  submittedByMemberId: string
  submittedVia: FeedbackSource
  secretsRedacted: number
}

export interface FeedbackListFilter {
  workspaceId: string
  status?: FeedbackStatus | undefined
  kind?: FeedbackKind | undefined
  submittedByMemberId?: string | undefined
  /** Only rows with a number below this one (newest-first paging). */
  beforeNumber?: number | undefined
  take: number
}

/**
 * Concurrent submissions to one workspace queue on the counter row lock, and
 * the queueing counts against the interactive-transaction timeout (5 s by
 * default) — with the limit re-check inside, a short burst of parallel
 * submissions measured from a laptop to the dev database ran past it. A
 * timed-out transaction fails closed (503), so this only trades latency for
 * fewer spurious refusals.
 */
const CREATE_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 }

export type AppendEvidenceResult =
  | { status: 'appended'; row: FeedbackRow }
  | { status: 'not_found' }
  | { status: 'full' }
  | { status: 'conflict' }

/** Window counts used by the submission limits. */
export interface FeedbackCounter {
  /**
   * Rows `memberId` submitted since `since`. A row whose submitter was
   * deleted (submittedByMemberId set to NULL) belongs to no live member and
   * is counted by the workspace limit only.
   */
  countByMemberSince(
    workspaceId: string,
    memberId: string,
    since: Date
  ): Promise<number>
  countByWorkspaceSince(workspaceId: string, since: Date): Promise<number>
  oldestSince(
    where: { workspaceId: string; submittedByMemberId?: string },
    since: Date
  ): Promise<Date | null>
}

type FeedbackClient = Pick<Prisma.TransactionClient, 'feedback'>

function counterFor(client: FeedbackClient): FeedbackCounter {
  return {
    countByMemberSince: (workspaceId, memberId, since) =>
      client.feedback.count({
        where: {
          workspaceId,
          submittedByMemberId: memberId,
          createdAt: { gte: since },
        },
      }),
    countByWorkspaceSince: (workspaceId, since) =>
      client.feedback.count({
        where: { workspaceId, createdAt: { gte: since } },
      }),
    oldestSince: async (where, since) => {
      const row = await client.feedback.findFirst({
        where: { ...where, createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      })
      return row?.createdAt ?? null
    },
  }
}

export const feedbackRepository = {
  /**
   * Insert one row, allocating `number` from Workspace.feedbackSeq in the
   * same transaction — the counter row lock serialises concurrent inserts
   * (as crossingSeq / documentSeq do).
   *
   * `beforeInsert` runs inside that transaction right after the counter
   * update, i.e. while this transaction holds the workspace row lock: every
   * other insert into the same workspace waits for it, and under READ
   * COMMITTED each statement sees rows committed before it started. Counts
   * taken through the given counter therefore include every earlier
   * submission, so a limit check there cannot be raced past. A throw rolls
   * the whole insert (and the counter bump) back.
   */
  async create(
    input: CreateFeedbackRow,
    beforeInsert?: (counter: FeedbackCounter) => Promise<void>
  ): Promise<FeedbackRow> {
    // Belt and braces: the service already redacted and counted; the stored
    // form is the same either way (LUM-898 storage redaction).
    const stored = redactStoredFields(
      {
        title: input.title,
        steps: input.steps,
        expected: input.expected,
        actual: input.actual,
      },
      STORAGE_REDACTED_FIELDS.feedback
    )
    return prisma.$transaction(async tx => {
      const { feedbackSeq } = await tx.workspace.update({
        where: { id: input.workspaceId },
        data: { feedbackSeq: { increment: 1 } },
        select: { feedbackSeq: true },
      })
      if (beforeInsert) await beforeInsert(counterFor(tx))
      return tx.feedback.create({
        data: {
          workspaceId: input.workspaceId,
          number: feedbackSeq,
          kind: input.kind,
          title: stored.title,
          steps: stored.steps,
          expected: stored.expected,
          actual: stored.actual,
          evidence: input.evidence,
          environment: input.environment ?? Prisma.DbNull,
          taskRef: input.taskRef,
          sessionId: input.sessionId,
          submittedByMemberId: input.submittedByMemberId,
          submittedVia: input.submittedVia,
          secretsRedacted: input.secretsRedacted,
        },
        select: SELECT,
      })
    }, CREATE_TX_OPTIONS)
  },

  /** One row by its workspace-local number; null when it is not in `workspaceId`. */
  async findByNumber(
    workspaceId: string,
    number: number
  ): Promise<FeedbackRow | null> {
    return prisma.feedback.findUnique({
      where: { workspaceId_number: { workspaceId, number } },
      select: SELECT,
    })
  },

  /**
   * Append one evidence entry to a report of `workspaceId`, keeping at most
   * `maxEntries`. Compare-and-set, no lock: the write only lands when
   * `evidence` still equals what was read (jsonb equality; the array only
   * ever grows, so it is its own version). A concurrent append makes the
   * write match nothing — re-read and try again, re-checking the cap — so no
   * entry is lost and the cap holds. Every lost race means another append
   * landed, and at most `maxEntries` can, so `maxEntries + 1` attempts always
   * end in `appended` or `full`; `conflict` is only a safety net.
   */
  async appendEvidence(
    workspaceId: string,
    number: number,
    entry: Prisma.InputJsonObject,
    redacted: number,
    maxEntries: number
  ): Promise<AppendEvidenceResult> {
    const key = { workspaceId_number: { workspaceId, number } }
    for (let attempt = 0; attempt <= maxEntries; attempt++) {
      const row = await prisma.feedback.findUnique({
        where: key,
        select: { evidence: true },
      })
      if (!row) return { status: 'not_found' }
      const current = Array.isArray(row.evidence) ? row.evidence : []
      if (current.length >= maxEntries) return { status: 'full' }
      const { count } = await prisma.feedback.updateMany({
        where: {
          workspaceId,
          number,
          // The column is NOT NULL, but a JSON `null` value has to be
          // matched as JsonNull, not as a plain null.
          evidence: {
            equals:
              row.evidence === null
                ? Prisma.JsonNull
                : (row.evidence as Prisma.InputJsonValue),
          },
        },
        data: {
          evidence: [...current, entry] as Prisma.InputJsonArray,
          secretsRedacted: { increment: redacted },
        },
      })
      if (count === 0) continue
      const updated = await prisma.feedback.findUnique({
        where: key,
        select: SELECT,
      })
      return updated
        ? { status: 'appended', row: updated }
        : { status: 'not_found' }
    }
    return { status: 'conflict' }
  },

  /** Newest first. */
  async list(filter: FeedbackListFilter): Promise<FeedbackListRow[]> {
    return prisma.feedback.findMany({
      where: {
        workspaceId: filter.workspaceId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.submittedByMemberId
          ? { submittedByMemberId: filter.submittedByMemberId }
          : {}),
        ...(filter.beforeNumber ? { number: { lt: filter.beforeNumber } } : {}),
      },
      orderBy: { number: 'desc' },
      take: filter.take,
      select: LIST_SELECT,
    })
  },

  /** Rows matching the filter (for the list's `total`). */
  async count(filter: Omit<FeedbackListFilter, 'take' | 'beforeNumber'>) {
    return prisma.feedback.count({
      where: {
        workspaceId: filter.workspaceId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.submittedByMemberId
          ? { submittedByMemberId: filter.submittedByMemberId }
          : {}),
      },
    })
  },

  /** Submissions by one member since `since` (rate limit). */
  countByMemberSince(workspaceId: string, memberId: string, since: Date) {
    return counterFor(prisma).countByMemberSince(workspaceId, memberId, since)
  },

  /** Submissions in one workspace since `since` (rate limit). */
  countByWorkspaceSince(workspaceId: string, since: Date) {
    return counterFor(prisma).countByWorkspaceSince(workspaceId, since)
  },

  /** Oldest submission inside the window — when the next slot frees up. */
  oldestSince(
    where: { workspaceId: string; submittedByMemberId?: string },
    since: Date
  ) {
    return counterFor(prisma).oldestSince(where, since)
  },

  // ── Staff (cross-workspace; see STAFF_SCOPE) ──────────────────────────

  /** Every workspace's reports (or one workspace's), newest first by seq. */
  async staffList(
    filter: StaffFeedbackListFilter
  ): Promise<StaffFeedbackListRow[]> {
    return unscoped(STAFF_SCOPE).feedback.findMany({
      where: {
        ...staffWhere(filter),
        ...(filter.beforeSeq ? { seq: { lt: filter.beforeSeq } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: filter.take,
      select: STAFF_LIST_SELECT,
    })
  },

  async staffCount(
    filter: Omit<StaffFeedbackListFilter, 'take' | 'beforeSeq'>
  ): Promise<number> {
    return unscoped(STAFF_SCOPE).feedback.count({ where: staffWhere(filter) })
  },

  /** One report by its global seq, with every reply and its author id. */
  async staffFindBySeq(seq: number): Promise<StaffFeedbackRow | null> {
    return unscoped(STAFF_SCOPE).feedback.findUnique({
      where: { seq },
      select: STAFF_SELECT,
    })
  },

  /**
   * Apply a status change and / or append a reply in one transaction, so a
   * command that does both never lands half-done. The reply body is
   * storage-redacted here too (LUM-898). Null when no row has `seq`.
   */
  async staffUpdate(
    seq: number,
    change: StaffFeedbackUpdate
  ): Promise<StaffFeedbackRow | null> {
    const client = unscoped(STAFF_SCOPE)
    return client.$transaction(async tx => {
      const row = await tx.feedback.findUnique({
        where: { seq },
        select: { id: true },
      })
      if (!row) return null
      if (change.status)
        await tx.feedback.update({
          where: { seq },
          data: {
            status: change.status.to,
            statusChangedAt: change.status.at,
            statusChangedById: change.status.byMemberId,
          },
          select: { id: true },
        })
      if (change.reply) {
        const { body } = redactStoredFields(
          { body: change.reply.body },
          STORAGE_REDACTED_FIELDS.feedbackReply
        )
        await tx.feedbackReply.create({
          data: {
            feedbackId: row.id,
            body,
            authorMemberId: change.reply.authorMemberId,
          },
          select: { id: true },
        })
      }
      return tx.feedback.findUnique({ where: { seq }, select: STAFF_SELECT })
    })
  },
}

function staffWhere(
  filter: Omit<StaffFeedbackListFilter, 'take' | 'beforeSeq'>
): Prisma.FeedbackWhereInput {
  return {
    ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
  }
}
