/**
 * LUM-1003 — backfill `PrCommentMirror.authorAssociation` from GitHub.
 *
 * Agent context renders a mirrored review comment as a todo only when its
 * author is verified (workspace member, or GitHub OWNER / MEMBER /
 * COLLABORATOR). Rows mirrored before LUM-1003 never recorded the
 * association, so without this a real maintainer's ask on an older PR reads
 * as unverified. This walks those rows PR by PR, lists the PR's comments /
 * reviews through the App installation and fills the association.
 *
 * - **NULL rows only, idempotent.** The write is guarded on
 *   `authorAssociation: null`; a re-run (or a webhook racing it) is a no-op.
 * - **Batched.** One short transaction per `WRITE_BATCH` rows, with an
 *   explicit timeout (repository).
 * - **Rate-limit aware.** Requests are sequential. A rate-limit response
 *   (primary or secondary) stops the run at once; so does the remaining quota
 *   dropping under `minRateLimitRemaining`. The PR being read when a limit
 *   hits is not counted as done: `nextCursor` points before it.
 * - **Resumable.** Keyset cursor on PR id (`nextCursor`); pass it back in.
 * - **Unreachable rows stay NULL** (= unverified) and are counted: the
 *   comment was deleted on GitHub, the PR/repo is gone, or the repository is
 *   no longer reachable through a confirmed installation.
 * - **Dry run** reads GitHub and reports counts without writing.
 */
import { getRepoToken } from '@/lib/integrations/github/auth'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import {
  GithubApiError,
  prCommentClient,
  type AssociationListingKind,
} from '@/lib/integrations/github/pr-comment-client'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { logger } from '@/lib/logger'

/** Rows per write transaction. */
export const WRITE_BATCH = 50
/** Pages per listing (100 comments each) before a PR is given up on. */
export const MAX_PAGES_PER_LISTING = 30

export interface BackfillOptions {
  dryRun: boolean
  /** Resume after this PR id (the previous run's `nextCursor`). */
  cursor?: string | null
  /** PRs to process this run. */
  maxPrs?: number
  /** Stop once `X-RateLimit-Remaining` drops below this. */
  minRateLimitRemaining?: number
  /** Stop before starting a PR after this instant (function time budget). */
  deadline?: Date
  now?: () => Date
}

export type BackfillStopReason = 'done' | 'max_prs' | 'rate_limit' | 'deadline'

export interface BackfillReport {
  dryRun: boolean
  prsProcessed: number
  rowsConsidered: number
  /** Rows written (dry run: rows that would be written). */
  filled: number
  /** Rows GitHub no longer returns, or whose PR is unreachable — left NULL. */
  unreachable: number
  /** PRs whose token or listing failed for a non-rate-limit reason. */
  prsUnreachable: number
  stoppedReason: BackfillStopReason
  /** Pass back as `cursor` to resume; null when nothing is left. */
  nextCursor: string | null
  rateLimitResetAt: string | null
}

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner = '', name = ''] = repo.split('/')
  return { owner, name }
}

/** Read one listing until every wanted id is found or the pages run out. */
async function readListing(input: {
  repo: { owner: string; name: string }
  prNumber: number
  kind: AssociationListingKind
  token: string
  wanted: Set<string>
  minRemaining: number
}): Promise<{ found: Map<string, string>; lowQuota: boolean }> {
  const found = new Map<string, string>()
  let lowQuota = false
  for (let page = 1; page <= MAX_PAGES_PER_LISTING; page += 1) {
    const res = await prCommentClient.listAuthorAssociationsPage({
      repo: input.repo,
      prNumber: input.prNumber,
      kind: input.kind,
      page,
      token: input.token,
    })
    for (const item of res.items) {
      const id = String(item.id)
      if (input.wanted.has(id) && item.authorAssociation) {
        found.set(id, item.authorAssociation.toUpperCase())
      }
    }
    if (
      res.rateLimitRemaining !== null &&
      res.rateLimitRemaining < input.minRemaining
    ) {
      lowQuota = true
      break
    }
    if (found.size === input.wanted.size || !res.hasNext) break
  }
  return { found, lowQuota }
}

function isRateLimit(err: unknown): err is GithubApiError {
  return (
    err instanceof GithubApiError &&
    (err.rateLimitResetAt !== undefined || err.status === 429)
  )
}

export const prCommentAuthorBackfillService = {
  async run(opts: BackfillOptions): Promise<BackfillReport> {
    const now = opts.now ?? (() => new Date())
    const maxPrs = opts.maxPrs ?? 50
    const minRemaining = opts.minRateLimitRemaining ?? 100
    const report: BackfillReport = {
      dryRun: opts.dryRun,
      prsProcessed: 0,
      rowsConsidered: 0,
      filled: 0,
      unreachable: 0,
      prsUnreachable: 0,
      stoppedReason: 'done',
      nextCursor: null,
      rateLimitResetAt: null,
    }

    // One extra row tells "exactly maxPrs left" apart from "more to come".
    const prs =
      await prCommentMirrorRepository.listPrsWithUnknownAuthorAssociation({
        afterPullRequestId: opts.cursor ?? null,
        limit: maxPrs + 1,
      })
    let cursor = opts.cursor ?? null

    for (const [i, pr] of prs.entries()) {
      if (i >= maxPrs) {
        report.stoppedReason = 'max_prs'
        report.nextCursor = cursor
        return report
      }
      if (opts.deadline && now() >= opts.deadline) {
        report.stoppedReason = 'deadline'
        report.nextCursor = cursor
        return report
      }

      const rows =
        await prCommentMirrorRepository.listUnknownAuthorAssociationRows(pr.id)
      if (rows.length === 0) {
        cursor = pr.id
        continue
      }

      const byKind = new Map<AssociationListingKind, Set<string>>()
      for (const r of rows) {
        const set = byKind.get(r.externalSource) ?? new Set<string>()
        set.add(r.externalId)
        byKind.set(r.externalSource, set)
      }

      const found = new Map<string, string>()
      let lowQuota = false
      try {
        const token = await getRepoToken(
          pr.workspaceId,
          pr.repo,
          REPO_TOKEN_PERMISSIONS.pullRequestRead
        )
        for (const [kind, wanted] of byKind) {
          const listing = await readListing({
            repo: parseRepo(pr.repo),
            prNumber: pr.number,
            kind,
            token,
            wanted,
            minRemaining: minRemaining,
          })
          for (const [id, a] of listing.found) found.set(`${kind}:${id}`, a)
          if (listing.lowQuota) {
            lowQuota = true
            break
          }
        }
      } catch (err) {
        if (isRateLimit(err)) {
          report.stoppedReason = 'rate_limit'
          report.rateLimitResetAt = err.rateLimitResetAt?.toISOString() ?? null
          report.nextCursor = cursor
          return report
        }
        // Repo gone, installation removed, PR deleted: rows stay unverified.
        logger.warn('[lum1003-backfill] PR unreachable', {
          pullRequestId: pr.id,
          error: err instanceof Error ? err.message : String(err),
        })
        report.prsUnreachable += 1
        report.unreachable += rows.length
        report.rowsConsidered += rows.length
        report.prsProcessed += 1
        cursor = pr.id
        continue
      }

      if (lowQuota) {
        // A partial read is not a verdict: leave this PR for the next run.
        report.stoppedReason = 'rate_limit'
        report.nextCursor = cursor
        return report
      }

      const updates: Array<{ id: string; authorAssociation: string }> = []
      for (const r of rows) {
        const a = found.get(`${r.externalSource}:${r.externalId}`)
        if (a) updates.push({ id: r.id, authorAssociation: a })
      }
      report.rowsConsidered += rows.length
      report.unreachable += rows.length - updates.length
      if (opts.dryRun) {
        report.filled += updates.length
      } else {
        for (let k = 0; k < updates.length; k += WRITE_BATCH) {
          report.filled +=
            await prCommentMirrorRepository.fillAuthorAssociations(
              updates.slice(k, k + WRITE_BATCH)
            )
        }
      }
      report.prsProcessed += 1
      cursor = pr.id
    }

    // Every PR in reach was processed. Unreachable rows stay NULL; a later
    // run without a cursor re-checks them (cheap, and a restored repository
    // then gets its associations).
    report.nextCursor = null
    return report
  },
}
