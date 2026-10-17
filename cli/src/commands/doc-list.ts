import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { normalizeScope } from './doc-create'
import { buildTree, flattenWithDepth } from '../lib/doc-tree'
import { sanitizeField } from '../lib/sanitize'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import {
  buildCommand,
  pageFooter,
  paginate,
  parsePageArgs,
} from '../lib/pagination'
import { docHandle } from '../lib/doc-handle'

export interface ListDocOptions {
  scope?: string
  project?: string
  task?: string
  limit?: string
  cursor?: string
  tree?: boolean
}

interface DocRow {
  id: string
  /** LUM-1230: printed instead of the id. */
  slug?: string | null
  title: string
  visibility: 'PRIVATE' | 'WORKSPACE' | 'SHARED'
  project: { name: string } | null
  parentId: string | null
  sortOrder: number
}

function visibilityLabel(v: DocRow['visibility'] | null | undefined): string {
  // Some routes (e.g. /api/tasks/<id>/documents) have returned rows without a
  // visibility field at runtime — fall back instead of crashing.
  if (!v) return '-'
  if (v === 'PRIVATE') return 'PERSONAL'
  return v
}

const DOC_HEADER = ['REF', 'SCOPE', 'PROJECT', 'TITLE']

function docCells(row: DocRow, indent = ''): string[] {
  return [
    // LUM-1230: the slug every doc command takes; --json keeps the id.
    docHandle(row.id, row.slug),
    visibilityLabel(row.visibility),
    sanitizeField(row.project?.name ?? '-'),
    `${indent}${sanitizeField(row.title)}`,
  ]
}

/** LUM-1089: rows as a table split into lines (header on a TTY only). */
function docTableLines(cells: string[][], opts: ListRenderOptions): string[] {
  return renderListTable(cells, { header: DOC_HEADER, flex: 3, ...opts }).split(
    '\n'
  )
}

export function formatDocListRows(
  rows: DocRow[],
  opts: ListRenderOptions = {}
): string[] {
  if (rows.length === 0) return []
  return docTableLines(
    rows.map(r => docCells(r)),
    opts
  )
}

/** Rows in tree (depth-first) order. */
export function orderAsTree(rows: DocRow[]): DocRow[] {
  return flattenWithDepth(buildTree(rows)).map(({ row }) => row)
}

/**
 * Rows as an indented tree. `context` is the whole list the rows were paged
 * from (defaults to `rows`), so a page keeps each row's real depth.
 */
export function formatDocListRowsAsTree(
  rows: DocRow[],
  opts: ListRenderOptions = {},
  context: DocRow[] = rows
): string[] {
  if (rows.length === 0) return []
  const depth = new Map(
    flattenWithDepth(buildTree(context)).map(({ row, depth: d }) => [row.id, d])
  )
  const ordered = context === rows ? orderAsTree(rows) : rows
  return docTableLines(
    ordered.map(row => docCells(row, '  '.repeat(depth.get(row.id) ?? 0))),
    opts
  )
}

export async function docList(opts: ListDocOptions): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const pageArgs = parsePageArgs(opts.limit, opts.cursor)
  if (!pageArgs.ok) {
    console.error(`Error: ${pageArgs.error}`)
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)

  let url: string
  if (opts.task) {
    url = `${trimTrailingSlash(apiUrl)}/api/tasks/${opts.task}/documents`
  } else {
    const params = new URLSearchParams()
    if (opts.scope && opts.scope.toLowerCase() !== 'all') {
      const v = normalizeScope(opts.scope)
      if (!v) {
        console.error(
          `Error: invalid scope "${opts.scope}". Allowed: personal, workspace, all`
        )
        return 1
      }
      params.set('visibility', v)
    }
    if (opts.project) params.set('projectRef', opts.project)
    const qs = params.toString()
    url = `${trimTrailingSlash(apiUrl)}/api/documents${qs ? `?${qs}` : ''}`
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(errHttp('doc list', res.status, text))
    return 1
  }
  const { documents } = (await res.json()) as { documents: DocRow[] }

  let rows = documents
  if (opts.task && opts.scope && opts.scope.toLowerCase() !== 'all') {
    const v = normalizeScope(opts.scope)
    if (v) rows = rows.filter(r => r.visibility === v)
  }
  if (opts.task && opts.project) {
    rows = rows.filter(
      r => (r.project?.name ?? '').toLowerCase() === opts.project!.toLowerCase()
    )
  }

  // LUM-1093: the routes return the whole visible list, so the page is cut
  // here — after tree ordering with --tree, so a page reads top to bottom.
  const ordered = opts.tree ? orderAsTree(rows) : rows
  const page = paginate(ordered, pageArgs)
  const lines = opts.tree
    ? formatDocListRowsAsTree(page.items, {}, ordered)
    : formatDocListRows(page.items)
  if (lines.length === 0 && page.total > 0) lines.push('No docs on this page.')
  lines.push(
    ...pageFooter(
      { ...page, shown: page.items.length },
      buildCommand('doc list', [
        ['--scope', opts.scope],
        ['--project', opts.project],
        ['--task', opts.task],
        ['--limit', opts.limit],
        ['--tree', opts.tree],
      ])
    )
  )
  for (const line of lines) console.log(line)
}
