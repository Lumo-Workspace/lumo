import { EXIT_USAGE } from '../lib/exit-codes'
import { emitJson, listEnvelope } from '../lib/json-output'
import { NONE, emptyState, fmtDay, fmtTimestamp } from '../lib/format'
import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import { actorNameMap, fetchDirectory } from '../lib/directory'
import { resolveTaskRef } from '../lib/comment-ref'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { colorEnabled, terminalWidth } from '../lib/ui'
import { shellQuote } from '../lib/confirmation'
import {
  buildCommand,
  pageFooter,
  parsePageArgs,
  type PageArgs,
} from '../lib/pagination'

/**
 * `lumo task history <LUM-N> [--limit N] [--cursor C]` (LUM-821) — the task's field-change
 * log (Jira changelog / Linear issue history): status, priority, title,
 * assignee, due date, tags, sprint… from the activity timeline,
 * oldest first. Comments are left to `task comments list`.
 */

export interface ActivityEntry {
  id: string
  kind: 'activity' | 'comment'
  type?: string
  createdAt: string
  actorId?: string | null
  payload?: Record<string, unknown> | null
}

interface TimelinePage {
  items: ActivityEntry[]
  hasMore: boolean
  nextCursor: string | null
}

const PAGE = 100
const MAX_PAGES = 10

const str = (v: unknown): string =>
  v === null || v === undefined || v === '' ? NONE : sanitizeField(String(v))

/** One activity → a short human line. Unknown types fall back to the type name. */
export function describeActivity(
  a: ActivityEntry,
  names: Map<string, string>
): string {
  const p = a.payload ?? {}
  const who = (id: unknown) =>
    typeof id === 'string' ? sanitizeField(names.get(id) ?? NONE) : NONE
  const day = (v: unknown) => (typeof v === 'string' ? fmtDay(v) : NONE)
  switch (a.type) {
    case 'STATUS_CHANGED':
      return `status ${str(p.from)} → ${str(p.to)}`
    case 'PRIORITY_CHANGED':
      return `priority ${str(p.from)} → ${str(p.to)}`
    case 'TITLE_CHANGED':
      return `title "${str(p.from)}" → "${str(p.to)}"`
    case 'DESCRIPTION_CHANGED':
      return 'description edited'
    case 'DUE_DATE_CHANGED':
      return `due ${day(p.from)} → ${day(p.to)}`
    case 'ASSIGNEE_CHANGED':
      return `assignee ${who(p.fromActorId)} → ${who(p.toActorId)}`
    case 'PARENT_CHANGED': // pre-LUM-959 rows only — subtasks were removed
      return p.toTaskId ? 'parent set' : 'parent cleared'
    case 'TAGS_CHANGED': {
      const list = (v: unknown) =>
        Array.isArray(v) ? v.map(x => sanitizeField(String(x))) : []
      const parts = [
        ...list(p.added).map(t => `+${t}`),
        ...list(p.removed).map(t => `-${t}`),
      ]
      return `tags ${parts.join(' ') || '(no change)'}`
    }
    case 'SPRINT_CHANGED':
      return p.toSprintId ? 'moved into a sprint' : 'removed from its sprint'
    case 'CREATED':
      return 'created'
    default:
      return (a.type ?? 'activity').toLowerCase().replace(/_/g, ' ')
  }
}

/**
 * `YYYY-MM-DD HH:MM  actor  change` rows, oldest first — the LUM-1089 list
 * table (LUM-1090): a WHEN / ACTOR / CHANGE header on a TTY only, the change
 * cut to the terminal width there; piped output stays headerless and whole.
 */
export function formatHistory(
  entries: ActivityEntry[],
  names: Map<string, string>,
  opts: ListRenderOptions = {}
): string {
  if (entries.length === 0) return emptyState('history')
  const rows = entries.map(a => {
    return [
      fmtTimestamp(a.createdAt, { tty: opts.tty }),
      a.actorId ? sanitizeField(names.get(a.actorId) ?? NONE) : 'system',
      describeActivity(a, names),
    ]
  })
  return renderListTable(rows, {
    header: ['WHEN', 'ACTOR', 'CHANGE'],
    flex: 2,
    ...opts,
  })
}

/**
 * LUM-1093: history pages from the newest end — the first page is the latest
 * `limit` entries, and the cursor counts how many newest entries the next
 * (earlier) page skips. Rows stay oldest first within a page.
 */
export function historyPage(
  all: ActivityEntry[],
  page: PageArgs
): {
  items: ActivityEntry[]
  total: number
  offset: number
  first: number
  nextCursor: string | null
} {
  const end = Math.max(0, all.length - page.offset)
  const start = Math.max(0, end - page.limit)
  const items = all.slice(start, end)
  return {
    items,
    total: all.length,
    offset: page.offset,
    first: start + 1,
    nextCursor: start > 0 ? String(page.offset + items.length) : null,
  }
}

export async function taskHistory(
  identifier: string,
  opts: { limit?: string; cursor?: string; json?: boolean } = {}
): Promise<number | void> {
  const pageArgs = parsePageArgs(opts.limit, opts.cursor)
  if (!pageArgs.ok) {
    console.error(`Error: ${pageArgs.error}`)
    return EXIT_USAGE
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const task = await resolveTaskRef(ctx, identifier)
  if (!task) return 1

  // The timeline pages oldest-first; walk it (bounded) and keep the tail.
  const activities: ActivityEntry[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = `limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const r: { ok: boolean; data?: TimelinePage } = await apiCall<TimelinePage>(
      ctx,
      `/api/tasks/${encodeURIComponent(task.id)}/timeline?${qs}`,
      {},
      'task history'
    )
    if (!r.ok || !r.data) return 1
    activities.push(...r.data.items.filter(i => i.kind === 'activity'))
    if (!r.data.hasMore || !r.data.nextCursor) break
    cursor = r.data.nextCursor
  }
  const page = historyPage(activities, pageArgs)
  if (opts.json) {
    // Batch C: the former bare array is wrapped once (release notes);
    // `total` / `nextCursor` drive --limit / --cursor paging.
    emitJson(
      listEnvelope('entries', page.items, {
        total: page.total,
        nextCursor: page.nextCursor,
      })
    )
    return
  }
  const dir = await fetchDirectory(ctx)
  const names = dir ? actorNameMap(dir) : new Map<string, string>()
  const lines = [
    `${task.identifier} history (oldest first)`,
    page.items.length === 0 && page.total > 0
      ? 'No entries on this page.'
      : // TTY → WHEN/ACTOR/CHANGE header + change cut to the terminal
        // width; piped → headerless, whole rows (LUM-1089 / LUM-1090).
        formatHistory(page.items, names, {
          tty: Boolean(process.stdout.isTTY),
          width: terminalWidth(),
          color: colorEnabled(),
        }),
    ...pageFooter(
      { ...page, shown: page.items.length },
      buildCommand(
        `task history ${shellQuote(sanitizeField(task.identifier))}`,
        [['--limit', opts.limit]]
      )
    ),
  ]
  process.stdout.write(lines.join('\n') + '\n')
}
