import type { FeedbackStatus } from '@prisma/client'
import {
  feedbackRepository,
  type StaffFeedbackListRow,
  type StaffFeedbackRow,
} from '@/lib/repositories/feedback.repository'
import {
  feedbackRef,
  memberNames,
  redactSubmittedText,
  submitter,
  UNKNOWN_MEMBER,
  type FeedbackEvidenceFile,
} from '@/lib/services/feedback.service'
import {
  guardInjectedText,
  guardPromptLineText,
} from '@/lib/security-scan/inject-guard'
import type {
  StaffListFeedbackQuery,
  StaffUpdateFeedback,
} from '@/lib/validation/feedback'
import { logger } from '@/lib/logger'

/**
 * LUM-1240 batch 2 — the Lumo team's side of customer feedback: every
 * workspace's reports, status changes and replies. Design: RFC §6
 * (docs/rfc/2026-10-19-LUM-1240-feedback.md), rulings in LUM-1240's
 * Decisions.
 *
 * Callers are already staff (`requireStaff` in the route); nothing here
 * re-checks it.
 *
 * Everything the customer wrote — title, steps, expected, actual, evidence
 * file names — is another tenant's text read by a staff member's agent, so
 * it leaves this service through `guardInjectedText` / `guardPromptLineText`
 * (secret redaction + wrapper-tag defang + directive marker); the CLI then
 * fences it. Reply authors are shown by name here (staff only); customers see
 * "Lumo team".
 */

export interface StaffCaller {
  memberId: string
}

export interface StaffWorkspaceRef {
  id: string
  name: string
  slug: string
}

export interface StaffFeedbackListItem {
  /** The staff handle, `#<seq>`. */
  ref: string
  seq: number
  /** What the customer calls it, `FB-<n>` (unique only within `workspace`). */
  customerRef: string
  workspace: StaffWorkspaceRef
  kind: string
  status: string
  title: string
  replyCount: number
  submittedBy: { name: string } | null
  createdAt: Date
}

export interface StaffFeedbackView {
  ref: string
  seq: number
  customerRef: string
  workspace: StaffWorkspaceRef
  kind: string
  status: string
  title: string
  steps: string[]
  expected: string | null
  actual: string | null
  evidence: FeedbackEvidenceFile[]
  environment: unknown
  task: string | null
  sessionId: string | null
  submittedBy: { name: string } | null
  submittedVia: string
  secretsRedacted: number
  /** Lines to print at the head of the customer-text block (redactions, signals). */
  contentNotices: string[]
  createdAt: Date
  updatedAt: Date
  statusChangedAt: Date | null
  statusChangedBy: { name: string } | null
}

export interface StaffFeedbackReplyView {
  body: string
  /** The staff member's name (customers see "Lumo team"). */
  author: string
  createdAt: Date
}

export interface StaffFeedbackDetail {
  feedback: StaffFeedbackView
  replies: StaffFeedbackReplyView[]
}

export interface StaffFeedbackChange {
  /** null when no status was given, or it already had that status. */
  status: { from: string; to: string } | null
  replied: boolean
}

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status })
}

export function staffRef(seq: number): string {
  return `#${seq}`
}

function workspaceOf(row: {
  workspaceId: string
  workspace: { name: string; slug: string }
}): StaffWorkspaceRef {
  return {
    id: row.workspaceId,
    name: row.workspace.name,
    slug: row.workspace.slug,
  }
}

/**
 * The customer-written fields, guarded for a staff reader. Block text goes
 * through `guardInjectedText` (its notices are collected for the block
 * head); one-line text through `guardPromptLineText`.
 */
export function guardCustomerText(row: {
  title: string
  steps: string[]
  expected: string | null
  actual: string | null
}): {
  title: string
  steps: string[]
  expected: string | null
  actual: string | null
  notices: string[]
} {
  const notices: string[] = []
  const block = (text: string | null): string | null => {
    if (text === null) return null
    const g = guardInjectedText(text)
    notices.push(...g.notices)
    return g.text
  }
  return {
    title: guardPromptLineText(row.title),
    steps: row.steps.map(s => guardPromptLineText(s)),
    expected: block(row.expected),
    actual: block(row.actual),
    notices: [...new Set(notices)],
  }
}

function evidenceOf(row: StaffFeedbackRow): FeedbackEvidenceFile[] {
  const list = (Array.isArray(row.evidence)
    ? row.evidence
    : []) as unknown as FeedbackEvidenceFile[]
  return list.map(e => ({ ...e, filename: guardPromptLineText(e.filename) }))
}

function toListItem(
  row: StaffFeedbackListRow,
  names: Map<string, string>
): StaffFeedbackListItem {
  return {
    ref: staffRef(row.seq),
    seq: row.seq,
    customerRef: feedbackRef(row.number),
    workspace: workspaceOf(row),
    kind: row.kind,
    status: row.status,
    title: guardPromptLineText(row.title),
    replyCount: row._count.replies,
    submittedBy: submitter(row.submittedByMemberId, names),
    createdAt: row.createdAt,
  }
}

function toDetail(
  row: StaffFeedbackRow,
  names: Map<string, string>
): StaffFeedbackDetail {
  const text = guardCustomerText(row)
  return {
    feedback: {
      ref: staffRef(row.seq),
      seq: row.seq,
      customerRef: feedbackRef(row.number),
      workspace: workspaceOf(row),
      kind: row.kind,
      status: row.status,
      title: text.title,
      steps: text.steps,
      expected: text.expected,
      actual: text.actual,
      evidence: evidenceOf(row),
      environment: row.environment ?? null,
      task: row.taskRef,
      sessionId: row.sessionId,
      submittedBy: submitter(row.submittedByMemberId, names),
      submittedVia: row.submittedVia,
      secretsRedacted: row.secretsRedacted,
      contentNotices: text.notices,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      statusChangedAt: row.statusChangedAt,
      statusChangedBy: row.statusChangedById
        ? { name: names.get(row.statusChangedById) ?? UNKNOWN_MEMBER }
        : null,
    },
    replies: row.replies.map(r => ({
      body: r.body,
      author: names.get(r.authorMemberId) ?? UNKNOWN_MEMBER,
      createdAt: r.createdAt,
    })),
  }
}

async function detailOf(row: StaffFeedbackRow): Promise<StaffFeedbackDetail> {
  const ids = [
    row.submittedByMemberId,
    row.statusChangedById,
    ...row.replies.map(r => r.authorMemberId),
  ].filter((id): id is string => typeof id === 'string')
  return toDetail(row, await memberNames(ids))
}

export const feedbackStaffService = {
  /** Every workspace's reports (or one workspace's), newest first. */
  async list(query: StaffListFeedbackQuery): Promise<{
    feedback: StaffFeedbackListItem[]
    total: number
    nextCursor: string | null
  }> {
    const before = query.cursor ? Number(query.cursor) : undefined
    if (before !== undefined && !(Number.isInteger(before) && before > 0))
      fail('invalid cursor', 400)
    const filter = {
      status: query.status,
      kind: query.kind,
      workspaceId: query.workspace,
    }
    const [rows, total] = await Promise.all([
      feedbackRepository.staffList({
        ...filter,
        beforeSeq: before,
        take: query.limit + 1,
      }),
      feedbackRepository.staffCount(filter),
    ])
    const page = rows.slice(0, query.limit)
    const names = await memberNames(
      page.flatMap(r => (r.submittedByMemberId ? [r.submittedByMemberId] : []))
    )
    return {
      feedback: page.map(r => toListItem(r, names)),
      total,
      nextCursor:
        rows.length > query.limit && page.length > 0
          ? String(page[page.length - 1]!.seq)
          : null,
    }
  },

  /** One report of any workspace by its global seq; 404 when there is none. */
  async show(seq: number): Promise<StaffFeedbackDetail> {
    const row = await feedbackRepository.staffFindBySeq(seq)
    if (!row) fail(`feedback ${staffRef(seq)} not found`, 404)
    return detailOf(row)
  },

  /**
   * Change the status and / or append a reply (one transaction). Setting the
   * status it already has is not a change (statusChangedAt stays). The reply
   * is what the customer will read: the route only accepts it from a staff
   * caller, and the CLI only sends it after the user confirmed (exit 4).
   */
  async update(
    caller: StaffCaller,
    seq: number,
    input: StaffUpdateFeedback,
    now: Date = new Date()
  ): Promise<StaffFeedbackDetail & { changed: StaffFeedbackChange }> {
    const current = await feedbackRepository.staffFindBySeq(seq)
    if (!current) fail(`feedback ${staffRef(seq)} not found`, 404)

    const statusChange =
      input.status !== undefined && input.status !== current.status
        ? {
            from: current.status as string,
            to: input.status as FeedbackStatus,
          }
        : null
    let reply: string | undefined
    if (input.reply !== undefined) {
      const r = redactSubmittedText(input.reply, 'reply')
      reply = r.text
      if (r.redacted > 0)
        logger.info('[feedback-staff] redacted suspected credentials', {
          seq,
          count: r.redacted,
          ruleIds: r.ruleIds,
        })
    }

    if (!statusChange && reply === undefined)
      return {
        ...(await detailOf(current)),
        changed: { status: null, replied: false },
      }

    const updated = await feedbackRepository.staffUpdate(seq, {
      status: statusChange
        ? { to: statusChange.to, byMemberId: caller.memberId, at: now }
        : undefined,
      reply:
        reply === undefined
          ? undefined
          : { body: reply, authorMemberId: caller.memberId },
    })
    if (!updated) fail(`feedback ${staffRef(seq)} not found`, 404)
    return {
      ...(await detailOf(updated)),
      changed: { status: statusChange, replied: reply !== undefined },
    }
  },
}
