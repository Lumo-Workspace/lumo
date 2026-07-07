import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

/**
 * `lumo idea web rm <LUM-I1> <link-id>`
 *
 * Removes a web link from an idea via
 * `DELETE /api/ideas/:id/web-links/:linkId`. Mirrors the task-side shape
 * (LUM-681); no task-side `rm` equivalent exists yet, so this follows the
 * DELETE route contract directly.
 */
export async function ideaWebRm(
  identifier: string | undefined,
  linkId: string | undefined
): Promise<number | void> {
  if (!identifier || !linkId) {
    console.error('Error: usage: lumo idea web rm <LUM-I1> <link-id>')
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
      `${base}/api/ideas/${encodeURIComponent(identifier)}/web-links/${encodeURIComponent(linkId)}`,
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
      `Error: idea ${identifier} or web link ${linkId} not found in workspace ${creds.workspaceSlug}`
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
        : `Error: web rm failed (HTTP ${res.status})`
    )
    return 1
  }

  console.log(`Removed web link ${linkId} from ${identifier}`)
}
