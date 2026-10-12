import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { normalizeScope } from './doc-create'
import { buildTree, flattenWithDepth } from '../lib/doc-tree'
import { sanitizeField } from '../lib/sanitize'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { errHttp, errNotLoggedIn } from '../lib/errors'

export interface ListDocOptions {
  scope?: string
  project?: string
  task?: string
  limit?: string
  tree?: boolean
}

interface DocRow {
  id: string
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

const DOC_HEADER = ['ID', 'SCOPE', 'PROJECT', 'TITLE']

function docCells(row: DocRow, indent = ''): string[] {
  return [
    row.id,
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

export function formatDocListRowsAsTree(
  rows: DocRow[],
  opts: ListRenderOptions = {}
): string[] {
  if (rows.length === 0) return []
  const flat = flattenWithDepth(buildTree(rows))
  return docTableLines(
    flat.map(({ row, depth }) => docCells(row, '  '.repeat(depth))),
    opts
  )
}

export async function docList(opts: ListDocOptions): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
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

  if (opts.limit) {
    const n = parseInt(opts.limit, 10)
    if (!Number.isNaN(n)) rows = rows.slice(0, n)
  }

  const lines = opts.tree
    ? formatDocListRowsAsTree(rows)
    : formatDocListRows(rows)
  for (const line of lines) console.log(line)
}
