import { EXIT_USAGE } from '../lib/exit-codes'
import { NONE, emptyState, fmtTimestamp } from '../lib/format'
import { fetchActorNames } from '../lib/crossing-records'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import {
  OUTPUT_TOKEN_BUDGET,
  truncateUnitsToBudget,
} from '../../../shared/src/output-budget'
import { shortCommentId } from '../lib/comment-ref'
import { shellQuote } from '../lib/confirmation'
import {
  LINKED_FENCE,
  fenceUntrustedText,
  linkedRetrievalPreamble,
} from '../../../shared/src/untrusted-fence'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import {
  buildCommand,
  pageFooter,
  pageJson,
  paginate,
  parsePageArgs,
  type PageArgs,
} from '../lib/pagination'
import { emitJson, listEnvelope, stripInternalFields } from '../lib/json-output'
import { guardJsonBlock } from '../lib/json-guard'

interface ResolveResponse {
  id: string
  identifier: string
}

export interface CommentNode {
  id: string
  authorActorId: string | null
  /** LUM-1232: the author's display name from the server; absent on older servers. */
  authorName?: string | null
  body: string
  createdAt: string
  replies?: CommentNode[]
}

export interface CommentThreadOptions {
  /** Render every comment, bypassing the output budget (the escape hatch the
   *  fetch-more pointer advertises). */
  full?: boolean | undefined
  /** Task identifier echoed into the fetch-more pointer (e.g. "LUM-42"). */
  identifier?: string | undefined
  /** Override the token ceiling (tests). */
  maxTokens?: number | undefined
  /** The `lumo <…>` sub-command the fetch-more pointer advertises. Defaults to
   *  the task thread. */
  fetchCommand?: string | undefined
  /** Actor id → member / agent name (LUM-1232 G2). When given, an author is
   *  printed by name, or `-` when the directory cannot name it — never as a
   *  raw actor id. */
  actorNames?: Map<string, string> | undefined
}

/**
 * Strip TipTap/HTML markup to readable plain text. Comment bodies are stored as
 * HTML; the CLI only needs the visible text. We collapse block tags to newlines
 * and drop the rest, then decode the handful of entities that survive.
 */
export function commentPlainText(html: string): string {
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

/** Render one comment (and its nested replies) as an indented text block. */
function renderCommentBlock(
  c: CommentNode,
  indent: string,
  names?: Map<string, string>
): string {
  const lines: string[] = []
  const id = c.authorActorId
  const author = sanitizeField(
    c.authorName
      ? c.authorName
      : id === null
        ? NONE
        : names
          ? (names.get(id) ?? NONE)
          : id
  )
  // `#<short id>` is the handle `task comment --reply-to` and
  // `task comments edit/rm` take (LUM-821).
  lines.push(
    `${indent}#${shortCommentId(c.id)} · ${author} · ${fmtTimestamp(c.createdAt)}`
  )
  const text = sanitizeField(commentPlainText(c.body))
  for (const line of (text || '(empty)').split('\n')) {
    lines.push(`${indent}${line}`)
  }
  for (const reply of c.replies ?? []) {
    lines.push('')
    lines.push(renderCommentBlock(reply, indent + '  ', names))
  }
  return lines.join('\n')
}

/**
 * Render the full comment thread as agent-facing text. One block per top-level
 * comment (replies indented underneath). Capped to the output-token budget by
 * default (LUM-428) — a long-running task's thread is one of the easiest ways
 * to blow the agent's context — with a fetch-more pointer to `--full`. Pass
 * `{ full: true }` to print everything.
 */
export function formatCommentThread(
  comments: CommentNode[],
  opts: CommentThreadOptions = {}
): string {
  if (comments.length === 0) return emptyState('comments')
  const blocks = comments.map(c => renderCommentBlock(c, '', opts.actorNames))
  if (opts.full) return fenceCommentThread(blocks.join(COMMENT_SEPARATOR))
  const id = opts.identifier ?? '<LUM-N>'
  const fetchCommand = opts.fetchCommand ?? 'task comments list'
  const capped = truncateUnitsToBudget({
    units: blocks,
    // The fence (tags, preamble, up to two notices) is printed on top of the
    // kept comments, so it is paid for out of the same budget.
    maxTokens: Math.max(
      1,
      (opts.maxTokens ?? OUTPUT_TOKEN_BUDGET) - FENCE_RESERVE_TOKENS
    ),
    unitNoun: 'comments',
    fetchHint: `read the whole thread with: lumo ${fetchCommand} ${id} --full`,
    separator: COMMENT_SEPARATOR,
  })
  if (!capped.truncated) return fenceCommentThread(capped.text)
  // The fetch-more pointer is Lumo's own line: keep it outside the fence.
  const cut = capped.text.lastIndexOf(COMMENT_SEPARATOR)
  if (cut < 0) return fenceCommentThread(capped.text)
  const pointer = capped.text.slice(cut + COMMENT_SEPARATOR.length)
  // A budget too small to keep any text leaves nothing to fence.
  const fenced = fenceCommentThread(capped.text.slice(0, cut))
  return fenced ? `${fenced}${COMMENT_SEPARATOR}${pointer}` : pointer
}

const COMMENT_SEPARATOR = '\n\n'
/** Upper bound on what `fenceCommentThread` adds around the body (~1 KB). */
const FENCE_RESERVE_TOKENS = 250

/**
 * LUM-998: a comment body is any workspace member's text — the same surface
 * `task context` already fences as linked context. The thread prints inside
 * one `<untrusted-linked-context>` block, wrapper tags defanged and
 * directive-shaped content flagged at the head; nothing is dropped.
 */
function fenceCommentThread(text: string): string {
  return fenceUntrustedText(
    LINKED_FENCE,
    linkedRetrievalPreamble('The comment thread'),
    text
  )
}

/**
 * `lumo task comments list <LUM-N>`
 *
 * Tier-2 retrieval for the task comment thread. Resolves the LUM-N identifier to
 * its DB id (the comments endpoint is keyed by DB id), then fetches the full
 * thread from `/api/tasks/:id/comments` and prints each top-level comment
 * (replies indented) as `author · time` followed by the plain-text body.
 */
export interface TaskCommentListOptions {
  full?: boolean | undefined
  limit?: string | undefined
  cursor?: string | undefined
  json?: boolean | undefined
}

/** A comment for `--json`: the body guarded as the text view's fence body. */
function commentJson(c: CommentNode): CommentNode {
  return {
    ...c,
    body: guardJsonBlock(c.body),
    ...(c.replies ? { replies: c.replies.map(commentJson) } : {}),
  }
}

/**
 * The `--json` envelope for one page of top-level threads (replies nested
 * under their parent); `--full` alone is every thread on one page.
 */
export function commentListJson(
  comments: CommentNode[],
  page: PageArgs | null,
  task: string
): Record<string, unknown> {
  const p = page
    ? paginate(comments, page)
    : { items: comments, total: comments.length, nextCursor: null }
  return listEnvelope(
    'comments',
    stripInternalFields(p.items.map(commentJson)),
    pageJson(p),
    { task }
  )
}

/**
 * LUM-1093: which top-level threads to print. `--full` alone keeps its
 * "every comment" promise (no paging); otherwise threads are paged 50 at a
 * time, replies travelling with their parent.
 */
export function commentPageArgs(
  opts: TaskCommentListOptions
): { ok: true; page: PageArgs | null } | { ok: false; error: string } {
  if (opts.full && opts.limit === undefined && opts.cursor === undefined) {
    return { ok: true, page: null }
  }
  const r = parsePageArgs(opts.limit, opts.cursor)
  if (!r.ok) return r
  return { ok: true, page: { limit: r.limit, offset: r.offset } }
}

/** The thread for one page plus the LUM-1093 footer (outside the fence). */
export function formatCommentPage(
  comments: CommentNode[],
  page: PageArgs | null,
  identifier: string,
  opts: TaskCommentListOptions,
  actorNames?: Map<string, string>
): string {
  if (!page)
    return formatCommentThread(comments, {
      full: opts.full,
      identifier,
      actorNames,
    })
  const p = paginate(comments, page)
  const footer = pageFooter(
    { ...p, shown: p.items.length },
    buildCommand(
      `task comments list ${shellQuote(sanitizeField(identifier))}`,
      [
        ['--full', opts.full],
        ['--limit', opts.limit],
      ]
    )
  )
  const body =
    p.items.length === 0
      ? '(no comments on this page)'
      : formatCommentThread(p.items, {
          full: opts.full,
          identifier,
          actorNames,
        })
  return [body, ...footer].join('\n')
}

export async function taskCommentList(
  identifier: string | undefined,
  opts: TaskCommentListOptions = {}
): Promise<number | void> {
  if (!identifier) {
    console.error('Error: usage: lumo task comments list <LUM-42>')
    return EXIT_USAGE
  }
  const paging = commentPageArgs(opts)
  if (!paging.ok) {
    console.error(`Error: ${paging.error}`)
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
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
    console.error(errAuth())
    return 1
  }
  if (resolveRes.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!resolveRes.ok) {
    console.error(errHttp('resolve', resolveRes.status))
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
    console.error(errAuth())
    return 1
  }
  if (res.status === 404) {
    console.error(`Error: task ${identifier} not found`)
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('comments list', res.status))
    return 1
  }

  const { comments } = (await res.json()) as { comments: CommentNode[] }
  if (opts.json) {
    emitJson(commentListJson(comments ?? [], paging.page, resolved.identifier))
    return
  }
  if (!comments || comments.length === 0) {
    console.log(emptyState('comments'))
    return
  }
  // LUM-1232 G2: authors by name from the member directory, not actor ids.
  const actorNames = await fetchActorNames(base, creds.token)
  console.log(
    formatCommentPage(
      comments,
      paging.page,
      resolved.identifier,
      opts,
      actorNames
    )
  )
}
