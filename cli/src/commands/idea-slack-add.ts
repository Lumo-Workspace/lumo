import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

/**
 * `lumo idea slack add <LUM-I1> <permalink>`
 *
 * Attaches a Slack thread to an idea by POSTing the permalink to
 * `/api/ideas/:id/slack-contexts`. Mirrors the task-side flow (LUM-681).
 */
export async function ideaSlackAdd(
  identifier: string | undefined,
  permalink: string | undefined
): Promise<number | void> {
  if (!identifier || !permalink) {
    console.error('Error: usage: lumo idea slack add <LUM-I1> <permalink>')
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
      `${base}/api/ideas/${encodeURIComponent(identifier)}/slack-contexts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permalink }),
      }
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
  if (res.status === 404) {
    console.error(
      `Error: idea ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      /* not JSON */
    }
    console.error(
      serverMsg
        ? `Error: ${sanitizeField(serverMsg)}`
        : `Error: slack add failed (HTTP ${res.status})`
    )
    return 1
  }

  const { context } = (await res.json()) as { context: { id: string } }
  console.log(`Linked Slack thread to ${identifier} (context ${context.id})`)
}
