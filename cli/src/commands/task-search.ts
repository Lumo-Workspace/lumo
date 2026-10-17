import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { shellQuote } from '../lib/confirmation'
import { sanitizeField } from '../lib/sanitize'
import { emptyState, fmtDay, renderTaskTable } from '../lib/format'
import type { ListRenderOptions } from '../lib/list-table'
import { localDayStart } from '../lib/local-day'
import { apiCall, apiContext } from '../lib/test-case-api'
import {
  actorNameMap,
  fetchDirectory,
  resolveAssigneeRefs,
} from '../lib/directory'
import {
  resolveMilestoneId,
  resolveProjectId,
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

/**
 * `lumo task search [query]` — workspace-wide task query (LUM-821), the CLI
 * counterpart of Jira JQL search / Linear `list_issues`. Unlike `task list`
 * (my tasks only) it spans every member; every filter is applied server-side
 * by GET /api/tasks/workspace. With a query, results are typo-tolerant and
 * ranked by relevance unless `--exact`.
 */

const STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

export interface TaskSearchOptions {
  assignee?: string[]
  tag?: string[]
  status?: string[]
  priority?: string[]
  project?: string
  milestone?: string
  sprint?: string
  team?: string
  dueBefore?: string
  dueAfter?: string
  limit?: string
  cursor?: string
  json?: boolean
  /** LUM-821: substring-only matching, board order (no typo tolerance). */
  exact?: boolean
}

export interface SearchTaskRow {
  number: number
  title: string
  status: string
  priority: string
  teamIdentifier: string
  dueDate: string | null
  assigneeActorId: string | null
  project?: { id: string; name: string } | null
}

interface SearchResponse {
  tasks: SearchTaskRow[]
  /** The server cap was hit (legacy shape, and fuzzy queries when paged). */
  truncated?: boolean
  /** LUM-1093 paged shape. */
  total?: number
  nextCursor?: string | null
}

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

/** Build the /api/tasks/workspace query string from resolved filters. */
export function buildSearchQuery(f: {
  q?: string | undefined
  statuses: string[]
  priorities: string[]
  assigneeActorIds: string[]
  unassigned: boolean
  tagIds: string[]
  projectIds: string[]
  milestoneIds: string[]
  sprintIds: string[]
  dueAfter?: string | undefined
  dueBefore?: string | undefined
  exact?: boolean | undefined
  /** LUM-1093: the page to fetch (server-side paging). */
  page?: PageArgs | undefined
}): string {
  const p = new URLSearchParams()
  if (f.q) {
    p.set('q', f.q)
    p.set('match', f.exact ? 'exact' : 'fuzzy')
  }
  const lists: Array<[string, string[]]> = [
    ['statuses', f.statuses],
    ['priorities', f.priorities],
    ['assigneeActorIds', f.assigneeActorIds],
    ['tagIds', f.tagIds],
    ['projectIds', f.projectIds],
    ['milestoneIds', f.milestoneIds],
    ['sprintIds', f.sprintIds],
  ]
  for (const [k, v] of lists) if (v.length) p.set(k, v.join(','))
  if (f.unassigned) p.set('unassigned', '1')
  if (f.dueAfter) p.set('dueAfter', f.dueAfter)
  if (f.dueBefore) p.set('dueBefore', f.dueBefore)
  if (f.page) {
    p.set('limit', String(f.page.limit))
    if (f.page.offset > 0) p.set('cursor', String(f.page.offset))
  }
  const qs = p.toString()
  return `/api/tasks/workspace${qs ? `?${qs}` : ''}`
}

/**
 * Render rows as `LUM-42  STATUS  PRIORITY  project  assignee  due  title`
 * through the shared task table (LUM-1089).
 */
export function formatSearchTable(
  tasks: SearchTaskRow[],
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

export async function taskSearch(
  query: string | undefined,
  opts: TaskSearchOptions
): Promise<number | void> {
  const statuses = normalizeEnumList(opts.status, STATUSES)
  if (!statuses.ok) {
    console.error(
      `Error: invalid status "${statuses.bad}". Allowed: ${STATUSES.map(s => s.toLowerCase()).join(', ')}`
    )
    return EXIT_USAGE
  }
  const priorities = normalizeEnumList(opts.priority, PRIORITIES)
  if (!priorities.ok) {
    console.error(
      `Error: invalid priority "${priorities.bad}". Allowed: low, medium, high, urgent`
    )
    return EXIT_USAGE
  }
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
      console.error(
        `Error: ${flag} expects a valid YYYY-MM-DD date, got "${raw}"`
      )
      return 1
    }
  }
  const pageArgs = parsePageArgs(opts.limit, opts.cursor)
  if (!pageArgs.ok) {
    console.error(`Error: ${pageArgs.error}`)
    return EXIT_USAGE
  }

  const ctx = apiContext()
  if (!ctx) return 1
  const creds = readCredentials()

  // The directory is needed both to resolve --assignee and to name the
  // assignee column, so fetch it once up front.
  const dir = await fetchDirectory(ctx)
  if (!dir) return 1

  let assigneeActorIds: string[] = []
  let unassigned = false
  if (opts.assignee?.length) {
    const r = resolveAssigneeRefs(opts.assignee, dir, {
      userId: creds?.userId ?? '',
      email: creds?.email ?? '',
    })
    if (!r.ok) {
      console.error(`Error: ${r.error}`)
      return 1
    }
    assigneeActorIds = r.actorIds
    unassigned = r.unassigned
  }

  let tagIds: string[] = []
  if (opts.tag?.length) {
    // Look tags up read-only — /api/tags/resolve would find-or-CREATE, and a
    // search must never mint an orphan tag for a typo.
    const r = await apiCall<{ tags: Array<{ id: string; name: string }> }>(
      ctx,
      '/api/tags',
      {},
      'tag lookup'
    )
    if (!r.ok || !r.data) return 1
    for (const name of opts.tag) {
      const hit = r.data.tags.find(
        t => t.name.toLowerCase() === name.trim().toLowerCase()
      )
      if (!hit) {
        console.error(`Error: no tag named "${name}". Try \`lumo tag list\`.`)
        return 1
      }
      tagIds.push(hit.id)
    }
    tagIds = [...new Set(tagIds)]
  }

  let projectIds: string[] = []
  let milestoneIds: string[] = []
  let sprintIds: string[] = []
  try {
    if (opts.milestone !== undefined) {
      const m = await resolveMilestoneId(
        ctx.base,
        ctx.token,
        opts.milestone,
        opts.project
      )
      milestoneIds = [m.id]
    }
    if (opts.project !== undefined) {
      projectIds = [await resolveProjectId(ctx.base, ctx.token, opts.project)]
    }
    if (opts.sprint !== undefined) {
      const s = await resolveSprintId(
        ctx.base,
        ctx.token,
        opts.sprint,
        opts.team,
        ctx.workspaceSlug
      )
      sprintIds = [s.id]
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const path = buildSearchQuery({
    q: query?.trim() || undefined,
    statuses: statuses.values,
    priorities: priorities.values,
    assigneeActorIds,
    unassigned,
    tagIds,
    projectIds,
    milestoneIds,
    sprintIds,
    dueAfter: dueAfter ?? undefined,
    dueBefore: dueBefore ?? undefined,
    exact: opts.exact,
    page: pageArgs,
  })
  const r = await apiCall<SearchResponse>(ctx, path, {}, 'task search')
  if (!r.ok || !r.data) return 1

  const page = searchPage(r.data, pageArgs)
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          tasks: page.items,
          truncated: r.data.truncated ?? false,
          ...pageJson(page),
        },
        null,
        2
      ) + '\n'
    )
    return
  }
  const lines = [formatSearchTable(page.items, actorNameMap(dir))]
  lines.push(
    ...pageFooter(
      { ...page, shown: page.items.length },
      searchCommand(query, opts)
    )
  )
  if (r.data.truncated) {
    // Paged servers report the capped match count in `total`; the legacy
    // shape only had the (capped) list itself.
    const capped = r.data.total ?? r.data.tasks.length
    lines.push(`(result capped at ${capped} — narrow the filters)`)
  }
  process.stdout.write(lines.join('\n') + '\n')
}

/**
 * The page to print: a paging server's answer as-is, or — for a server that
 * predates LUM-1093 and returned its whole capped list — sliced here.
 */
export function searchPage(
  data: SearchResponse,
  page: PageArgs
): Page<SearchTaskRow> {
  if (typeof data.total === 'number') {
    return {
      items: data.tasks,
      total: data.total,
      offset: page.offset,
      nextCursor: data.nextCursor ?? null,
    }
  }
  return paginate(data.tasks, page)
}

/** `lumo task search …` with the caller's filters (footer next-page command). */
export function searchCommand(
  query: string | undefined,
  opts: TaskSearchOptions
): string {
  const q = query?.trim()
  const base = q ? `task search ${shellQuote(sanitizeField(q))}` : 'task search'
  return buildCommand(base, [
    ['--assignee', opts.assignee],
    ['--tag', opts.tag],
    ['--status', opts.status],
    ['--priority', opts.priority],
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
