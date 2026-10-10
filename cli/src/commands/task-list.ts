import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { formatTaskListTable, type TaskRow } from '../lib/format'
import { resolveMilestoneId } from '../lib/resolve'

export { formatTaskListTable } from '../lib/format'
export type { TaskRow } from '../lib/format'

const ALLOWED_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const
type Status = (typeof ALLOWED_STATUSES)[number]

export interface ListTaskOptions {
  status?: string
  project?: string
  limit?: string
  milestone?: string
}

export function resolveTaskListEndpoint(
  base: string,
  milestoneId: string | undefined
): string {
  if (!milestoneId) return `${base}/api/tasks/me`
  return `${base}/api/milestones/${milestoneId}/tasks?assigned=me`
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

export async function taskList(opts: ListTaskOptions): Promise<number | void> {
  let statusFilter: Status | undefined
  if (opts.status !== undefined) {
    const n = normalizeStatusFilter(opts.status)
    if (!n) {
      console.error(
        `Error: invalid status "${opts.status}". Allowed: ${ALLOWED_STATUSES.map(s => s.toLowerCase()).join(', ')}`
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

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let milestoneId: string | undefined
  if (opts.milestone !== undefined) {
    try {
      const resolved = await resolveMilestoneId(
        base,
        creds.token,
        opts.milestone,
        opts.project
      )
      milestoneId = resolved.id
    } catch (err) {
      console.error(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      )
      return 1
    }
  }

  const url = resolveTaskListEndpoint(base, milestoneId)

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
