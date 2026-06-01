import { getGithubInstallationToken } from '@/lib/integrations/github'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

// ── Types ───────────────────────────────────────────────────────────────────

export interface PrStatusUpdate {
  state: string
  mergedAt: Date | null
}

// ── PR Sync ─────────────────────────────────────────────────────────────────

export async function syncPullRequestStatus(
  openPrs: { id: string; number: number; url: string; state: string }[]
): Promise<Map<string, PrStatusUpdate>> {
  const updates = new Map<string, PrStatusUpdate>()
  try {
    // workspaceId not threaded here (batch across PRs); relies on
    // GITHUB_APP_INSTALLATION_ID env fallback during the per-workspace
    // migration. See LUM-129 spec §3.
    const token = await getGithubInstallationToken()

    for (const pr of openPrs) {
      const match = pr.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/)
      if (!match) continue
      const repo = match[1]

      const res = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${pr.number}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      )
      if (!res.ok) continue

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

      if (newState === pr.state) continue

      const mergedAt = ghPr.merged_at ? new Date(ghPr.merged_at) : null

      await pullRequestRepository.updateState(pr.id, {
        state: newState,
        mergedAt,
        closedAt: ghPr.closed_at ? new Date(ghPr.closed_at) : null,
        isDraft: ghPr.draft,
      })

      updates.set(pr.id, { state: newState, mergedAt })
    }
  } catch (_err) {
    // Non-critical: PR state may be slightly stale
  }
  return updates
}
