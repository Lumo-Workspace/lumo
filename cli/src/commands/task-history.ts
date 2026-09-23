import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import { actorNameMap, fetchDirectory } from '../lib/directory'
import { resolveTaskRef } from '../lib/comment-ref'
import { localDayLabel } from '../lib/local-day'

/**
 * `lumo task history <LUM-N> [--limit N]` (LUM-821) — the task's field-change
 * log (Jira changelog / Linear issue history): status, priority, title,
 * assignee, due date, parent, tags, sprint… from the activity timeline,
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
  v === null || v === undefined || v === ''
    ? '(none)'
    : sanitizeField(String(v))

/** One activity → a short human line. Unknown types fall back to the type name. */
export function describeActivity(
  a: ActivityEntry,
  names: Map<string, string>
): string {
  const p = a.payload ?? {}
  const who = (id: unknown) =>
    typeof id === 'string'
      ? sanitizeField(names.get(id) ?? 'unknown')
      : '(none)'
  const day = (v: unknown) =>
    typeof v === 'string' ? localDayLabel(v) : '(none)'
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
    case 'PARENT_CHANGED':
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

/** `YYYY-MM-DD HH:MM  actor  change` rows, oldest first. */
export function formatHistory(
  entries: ActivityEntry[],
  names: Map<string, string>
): string {
  if (entries.length === 0) return 'No history.'
  const rows = entries.map(a => {
    const d = new Date(a.createdAt)
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return {
      when: `${localDayLabel(a.createdAt)} ${hhmm}`,
      actor: a.actorId
        ? sanitizeField(names.get(a.actorId) ?? 'unknown')
        : 'system',
      change: describeActivity(a, names),
    }
  })
  const aw = Math.max(...rows.map(r => r.actor.length))
  return rows
    .map(r => `${r.when}  ${r.actor.padEnd(aw)}  ${r.change}`)
    .join('\n')
}

export async function taskHistory(
  identifier: string,
  opts: { limit?: string; json?: boolean } = {}
): Promise<number | void> {
  const limit = opts.limit !== undefined ? parseInt(opts.limit, 10) : 30
  if (Number.isNaN(limit) || limit < 1) {
    console.error(
      `Error: invalid --limit "${opts.limit}" (expected a positive integer)`
    )
    return 1
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
  const shown = activities.slice(-limit)
  if (opts.json) {
    process.stdout.write(JSON.stringify(shown, null, 2) + '\n')
    return
  }
  const dir = await fetchDirectory(ctx)
  const names = dir ? actorNameMap(dir) : new Map<string, string>()
  process.stdout.write(`${task.identifier} history (oldest first)\n`)
  process.stdout.write(formatHistory(shown, names) + '\n')
  if (activities.length > shown.length) {
    process.stdout.write(
      `(${activities.length - shown.length} earlier entries hidden — raise --limit)\n`
    )
  }
}
