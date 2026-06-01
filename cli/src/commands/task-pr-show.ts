import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'

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
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 400) {
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
    console.error(`Error: pr show failed (HTTP ${res.status})`)
    return 1
  }

  const { pullRequest: pr, note } = (await res.json()) as PrResponse
  console.log(
    `#${pr.number}${pr.repo ? ` (${pr.repo})` : ''}  ${pr.title ?? ''}`
  )
  console.log(
    `state:    ${pr.state ?? 'unknown'}${pr.isDraft ? ' · draft' : ''}`
  )
  if (pr.ciStatus) console.log(`ci:       ${pr.ciStatus}`)
  if (pr.authorLogin) console.log(`author:   ${pr.authorLogin}`)
  if (pr.headBranch || pr.baseBranch)
    console.log(`branch:   ${pr.headBranch ?? '?'} → ${pr.baseBranch ?? '?'}`)
  if (pr.url) console.log(`url:      ${pr.url}`)
  if (note) console.log(`\nnote: ${note}`)
}
