import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { formatCommentThread, type CommentNode } from './task-comment-list'

/**
 * `lumo idea comment <id> <body>` — post a comment on a team-level idea.
 *
 * `<id>` is the `<TEAM>-I<n>` identifier (a bare `<n>` also resolves) or a cuid.
 * Unlike task comments, the idea comments endpoint is keyed by the idea ref
 * directly, so there's no separate resolve step. Body is plain text — quote it
 * to pass spaces/newlines.
 */
export async function ideaComment(
  idRef: string | undefined,
  body: string | undefined
): Promise<number | void> {
  if (!idRef || idRef.trim().length === 0) {
    console.error('Error: usage: lumo idea comment <LUM-I42> "<body>"')
    return 1
  }
  if (!body || body.trim().length === 0) {
    console.error('Error: comment body cannot be empty.')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const url = `${base}/api/ideas/${encodeURIComponent(idRef.trim())}/comments`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: body.trim() }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 201) {
    process.stdout.write(`✓ commented on ${sanitizeField(idRef.trim())}\n`)
    return
  }

  let serverMsg: string | null = null
  try {
    const errBody = (await res.json()) as { error?: string }
    if (typeof errBody.error === 'string') serverMsg = errBody.error
  } catch {
    // Body wasn't JSON; fall through to status-only message
  }
  if (serverMsg) {
    console.error(`Error: ${sanitizeField(serverMsg)}`)
  } else {
    console.error(`Error: idea comment failed (HTTP ${res.status})`)
  }
  return 1
}

/**
 * `lumo idea comments list <id>` — print an idea's comment thread. Reuses the
 * shared `formatCommentThread` renderer (same output-budget cap + `--full`
 * escape hatch as `lumo task comments list`). Idea threads are flat, so each
 * block is a single top-level comment.
 */
export async function ideaCommentList(
  idRef: string | undefined,
  opts: { full?: boolean } = {}
): Promise<number | void> {
  if (!idRef || idRef.trim().length === 0) {
    console.error('Error: usage: lumo idea comments list <LUM-I42>')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const url = `${base}/api/ideas/${encodeURIComponent(idRef.trim())}/comments`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
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
    console.error(`Error: idea ${sanitizeField(idRef.trim())} not found`)
    return 1
  }
  if (!res.ok) {
    console.error(`Error: idea comments list failed (HTTP ${res.status})`)
    return 1
  }

  const { comments } = (await res.json()) as { comments: CommentNode[] }
  if (!comments || comments.length === 0) {
    console.log('(no comments)')
    return
  }
  console.log(
    formatCommentThread(comments, {
      full: opts.full,
      identifier: idRef.trim(),
      fetchCommand: 'idea comments list',
    })
  )
}
