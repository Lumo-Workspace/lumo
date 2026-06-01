import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

interface ResolveResponse {
  id: string
  identifier: string
}

interface CommentNode {
  id: string
  authorActorId: string | null
  body: string
  createdAt: string
  replies?: CommentNode[]
}

/**
 * Strip TipTap/HTML markup to readable plain text. Comment bodies are stored as
 * HTML; the CLI only needs the visible text. We collapse block tags to newlines
 * and drop the rest, then decode the handful of entities that survive.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function printComment(c: CommentNode, indent: string): void {
  const author = sanitizeField(c.authorActorId ?? 'unknown')
  console.log(`${indent}${author} · ${c.createdAt}`)
  const text = sanitizeField(htmlToPlainText(c.body))
  for (const line of (text || '(empty)').split('\n')) {
    console.log(`${indent}${line}`)
  }
  console.log('')
  for (const reply of c.replies ?? []) {
    printComment(reply, indent + '  ')
  }
}

/**
 * `lumo task comments list <LUM-N>`
 *
 * Tier-2 retrieval for the task comment thread. Resolves the LUM-N identifier to
 * its DB id (the comments endpoint is keyed by DB id), then fetches the full
 * thread from `/api/tasks/:id/comments` and prints each top-level comment
 * (replies indented) as `author · time` followed by the plain-text body.
 */
export async function taskCommentList(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error('Error: usage: lumo task comments list <LUM-42>')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  // 1. Resolve LUM-N → DB id (the comments endpoint takes the DB id).
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

  // 2. Fetch the comment thread.
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(resolved.id)}/comments`,
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
    console.error(`Error: task ${identifier} not found`)
    return 1
  }
  if (!res.ok) {
    console.error(`Error: comments list failed (HTTP ${res.status})`)
    return 1
  }

  const { comments } = (await res.json()) as { comments: CommentNode[] }
  if (!comments || comments.length === 0) {
    console.log('(no comments)')
    return
  }
  for (const c of comments) {
    printComment(c, '')
  }
}
