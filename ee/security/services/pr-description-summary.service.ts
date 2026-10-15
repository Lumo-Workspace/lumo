/**
 * LUM-1151 — keep Lumo's high-level summary in the PR description in sync
 * (ee/security/security-scan/pr-description-summary.ts has the rules).
 *
 * Read-modify-write with the LATEST description: the body is read from
 * GitHub right before the edit and only Lumo's block (or the author's
 * placeholder line) is changed in it, so an author edit made before that
 * read is kept. GitHub offers no conditional update for a PR body, so the
 * window between the read and the write is kept to the two calls alone —
 * nothing else is awaited in between. Nothing is written when the result
 * equals the current body (re-runs on the same review are no-ops).
 *
 * Never throws: the description is a courtesy next to the summary comment,
 * and a failed edit must not fail the review write-back.
 *
 * Layering: service — GitHub through `@/lib/integrations/github`, the
 * database through the repository.
 */
import { logger } from '@/lib/logger'
import {
  GithubApiError,
  prCommentClient,
} from '@/lib/integrations/github/pr-comment-client'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  applyDescriptionSummary,
  buildDescriptionSummaryBlock,
  type HighLevelSummaryMode,
} from '@/ee/security/security-scan/pr-description-summary'
import { prCommandHandle } from '@/ee/security/services/pr-command-parse'
import { parsePrSummary } from '@/ee/security/security-scan/pr-summary'
import { repoConfigService } from '@/ee/security/services/repo-config.service'

export type DescriptionSyncOutcome =
  | 'written'
  | 'unchanged'
  | 'no_summary'
  | 'not_open'
  | 'failed'

interface Repo {
  owner: string
  name: string
}

export interface DescriptionSyncInput {
  repo: Repo
  prNumber: number
  /** A `pull_requests: write` token for the repository. */
  token: string
  /** The scan's raw `prSummary` Json. */
  prSummary: unknown
  headSha: string
  commitUrl?: string | null
}

function describe(error: unknown): string {
  if (error instanceof GithubApiError) return `${error.status} ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/** What `@<app> summary` found to do (the reply is worded from it). */
export type SummaryCommandResult =
  | { kind: 'off' }
  | { kind: 'comment' }
  | { kind: 'no_review' }
  | { kind: 'no_summary'; sha: string }
  | { kind: 'not_open' }
  | { kind: 'failed' }
  | { kind: 'written'; sha: string; changed: boolean }

export const prDescriptionSummaryService = {
  /** Put the review's summary into the PR description. Never throws. */
  async sync(input: DescriptionSyncInput): Promise<DescriptionSyncOutcome> {
    // Model text read back through the same neutralising pass as the comment.
    const block = buildDescriptionSummaryBlock({
      prSummary: parsePrSummary(input.prSummary),
      headSha: input.headSha,
      commitUrl: input.commitUrl ?? null,
    })
    if (!block) return 'no_summary'
    const where = `pr=${input.repo.owner}/${input.repo.name}#${input.prNumber}`
    try {
      const current = await prCommentClient.getPullRequestBody({
        repo: input.repo,
        prNumber: input.prNumber,
        token: input.token,
      })
      if (current.state !== null && current.state !== 'open') return 'not_open'
      const next = applyDescriptionSummary(
        current.body,
        block,
        prCommandHandle()
      )
      if (next === (current.body ?? '')) return 'unchanged'
      await prCommentClient.updatePullRequestBody({
        repo: input.repo,
        prNumber: input.prNumber,
        body: next,
        token: input.token,
      })
      return 'written'
    } catch (error) {
      logger.warn(
        `[pr-description-summary] description not updated ${where}: ${describe(error)}`
      )
      return 'failed'
    }
  },

  /**
   * `@<app> summary` — write the latest review's summary into the PR
   * description again (after the author added the placeholder, or edited
   * or removed Lumo's section). Uses the latest scan that carries a
   * summary; no new AI review is run.
   */
  async regenerate(input: {
    workspaceId: string
    pullRequestId: string
    repo: Repo
    prNumber: number
    token: string
  }): Promise<SummaryCommandResult> {
    const scan = await prSecurityScanRepository.findLatestSummaryByPullRequest(
      input.pullRequestId
    )
    if (!scan) return { kind: 'no_review' }
    // The setting as it is NOW (the owner may have changed it since the
    // scan ran), not the one stored on the scan.
    const mode: HighLevelSummaryMode =
      await repoConfigService.highLevelSummaryForPullRequest({
        workspaceId: input.workspaceId,
        repo: `${input.repo.owner}/${input.repo.name}`,
        prNumber: input.prNumber,
      })
    if (mode === 'off') return { kind: 'off' }
    if (mode === 'comment') return { kind: 'comment' }
    const outcome = await prDescriptionSummaryService.sync({
      repo: input.repo,
      prNumber: input.prNumber,
      token: input.token,
      prSummary: scan.prSummary,
      headSha: scan.headSha,
      commitUrl: commitUrlOf(input.repo, scan.headSha),
    })
    switch (outcome) {
      case 'no_summary':
        return { kind: 'no_summary', sha: scan.headSha }
      case 'not_open':
        return { kind: 'not_open' }
      case 'failed':
        return { kind: 'failed' }
      default:
        return {
          kind: 'written',
          sha: scan.headSha,
          changed: outcome === 'written',
        }
    }
  },
}

function commitUrlOf(repo: Repo, sha: string): string | null {
  const full = `${repo.owner}/${repo.name}`
  if (!/^[\w.-]+\/[\w.-]+$/.test(full) || !/^[0-9a-f]{7,40}$/i.test(sha))
    return null
  return `https://github.com/${full}/commit/${sha}`
}

/** PURE — the reply to `@<app> summary`. */
export function buildSummaryCommandReply(
  r: SummaryCommandResult,
  handle: string
): string {
  switch (r.kind) {
    case 'off':
      return 'ℹ️ The high-level summary is turned off for this repository. A workspace owner can turn it on in the repository’s review settings (or `reviews.high_level_summary` in `.lumo.yaml`).'
    case 'comment':
      return 'ℹ️ This repository keeps the high-level summary in Lumo’s summary comment, not in the PR description — it is refreshed there on every review.'
    case 'no_review':
      return `⏳ Lumo has not reviewed this PR yet — the summary is written when the first review finishes (or comment \`${handle} review\`).`
    case 'no_summary':
      return `⏳ Lumo’s latest review (\`${r.sha.slice(0, 7)}\`) has no summary to write — the AI review did not write one for it. Comment \`${handle} review\` to review the PR again.`
    case 'not_open':
      return '⚠️ Lumo didn’t update the description: the PR is not open.'
    case 'failed':
      return `⚠️ Lumo couldn’t update the PR description — try \`${handle} summary\` again later.`
    case 'written':
      return r.changed
        ? `✅ Updated the summary in the PR description (review of \`${r.sha.slice(0, 7)}\`).`
        : `✅ The summary in the PR description is already up to date (review of \`${r.sha.slice(0, 7)}\`).`
  }
}
