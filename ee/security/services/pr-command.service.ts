/**
 * LUM-1129 — drive the PR reviewer from the PR itself, CodeRabbit-style: a
 * top-level conversation comment `@<app> review | full review | pause |
 * resume | resolve` runs the same control path as `lumo pr scan --review /
 * --pause / --resume` (`prReviewControlService`) or the LUM-1127 thread
 * resolve, and Lumo answers with a reply.
 *
 *   · only a `created` comment acts — an edit or a deletion never re-runs one;
 *   · bots (Lumo itself included) are ignored;
 *   · only an account with write access to the repository may command —
 *     anyone else is ignored silently, so a drive-by commenter on a public
 *     repository can neither burn review budget nor make Lumo talk;
 *   · `resolve` closes conversations only: it never dispositions a finding,
 *     and leaves the thread of a finding that blocks DONE open (those are
 *     cleared by `lumo finding disposition` or the web panel). The PR's own
 *     author may not `resolve` by command;
 *   · LUM-1130 `approve` (the request-changes workflow only): resolves Lumo's
 *     threads and approves the PR's current head, dismissing Lumo's earlier
 *     change requests — refused while any finding blocks DONE (a thread
 *     resolved on GitHub does not clear it), and, like `resolve`, never for
 *     the PR's own author;
 *   · a redelivered webhook is answered once: the reply carries a marker
 *     naming the command comment, and a marker already on the PR stops it.
 *     Best effort (check, then act): if the reply itself fails, a later
 *     redelivery runs the command again — pause/resume/resolve are
 *     idempotent, and a repeated review request deduplicates while the first
 *     is still running (after it, it is one more manual review).
 *
 * Layering: service — GitHub through `@/lib/integrations/github/*`, the
 * database through repositories and the existing services.
 */
import { createHash } from 'crypto'
import { logger } from '@/lib/logger'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import { checkRepositoryWriteAccess } from '@/lib/integrations/github/collaborator-access'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import type { CoreEvents } from '@/lib/plugins/types'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prReviewControlService } from '@/ee/security/services/pr-review-control.service'
import { prReviewVerdictService } from '@/ee/security/services/pr-review-verdict.service'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import {
  isBlockingFinding,
  loadSecurityPolicy,
} from '@/ee/security/services/pr-security-scan-gate'
import {
  isLumoActor,
  resolveThreadsByCommand,
  type ResolveByCommandResult,
} from '@/ee/security/services/pr-finding-thread.service'
import {
  parsePrCommand,
  prCommandHandle,
  type PrCommand,
} from '@/ee/security/services/pr-command-parse'

export type PrCommentEvent = CoreEvents['github.issueComment']

export type PrCommandOutcome =
  | 'ignored_action'
  | 'disabled'
  | 'ignored_bot'
  | 'not_a_command'
  | 'unauthorized'
  | 'duplicate'
  | 'help'
  | 'refused_author'
  | 'refused_mode_off'
  | 'refused_blocking'
  | 'done'
  | 'failed'

// ── Replies (pure) ──────────────────────────────────────────────────────────

const ACK_MARKER_PREFIX = '<!-- lumo-command:ack:'

/**
 * Hidden marker on a reply: the command comment it answers, scoped to the
 * workspace (a repository two workspaces confirmed gets one answer from
 * each). The workspace id is hashed — it is not published on the PR.
 */
export function ackMarker(commentId: number, workspaceId: string): string {
  const ws = createHash('sha256').update(workspaceId).digest('hex').slice(0, 8)
  return `${ACK_MARKER_PREFIX}${commentId}:${ws} -->`
}

export function buildHelpReply(handle: string, text: string | null): string {
  const lead = text
    ? `🤔 Lumo doesn't know \`${text.replace(/`/g, "'").slice(0, 60)}\`. Commands it takes:`
    : 'Commands Lumo takes in a top-level PR comment:'
  return [
    lead,
    '',
    `- \`${handle} review\` — incremental review of the changes since Lumo's last complete review`,
    `- \`${handle} full review\` — review the whole PR again from scratch`,
    `- \`${handle} pause\` — stop automatic AI reviews on new pushes`,
    `- \`${handle} resume\` — resume automatic AI reviews and reset the round budget`,
    `- \`${handle} resolve\` — resolve Lumo's open review threads (findings that block DONE stay open)`,
    `- \`${handle} approve\` — resolve Lumo's threads and approve the PR (request-changes workflow only; refused while a finding blocks DONE)`,
    `- \`${handle} help\` — this list`,
    '',
    'Only accounts with write access to the repository can run commands.',
  ].join('\n')
}

export function buildResolveReply(
  r: ResolveByCommandResult,
  handle: string
): string {
  const n = (k: number, one: string, many: string) =>
    `${k} ${k === 1 ? one : many}`
  const lines: string[] = []
  if (r.resolved === 0 && r.kept === 0 && r.failed === 0)
    lines.push('✅ No open Lumo review threads on this PR.')
  else
    lines.push(
      `✅ Resolved ${n(r.resolved, 'Lumo review thread', 'Lumo review threads')}.`
    )
  if (r.kept > 0)
    lines.push(
      `🔒 Left ${n(r.kept, 'thread', 'threads')} open: ${r.kept === 1 ? 'its finding blocks' : 'their findings block'} DONE until dispositioned in Lumo (\`lumo finding disposition\` or the PR's security panel) — a resolve is not a disposition.`
    )
  if (r.failed > 0)
    lines.push(
      `⚠️ Could not resolve ${n(r.failed, 'thread', 'threads')} — try \`${handle} resolve\` again later.`
    )
  return lines.join('\n\n')
}

/** LUM-1130 — the reply to `@<app> approve` (pure). */
export function buildApproveReply(
  r:
    | { kind: 'mode_off' }
    | { kind: 'blocked'; blocking: number }
    | { kind: 'unresolved'; result: ResolveByCommandResult }
    | { kind: 'not_open' }
    | { kind: 'approved'; sha: string; result: ResolveByCommandResult },
  handle: string
): string {
  switch (r.kind) {
    case 'mode_off':
      return "ℹ️ Lumo doesn't approve PRs in this workspace — the request-changes workflow is off. A workspace owner can turn it on in Settings → Workspace → PR security scanning (or `lumo workspace security-scan --request-changes on`)."
    case 'blocked':
      return `🔒 Lumo can't approve: ${r.blocking === 1 ? '1 finding blocks' : `${r.blocking} findings block`} DONE until dispositioned in Lumo (\`lumo finding disposition\` or the PR's security panel) — resolving its thread is not a disposition.`
    case 'unresolved':
      return `⚠️ Lumo didn't approve: it could not resolve ${r.result.failed === 1 ? '1 thread' : `${r.result.failed} threads`} — try \`${handle} approve\` again later.`
    case 'not_open':
      return "⚠️ Lumo didn't approve: the PR is not open."
    case 'approved': {
      const resolved =
        r.result.resolved > 0
          ? ` Resolved ${r.result.resolved === 1 ? '1 Lumo review thread' : `${r.result.resolved} Lumo review threads`}.`
          : ''
      return `✅ Approved \`${r.sha.slice(0, 7)}\`.${resolved}`
    }
  }
}

const ACKS: Record<
  Exclude<PrCommand, 'resolve' | 'approve' | 'help'>,
  string
> = {
  review:
    "👀 Incremental review requested — Lumo reviews the changes since its last complete review. The result lands in the security summary when it's done.",
  'full review':
    "👀 Full review requested — Lumo reviews the whole PR again. The result lands in the security summary when it's done.",
  pause:
    '⏸️ Automatic AI reviews are paused on this PR. New pushes still get the deterministic checks; ask for a one-off review with `{handle} review`, or `{handle} resume` to restart them.',
  resume:
    '▶️ Automatic AI reviews resumed on this PR; the round budget is reset ({limit} automatic rounds).',
}

function withMarker(body: string, marker: string): string {
  return `${body}\n\n${marker}`
}

// ── Steps ───────────────────────────────────────────────────────────────────

function parseRepo(full: string): { owner: string; name: string } {
  const [owner = '', name = ''] = full.split('/')
  return { owner, name }
}

function isBot(user: { login?: string; type?: string } | null): boolean {
  if (!user) return true
  return user.type === 'Bot' || (user.login ?? '').endsWith('[bot]')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function alreadyAnswered(
  event: PrCommentEvent,
  token: string,
  marker: string
): Promise<boolean> {
  const since = event.comment.createdAt
    ? new Date(event.comment.createdAt)
    : new Date(0)
  const comments =
    (await prCommentClient.listIssueCommentsSince({
      repo: parseRepo(event.repo),
      prNumber: event.prNumber,
      since,
      token,
    })) ?? []
  return comments.some(c => c.body.includes(marker) && isLumoActor(c.user))
}

async function blockingFingerprints(
  pullRequestId: string,
  workspaceId: string
): Promise<Set<string>> {
  const [scan] = await prSecurityScanRepository.findLatestByPullRequestIds([
    pullRequestId,
  ])
  if (!scan) return new Set()
  const policy = await loadSecurityPolicy(workspaceId)
  return new Set(
    scan.findings
      .filter(f => isBlockingFinding(f, policy))
      .map(f => f.fingerprint)
  )
}

/**
 * LUM-1130 `approve`: mode on, no blocking finding, every open Lumo thread
 * resolved — then approve the live head. Checks before any side effect: a
 * refused approve resolves nothing.
 */
async function approve(
  event: PrCommentEvent,
  login: string,
  handle: string,
  writeToken: string
): Promise<{ outcome: PrCommandOutcome; body: string }> {
  if (
    !(await securityColumnsRepository.findRequestChangesEnabled(
      event.workspaceId
    ))
  )
    return {
      outcome: 'refused_mode_off',
      body: buildApproveReply({ kind: 'mode_off' }, handle),
    }
  const blocking = await blockingFingerprints(
    event.pullRequestId,
    event.workspaceId
  )
  if (blocking.size > 0)
    return {
      outcome: 'refused_blocking',
      body: buildApproveReply(
        { kind: 'blocked', blocking: blocking.size },
        handle
      ),
    }
  const repo = parseRepo(event.repo)
  const result = await resolveThreadsByCommand({
    pullRequestId: event.pullRequestId,
    repo,
    prNumber: event.prNumber,
    token: writeToken,
    login,
    keep: blocking,
  })
  if (result.failed > 0)
    return {
      outcome: 'failed',
      body: buildApproveReply({ kind: 'unresolved', result }, handle),
    }
  const approved = await prReviewVerdictService.approveByCommand({
    repo,
    prNumber: event.prNumber,
    token: writeToken,
    login,
  })
  if (!approved.ok)
    return {
      outcome: 'failed',
      body: buildApproveReply({ kind: 'not_open' }, handle),
    }
  return {
    outcome: 'done',
    body: buildApproveReply(
      { kind: 'approved', sha: approved.sha, result },
      handle
    ),
  }
}

/** Runs one command; returns the reply body (without its marker). */
async function run(
  event: PrCommentEvent,
  command: PrCommand,
  login: string,
  handle: string,
  writeToken: string
): Promise<{ outcome: PrCommandOutcome; body: string }> {
  const isAuthor =
    !!event.prAuthorLogin &&
    event.prAuthorLogin.toLowerCase() === login.toLowerCase()
  if (command === 'approve') {
    if (isAuthor)
      return {
        outcome: 'refused_author',
        body: `🚫 The PR's author can't approve by command — a reviewer with write access can run \`${handle} approve\`.`,
      }
    return approve(event, login, handle, writeToken)
  }
  if (command === 'resolve') {
    if (isAuthor)
      return {
        outcome: 'refused_author',
        body: `🚫 The PR's author can't resolve Lumo's threads by command — a reviewer with write access can run \`${handle} resolve\`, or resolve a thread on GitHub after addressing it.`,
      }
    const keep = await blockingFingerprints(
      event.pullRequestId,
      event.workspaceId
    )
    const result = await resolveThreadsByCommand({
      pullRequestId: event.pullRequestId,
      repo: parseRepo(event.repo),
      prNumber: event.prNumber,
      token: writeToken,
      login,
      keep,
    })
    return { outcome: 'done', body: buildResolveReply(result, handle) }
  }
  if (command === 'help')
    return { outcome: 'help', body: buildHelpReply(handle, null) }

  const action =
    command === 'review'
      ? 'incremental'
      : command === 'full review'
        ? 'full'
        : command
  try {
    const result = await prReviewControlService.act(
      event.workspaceId,
      event.prNumber,
      event.repo,
      action
    )
    const limit =
      result && 'reviewRoundLimit' in result
        ? String(result.reviewRoundLimit)
        : ''
    return {
      outcome: 'done',
      body: ACKS[command]
        .split('{handle}')
        .join(handle)
        .split('{limit}')
        .join(limit),
    }
  } catch (error) {
    const status = (error as { status?: number }).status
    if (typeof status === 'number' && status < 500)
      return {
        outcome: 'failed',
        body: `⚠️ Lumo couldn't run \`${command}\`: ${describe(error)}.`,
      }
    throw error
  }
}

// ── Entry ───────────────────────────────────────────────────────────────────

/**
 * One `github.issueComment` event. Silent outcomes (not a command, not
 * allowed, an edit, a bot) post nothing; a command, a refusal and a 4xx
 * from the control service get one reply. Never throws — an unexpected
 * failure (GitHub, database, a 5xx) is logged and gets no reply.
 */
export async function applyPrCommentCommand(
  event: PrCommentEvent
): Promise<PrCommandOutcome> {
  if (event.action !== 'created') return 'ignored_action'
  const handle = prCommandHandle()
  if (!handle) return 'disabled'
  const user = event.comment.user
  if (isBot(user)) return 'ignored_bot'
  const parsed = parsePrCommand(event.comment.body, handle)
  if (!parsed) return 'not_a_command'
  const login = user?.login ?? ''
  const where = `pr=${event.repo}#${event.prNumber} comment=${event.comment.id}`

  try {
    const readToken = await getRepoToken(
      event.workspaceId,
      event.repo,
      REPO_TOKEN_PERMISSIONS.collaboratorPermission
    )
    const access = await checkRepositoryWriteAccess(
      readToken,
      event.repo,
      login
    )
    if (access !== 'write') {
      logger.info(
        `[pr-command] ignored ${where}: ${login} has no write access (${access})`
      )
      return 'unauthorized'
    }

    const writeToken = await getRepoToken(
      event.workspaceId,
      event.repo,
      REPO_TOKEN_PERMISSIONS.pullRequestWrite
    )
    const marker = ackMarker(event.comment.id, event.workspaceId)
    if (await alreadyAnswered(event, writeToken, marker)) {
      logger.info(`[pr-command] already answered ${where}`)
      return 'duplicate'
    }

    const { outcome, body } = parsed.command
      ? await run(event, parsed.command, login, handle, writeToken)
      : { outcome: 'help' as const, body: buildHelpReply(handle, parsed.text) }
    await prCommentClient.createIssueComment({
      repo: parseRepo(event.repo),
      prNumber: event.prNumber,
      body: withMarker(body, marker),
      token: writeToken,
    })
    logger.info(
      `[pr-command] ${parsed.command ?? 'unknown'} by ${login} ${where}: ${outcome}`
    )
    return outcome
  } catch (error) {
    logger.warn(`[pr-command] failed ${where}: ${describe(error)}`)
    return 'failed'
  }
}
