import { logger } from '@/lib/logger'
import type { TaskDelivery } from '@/lib/claim-faithfulness/types'

export interface MergedPrRef {
  workspaceId: string
  repo: string // "owner/repo"
  number: number
  mergeCommitSha: string | null
  title: string
}

type FetchDiff = (o: {
  workspaceId: string
  fullName: string
  prNumber: number
}) => Promise<string>

// Default fetcher — dynamically imported so ts-jest never loads the ESM-only
// `@octokit/auth-app` transitive dep. Typed as FetchDiff so the `??` fallback
// in resolveDeliveryViaGithub stays a non-undefined callable.
const defaultFetchDiff: FetchDiff = async o => {
  const { fetchPrDiff } = await import('@/lib/integrations/github/contents')
  return fetchPrDiff(o)
}

/**
 * PURE — server-side analogue of `git show --numstat`. Parses a unified diff:
 * file paths come from `diff --git a/<p> b/<p>` headers (the `b/` side); `+`/`-`
 * body lines are counted, excluding the `+++`/`---` file headers themselves.
 */
export function numstatFromDiff(diff: string): {
  changedFiles: string[]
  additions: number
  deletions: number
} {
  const changedFiles: string[] = []
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/ b\/(.+)$/)
      if (m?.[1] && !changedFiles.includes(m[1])) changedFiles.push(m[1])
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { changedFiles, additions, deletions }
}

/**
 * Build a TaskDelivery from a task's merged PRs by fetching each PR's unified
 * diff over the GitHub API (no local git — runs in serverless). Returns null
 * when there is no merged PR, or when every diff fetch fails (nothing to judge
 * → caller records UNJUDGEABLE). fetchDiff is injectable for tests.
 */
export async function resolveDeliveryViaGithub(
  args: { identifier: string; mergedPRs: MergedPrRef[] },
  deps: { fetchDiff?: FetchDiff } = {}
): Promise<TaskDelivery | null> {
  const { identifier, mergedPRs } = args
  if (mergedPRs.length === 0) return null
  const fetchDiff = deps.fetchDiff ?? defaultFetchDiff

  const diffs: string[] = []
  for (const pr of mergedPRs) {
    try {
      diffs.push(
        await fetchDiff({
          workspaceId: pr.workspaceId,
          fullName: pr.repo,
          prNumber: pr.number,
        })
      )
    } catch (err) {
      logger.error(
        `[claim-faithfulness] diff fetch failed for ${pr.repo}#${pr.number}: ${(err as Error).message}`
      )
    }
  }
  if (diffs.length === 0) return null

  const diff = diffs.join('\n')
  const { changedFiles, additions, deletions } = numstatFromDiff(diff)
  return {
    identifier,
    shas: mergedPRs
      .map(p => p.mergeCommitSha)
      .filter((s): s is string => Boolean(s)),
    prNumbers: mergedPRs.map(p => p.number),
    diff,
    commitSubjects: mergedPRs.map(p => p.title),
    changedFiles,
    additions,
    deletions,
  }
}
