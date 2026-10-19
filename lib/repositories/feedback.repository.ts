import {
  Prisma,
  type FeedbackKind,
  type FeedbackSource,
  type FeedbackStatus,
} from '@prisma/client'
import { scopedPrisma as prisma } from '@/lib/db/workspace-scope'
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

export type FeedbackRow = Prisma.FeedbackGetPayload<{ select: typeof SELECT }>
export type FeedbackListRow = Prisma.FeedbackGetPayload<{
  select: typeof LIST_SELECT
}>

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

export const feedbackRepository = {
  /**
   * Insert one row, allocating `number` from Workspace.feedbackSeq in the
   * same transaction — the counter row lock serialises concurrent inserts
   * (as crossingSeq / documentSeq do).
   */
  async create(input: CreateFeedbackRow): Promise<FeedbackRow> {
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
    })
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
  async countByMemberSince(
    workspaceId: string,
    memberId: string,
    since: Date
  ): Promise<number> {
    return prisma.feedback.count({
      where: {
        workspaceId,
        submittedByMemberId: memberId,
        createdAt: { gte: since },
      },
    })
  },

  /** Submissions in one workspace since `since` (rate limit). */
  async countByWorkspaceSince(
    workspaceId: string,
    since: Date
  ): Promise<number> {
    return prisma.feedback.count({
      where: { workspaceId, createdAt: { gte: since } },
    })
  },

  /** Oldest submission inside the window — when the next slot frees up. */
  async oldestSince(
    where: { workspaceId: string; submittedByMemberId?: string },
    since: Date
  ): Promise<Date | null> {
    const row = await prisma.feedback.findFirst({
      where: { ...where, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })
    return row?.createdAt ?? null
  },
}
