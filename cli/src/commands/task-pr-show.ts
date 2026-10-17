import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { formatPrShow } from '../lib/tier2-render'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

interface PullRequest {
  id: string
  repo: string | null
  number: number
  title: string | null
  url: string | null
  state: string | null
  isDraft: boolean
  ciStatus: string | null
  authorLogin: string | null
  headBranch: string | null
  baseBranch: string | null
  mergedAt: string | null
  closedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

interface PrResponse {
  pullRequest: PullRequest
  liveDiffAvailable?: boolean
  note?: string
}

/**
 * `lumo task pr show <LUM-N> <number>`
 *
 * Tier-2 retrieval for the cheap inline PR card. Reads the synced PR record
 * (title, state, ciStatus, branches, author, url) from
 * `/api/tasks/:id/pull-requests/:number`. Live diff + review comments need a
 * GitHub token, so the route degrades to the stored record + a `note`; we print
 * the note when present.
 */
export async function taskPrShow(
  identifier: string | undefined,
  prNumber: string | undefined
): Promise<number | void> {
  if (!identifier || !prNumber) {
    console.error('Error: usage: lumo task pr show <LUM-42> <number>')
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/pull-requests/${encodeURIComponent(prNumber)}`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (res.status === 400) {
    // The server rejected it after a request was sent: exit 1, not a usage 2.
    console.error(`Error: invalid PR number "${prNumber}"`)
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} or PR #${prNumber} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('pr show', res.status))
    return 1
  }

  const { pullRequest: pr, note } = (await res.json()) as PrResponse
  // LUM-998: the PR title is guarded inline.
  console.log(formatPrShow(pr, note))
}
