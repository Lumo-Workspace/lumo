import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { reportPull } from '../lib/report-pull'
import { formatWebBody } from '../lib/tier2-render'

/**
 * `lumo idea web show <LUM-I1> <link-id>`
 *
 * Tier-2 retrieval for the cheap inline WebLink card on an idea. Fetches the
 * page body (cached, or fetched behind the SSRF guard on first read) from
 * `/api/ideas/:id/web-links/:linkId/body` and prints it as plain text.
 * Mirrors `taskWebShow` (LUM-681).
 */
export async function ideaWebShow(
  identifier: string | undefined,
  linkId: string | undefined
): Promise<number | void> {
  if (!identifier || !linkId) {
    console.error('Error: usage: lumo idea web show <LUM-I1> <link-id>')
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
      `${base}/api/ideas/${encodeURIComponent(identifier)}/web-links/${encodeURIComponent(linkId)}/body`,
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
  if (res.status === 404) {
    console.error(
      `Error: idea ${identifier} or web link ${linkId} not found in workspace ${creds.workspaceSlug}`
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
        : `Error: web show failed (HTTP ${res.status})`
    )
    return 1
  }

  const { body, redactedSecrets } = (await res.json()) as {
    body: string | null
    redactedSecrets?: number
  }
  // LUM-998: fenced + guarded; the redaction count is the first notice.
  console.log(formatWebBody(body, redactedSecrets))

  // LUM-681: mirrors LUM-500 disclosure-funnel stamping for idea fragments.
  // The linkId arg == lineage WEB_LINK fragmentId. Fire-and-forget — never
  // blocks output, swallows failures.
  await reportPull({ fragmentType: 'WEB_LINK', fragmentId: linkId })
}
