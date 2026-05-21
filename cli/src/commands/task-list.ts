import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

const ALLOWED_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const
type Status = (typeof ALLOWED_STATUSES)[number]

export interface ListTaskOptions {
  status?: string
  project?: string
  limit?: string
}

interface TaskRow {
  id: string
  number: number
  title: string
  status: string
  priority: string
  teamIdentifier: string
  project: { id: string; name: string }
}

interface ListResponse {
  tasks: TaskRow[]
}

function normalizeStatusFilter(value: string): Status | null {
  if (!value) return null
  const upper = value.toUpperCase().replace(/-/g, '_')
  return (ALLOWED_STATUSES as readonly string[]).includes(upper)
    ? (upper as Status)
    : null
}

/**
 * Render the task list as a fixed-width table. Each row:
 *   LUM-42  IN_PROGRESS  HIGH    project-name   Title here
 * Columns are right-padded to the widest cell in the result set so output
 * lines up regardless of identifier or project-name length.
 */
export function formatTaskListTable(tasks: TaskRow[]): string {
  if (tasks.length === 0) return 'No tasks.'
  const rows = tasks.map(t => ({
    identifier: `${t.teamIdentifier}-${t.number}`,
    status: t.status,
    priority: t.priority,
    project: t.project.name,
    title: t.title,
  }))
  const widths = {
    identifier: Math.max(...rows.map(r => r.identifier.length)),
    status: Math.max(...rows.map(r => r.status.length)),
    priority: Math.max(...rows.map(r => r.priority.length)),
    project: Math.max(...rows.map(r => r.project.length)),
  }
  return rows
    .map(
      r =>
        `${r.identifier.padEnd(widths.identifier)}  ` +
        `${r.status.padEnd(widths.status)}  ` +
        `${r.priority.padEnd(widths.priority)}  ` +
        `${r.project.padEnd(widths.project)}  ` +
        r.title
    )
    .join('\n')
}

export async function taskList(opts: ListTaskOptions): Promise<number | void> {
  let statusFilter: Status | undefined
  if (opts.status !== undefined) {
    const n = normalizeStatusFilter(opts.status)
    if (!n) {
      console.error(
        `Error: invalid status "${opts.status}". Allowed: todo, in_progress, in_review, done`
      )
      return 1
    }
    statusFilter = n
  }

  const limit = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    console.error(
      `Error: invalid --limit "${opts.limit}" (expected a positive integer)`
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
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/me`

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
  if (!res.ok) {
    console.error(`Error: task list failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as ListResponse

  // Server returns the full assigned-to-me set. Filters are client-side
  // because /api/tasks/me doesn't accept status/project query params yet
  // — when it does, switch to query params and drop this filter block.
  let tasks = data.tasks
  if (statusFilter) tasks = tasks.filter(t => t.status === statusFilter)
  if (opts.project) {
    const ref = opts.project.toLowerCase()
    tasks = tasks.filter(t => t.project.name.toLowerCase() === ref)
  }
  if (limit !== undefined) tasks = tasks.slice(0, limit)

  process.stdout.write(formatTaskListTable(tasks) + '\n')
}
