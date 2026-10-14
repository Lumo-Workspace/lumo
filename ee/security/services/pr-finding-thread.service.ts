/**
 * LUM-1127 — the lifecycle of Lumo's inline review threads, CodeRabbit-style:
 *
 *   · a fingerprint a COMPLETE pass of its own layer no longer reports on the
 *     new head → Lumo resolves the thread with "✅ Addressed in `<sha>`";
 *   · a human resolves the thread on GitHub → recorded (webhook, with a
 *     GraphQL read-back as the backstop) and never re-posted;
 *   · an addressed fingerprint reported again → the thread is unresolved with
 *     a regression note;
 *   · the comment went outdated but the finding is still reported → a fresh
 *     comment on the new line, the old thread resolved with a "moved" note.
 *
 * "Fixed" is strict: absence only counts when the layer that produced the
 * finding ran whole (`RAN` — never PARTIAL / PAUSED / PENDING / FAILED) on
 * this head and, for the incremental AI review, read the finding's file.
 * A GitHub resolve never touches a finding's disposition, so a gate-blocking
 * finding still blocks DONE (`isBlockingFinding`) until a human dispositions
 * it in Lumo; only non-blocking ones leave "open" when their thread is
 * resolved.
 *
 * Layering: service — GitHub through `@/lib/integrations/github/*`, the
 * database through the repository. Best effort throughout: a thread failure
 * is logged and retried by the next sync, never thrown at the write-back.
 */
import { logger } from '@/lib/logger'
import {
  prCommentClient,
  type ListedComment,
} from '@/lib/integrations/github/pr-comment-client'
import {
  reviewThreadClient,
  type ReviewThreadState,
} from '@/lib/integrations/github/review-threads'
import {
  prFindingThreadRepository,
  type FindingThreadRow,
  type FindingThreadState,
} from '@/ee/security/repositories/pr-finding-thread.repository'
import type {
  FindingKind,
  FindingProvenance,
  ReviewFindingRow,
  ScanStatus,
} from '@/ee/security/repositories/pr-security-scan.repository'
import type {
  ScanStageKey,
  ScanStages,
} from '@/ee/security/security-scan/types'
import { isVerifierRejected } from '@/ee/security/security-scan/verifier'

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Hidden marker on every Lumo thread note, so nothing mistakes it for a finding comment. */
export const THREAD_NOTE_MARKER = '<!-- lumo-security:thread-note -->'

const FP_MARKER_RE = /<!--\s*lumo-security:fp:([^\s>]+?)\s*-->/
const RETRACTED_MARKER = '<!-- lumo-security:verifier-rejected -->'

const short = (sha: string): string => sha.slice(0, 7)

export function buildAddressedNote(headSha: string): string {
  return `✅ Addressed in \`${short(headSha)}\` — Lumo's latest complete review of this file no longer reports this finding.\n\n${THREAD_NOTE_MARKER}`
}

export function buildRegressionNote(headSha: string): string {
  return `⚠️ Reappeared in \`${short(headSha)}\` — Lumo reports this finding again, so the thread is reopened.\n\n${THREAD_NOTE_MARKER}`
}

export function buildMovedNote(headSha: string): string {
  return `↪️ Moved in \`${short(headSha)}\` — the finding is still reported at a new line; continued in a new comment.\n\n${THREAD_NOTE_MARKER}`
}

/**
 * Lumo's own App account: `<slug>[bot]` (type `Bot` over REST). GraphQL's
 * `resolvedBy` types every account `User` — the bot included (LUM-1127 prod:
 * `uselumo[bot]` / `User`) — so a `[bot]` login counts as a bot whatever the
 * type says (a human login cannot contain brackets). Without the slug
 * configured (dev, tests) any bot counts: a bot resolving a thread is never
 * a human.
 */
export function isLumoActor(
  actor: { type?: string | null; login?: string | null } | null | undefined
): boolean {
  if (!actor) return false
  if (actor.type !== 'Bot' && !actor.login?.endsWith('[bot]')) return false
  const slug = process.env.GITHUB_APP_SLUG
  if (!slug) return true
  return actor.login === slug || actor.login === `${slug}[bot]`
}

/** The scan layer that produced a finding (and alone can say it is gone). */
export function layerOf(t: {
  ruleId: string
  provenance: FindingProvenance
  kind: FindingKind
}): ScanStageKey {
  if (t.provenance === 'DETERMINISTIC') return 'secrets'
  if (t.provenance === 'EXTERNAL_TOOL')
    return t.kind === 'DEPENDENCY' ? 'supplyChain' : 'external'
  return t.ruleId.startsWith('hunt:') ? 'hunt' : 'judge'
}

/** `judgeReviewScope` as stored: an array of paths, or null for the whole diff. */
export function parseReviewScope(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter((p): p is string => typeof p === 'string')
}

export interface CoverageScan {
  status: ScanStatus
  stages: ScanStages | null
  /** Raw Json — `parseReviewScope`. */
  judgeReviewScope?: unknown
}

/**
 * Did the layer that produced this finding read its file, whole, on this
 * head? Only then is the fingerprint's absence evidence of a fix.
 */
export function layerCoveredFile(
  scan: CoverageScan,
  t: {
    ruleId: string
    provenance: FindingProvenance
    kind: FindingKind
    filePath: string
  }
): boolean {
  if (scan.status !== 'CLEAN' && scan.status !== 'FINDINGS') return false
  const layer = layerOf(t)
  if (scan.stages?.[layer] !== 'RAN') return false
  if (layer !== 'judge') return true
  const scope = parseReviewScope(scan.judgeReviewScope)
  return scope === null || scope.includes(t.filePath)
}

function inlineEligible(
  f: Pick<ReviewFindingRow, 'line' | 'severity' | 'suggestedDisposition'>
): boolean {
  return (
    f.line !== null && f.severity !== 'LOW' && f.suggestedDisposition == null
  )
}

export type ThreadAction =
  /** Absent after a complete pass: resolve with the addressed note. */
  | { kind: 'ADDRESS'; row: FindingThreadRow; threadId: string | null }
  /** Addressed, then reported again: unresolve with the regression note. */
  | { kind: 'REOPEN'; row: FindingThreadRow; threadId: string | null }
  /** Still reported but the comment is outdated: post afresh, resolve the old one as moved. */
  | { kind: 'REPOST'; row: FindingThreadRow; threadId: string | null }
  /** State-only change (GitHub already says so, or the verifier decided). */
  | {
      kind: 'SET_STATE'
      row: FindingThreadRow
      state: FindingThreadState
      resolvedByLogin: string | null
    }

export interface ThreadPlanInput {
  rows: FindingThreadRow[]
  /** Every finding on the current scan (any disposition). */
  findings: ReviewFindingRow[]
  /** The current scan's open findings (undecided, not persisting, not verifier-rejected). */
  open: ReviewFindingRow[]
  scan: CoverageScan
  headSha: string
  /** GitHub's view of the threads, by first-comment id; null = not read. */
  remote: Map<string, ReviewThreadState> | null
}

export interface ThreadPlan {
  actions: ThreadAction[]
  /** Thread node ids learnt from GitHub, to store. */
  nodeIds: Array<{ row: FindingThreadRow; threadNodeId: string }>
}

/**
 * Pure: what to do with each thread on this sync. Every rule that reads
 * GitHub's own state needs `remote`; without it only the scan-driven
 * transitions run (and those need a thread node id on the row).
 */
export function planThreadActions(input: ThreadPlanInput): ThreadPlan {
  const present = new Set(input.findings.map(f => f.fingerprint))
  const rejected = new Set(
    input.findings.filter(isVerifierRejected).map(f => f.fingerprint)
  )
  const openByFp = new Map(input.open.map(f => [f.fingerprint, f]))
  const actions: ThreadAction[] = []
  const nodeIds: ThreadPlan['nodeIds'] = []

  for (const row of input.rows) {
    const remote = input.remote?.get(row.commentId) ?? null
    if (remote && remote.id !== row.threadNodeId)
      nodeIds.push({ row, threadNodeId: remote.id })
    const threadId = remote?.id ?? row.threadNodeId
    let state = row.state

    // GitHub is the record of what a human did; the webhook is the fast
    // path, this read-back the backstop for a missed delivery.
    if (remote) {
      if (
        state === 'OPEN' &&
        remote.isResolved &&
        remote.resolvedBy &&
        !isLumoActor(remote.resolvedBy)
      ) {
        actions.push({
          kind: 'SET_STATE',
          row,
          state: 'RESOLVED_BY_USER',
          resolvedByLogin: remote.resolvedBy.login,
        })
        continue
      }
      if (
        (state === 'RESOLVED_BY_USER' || state === 'ADDRESSED') &&
        !remote.isResolved
      ) {
        actions.push({
          kind: 'SET_STATE',
          row,
          state: 'OPEN',
          resolvedByLogin: null,
        })
        state = 'OPEN'
      }
    }

    const fp = row.fingerprint
    const openNow = openByFp.get(fp)

    if (state === 'DISMISSED') {
      // The verifier's later verdict restored the comment: open again.
      if (openNow)
        actions.push({
          kind: 'SET_STATE',
          row,
          state: 'OPEN',
          resolvedByLogin: null,
        })
      continue
    }
    if (rejected.has(fp)) {
      if (state === 'OPEN')
        actions.push({
          kind: 'SET_STATE',
          row,
          state: 'DISMISSED',
          resolvedByLogin: null,
        })
      continue
    }
    // Recorded as a human's resolve, but the resolver was Lumo itself (the
    // LUM-1127 misread of GraphQL's `User`-typed bot, or a sync racing
    // Lumo's own ADDRESS): it is Lumo's addressed thread, so a regression
    // reopens or reposts it like any other. A human's resolve — `@<app>
    // resolve` included, which records the asker — is never touched.
    if (
      state === 'RESOLVED_BY_USER' &&
      isLumoActor({ login: row.resolvedByLogin }) &&
      // …unless GitHub now names a human as the resolver.
      !(remote?.resolvedBy && !isLumoActor(remote.resolvedBy))
    ) {
      actions.push({
        kind: 'SET_STATE',
        row,
        state: 'ADDRESSED',
        resolvedByLogin: null,
      })
      state = 'ADDRESSED'
    }
    // A human closed the conversation: never re-posted, never reopened by Lumo.
    if (state === 'RESOLVED_BY_USER') continue

    if (state === 'OPEN') {
      if (
        !present.has(fp) &&
        // Not again on the head it was already addressed on (a human
        // reopened it there — Lumo does not fight that).
        row.addressedInSha !== input.headSha &&
        layerCoveredFile(input.scan, row)
      ) {
        actions.push({ kind: 'ADDRESS', row, threadId })
      } else if (openNow && remote?.isOutdated && inlineEligible(openNow)) {
        actions.push({ kind: 'REPOST', row, threadId })
      }
      continue
    }

    // ADDRESSED
    if (openNow) {
      // An outdated thread points at code that is gone: a fresh comment on
      // the new line reads better than reopening it.
      if (remote?.isOutdated && inlineEligible(openNow))
        actions.push({ kind: 'REPOST', row, threadId: null })
      else actions.push({ kind: 'REOPEN', row, threadId })
    }
  }
  return { actions, nodeIds }
}

/** The fingerprint of a Lumo-authored thread-opening comment, else null. */
export function lumoThreadFingerprint(c: {
  body: string
  user: { type?: string; login?: string } | null
  in_reply_to_id?: number | null
}): string | null {
  if (c.in_reply_to_id) return null
  if (!isLumoActor(c.user)) return null
  return FP_MARKER_RE.exec(c.body)?.[1] ?? null
}

export interface ThreadCounts {
  open: number
  addressed: number
  resolved: number
}

function countStates(states: FindingThreadState[]): ThreadCounts {
  return {
    open: states.filter(s => s === 'OPEN').length,
    addressed: states.filter(s => s === 'ADDRESSED').length,
    resolved: states.filter(s => s === 'RESOLVED_BY_USER').length,
  }
}

// ── Sync side (called by the PR write-back) ─────────────────────────────────

export interface ThreadSyncContext {
  pullRequestId: string
  workspaceId: string
  repo: { owner: string; name: string }
  prNumber: number
  token: string
  headSha: string
  scan: CoverageScan
  findings: ReviewFindingRow[]
  open: ReviewFindingRow[]
  /** The PR's review comments, as the write-back listed them. */
  comments: ListedComment[]
}

export interface ThreadReconcileResult {
  /** Fingerprints a human resolved on GitHub (never re-posted). */
  resolvedByUser: Set<string>
  /** Fingerprints whose existing comment must not stop a fresh post (moved / outdated regression). */
  repost: Map<string, { row: FindingThreadRow; oldThreadId: string | null }>
  /** Thread states after this sync, for the summary. */
  counts: ThreadCounts
}

export const NO_THREADS: ThreadReconcileResult = {
  resolvedByUser: new Set(),
  repost: new Map(),
  counts: { open: 0, addressed: 0, resolved: 0 },
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Marker comments with no row yet (posted before LUM-1127, or a row write
 * that failed): adopt them, so existing threads join the lifecycle without a
 * backfill migration. A fingerprint whose layer cannot be looked up is left
 * alone — without it, its absence could never be judged.
 */
async function adoptUnknownComments(
  ctx: ThreadSyncContext,
  rows: FindingThreadRow[],
  remote: Map<string, ReviewThreadState> | null
): Promise<FindingThreadRow[]> {
  const known = new Set(rows.map(r => r.fingerprint))
  // Listing is newest first: the first comment seen per fingerprint wins.
  const pending = new Map<string, ListedComment>()
  for (const c of ctx.comments) {
    const fp = lumoThreadFingerprint(c)
    if (fp && !known.has(fp) && !pending.has(fp)) pending.set(fp, c)
  }
  if (pending.size === 0) return []
  const meta = new Map(
    ctx.findings.map(f => [
      f.fingerprint,
      {
        ruleId: f.ruleId,
        provenance: f.provenance,
        kind: f.kind,
        filePath: f.filePath,
      },
    ])
  )
  const missing = [...pending.keys()].filter(fp => !meta.has(fp))
  for (const m of await prFindingThreadRepository.findLayerMetaByFingerprints(
    ctx.pullRequestId,
    missing
  ))
    meta.set(m.fingerprint, m)

  const adopted: FindingThreadRow[] = []
  for (const [fp, c] of pending) {
    const m = meta.get(fp)
    if (!m) continue
    const r = remote?.get(String(c.id)) ?? null
    const state: FindingThreadState = c.body.includes(RETRACTED_MARKER)
      ? 'DISMISSED'
      : r?.isResolved && r.resolvedBy && !isLumoActor(r.resolvedBy)
        ? 'RESOLVED_BY_USER'
        : 'OPEN'
    const resolvedByLogin =
      state === 'RESOLVED_BY_USER' ? (r?.resolvedBy?.login ?? null) : null
    await prFindingThreadRepository.upsert({
      pullRequestId: ctx.pullRequestId,
      workspaceId: ctx.workspaceId,
      fingerprint: fp,
      commentId: String(c.id),
      threadNodeId: r?.id ?? null,
      state,
      resolvedByLogin,
      ...m,
    })
    adopted.push({
      id: '',
      pullRequestId: ctx.pullRequestId,
      fingerprint: fp,
      commentId: String(c.id),
      threadNodeId: r?.id ?? null,
      state,
      resolvedByLogin,
      addressedInSha: null,
      ...m,
    })
  }
  return adopted
}

async function readRemote(
  ctx: ThreadSyncContext
): Promise<Map<string, ReviewThreadState> | null> {
  try {
    const threads = await reviewThreadClient.listReviewThreads({
      repo: ctx.repo,
      prNumber: ctx.prNumber,
      token: ctx.token,
    })
    const out = new Map<string, ReviewThreadState>()
    for (const t of threads)
      if (t.firstCommentId !== null) out.set(String(t.firstCommentId), t)
    return out
  } catch (error) {
    logger.warn(
      `[pr-finding-thread] thread read failed pr=#${ctx.prNumber}: ${describe(error)}`
    )
    return null
  }
}

async function reply(
  ctx: ThreadSyncContext,
  commentId: string,
  body: string
): Promise<void> {
  try {
    await prCommentClient.createReviewLineReply({
      repo: ctx.repo,
      prNumber: ctx.prNumber,
      inReplyTo: Number(commentId),
      body,
      token: ctx.token,
    })
  } catch (error) {
    logger.warn(
      `[pr-finding-thread] note failed comment=${commentId}: ${describe(error)}`
    )
  }
}

/** Runs one action; returns the row's state afterwards. */
async function execute(
  ctx: ThreadSyncContext,
  action: ThreadAction,
  remote: Map<string, ReviewThreadState> | null
): Promise<FindingThreadState> {
  const { row } = action
  if (action.kind === 'SET_STATE') {
    const resolving =
      action.state === 'RESOLVED_BY_USER' || action.state === 'ADDRESSED'
    await prFindingThreadRepository.update(row.id, {
      state: action.state,
      resolvedByLogin: action.resolvedByLogin,
      resolvedAt: resolving ? new Date() : null,
    })
    return action.state
  }
  if (action.kind === 'REPOST') return row.state
  if (!action.threadId) {
    logger.info(
      `[pr-finding-thread] no thread id yet fp=${row.fingerprint} — retried next sync`
    )
    return row.state
  }
  if (action.kind === 'ADDRESS') {
    // Already resolved on GitHub (an earlier sync resolved it and then failed
    // to record it): record only — no second note.
    const already = remote?.get(row.commentId)?.isResolved === true
    if (!already) {
      await reviewThreadClient.resolveThread({
        threadId: action.threadId,
        token: ctx.token,
      })
      await reply(ctx, row.commentId, buildAddressedNote(ctx.headSha))
    }
    await prFindingThreadRepository.update(row.id, {
      state: 'ADDRESSED',
      threadNodeId: action.threadId,
      addressedInSha: ctx.headSha,
      resolvedAt: new Date(),
      resolvedByLogin: null,
    })
    return 'ADDRESSED'
  }
  // REOPEN
  await reviewThreadClient.unresolveThread({
    threadId: action.threadId,
    token: ctx.token,
  })
  await reply(ctx, row.commentId, buildRegressionNote(ctx.headSha))
  await prFindingThreadRepository.update(row.id, {
    state: 'OPEN',
    threadNodeId: action.threadId,
    addressedInSha: null,
    resolvedAt: null,
    resolvedByLogin: null,
  })
  return 'OPEN'
}

export const prFindingThreadService = {
  /**
   * Before the write-back posts: adopt marker comments, then resolve /
   * reopen / record each thread against this scan. Never throws.
   */
  async reconcile(ctx: ThreadSyncContext): Promise<ThreadReconcileResult> {
    let rows: FindingThreadRow[]
    try {
      rows = await prFindingThreadRepository.findByPullRequest(
        ctx.pullRequestId
      )
    } catch (error) {
      logger.warn(
        `[pr-finding-thread] load failed pr=#${ctx.prNumber}: ${describe(error)}`
      )
      return NO_THREADS
    }
    const hasMarkers = ctx.comments.some(c => lumoThreadFingerprint(c))
    if (rows.length === 0 && !hasMarkers) return NO_THREADS

    const remote = await readRemote(ctx)
    try {
      rows = [...rows, ...(await adoptUnknownComments(ctx, rows, remote))]
    } catch (error) {
      logger.warn(
        `[pr-finding-thread] adoption failed pr=#${ctx.prNumber}: ${describe(error)}`
      )
    }
    // Adopted rows carry no id until re-read; re-read so updates can target them.
    if (rows.some(r => r.id === '')) {
      try {
        rows = await prFindingThreadRepository.findByPullRequest(
          ctx.pullRequestId
        )
      } catch {
        rows = rows.filter(r => r.id !== '')
      }
    }

    const plan = planThreadActions({
      rows,
      findings: ctx.findings,
      open: ctx.open,
      scan: ctx.scan,
      headSha: ctx.headSha,
      remote,
    })
    const finalState = new Map(rows.map(r => [r.fingerprint, r.state]))
    for (const { row, threadNodeId } of plan.nodeIds) {
      try {
        await prFindingThreadRepository.update(row.id, { threadNodeId })
      } catch (error) {
        logger.warn(
          `[pr-finding-thread] node id write failed fp=${row.fingerprint}: ${describe(error)}`
        )
      }
    }
    const repost: ThreadReconcileResult['repost'] = new Map()
    for (const action of plan.actions) {
      if (action.kind === 'REPOST') {
        repost.set(action.row.fingerprint, {
          row: action.row,
          oldThreadId: action.threadId,
        })
        // About to be posted afresh: an open thread from this sync on.
        finalState.set(action.row.fingerprint, 'OPEN')
        continue
      }
      try {
        finalState.set(
          action.row.fingerprint,
          await execute(ctx, action, remote)
        )
      } catch (error) {
        logger.warn(
          `[pr-finding-thread] ${action.kind} failed fp=${action.row.fingerprint}: ${describe(error)}`
        )
      }
    }
    const resolvedByUser = new Set(
      [...finalState]
        .filter(([, s]) => s === 'RESOLVED_BY_USER')
        .map(([f]) => f)
    )
    return {
      resolvedByUser,
      repost,
      counts: countStates([...finalState.values()]),
    }
  },

  /**
   * After the write-back's review went out: record each new comment against
   * its fingerprint, and close the thread a moved finding left behind.
   * Never throws.
   */
  async recordPosted(
    ctx: ThreadSyncContext,
    reviewId: number,
    posted: ReviewFindingRow[],
    repost: ThreadReconcileResult['repost']
  ): Promise<void> {
    try {
      const comments = await prCommentClient.listReviewCommentsOfReview({
        repo: ctx.repo,
        prNumber: ctx.prNumber,
        reviewId,
        token: ctx.token,
      })
      const byFp = new Map(posted.map(f => [f.fingerprint, f]))
      for (const c of comments) {
        const fp = FP_MARKER_RE.exec(c.body)?.[1]
        const f = fp ? byFp.get(fp) : undefined
        if (!fp || !f) continue
        const moved = repost.get(fp)
        if (moved) {
          if (moved.oldThreadId) {
            try {
              await reviewThreadClient.resolveThread({
                threadId: moved.oldThreadId,
                token: ctx.token,
              })
              await reply(ctx, moved.row.commentId, buildMovedNote(ctx.headSha))
            } catch (error) {
              logger.warn(
                `[pr-finding-thread] moved resolve failed fp=${fp}: ${describe(error)}`
              )
            }
          }
        }
        await prFindingThreadRepository.upsert({
          pullRequestId: ctx.pullRequestId,
          workspaceId: ctx.workspaceId,
          fingerprint: fp,
          commentId: String(c.id),
          threadNodeId: null,
          state: 'OPEN',
          ruleId: f.ruleId,
          provenance: f.provenance,
          kind: f.kind,
          filePath: f.filePath,
        })
      }
    } catch (error) {
      logger.warn(
        `[pr-finding-thread] record failed pr=#${ctx.prNumber}: ${describe(error)}`
      )
    }
  },
}

// ── Webhook side ────────────────────────────────────────────────────────────

export interface ReviewThreadEvent {
  workspaceId: string
  pullRequestId: string
  action: string
  threadNodeId: string | null
  comments: Array<{
    id: number
    body: string
    user: { type?: string; login?: string } | null
    in_reply_to_id?: number | null
  }>
  sender: { login?: string; type?: string } | null
}

export type ReviewThreadOutcome =
  | 'ignored_self'
  | 'ignored_action'
  | 'not_lumo_thread'
  | 'recorded'
  | 'unchanged'

/**
 * A `pull_request_review_thread` delivery. Lumo's own resolve / unresolve
 * echoes back as one of these: the sender is Lumo's bot, so it is dropped
 * before anything is read — it is not a user action.
 */
export async function applyReviewThreadEvent(
  event: ReviewThreadEvent
): Promise<ReviewThreadOutcome> {
  if (event.action !== 'resolved' && event.action !== 'unresolved')
    return 'ignored_action'
  if (isLumoActor(event.sender)) return 'ignored_self'
  const login = event.sender?.login ?? null
  const rows = await prFindingThreadRepository.findByThreadRef(
    event.pullRequestId,
    {
      threadNodeId: event.threadNodeId,
      commentIds: event.comments.map(c => String(c.id)),
    }
  )

  if (rows.length === 0) {
    // A marker thread from before the table existed: adopt it now.
    const first = event.comments.find(c => lumoThreadFingerprint(c))
    const fp = first ? lumoThreadFingerprint(first) : null
    if (!first || !fp) return 'not_lumo_thread'
    const [meta] = await prFindingThreadRepository.findLayerMetaByFingerprints(
      event.pullRequestId,
      [fp]
    )
    if (!meta) return 'not_lumo_thread'
    const resolved = event.action === 'resolved'
    await prFindingThreadRepository.upsert({
      pullRequestId: event.pullRequestId,
      workspaceId: event.workspaceId,
      fingerprint: fp,
      commentId: String(first.id),
      threadNodeId: event.threadNodeId,
      state: resolved ? 'RESOLVED_BY_USER' : 'OPEN',
      resolvedByLogin: resolved ? login : null,
      ruleId: meta.ruleId,
      provenance: meta.provenance,
      kind: meta.kind,
      filePath: meta.filePath,
    })
    return 'recorded'
  }

  let changed = false
  for (const row of rows) {
    if (event.action === 'resolved' && row.state === 'OPEN') {
      await prFindingThreadRepository.update(row.id, {
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: login,
        resolvedAt: new Date(),
        ...(event.threadNodeId ? { threadNodeId: event.threadNodeId } : {}),
      })
      changed = true
    } else if (
      event.action === 'unresolved' &&
      (row.state === 'RESOLVED_BY_USER' || row.state === 'ADDRESSED')
    ) {
      await prFindingThreadRepository.update(row.id, {
        state: 'OPEN',
        resolvedByLogin: null,
        resolvedAt: null,
        ...(event.threadNodeId ? { threadNodeId: event.threadNodeId } : {}),
      })
      changed = true
    }
  }
  return changed ? 'recorded' : 'unchanged'
}

// ── Command side (LUM-1129 `@<app> resolve`) ────────────────────────────────

export interface ResolveByCommandInput {
  pullRequestId: string
  repo: { owner: string; name: string }
  prNumber: number
  /** Installation token with `pull_requests: write`. */
  token: string
  /** The GitHub login that asked — recorded as the thread's resolver. */
  login: string
  /** Fingerprints whose thread must stay open: their finding blocks DONE. */
  keep: ReadonlySet<string>
}

export interface ResolveByCommandResult {
  resolved: number
  /** Left open because the finding blocks DONE. */
  kept: number
  failed: number
}

/**
 * `@<app> resolve`: resolve every open Lumo thread on the PR on the asker's
 * behalf — recorded as their resolve (`RESOLVED_BY_USER`), so the next sync
 * never re-posts it. Conversation only: no finding's disposition is touched,
 * and a thread whose finding blocks DONE (`keep`) is left open, because
 * resolving it would hide a finding that still gates the task — those are
 * cleared by `lumo finding disposition` or the web panel. A GitHub failure
 * on one thread is counted, not thrown; only a failed row read throws.
 */
export async function resolveThreadsByCommand(
  input: ResolveByCommandInput
): Promise<ResolveByCommandResult> {
  const result: ResolveByCommandResult = { resolved: 0, kept: 0, failed: 0 }
  const open = (
    await prFindingThreadRepository.findByPullRequest(input.pullRequestId)
  ).filter(r => r.state === 'OPEN')
  const targets = open.filter(r => !input.keep.has(r.fingerprint))
  result.kept = open.length - targets.length
  if (targets.length === 0) return result

  let remote: Map<string, ReviewThreadState> | null = null
  try {
    const threads = await reviewThreadClient.listReviewThreads({
      repo: input.repo,
      prNumber: input.prNumber,
      token: input.token,
    })
    remote = new Map(
      threads
        .filter(t => t.firstCommentId !== null)
        .map(t => [String(t.firstCommentId), t])
    )
  } catch (error) {
    logger.warn(
      `[pr-finding-thread] command thread read failed pr=#${input.prNumber}: ${describe(error)}`
    )
  }

  for (const row of targets) {
    const r = remote?.get(row.commentId) ?? null
    const threadId = r?.id ?? row.threadNodeId
    if (!threadId) {
      result.failed += 1
      continue
    }
    try {
      if (!r?.isResolved)
        await reviewThreadClient.resolveThread({ threadId, token: input.token })
      // Already resolved on GitHub by someone else: credit them, not the asker.
      const by =
        r?.isResolved && r.resolvedBy && !isLumoActor(r.resolvedBy)
          ? r.resolvedBy.login
          : input.login
      await prFindingThreadRepository.update(row.id, {
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: by,
        resolvedAt: new Date(),
        threadNodeId: threadId,
      })
      result.resolved += 1
    } catch (error) {
      result.failed += 1
      logger.warn(
        `[pr-finding-thread] command resolve failed fp=${row.fingerprint}: ${describe(error)}`
      )
    }
  }
  return result
}
