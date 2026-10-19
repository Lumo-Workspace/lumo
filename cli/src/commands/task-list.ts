import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import {
  emptyState,
  fmtDay,
  formatTaskListTable,
  renderTaskTable,
  type TaskRow,
} from '../lib/format'
import type { ListRenderOptions } from '../lib/list-table'
import { localDayStart } from '../lib/local-day'
import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import {
  actorNameMap,
  fetchDirectory,
  resolveAssigneeRefs,
} from '../lib/directory'
import {
  resolveMilestoneId,
  resolveProject,
  resolveSprintId,
} from '../lib/resolve'
import {
  buildCommand,
  pageFooter,
  pageJson,
  paginate,
  parsePageArgs,
  type Page,
  type PageArgs,
} from '../lib/pagination'
import {
  emitJson,
  listEnvelope,
  parseFieldList,
  pickFields,
} from '../lib/json-output'

export { formatTaskListTable } from '../lib/format'
export type { TaskRow } from '../lib/format'

/**
 * `lumo task list` (LUM-1093, LUM-1233) — the one task query. Without
 * `--assignee` it lists your tasks (unchanged since 1.126.0); `--assignee any`
 * spans the workspace and `--search` matches text, ranked and typo-tolerant
 * unless `--exact` (the old `task search`). A repeated flag ORs its values;
 * different flags AND. Every filter and the page run server-side
 * (GET /api/tasks/me).
 */

const ALLOWED_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

/** Repeatable flags arrive as arrays from Commander; tests may pass a string. */
type Many = string | string[]

export interface ListTaskOptions {
  status?: Many
  priority?: Many
  assignee?: Many
  tag?: Many
  project?: string
  milestone?: string
  sprint?: string
  team?: string
  dueAfter?: string
  dueBefore?: string
  search?: string
  exact?: boolean
  limit?: string
  cursor?: string
  json?: boolean
  fields?: string
}

const toList = (v: Many | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v]

/** Normalise a repeatable enum flag; returns the bad value on failure. */
export function normalizeEnumList(
  values: string[] | undefined,
  allowed: readonly string[]
): { ok: true; values: string[] } | { ok: false; bad: string } {
  const out: string[] = []
  for (const raw of values ?? []) {
    for (const part of raw.split(',')) {
      const v = part.trim().toUpperCase().replace(/-/g, '_')
      if (!v) continue
      if (!allowed.includes(v)) return { ok: false, bad: part.trim() }
      out.push(v)
    }
  }
  return { ok: true, values: [...new Set(out)] }
}

/**
 * The assignee scope of `--assignee` values: none given → the server's
 * default (me); `any` → every assignee (it cannot be mixed with others);
 * otherwise the refs to resolve against the directory.
 */
export function assigneeScope(
  values: string[]
):
  | { ok: true; scope: 'me' }
  | { ok: true; scope: 'any' }
  | { ok: true; scope: 'refs'; refs: string[] }
  | { ok: false; error: string } {
  const refs = values.map(v => v.trim()).filter(Boolean)
  if (refs.length === 0) return { ok: true, scope: 'me' }
  if (refs.some(r => r.toLowerCase() === 'any')) {
    return refs.length === 1
      ? { ok: true, scope: 'any' }
      : {
          ok: false,
          error:
            '--assignee any already includes every assignee; drop the other --assignee values',
        }
  }
  return { ok: true, scope: 'refs', refs }
}

/**
 * The fields `task list --json` promises (J-3) — what the skill reference
 * documents and what `--fields` may select. Every other field the server
 * returns is still emitted unchanged (J-5: only add).
 */
export const TASK_LIST_FIELDS = [
  'ref',
  'id',
  'title',
  'status',
  'priority',
  'project',
  'assignee',
  'milestone',
  'sprint',
  'tags',
  'dueDate',
  'blockedByOpenCount',
  'unblocksOpenCount',
  'createdAt',
  'updatedAt',
] as const

/**
 * Internal-only fields still emitted by bare `task list --json`, marked
 * deprecated (J-3 step 1). They are removed only in a release that bumps
 * the envelope `version`.
 */
export const TASK_LIST_DEPRECATED_FIELDS = [
  'workspaceId',
  'order',
  'viewOrder',
  'deletedAt',
  'deletedByClerkId',
  'trashRootId',
  'claimSnapshot',
  'claimSnapshotAt',
  'claimSnapshotSessionId',
  'claimSnapshotSource',
] as const

/** `ref` (e.g. LUM-42) first, then every field the server returned. */
export function taskListJsonRow(t: ListedTask): Record<string, unknown> {
  return { ref: `${t.teamIdentifier}-${t.number}`, ...t }
}

/**
 * The `task list --json` envelope: `{ version, tasks, total, nextCursor,
 * truncated, deprecatedFields }`, or only the selected fields per task with
 * `--fields`. `truncated` (LUM-1233, from the old `task search`): a fuzzy
 * `--search` hit the ranking cap, so `total` is a floor.
 */
export function taskListJson(
  page: Page<ListedTask>,
  fields?: readonly string[],
  truncated = false
): Record<string, unknown> {
  const rows = page.items.map(taskListJsonRow)
  if (fields) {
    return listEnvelope(
      'tasks',
      rows.map(r => pickFields(r, fields)),
      pageJson(page),
      { truncated }
    )
  }
  return listEnvelope('tasks', rows, pageJson(page), {
    truncated,
    deprecatedFields: [...TASK_LIST_DEPRECATED_FIELDS],
  })
}

/** A row of GET /api/tasks/me (the fields `task list` reads). */
export type ListedTask = TaskRow & {
  milestoneId?: string | null
  assigneeActorId?: string | null
  dueDate?: string | null
}

interface ListResponse {
  tasks: ListedTask[]
  /** LUM-1093 paged shape; absent from servers that predate it. */
  total?: number
  nextCursor?: string | null
  /** LUM-1233: a fuzzy `--search` hit the ranking cap; absent before 1.126.1's server. */
  truncated?: boolean
}

/** The resolved query `task list` sends. */
export interface TaskListQuery {
  statuses?: string[] | undefined
  /** Exact project name (resolved from `--project`; server-side match). */
  project?: string | undefined
  milestoneId?: string | undefined
  sprintId?: string | undefined
  priorities?: string[] | undefined
  /** `any` = every assignee; absent = the server default (me). */
  assignee?: 'any' | undefined
  assigneeActorIds?: string[] | undefined
  unassigned?: boolean | undefined
  tagIds?: string[] | undefined
  q?: string | undefined
  exact?: boolean | undefined
  dueAfter?: string | undefined
  dueBefore?: string | undefined
}

/**
 * LUM-1093 / LUM-1233: GET /api/tasks/me with every filter and the page
 * applied server-side (sending `limit` switches the route to the paged shape).
 */
export function buildTaskListPath(q: TaskListQuery, page: PageArgs): string {
  const p = new URLSearchParams()
  if (q.statuses?.length) p.set('statuses', q.statuses.join(','))
  if (q.milestoneId) p.set('milestoneIds', q.milestoneId)
  if (q.project) p.set('projectName', q.project)
  if (q.sprintId) p.set('sprintIds', q.sprintId)
  if (q.priorities?.length) p.set('priorities', q.priorities.join(','))
  if (q.assignee) p.set('assignee', q.assignee)
  if (q.assigneeActorIds?.length)
    p.set('assigneeActorIds', q.assigneeActorIds.join(','))
  if (q.unassigned) p.set('unassigned', '1')
  if (q.tagIds?.length) p.set('tagIds', q.tagIds.join(','))
  if (q.q) {
    p.set('q', q.q)
    p.set('match', q.exact ? 'exact' : 'fuzzy')
  }
  if (q.dueAfter) p.set('dueAfter', q.dueAfter)
  if (q.dueBefore) p.set('dueBefore', q.dueBefore)
  p.set('limit', String(page.limit))
  if (page.offset > 0) p.set('cursor', String(page.offset))
  return `/api/tasks/me?${p.toString()}`
}

/**
 * Whether the query uses a LUM-1233 filter a server older than it would
 * silently ignore (status / project / milestone / sprint it always had).
 */
export function usesNewFilters(q: TaskListQuery): boolean {
  return Boolean(
    q.priorities?.length ||
    q.assignee ||
    q.assigneeActorIds?.length ||
    q.unassigned ||
    q.tagIds?.length ||
    q.q ||
    q.dueAfter ||
    q.dueBefore
  )
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
  if (q.statuses?.length)
    tasks = tasks.filter(t => q.statuses!.includes(t.status))
  if (q.project) {
    const ref = q.project.toLowerCase()
    tasks = tasks.filter(t => t.project.name.toLowerCase() === ref)
  }
  if (q.milestoneId) tasks = tasks.filter(t => t.milestoneId === q.milestoneId)
  return paginate(tasks, page)
}

/** `lumo task list …` with the caller's filters (footer next-page command). */
export function taskListCommand(opts: ListTaskOptions): string {
  return buildCommand('task list', [
    ['--assignee', toList(opts.assignee)],
    ['--search', opts.search],
    ['--status', toList(opts.status)],
    ['--priority', toList(opts.priority)],
    ['--tag', toList(opts.tag)],
    ['--project', opts.project],
    ['--milestone', opts.milestone],
    ['--sprint', opts.sprint],
    ['--team', opts.team],
    ['--due-after', opts.dueAfter],
    ['--due-before', opts.dueBefore],
    ['--limit', opts.limit],
    ['--exact', opts.exact],
  ])
}

/**
 * The table plus the LUM-1093 footer when the page is not the whole list.
 * `names` (actor id → name) is set when the result can span other members
 * (`--assignee` given): the table then adds ASSIGNEE and DUE columns.
 */
export function formatTaskListPage(
  page: Page<ListedTask>,
  opts: ListTaskOptions,
  names?: Map<string, string>,
  truncated = false
): string {
  const footer = pageFooter(
    { ...page, shown: page.items.length },
    taskListCommand(opts)
  )
  const table =
    page.items.length === 0 && page.total > 0
      ? 'No tasks on this page.'
      : names
        ? formatTaskListWideTable(page.items, names)
        : formatTaskListTable(page.items)
  const lines = [table, ...footer]
  // A fuzzy --search ranks at most the server cap; `total` is then a floor.
  if (truncated)
    lines.push(`(result capped at ${page.total} — narrow the filters)`)
  return lines.join('\n')
}

/** `ref  STATUS  PRIORITY  project  assignee  due  title` (`-` = none). */
export function formatTaskListWideTable(
  tasks: ListedTask[],
  names: Map<string, string>,
  opts: ListRenderOptions = {}
): string {
  if (tasks.length === 0) return emptyState('tasks')
  return renderTaskTable(
    tasks.map(t => ({
      id: `${t.teamIdentifier}-${t.number}`,
      status: t.status,
      priority: t.priority,
      project: sanitizeField(t.project?.name ?? '-'),
      assignee: t.assigneeActorId
        ? sanitizeField(names.get(t.assigneeActorId) ?? '?')
        : '-',
      due: fmtDay(t.dueDate),
      title: sanitizeField(t.title),
    })),
    ['project', 'assignee', 'due'],
    opts
  )
}

/** Resolved query + the directory names for the wide table, or an exit code. */
async function resolveQuery(
  opts: ListTaskOptions
): Promise<
  | { ok: true; query: TaskListQuery; names?: Map<string, string> }
  | { ok: false; code: number }
> {
  const usage = (msg: string) => {
    console.error(`Error: ${msg}`)
    return { ok: false as const, code: EXIT_USAGE }
  }
  const statuses = normalizeEnumList(toList(opts.status), ALLOWED_STATUSES)
  if (!statuses.ok) {
    return usage(
      `invalid status "${statuses.bad}". Allowed: ${ALLOWED_STATUSES.map(s => s.toLowerCase()).join(', ')}`
    )
  }
  const priorities = normalizeEnumList(toList(opts.priority), PRIORITIES)
  if (!priorities.ok) {
    return usage(
      `invalid priority "${priorities.bad}". Allowed: low, medium, high, urgent`
    )
  }
  const scope = assigneeScope(toList(opts.assignee))
  if (!scope.ok) return usage(scope.error)
  const q = opts.search?.trim() || undefined
  if (opts.exact && !q) return usage('--exact only works with --search')
  // Both bounds are inclusive local days → the instant window
  // [dueAfter 00:00 local, dueBefore+1 00:00 local).
  const dueAfter =
    opts.dueAfter !== undefined ? localDayStart(opts.dueAfter) : undefined
  const dueBefore =
    opts.dueBefore !== undefined ? localDayStart(opts.dueBefore, 1) : undefined
  for (const [flag, raw, v] of [
    ['--due-after', opts.dueAfter, dueAfter],
    ['--due-before', opts.dueBefore, dueBefore],
  ] as const) {
    if (raw !== undefined && v === null) {
      return usage(`${flag} expects a valid YYYY-MM-DD date, got "${raw}"`)
    }
  }

  const ctx = apiContext()
  if (!ctx) return { ok: false, code: 1 }
  const fail = (err: unknown) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false as const, code: 1 }
  }

  const query: TaskListQuery = {
    statuses: statuses.values,
    priorities: priorities.values,
    q,
    exact: opts.exact,
    dueAfter: dueAfter ?? undefined,
    dueBefore: dueBefore ?? undefined,
  }

  // An explicit --assignee may reach other members: resolve the refs and
  // keep the directory to name the ASSIGNEE column.
  let names: Map<string, string> | undefined
  if (scope.scope !== 'me') {
    const dir = await fetchDirectory(ctx)
    if (!dir) return { ok: false, code: 1 }
    names = actorNameMap(dir)
    if (scope.scope === 'any') query.assignee = 'any'
    else {
      const creds = readCredentials()
      const r = resolveAssigneeRefs(scope.refs, dir, {
        userId: creds?.userId ?? '',
        email: creds?.email ?? '',
      })
      if (!r.ok) return fail(r.error)
      query.assigneeActorIds = r.actorIds
      query.unassigned = r.unassigned
    }
  }

  const tags = toList(opts.tag)
  if (tags.length) {
    // Look tags up read-only — /api/tags/resolve would find-or-CREATE, and a
    // list must never mint an orphan tag for a typo.
    const r = await apiCall<{ tags: Array<{ id: string; name: string }> }>(
      ctx,
      '/api/tags',
      {},
      'tag lookup'
    )
    if (!r.ok || !r.data) return { ok: false, code: 1 }
    const ids: string[] = []
    for (const name of tags) {
      const hit = r.data.tags.find(
        t => t.name.toLowerCase() === name.trim().toLowerCase()
      )
      if (!hit) return fail(`no tag named "${name}". Try \`lumo tag list\`.`)
      ids.push(hit.id)
    }
    query.tagIds = [...new Set(ids)]
  }

  try {
    if (opts.project !== undefined) {
      // Name or slug; the server matches the resolved name exactly.
      query.project = (
        await resolveProject(ctx.base, ctx.token, opts.project)
      ).name
    }
    if (opts.milestone !== undefined) {
      query.milestoneId = (
        await resolveMilestoneId(
          ctx.base,
          ctx.token,
          opts.milestone,
          opts.project
        )
      ).id
    }
    if (opts.sprint !== undefined) {
      query.sprintId = (
        await resolveSprintId(
          ctx.base,
          ctx.token,
          opts.sprint,
          opts.team,
          ctx.workspaceSlug
        )
      ).id
    }
  } catch (err) {
    return fail(err)
  }
  return { ok: true, query, ...(names ? { names } : {}) }
}

export async function taskList(opts: ListTaskOptions): Promise<number | void> {
  const pageArgs = parsePageArgs(opts.limit, opts.cursor)
  if (!pageArgs.ok) {
    console.error(`Error: ${pageArgs.error}`)
    return EXIT_USAGE
  }

  let fields: string[] | undefined
  if (opts.fields !== undefined) {
    if (!opts.json) {
      console.error('Error: --fields only works with --json')
      return EXIT_USAGE
    }
    const parsed = parseFieldList(opts.fields, TASK_LIST_FIELDS)
    if (!parsed.ok) {
      console.error(`Error: ${parsed.error}`)
      return EXIT_USAGE
    }
    fields = parsed.fields
  }

  const resolved = await resolveQuery(opts)
  if (!resolved.ok) return resolved.code
  const { query, names } = resolved

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
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
  const data = (await res.json()) as ListResponse

  // A server older than these filters ignores them and would answer with
  // the wrong set — never print that as if it were filtered.
  if (usesNewFilters(query) && typeof data.truncated !== 'boolean') {
    console.error(
      'Error: this Lumo server does not support these task list filters yet (--assignee, --priority, --tag, --search, --due-*).'
    )
    return 1
  }

  const page = pageFromResponse(data, query, pageArgs)
  const truncated = data.truncated ?? false
  if (opts.json) {
    emitJson(taskListJson(page, fields, truncated))
    return
  }
  process.stdout.write(formatTaskListPage(page, opts, names, truncated) + '\n')
}
