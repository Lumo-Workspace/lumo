import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { normalizeScope } from './doc-create'
import { buildTree, flattenWithDepth } from '../lib/doc-tree'

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

function visibilityLabel(v: DocRow['visibility']): string {
  if (v === 'PRIVATE') return 'PERSONAL'
  return v
}

export function formatDocListRows(rows: DocRow[]): string[] {
  if (rows.length === 0) return []
  return rows.map(r => {
    const label = visibilityLabel(r.visibility).padEnd(10, ' ')
    const project = (r.project?.name ?? '-').padEnd(14, ' ')
    return `${r.id}  ${label}  ${project}  ${r.title}`
  })
}

export function formatDocListRowsAsTree(rows: DocRow[]): string[] {
  if (rows.length === 0) return []
  const tree = buildTree(rows)
  const flat = flattenWithDepth(tree)
  return flat.map(({ row, depth }) => {
    const label = visibilityLabel(row.visibility).padEnd(10, ' ')
    const project = (row.project?.name ?? '-').padEnd(14, ' ')
    const indent = '  '.repeat(depth)
    return `${row.id}  ${label}  ${project}  ${indent}${row.title}`
  })
}

export async function docList(opts: ListDocOptions): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl

  let url: string
  if (opts.task) {
    url = `${trimTrailingSlash(apiUrl)}/api/tasks/${opts.task}/documents`
  } else {
    const params = new URLSearchParams()
    if (opts.scope && opts.scope !== 'all') {
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
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }
  const { documents } = (await res.json()) as { documents: DocRow[] }

  let rows = documents
  if (opts.task && opts.scope && opts.scope !== 'all') {
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
