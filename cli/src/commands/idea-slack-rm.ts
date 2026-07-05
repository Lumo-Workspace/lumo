import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

/**
 * `lumo idea slack rm <LUM-I1> <context-id>`
 *
 * Removes a Slack context from an idea via
 * `DELETE /api/ideas/:id/slack-contexts/:contextId`. Mirrors the task-side
 * shape (LUM-681); no task-side `rm` equivalent exists yet, so this follows
 * the DELETE route contract directly.
 */
export async function ideaSlackRm(
  identifier: string | undefined,
  contextId: string | undefined
): Promise<number | void> {
  if (!identifier || !contextId) {
    console.error('Error: usage: lumo idea slack rm <LUM-I1> <context-id>')
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
      `${base}/api/ideas/${encodeURIComponent(identifier)}/slack-contexts/${encodeURIComponent(contextId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${creds.token}` },
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
      `Error: idea ${identifier} or slack context ${contextId} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok && res.status !== 204) {
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
        : `Error: slack rm failed (HTTP ${res.status})`
    )
    return 1
  }

  console.log(`Removed Slack context ${contextId} from ${identifier}`)
}
