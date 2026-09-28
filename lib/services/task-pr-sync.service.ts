import { getRepoToken } from '@/lib/integrations/github'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { logger } from '@/lib/logger'

// ── Types ───────────────────────────────────────────────────────────────────

export interface PrStatusUpdate {
  state: string
  mergedAt: Date | null
}

type OpenPr = { id: string; number: number; url: string; state: string }

// ── PR Sync ─────────────────────────────────────────────────────────────────

/**
 * Refresh the task's open PRs from GitHub. Non-critical — a failure only
 * leaves a PR state stale — but never silent (LUM-828): every failure is
 * logged, and one failing PR does not stop the rest from syncing.
 */
export async function syncPullRequestStatus(
  workspaceId: string,
  openPrs: OpenPr[]
): Promise<Map<string, PrStatusUpdate>> {
  const updates = new Map<string, PrStatusUpdate>()
  // One token per repository (LUM-883), minted only for a repository the
  // workspace still has confirmed: a PR row whose repository left the list
  // keeps its stored state instead of being refreshed from GitHub. `null` =
  // refused or failed, already logged once for that repository.
  const tokens = new Map<string, string | null>()

  for (const pr of openPrs) {
    const repo = pr.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/)?.[1]
    if (!repo) continue
    const key = repo.toLowerCase()
    if (!tokens.has(key)) {
      try {
        tokens.set(key, await getRepoToken(workspaceId, repo))
      } catch (error) {
        logger.warn(
          `[pr-sync] no GitHub token for ${repo} in workspace ${workspaceId}; its PR states may be stale`,
          { error: String(error) }
        )
        tokens.set(key, null)
      }
    }
    const token = tokens.get(key)
    if (!token) continue
    try {
      const update = await syncOne(token, repo, pr)
      if (update) updates.set(pr.id, update)
    } catch (error) {
      logger.warn(`[pr-sync] refresh of ${repo}#${pr.number} failed`, {
        error: String(error),
      })
    }
  }
  return updates
}

async function syncOne(
  token: string,
  repo: string,
  pr: OpenPr
): Promise<PrStatusUpdate | null> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${pr.number}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  )
  if (!res.ok) {
    logger.warn(`[pr-sync] GitHub refused ${repo}#${pr.number}`, {
      status: res.status,
    })
    return null
  }

  const ghPr = (await res.json()) as {
    state: string
    merged: boolean
    merged_at: string | null
    closed_at: string | null
    draft: boolean
  }

  const newState = ghPr.merged
    ? 'merged'
    : ghPr.state === 'closed'
      ? 'closed'
      : 'open'

  if (newState === pr.state) return null

  const mergedAt = ghPr.merged_at ? new Date(ghPr.merged_at) : null

  await pullRequestRepository.updateState(pr.id, {
    state: newState,
    mergedAt,
    closedAt: ghPr.closed_at ? new Date(ghPr.closed_at) : null,
    isDraft: ghPr.draft,
  })

  return { state: newState, mergedAt }
}
