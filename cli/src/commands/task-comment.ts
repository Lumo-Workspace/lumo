import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

interface ResolveResponse {
  id: string
  identifier: string
  title: string
  status: string
}

interface CommentResponse {
  comment: {
    id: string
  }
}

/**
 * `lumo task comment <LUM-N> <body>`
 *
 * Two HTTP calls: resolve LUM-N → task DB id, then POST the comment to
 * `/api/tasks/:id/comments`. The comments endpoint accepts both Clerk and
 * bearer auth (dual-auth) — see lib/auth/identity.ts.
 *
 * Body is taken verbatim as the comment text. Multi-line bodies work via
 * shell quoting. We do not support markdown @-mention chip syntax from the
 * CLI; plain text only.
 */
export async function taskComment(
  identifier: string | undefined,
  body: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo task comment <LUM-42> "comment body"'
    )
    return 1
  }
  if (!body || body.trim().length === 0) {
    console.error(
      'Error: missing <body>. Usage: lumo task comment <LUM-42> "comment body"'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  // 1. Resolve LUM-N → DB id (the comments endpoint takes DB id).
  let resolveRes: Response
  try {
    resolveRes = await fetch(
      `${base}/api/tasks/resolve/${encodeURIComponent(identifier)}`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (resolveRes.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (resolveRes.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!resolveRes.ok) {
    console.error(`Error: resolve failed (HTTP ${resolveRes.status})`)
    return 1
  }
  const resolved = (await resolveRes.json()) as ResolveResponse

  // 2. POST the comment.
  let postRes: Response
  try {
    postRes = await fetch(
      `${base}/api/tasks/${encodeURIComponent(resolved.id)}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (postRes.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (postRes.status !== 201) {
    let serverMsg: string | null = null
    try {
      const errBody = (await postRes.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // Body wasn't JSON
    }
    console.error(
      serverMsg
        ? `Error: ${sanitizeField(serverMsg)}`
        : `Error: comment create failed (HTTP ${postRes.status})`
    )
    return 1
  }

  const data = (await postRes.json()) as CommentResponse
  process.stdout.write(
    `Commented on ${resolved.identifier}  (comment ${data.comment.id})\n`
  )
}
