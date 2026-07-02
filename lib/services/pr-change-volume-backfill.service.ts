import { logger } from '@/lib/logger'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

/** One backfill candidate row as the repository projects it. */
export interface BackfillPrRow {
  id: string
  workspaceId: string
  taskId: string | null
  repo: string
  number: number
  state: string
  additions: number | null
  deletions: number | null
  changedFiles: number | null
}

type FetchStats = (o: {
  workspaceId: string
  fullName: string
  prNumber: number
}) => Promise<{ additions: number; deletions: number; changedFiles: number }>

// Dynamically imported so jest never loads the ESM-only octokit auth chain
// (same pattern as lib/claim-faithfulness/delivery-github.ts).
const defaultFetchStats: FetchStats = async o => {
  const { fetchPrStats } = await import('@/lib/integrations/github/contents')
  return fetchPrStats(o)
}

export interface BackfillResult {
  /** Task-bound merged PRs missing at least one column. */
  candidates: number
  /** Rows written (apply) or that WOULD be written (dry-run). */
  written: number
  /** GitHub API could not produce stats — explicitly skipped, never zeroed. */
  skippedApiError: number
  /** Rows the defensive filter rejected (not merged / no task binding). */
  filteredOut: number
  dryRun: boolean
}

/**
 * LUM-634 — backfill change-volume columns for historical merged PRs.
 *
 * Operational discipline (mirrors the claim-audit script posture):
 * - scope: ONLY task-bound merged PRs (the audit reading has no use for
 *   ownerless PRs) — the repository query enforces it and a defensive
 *   in-process filter re-checks each row;
 * - dry-run first: `dryRun: true` (the script's default) counts and logs but
 *   never writes;
 * - fail-closed: a PR whose stats GitHub won't return is counted in
 *   `skippedApiError` and left null — a fabricated 0 is never written.
 *
 * Idempotent: already-filled PRs are excluded by the candidate query, and
 * re-writing the same GitHub-reported numbers is harmless.
 */
export async function backfillPrChangeVolume(
  opts: { dryRun: boolean },
  deps: { fetchStats?: FetchStats } = {}
): Promise<BackfillResult> {
  const fetchStats = deps.fetchStats ?? defaultFetchStats
  const rows =
    await pullRequestRepository.listMergedTaskBoundMissingChangeVolume()

  const result: BackfillResult = {
    candidates: 0,
    written: 0,
    skippedApiError: 0,
    filteredOut: 0,
    dryRun: opts.dryRun,
  }

  for (const row of rows as BackfillPrRow[]) {
    // Defense-in-depth: never process a row outside the decided scope, even
    // if the query (or a future edit to it) leaks one through.
    if (row.state !== 'merged' || row.taskId === null) {
      result.filteredOut++
      continue
    }
    result.candidates++

    let stats: Awaited<ReturnType<FetchStats>>
    try {
      stats = await fetchStats({
        workspaceId: row.workspaceId,
        fullName: row.repo,
        prNumber: row.number,
      })
    } catch (err) {
      result.skippedApiError++
      logger.warn(
        `[pr-change-volume] skip ${row.repo}#${row.number}: ${(err as Error).message}`
      )
      continue
    }

    if (!opts.dryRun) {
      await pullRequestRepository.updateChangeVolume(row.id, stats)
    }
    result.written++
  }

  return result
}
