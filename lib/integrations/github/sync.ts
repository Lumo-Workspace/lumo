/**
 * Lists the recent PRs of a GitHub repo for the install / re-verify backfill.
 *
 * Fetch only: linking each PR to a task — and the shared-repository ambiguity
 * check that goes with it (LUM-925) — is `githubService.backfillPullRequests`,
 * the same lookup the webhook uses (LUM-929).
 */

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

export interface RecentPullRequest {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  user: { login: string }
  head: { ref: string; sha: string }
  base: { ref: string }
  merged_at: string | null
  closed_at: string | null
}

/** The 100 most-recently-updated PRs (all states). Throws on a GitHub error. */
export async function listRecentPullRequests(
  token: string,
  fullName: string
): Promise<RecentPullRequest[]> {
  const res = await fetch(
    `https://api.github.com/repos/${fullName}/pulls?state=all&per_page=100&sort=updated&direction=desc`,
    { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    throw new Error(`failed to fetch PRs for ${fullName}: ${res.status}`)
  }
  return (await res.json()) as RecentPullRequest[]
}
