import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { formatTaskListTable, type TaskRow } from '../lib/format'
import { resolveMilestoneId } from '../lib/resolve'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import {
  buildCommand,
  pageFooter,
  pageJson,
  paginate,
  parsePageArgs,
  type Page,
  type PageArgs,
} from '../lib/pagination'

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
  cursor?: string
  milestone?: string
  json?: boolean
}

/** A row of GET /api/tasks/me (the fields `task list` reads). */
export type ListedTask = TaskRow & { milestoneId?: string | null }

interface ListResponse {
  tasks: ListedTask[]
  /** LUM-1093 paged shape; absent from servers that predate it. */
  total?: number
  nextCursor?: string | null
}

export interface TaskListQuery {
  status?: Status | undefined
  project?: string | undefined
  milestoneId?: string | undefined
}

/**
 * LUM-1093: GET /api/tasks/me with every filter and the page applied
 * server-side (sending `limit` switches the route to the paged shape).
 */
export function buildTaskListPath(q: TaskListQuery, page: PageArgs): string {
  const p = new URLSearchParams()
  if (q.status) p.set('statuses', q.status)
  if (q.milestoneId) p.set('milestoneIds', q.milestoneId)
  if (q.project) p.set('projectName', q.project)
  p.set('limit', String(page.limit))
  if (page.offset > 0) p.set('cursor', String(page.offset))
  return `/api/tasks/me?${p.toString()}`
}

/**
 * The page to print. A server that already paged (has `total`) is trusted
 * as-is; an older server returned every assigned task, so the filters and the
 * page are applied here instead.
 */
export function pageFromResponse(
  data: ListResponse,
  q: TaskListQuery,
  page: PageArgs
): Page<ListedTask> {
  if (typeof data.total === 'number') {
    return {
      items: data.tasks,
      total: data.total,
      offset: page.offset,
      nextCursor: data.nextCursor ?? null,
    }
  }
  let tasks = data.tasks
  if (q.status) tasks = tasks.filter(t => t.status === q.status)
  if (q.project) {
    const ref = q.project.toLowerCase()
    tasks = tasks.filter(t => t.project.name.toLowerCase() === ref)
  }
  if (q.milestoneId) tasks = tasks.filter(t => t.milestoneId === q.milestoneId)
  return paginate(tasks, page)
}

function normalizeStatusFilter(value: string): Status | null {
  if (!value) return null
  const upper = value.toUpperCase().replace(/-/g, '_')
  return (ALLOWED_STATUSES as readonly string[]).includes(upper)
    ? (upper as Status)
    : null
}

/** The table plus the LUM-1093 footer when the page is not the whole list. */
export function formatTaskListPage(
  page: Page<TaskRow>,
  opts: ListTaskOptions
): string {
  const footer = pageFooter(
    { ...page, shown: page.items.length },
    buildCommand('task list', [
      ['--status', opts.status],
      ['--project', opts.project],
      ['--milestone', opts.milestone],
      ['--limit', opts.limit],
    ])
  )
  const table =
    page.items.length === 0 && page.total > 0
      ? 'No tasks on this page.'
      : formatTaskListTable(page.items)
  return [table, ...footer].join('\n')
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

  const pageArgs = parsePageArgs(opts.limit, opts.cursor)
  if (!pageArgs.ok) {
    console.error(`Error: ${pageArgs.error}`)
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
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

  const query: TaskListQuery = {
    status: statusFilter,
    project: opts.project,
    milestoneId,
  }

  let res: Response
  try {
    res = await fetch(`${base}${buildTaskListPath(query, pageArgs)}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('task list', res.status))
    return 1
  }

  const page = pageFromResponse(
    (await res.json()) as ListResponse,
    query,
    pageArgs
  )
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ tasks: page.items, ...pageJson(page) }, null, 2) + '\n'
    )
    return
  }
  process.stdout.write(formatTaskListPage(page, opts) + '\n')
}
