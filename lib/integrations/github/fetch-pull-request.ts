/**
 * Fetch a single pull request from GitHub with a user's OAuth token.
 *
 * Extracted from `task-pr-link.service.ts` (LUM-684) so the idea-evidence link
 * path can reuse it instead of standing up a second raw `api.github.com` call:
 * CLAUDE.md's DIP rule keeps third-party calls behind a `lib/` wrapper, and one
 * copy of the response shape means one place to fix when it drifts.
 *
 * Uses an OAuth token (`Authorization: token …`) rather than the installation
 * token `lib/integrations/github/contents.ts` takes — the PR-link flow reads a
 * `GitHubIntegration.accessToken`, which is per-member OAuth.
 */

/** The subset of GitHub's PR payload the link flow persists. */
export interface GitHubPullRequestPayload {
  number: number
  title: string
  html_url: string
  state: string
  merged: boolean
  draft: boolean
  user: { login: string }
  // LUM-801: `sha` was always in GitHub's payload — this declaration just
  // narrowed it away. It is what a TestCaseRun's recorded commit is compared
  // against to tell a still-current run from one the PR has moved past.
  head: { ref: string; sha: string }
  base: { ref: string }
  merged_at: string | null
  closed_at: string | null
}

/**
 * Parse a GitHub PR URL into `{ repo, number }`. Returns null on malformed
 * URLs so callers can map that to HTTP 400.
 *
 * Example: `https://github.com/owner/repo/pull/42` → `{ repo: "owner/repo", number: 42 }`.
 */
export function parsePrUrl(
  url: string
): { repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { repo: match[1]!, number: Number(match[2]) }
}

/**
 * Fetch one PR. Returns null when GitHub does not return it, so callers decide
 * the status — note a 401/403/rate-limit is indistinguishable from a genuine
 * 404 here, which is why callers surface "not found on GitHub" rather than
 * claiming the PR does not exist.
 */
export async function fetchPullRequest(args: {
  token: string
  repo: string
  number: number
}): Promise<GitHubPullRequestPayload | null> {
  const res = await fetch(
    `https://api.github.com/repos/${args.repo}/pulls/${args.number}`,
    {
      headers: {
        Authorization: `token ${args.token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  )
  if (!res.ok) return null
  return (await res.json()) as GitHubPullRequestPayload
}

/** GitHub's `state` + `merged` collapsed into the lowercase string the
 * `PullRequest.state` column stores. */
export function toPrState(pr: {
  state: string
  merged: boolean
}): 'merged' | 'closed' | 'open' {
  if (pr.merged) return 'merged'
  return pr.state === 'closed' ? 'closed' : 'open'
}
