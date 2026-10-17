import { emptyState } from '../lib/format'
import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import { successLine } from '../lib/feedback'

interface ResolveResponse {
  id: string
  identifier: string
}

export interface DepEdge {
  id: string
  direction: 'BLOCKED_BY' | 'BLOCKS'
  kind: string
  source: string
  status: string
  reason: string | null
  detail: { count?: number; sample?: string[]; surface?: string } | null
  other: { identifier: string; title: string; status: string }
}

/** Short id = first 8 chars; used for both display and selectors. */
const shortId = (id: string) => id.slice(0, 8)

/**
 * Resolve a user-supplied edge selector against the task's edge list. Accepts
 * either the other task's identifier (case-insensitive, exact) or an edge-id
 * prefix of at least 6 chars. Returns null when nothing (or more than one
 * edge) matches — callers print the candidate list and bail.
 */
export function resolveEdgeSelector(
  edges: DepEdge[],
  selector: string
): DepEdge | null {
  const s = selector.trim()
  const byIdent = edges.filter(
    e => e.other.identifier.toUpperCase() === s.toUpperCase()
  )
  if (byIdent.length === 1) return byIdent[0] ?? null
  const byPrefix = edges.filter(e => e.id.startsWith(s))
  if (s.length >= 6 && byPrefix.length === 1) return byPrefix[0] ?? null
  return null
}

/**
 * Render the dependency edges of a task grouped by status. SUGGESTED rows get
 * a copy-pasteable confirm hint with the short edge id; detected evidence
 * (shared files / task mention) is summarized inline.
 */
export function formatDepsList(identifier: string, edges: DepEdge[]): string {
  if (edges.length === 0) return emptyState('dependencies', identifier)
  const lines: string[] = [
    `Dependencies for ${identifier} (${edges.length})`,
    '',
  ]
  const dirLabel = (e: DepEdge) =>
    e.direction === 'BLOCKED_BY' ? 'blocked by' : 'blocks'
  const evidence = (e: DepEdge) => {
    if (e.reason === 'shared_files')
      return ` · shared_files(${e.detail?.count ?? '?'} shared files${
        e.detail?.sample?.length ? ': ' + e.detail.sample.join(', ') : ''
      })`
    if (e.reason === 'task_mention')
      return ` · task_mention(${e.detail?.surface ?? ''})`
    return ''
  }
  const section = (
    title: string,
    rows: DepEdge[],
    render: (e: DepEdge) => string[]
  ) => {
    if (rows.length === 0) return
    lines.push(title)
    for (const e of rows) lines.push(...render(e))
    lines.push('')
  }
  const confirmed = edges.filter(e => e.status === 'CONFIRMED')
  const suggested = edges.filter(e => e.status === 'SUGGESTED')
  const dismissed = edges.filter(e => e.status === 'DISMISSED')
  section('CONFIRMED', confirmed, e => [
    `  [${shortId(e.id)}] ${dirLabel(e)} ${e.other.identifier} "${e.other.title}" ${e.other.status} · ${e.source}${evidence(e)}`,
  ])
  section('SUGGESTED (pending confirmation)', suggested, e => [
    `  [${shortId(e.id)}] ${dirLabel(e)} ${e.other.identifier} "${e.other.title}" ${e.other.status}${evidence(e)}`,
    `      confirm: lumo task deps confirm ${identifier} ${shortId(e.id)} (add --reverse if direction is flipped; false positive: dismiss)`,
  ])
  section('DISMISSED', dismissed, e => [
    `  [${shortId(e.id)}] ${dirLabel(e)} ${e.other.identifier} · dismissed`,
  ])
  return lines.join('\n').trimEnd()
}

// ---------------------------------------------------------------------------
// Shared plumbing for the five actions (template: task-comment-list.ts).
// ---------------------------------------------------------------------------

interface Ctx {
  apiUrl: string
  base: string
  token: string
  workspaceSlug: string
}

function getCtx(): Ctx | number {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  return {
    apiUrl,
    base: trimTrailingSlash(apiUrl),
    token: creds.token,
    workspaceSlug: creds.workspaceSlug,
  }
}

/** Resolve LUM-N → DB id (the dependencies endpoints take the DB id). */
async function resolveTask(
  ctx: Ctx,
  identifier: string
): Promise<ResolveResponse | number> {
  let res: Response
  try {
    res = await fetch(
      `${ctx.base}/api/tasks/resolve/${encodeURIComponent(identifier)}`,
      { headers: { Authorization: `Bearer ${ctx.token}` } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${ctx.apiUrl} (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${ctx.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('resolve', res.status))
    return 1
  }
  return (await res.json()) as ResolveResponse
}

/** Best-effort `{ error }` body extraction for non-2xx responses. */
async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

async function depsFetch(
  ctx: Ctx,
  path: string,
  init: RequestInit,
  label: string
): Promise<Response | number> {
  let res: Response
  try {
    res = await fetch(`${ctx.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${ctx.apiUrl} (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!res.ok) {
    const serverMsg = await readErrorMessage(res)
    console.error(
      serverMsg
        ? `Error: ${sanitizeField(serverMsg)}`
        : errHttp(label, res.status)
    )
    return 1
  }
  return res
}

async function fetchDeps(
  ctx: Ctx,
  taskDbId: string
): Promise<DepEdge[] | number> {
  const res = await depsFetch(
    ctx,
    `/api/tasks/${encodeURIComponent(taskDbId)}/dependencies`,
    {},
    'dependencies list'
  )
  if (typeof res === 'number') return res
  const { dependencies } = (await res.json()) as { dependencies: DepEdge[] }
  return dependencies ?? []
}

/** Selector miss: print all candidates with short ids so the user can retry. */
function printSelectorCandidates(edges: DepEdge[], selector: string): void {
  console.error(
    `Error: no unique dependency edge matches "${selector}". Candidates:`
  )
  if (edges.length === 0) {
    console.error('  (no dependency edges)')
    return
  }
  for (const e of edges) {
    console.error(
      sanitizeField(
        `  [${shortId(e.id)}] ${e.status} ${e.other.identifier} "${e.other.title}"`
      )
    )
  }
}

/**
 * Shared front half of confirm/dismiss/rm: resolve the task, fetch its edge
 * list, and resolve the selector. Returns the task + edge on success, or an
 * exit code after printing the candidate list.
 */
async function resolveTaskAndEdge(
  identifier: string,
  selector: string
): Promise<{ ctx: Ctx; task: ResolveResponse; edge: DepEdge } | number> {
  const ctx = getCtx()
  if (typeof ctx === 'number') return ctx
  const task = await resolveTask(ctx, identifier)
  if (typeof task === 'number') return task
  const edges = await fetchDeps(ctx, task.id)
  if (typeof edges === 'number') return edges
  const edge = resolveEdgeSelector(edges, selector)
  if (!edge) {
    printSelectorCandidates(edges, selector)
    return 1
  }
  return { ctx, task, edge }
}

// ---------------------------------------------------------------------------
// Command actions
// ---------------------------------------------------------------------------

/** `lumo task deps list <LUM-N>` */
export async function taskDepsList(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error('Error: usage: lumo task deps list <LUM-42>')
    return EXIT_USAGE
  }
  const ctx = getCtx()
  if (typeof ctx === 'number') return ctx
  const task = await resolveTask(ctx, identifier)
  if (typeof task === 'number') return task
  const edges = await fetchDeps(ctx, task.id)
  if (typeof edges === 'number') return edges
  // Whole-block sanitization (session-attach style): edge titles, reasons and
  // sample paths are server-controlled free text.
  console.log(sanitizeField(formatDepsList(task.identifier, edges)))
}

/** `lumo task deps add <LUM-N> --blocked-by <LUM-M>` */
export async function taskDepsAdd(
  identifier: string | undefined,
  opts: { blockedBy?: string }
): Promise<number | void> {
  if (!identifier || !opts.blockedBy) {
    console.error(
      'Error: usage: lumo task deps add <LUM-42> --blocked-by <LUM-9>'
    )
    return EXIT_USAGE
  }
  const ctx = getCtx()
  if (typeof ctx === 'number') return ctx
  const task = await resolveTask(ctx, identifier)
  if (typeof task === 'number') return task
  const res = await depsFetch(
    ctx,
    `/api/tasks/${encodeURIComponent(task.id)}/dependencies`,
    { method: 'POST', body: JSON.stringify({ blockedBy: opts.blockedBy }) },
    'dependency add'
  )
  if (typeof res === 'number') return res
  console.log(formatDepsAdded(task.identifier, opts.blockedBy))
}

/** LUM-1092: `Added dependency LUM-42 blocked by LUM-9` (was `Added: …`). */
export function formatDepsAdded(identifier: string, blockedBy: string): string {
  return successLine({
    verb: 'Added',
    kind: 'dependency',
    ref: sanitizeField(`${identifier} blocked by ${blockedBy}`),
  })
}

/** `lumo task deps confirm <LUM-N> <edge> [--reverse]` */
export async function taskDepsConfirm(
  identifier: string | undefined,
  selector: string | undefined,
  opts: { reverse?: boolean }
): Promise<number | void> {
  if (!identifier || !selector) {
    console.error(
      'Error: usage: lumo task deps confirm <LUM-42> <edge> [--reverse]'
    )
    return EXIT_USAGE
  }
  const resolved = await resolveTaskAndEdge(identifier, selector)
  if (typeof resolved === 'number') return resolved
  const { ctx, task, edge } = resolved
  const res = await depsFetch(
    ctx,
    `/api/tasks/${encodeURIComponent(task.id)}/dependencies/${encodeURIComponent(edge.id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'confirm',
        reverse: opts.reverse ?? false,
      }),
    },
    'dependency confirm'
  )
  if (typeof res === 'number') return res
  console.log(formatDepsConfirmed(task.identifier, edge, opts.reverse ?? false))
}

/** LUM-1092: `Confirmed dependency [id] LUM-42 blocked by LUM-9 "Title"`. */
export function formatDepsConfirmed(
  identifier: string,
  edge: DepEdge,
  reversed: boolean
): string {
  const dir = edge.direction === 'BLOCKED_BY' ? 'blocked by' : 'blocks'
  return successLine({
    verb: 'Confirmed',
    kind: 'dependency',
    ref: sanitizeField(
      `[${shortId(edge.id)}] ${identifier} ${dir} ${edge.other.identifier}`
    ),
    title: edge.other.title,
    ...(reversed ? { suffix: '(reversed)' } : {}),
  })
}

/** `lumo task deps dismiss <LUM-N> <edge>` */
export async function taskDepsDismiss(
  identifier: string | undefined,
  selector: string | undefined
): Promise<number | void> {
  if (!identifier || !selector) {
    console.error('Error: usage: lumo task deps dismiss <LUM-42> <edge>')
    return EXIT_USAGE
  }
  const resolved = await resolveTaskAndEdge(identifier, selector)
  if (typeof resolved === 'number') return resolved
  const { ctx, task, edge } = resolved
  const res = await depsFetch(
    ctx,
    `/api/tasks/${encodeURIComponent(task.id)}/dependencies/${encodeURIComponent(edge.id)}`,
    { method: 'PATCH', body: JSON.stringify({ action: 'dismiss' }) },
    'dependency dismiss'
  )
  if (typeof res === 'number') return res
  console.log(formatDepsDismissed(edge))
}

/** LUM-1092: `Dismissed dependency [id] LUM-38 "Title" (won't be suggested again)`. */
export function formatDepsDismissed(edge: DepEdge): string {
  return successLine({
    verb: 'Dismissed',
    kind: 'dependency',
    ref: sanitizeField(`[${shortId(edge.id)}] ${edge.other.identifier}`),
    title: edge.other.title,
    suffix: "(won't be suggested again)",
  })
}

/** The changes[] block for the `task deps rm` confirmation envelope. */
export function describeDepsRm(identifier: string, edge: DepEdge): string[] {
  const dir = edge.direction === 'BLOCKED_BY' ? 'blocked by' : 'blocks'
  return [
    sanitizeField(
      `Will delete dependency edge [${shortId(edge.id)}] from ${identifier}: ${dir} ${edge.other.identifier} "${edge.other.title}" (${edge.status}, ${edge.source})`
    ),
    'The edge row is hard-deleted; both tasks are otherwise untouched',
  ]
}

/** `lumo task deps rm <LUM-N> <edge> --confirm` */
export async function taskDepsRm(
  identifier: string | undefined,
  selector: string | undefined,
  opts: ConfirmFlags
): Promise<number | void> {
  if (!identifier || !selector) {
    console.error('Error: usage: lumo task deps rm <LUM-42> <edge> --confirm')
    return EXIT_USAGE
  }
  const resolved = await resolveTaskAndEdge(identifier, selector)
  if (typeof resolved === 'number') return resolved
  const { ctx, task, edge } = resolved
  // LUM-755: the edge is resolved first so the envelope can say exactly
  // which row would go; without --confirm nothing is sent.
  if (!isConfirmed(opts)) {
    return emitConfirmation({
      command: 'task deps rm',
      changes: describeDepsRm(task.identifier, edge),
    })
  }
  const res = await depsFetch(
    ctx,
    `/api/tasks/${encodeURIComponent(task.id)}/dependencies/${encodeURIComponent(edge.id)}`,
    { method: 'DELETE' },
    'dependency delete'
  )
  if (typeof res === 'number') return res
  console.log(formatDepsRemoved(task.identifier, edge))
}

/** LUM-1092: `Removed dependency [id] from LUM-42` (was `Removed [id] from …`). */
export function formatDepsRemoved(identifier: string, edge: DepEdge): string {
  return successLine({
    verb: 'Removed',
    kind: 'dependency',
    ref: sanitizeField(`[${shortId(edge.id)}] from ${identifier}`),
  })
}
