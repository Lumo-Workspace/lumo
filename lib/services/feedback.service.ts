import type { FeedbackSource, Prisma } from '@prisma/client'
import {
  feedbackRepository,
  type AppendEvidenceResult,
  type FeedbackCounter,
  type FeedbackListRow,
  type FeedbackRow,
} from '@/lib/repositories/feedback.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskRepository } from '@/lib/repositories'
import { privateFileService } from '@/lib/services/private-file.service'
import { redactForStorage, scanSecrets } from '@/lib/security-scan/scan-secrets'
import {
  FEEDBACK_EVIDENCE_ATTACH_WINDOW_MS,
  FEEDBACK_EVIDENCE_ALLOWED_TYPES,
  FEEDBACK_EVIDENCE_MAX_BYTES,
  FEEDBACK_LIMITS,
  MAX_FEEDBACK_EVIDENCE_FILES,
  type CreateFeedbackPayload,
  type FeedbackLimit,
  type ListFeedbackQuery,
} from '@/lib/validation/feedback'
import { logger } from '@/lib/logger'

/**
 * LUM-1240 — customer / agent feedback to the Lumo team.
 * Design: docs/rfc/2026-10-19-LUM-1240-feedback.md (rulings in LUM-1240's
 * Decisions).
 *
 * - Text the submitter wrote (title, steps, expected, actual) and text
 *   evidence files are scanned for credentials and stored redacted.
 * - Limits are counted from the Feedback table (per member and per
 *   workspace, a 10-minute burst and a rolling day). A count that fails
 *   refuses the submission: an agent can file without confirmation, so the
 *   limit must not silently disappear. The check runs twice: once up front
 *   (so an over-limit caller uploads nothing) and again inside the insert
 *   transaction under the workspace counter lock, which is the one that
 *   holds against concurrent submissions.
 * - Every read is scoped to the caller's workspace; another workspace's
 *   report is indistinguishable from a missing one (404).
 */

/** What customers see as the author of a staff reply (RFC Q6). */
export const LUMO_TEAM_AUTHOR = 'Lumo team'

export interface FeedbackCaller {
  workspaceId: string
  memberId: string
}

export interface CreateFeedbackContext extends FeedbackCaller {
  submittedVia: FeedbackSource
  /** X-Lumo-Session-Id, or null (also null under --no-env). */
  sessionId: string | null
  /** Origin for the file-route URLs. */
  origin: string
}

export interface FeedbackEvidenceFile {
  type: 'file'
  url: string
  filename: string
  contentType: string
  size: number
}

export interface FeedbackView {
  ref: string
  id: string
  number: number
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
  secretsRedacted: number
  createdAt: Date
  updatedAt: Date
  statusChangedAt: Date | null
}

export interface FeedbackReplyView {
  body: string
  author: string
  createdAt: Date
}

export interface FeedbackListItem {
  ref: string
  id: string
  number: number
  kind: string
  status: string
  title: string
  replyCount: number
  submittedBy: { name: string } | null
  createdAt: Date
}

export interface FeedbackLimitDetails {
  code: 'RATE_LIMITED'
  scope: FeedbackLimit['scope']
  window: FeedbackLimit['window']
  limit: number
  retryAt: string
}

/** Thrown when a submission is over one of the FEEDBACK_LIMITS (HTTP 429). */
export class FeedbackRateLimitError extends Error {
  readonly status = 429
  constructor(
    message: string,
    readonly details: FeedbackLimitDetails
  ) {
    super(message)
    this.name = 'FeedbackRateLimitError'
  }
}

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status })
}

export function feedbackRef(number: number): string {
  return `FB-${number}`
}

/**
 * Redact one piece of submitter-written text. `scanSecrets` names what was
 * found (logged by rule id only, never the value); `redactForStorage` does the
 * replacing and counts every distinct value, including ones the reporting
 * rules skip. Returns the text to store and how many values were replaced.
 */
export function redactSubmittedText(
  text: string,
  label: string
): { text: string; redacted: number; ruleIds: string[] } {
  const lines = text
    .split('\n')
    .map((line, i) => ({ lineNo: i + 1, text: line }))
  const findings = scanSecrets([{ path: `feedback/${label}`, lines }])
  const { text: stored, redactedCount } = redactForStorage(text)
  return {
    text: stored,
    redacted: redactedCount,
    ruleIds: findings.map(f => f.ruleId),
  }
}

/** Plain text and JSON evidence is scanned like the text fields. */
function isTextType(contentType: string): boolean {
  return contentType === 'text/plain' || contentType === 'application/json'
}

/** Rejects a file list the evidence rules do not allow (400). */
export function validateEvidenceFiles(files: readonly File[]): void {
  if (files.length > MAX_FEEDBACK_EVIDENCE_FILES)
    fail(`At most ${MAX_FEEDBACK_EVIDENCE_FILES} evidence files`, 400)
  for (const f of files) {
    if (!FEEDBACK_EVIDENCE_ALLOWED_TYPES.includes(f.type))
      fail(
        `Unsupported evidence type "${f.type}". Allowed: ${FEEDBACK_EVIDENCE_ALLOWED_TYPES.join(', ')}`,
        400
      )
    if (f.size > FEEDBACK_EVIDENCE_MAX_BYTES)
      fail(
        `"${f.name}" is larger than ${FEEDBACK_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB`,
        400
      )
  }
}

function limitMessage(limit: FeedbackLimit): string {
  const who = limit.scope === 'member' ? 'you' : 'this workspace'
  const per = limit.window === 'burst' ? '10 min' : '24 h'
  return `feedback limit reached for ${who} (${limit.max} per ${per})`
}

/**
 * Throws FeedbackRateLimitError when the caller is at any limit; throws a 503
 * when the count itself fails (fail closed). `counter` is the repository by
 * default, or the insert transaction's counter for the serialized re-check.
 * The member limit counts by the caller's member id — every submitter,
 * Clerk or API key, has one (requireIdentity refuses a key whose member is
 * gone).
 */
export async function assertWithinFeedbackLimits(
  caller: FeedbackCaller,
  now: Date = new Date(),
  counter: FeedbackCounter = feedbackRepository
): Promise<void> {
  for (const limit of FEEDBACK_LIMITS) {
    const since = new Date(now.getTime() - limit.windowMs)
    const where =
      limit.scope === 'member'
        ? {
            workspaceId: caller.workspaceId,
            submittedByMemberId: caller.memberId,
          }
        : { workspaceId: caller.workspaceId }
    let used: number
    try {
      used =
        limit.scope === 'member'
          ? await counter.countByMemberSince(
              caller.workspaceId,
              caller.memberId,
              since
            )
          : await counter.countByWorkspaceSince(caller.workspaceId, since)
    } catch (error) {
      logger.warn('[feedback] limit check failed; refusing the submission', {
        scope: limit.scope,
        window: limit.window,
        error: (error as Error).message,
      })
      fail('could not check the feedback limit; try again later', 503)
    }
    if (used < limit.max) continue
    const oldest = await counter.oldestSince(where, since).catch(() => null)
    const retryAt = new Date(
      (oldest ?? now).getTime() + limit.windowMs
    ).toISOString()
    throw new FeedbackRateLimitError(limitMessage(limit), {
      code: 'RATE_LIMITED',
      scope: limit.scope,
      window: limit.window,
      limit: limit.max,
      retryAt,
    })
  }
}

/**
 * Shown when a submitter's name and email cannot be resolved (directory
 * outage, a user with neither). Never the member id: that is an internal
 * key, not a name, and the Lumo team reads these across workspaces.
 */
export const UNKNOWN_MEMBER = 'Unknown member'

/** Names / emails only — unresolved ids are left out (see UNKNOWN_MEMBER). */
export async function memberNames(
  memberIds: readonly string[]
): Promise<Map<string, string>> {
  return memberRepository.labelsByIds([...new Set(memberIds)], {
    unresolved: 'omit',
  })
}

const nameOf = memberNames

/** `{ name }` for a member id; null when the submitter row is gone. */
export function submitter(
  memberId: string | null,
  names: Map<string, string>
): { name: string } | null {
  return memberId ? { name: names.get(memberId) ?? UNKNOWN_MEMBER } : null
}

function toView(
  row: FeedbackRow,
  names: Map<string, string>
): { feedback: FeedbackView; replies: FeedbackReplyView[] } {
  return {
    feedback: {
      ref: feedbackRef(row.number),
      id: row.id,
      number: row.number,
      kind: row.kind,
      status: row.status,
      title: row.title,
      steps: row.steps,
      expected: row.expected,
      actual: row.actual,
      evidence: (Array.isArray(row.evidence)
        ? row.evidence
        : []) as unknown as FeedbackEvidenceFile[],
      environment: row.environment ?? null,
      task: row.taskRef,
      sessionId: row.sessionId,
      submittedBy: submitter(row.submittedByMemberId, names),
      secretsRedacted: row.secretsRedacted,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      statusChangedAt: row.statusChangedAt,
    },
    // Staff authors are never shown to customers (RFC Q6).
    replies: row.replies.map(r => ({
      body: r.body,
      author: LUMO_TEAM_AUTHOR,
      createdAt: r.createdAt,
    })),
  }
}

function toListItem(
  row: FeedbackListRow,
  names: Map<string, string>
): FeedbackListItem {
  return {
    ref: feedbackRef(row.number),
    id: row.id,
    number: row.number,
    kind: row.kind,
    status: row.status,
    title: row.title,
    replyCount: row._count.replies,
    submittedBy: submitter(row.submittedByMemberId, names),
    createdAt: row.createdAt,
  }
}

async function resolveTaskRef(
  workspaceId: string,
  ref: string | null | undefined
): Promise<string | null> {
  if (!ref) return null
  const m = /^([A-Za-z]+)-(\d+)$/.exec(ref)
  if (!m) fail(`invalid task ref "${ref}"`, 400)
  const identifier = m[1]!.toUpperCase()
  const number = Number(m[2])
  const task = await taskRepository.findByWorkspaceIdentifier(
    workspaceId,
    identifier,
    number
  )
  if (!task)
    fail(`task ${identifier}-${number} not found in this workspace`, 400)
  return `${identifier}-${number}`
}

async function storeEvidence(
  ctx: CreateFeedbackContext,
  files: readonly File[]
): Promise<{
  entries: FeedbackEvidenceFile[]
  pathnames: string[]
  redacted: number
}> {
  const entries: FeedbackEvidenceFile[] = []
  const pathnames: string[] = []
  let redacted = 0
  try {
    for (const [i, file] of files.entries()) {
      let body: Blob | Buffer = file
      let size = file.size
      if (isTextType(file.type)) {
        const r = redactSubmittedText(await file.text(), `evidence[${i}]`)
        redacted += r.redacted
        if (r.redacted > 0) {
          body = Buffer.from(r.text, 'utf8')
          size = body.length
        }
      }
      const stored = await privateFileService.storeFeedbackEvidence(
        ctx.workspaceId,
        body,
        file.type,
        ctx.origin
      )
      pathnames.push(stored.pathname)
      entries.push({
        type: 'file',
        url: stored.url,
        filename: file.name,
        contentType: file.type,
        size,
      })
    }
  } catch (error) {
    await privateFileService.deletePrivatePathnames(pathnames)
    throw error
  }
  return { entries, pathnames, redacted }
}

export const feedbackService = {
  async create(
    ctx: CreateFeedbackContext,
    payload: CreateFeedbackPayload,
    files: readonly File[]
  ): Promise<{ feedback: FeedbackView; replies: FeedbackReplyView[] }> {
    validateEvidenceFiles(files)
    const taskRef = await resolveTaskRef(ctx.workspaceId, payload.task)
    // Early refusal, before any evidence is stored. Not race-free on its
    // own — the re-check inside the insert transaction below is.
    await assertWithinFeedbackLimits(ctx)

    let redacted = 0
    const ruleIds: string[] = []
    const scrub = (text: string, label: string): string => {
      const r = redactSubmittedText(text, label)
      redacted += r.redacted
      ruleIds.push(...r.ruleIds)
      return r.text
    }
    const title = scrub(payload.title, 'title')
    const steps = payload.steps.map((s, i) => scrub(s, `steps[${i}]`))
    const expected =
      payload.expected == null ? null : scrub(payload.expected, 'expected')
    const actual =
      payload.actual == null ? null : scrub(payload.actual, 'actual')

    const evidence = await storeEvidence(ctx, files)
    redacted += evidence.redacted

    let row: FeedbackRow
    try {
      row = await feedbackRepository.create(
        {
          workspaceId: ctx.workspaceId,
          kind: payload.kind,
          title,
          steps,
          expected,
          actual,
          evidence: evidence.entries as unknown as Prisma.InputJsonValue,
          environment: (payload.environment ??
            null) as Prisma.InputJsonValue | null,
          taskRef,
          sessionId: ctx.sessionId,
          submittedByMemberId: ctx.memberId,
          submittedVia: ctx.submittedVia,
          secretsRedacted: redacted,
        },
        counter => assertWithinFeedbackLimits(ctx, new Date(), counter)
      )
    } catch (error) {
      await privateFileService.deletePrivatePathnames(evidence.pathnames)
      throw error
    }
    if (redacted > 0) {
      logger.info('[feedback] redacted suspected credentials', {
        feedbackId: row.id,
        count: redacted,
        ruleIds,
      })
    }
    return toView(row, await nameOf([ctx.memberId]))
  },

  async list(
    caller: FeedbackCaller,
    query: ListFeedbackQuery
  ): Promise<{
    feedback: FeedbackListItem[]
    total: number
    nextCursor: string | null
  }> {
    const filter = {
      workspaceId: caller.workspaceId,
      status: query.status,
      kind: query.kind,
      submittedByMemberId: query.mine ? caller.memberId : undefined,
    }
    const before = query.cursor ? Number(query.cursor) : undefined
    if (before !== undefined && !(Number.isInteger(before) && before > 0))
      fail('invalid cursor', 400)
    const [rows, total] = await Promise.all([
      feedbackRepository.list({
        ...filter,
        beforeNumber: before,
        take: query.limit + 1,
      }),
      feedbackRepository.count(filter),
    ])
    const page = rows.slice(0, query.limit)
    const names = await nameOf(
      page.flatMap(r => (r.submittedByMemberId ? [r.submittedByMemberId] : []))
    )
    return {
      feedback: page.map(r => toListItem(r, names)),
      total,
      nextCursor:
        rows.length > query.limit && page.length > 0
          ? String(page[page.length - 1]!.number)
          : null,
    }
  },

  /**
   * Attach one evidence file to a report just submitted (one file per request
   * keeps every upload under the platform's request-body limit). Only the
   * submitter, only within FEEDBACK_EVIDENCE_ATTACH_WINDOW_MS of submitting,
   * at most MAX_FEEDBACK_EVIDENCE_FILES in total. Another workspace's report
   * is a 404; someone else's report in the same workspace a 403.
   */
  async attachEvidence(
    ctx: Pick<CreateFeedbackContext, 'workspaceId' | 'memberId' | 'origin'>,
    number: number,
    file: File,
    now: Date = new Date()
  ): Promise<{ feedback: FeedbackView; replies: FeedbackReplyView[] }> {
    const row = await feedbackRepository.findByNumber(ctx.workspaceId, number)
    if (!row) fail(`feedback ${feedbackRef(number)} not found`, 404)
    if (row.submittedByMemberId !== ctx.memberId)
      fail('only the member who sent this report can attach evidence', 403)
    if (
      now.getTime() - row.createdAt.getTime() >
      FEEDBACK_EVIDENCE_ATTACH_WINDOW_MS
    )
      fail(
        'evidence can only be attached within 15 minutes of sending the report',
        409
      )
    // Early refusal before storing the file; appendEvidence re-checks the
    // cap atomically.
    const count = Array.isArray(row.evidence) ? row.evidence.length : 0
    if (count >= MAX_FEEDBACK_EVIDENCE_FILES)
      fail(`At most ${MAX_FEEDBACK_EVIDENCE_FILES} evidence files`, 400)
    validateEvidenceFiles([file])

    const stored = await storeEvidence(
      { ...ctx, submittedVia: 'API', sessionId: null },
      [file]
    )
    let result: AppendEvidenceResult
    try {
      result = await feedbackRepository.appendEvidence(
        ctx.workspaceId,
        number,
        stored.entries[0]! as unknown as Prisma.InputJsonObject,
        stored.redacted,
        MAX_FEEDBACK_EVIDENCE_FILES
      )
    } catch (error) {
      await privateFileService.deletePrivatePathnames(stored.pathnames)
      throw error
    }
    if (result.status !== 'appended') {
      await privateFileService.deletePrivatePathnames(stored.pathnames)
      if (result.status === 'full')
        fail(`At most ${MAX_FEEDBACK_EVIDENCE_FILES} evidence files`, 400)
      if (result.status === 'conflict')
        fail('evidence is being attached concurrently; try again', 409)
      fail(`feedback ${feedbackRef(number)} not found`, 404)
    }
    const updated = result.row
    return toView(updated, await nameOf([ctx.memberId]))
  },

  /** One report of the caller's workspace; 404 for anything else. */
  async show(
    caller: FeedbackCaller,
    number: number
  ): Promise<{ feedback: FeedbackView; replies: FeedbackReplyView[] }> {
    const row = await feedbackRepository.findByNumber(
      caller.workspaceId,
      number
    )
    if (!row) fail(`feedback ${feedbackRef(number)} not found`, 404)
    return toView(
      row,
      await nameOf(row.submittedByMemberId ? [row.submittedByMemberId] : [])
    )
  },
}
