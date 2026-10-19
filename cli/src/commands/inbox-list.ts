import { emptyState, fmtTimestamp } from '../lib/format'
import { sectionHeading, type LayoutOptions } from '../lib/report-layout'
import { sanitizeField } from '../lib/sanitize'
import { icons, truncate } from '../lib/ui'

/** One row of `GET /api/notifications` (the fields the CLI renders). */
export interface InboxNotification {
  id: string
  type: string
  read: boolean
  requiresAction: boolean
  actionTakenAt: string | null
  createdAt: string
  actor: { name: string } | null
  /** Set even when the task row is gone (then `task` is null). */
  taskId?: string | null
  task: { title: string; number: number; teamIdentifier: string } | null
  sprint: { name: string } | null
  project: { name: string } | null
  milestone: { name: string } | null
  document: { title: string } | null
  commentPreview: string | null
}

export interface InboxResponse {
  notifications: InboxNotification[]
  unreadCount: number
}

/** The web inbox's verbs (NotificationItem), English. */
const VERB: Record<string, string> = {
  TASK_IN_REVIEW: 'submitted for review',
  TASK_SENT_BACK: 'sent back to In Progress',
  TASK_ASSIGNED: 'assigned you to',
  TASK_MENTIONED: 'mentioned you in',
  TASK_DONE: 'marked as done',
  TASK_SPEC_READY: 'generated a spec draft for',
  AGENT_CLARIFY: 'has a question about',
  AGENT_AUTHORIZE: 'needs your approval for',
  AGENT_VERIFY: 'completed work on',
  AGENT_FAILED: 'failed on',
  AGENT_DONE: 'finished work on',
  SPRINT_STARTED: 'started sprint',
  SPRINT_CLOSED: 'closed sprint',
  PROJECT_MENTIONED: 'mentioned you in',
  MILESTONE_MENTIONED: 'mentioned you in',
  DOCUMENT_MENTIONED: 'mentioned you in',
  DOCUMENT_COMMENT_MENTIONED: 'mentioned you in a comment on',
}

/** Same predicate as the web inbox: asks for a response not yet given. */
export function isPendingAction(n: InboxNotification): boolean {
  return n.requiresAction && n.actionTakenAt === null
}

const flat = (s: string) => sanitizeField(s).replace(/\s+/g, ' ').trim()

/**
 * `<actor> <verb> <subject>` — the web inbox sentence: the actor falls back
 * to "Lumo AI", the subject is the sprint / project / milestone / document
 * the type is about, else the task (`LUM-1 Title`), else "a deleted task"
 * when the notification names a task that no longer exists, else "a task".
 */
export function notificationSentence(n: InboxNotification): string {
  const actor = n.actor ? flat(n.actor.name) : 'Lumo AI'
  const verb = VERB[n.type] ?? 'sent you an update on'
  let subject: string
  if (n.type === 'SPRINT_STARTED' || n.type === 'SPRINT_CLOSED') {
    subject = n.sprint ? flat(n.sprint.name) : 'a sprint'
  } else if (n.type === 'PROJECT_MENTIONED' && n.project) {
    subject = flat(n.project.name)
  } else if (n.type === 'MILESTONE_MENTIONED' && n.milestone) {
    subject = flat(n.milestone.name)
  } else if (
    (n.type === 'DOCUMENT_MENTIONED' ||
      n.type === 'DOCUMENT_COMMENT_MENTIONED') &&
    n.document
  ) {
    subject = flat(n.document.title)
  } else if (n.task) {
    subject = `${n.task.teamIdentifier}-${n.task.number} ${flat(n.task.title)}`
  } else if (n.taskId) {
    // LUM-1232 G3: the server batch-loads tasks without a deletion filter, so
    // a taskId with no task means the task row is gone — say so instead of a
    // bare "a task" that reads like missing data.
    subject = 'a deleted task'
  } else {
    subject = 'a task'
  }
  return `${actor} ${verb} ${subject}`
}

function itemLines(n: InboxNotification, tty?: boolean): string[] {
  const mark = n.read ? ' ' : icons.bullet
  const lines = [
    `${mark} ${fmtTimestamp(n.createdAt, { tty })}  ${notificationSentence(n)}`,
  ]
  if (n.commentPreview && n.type === 'TASK_MENTIONED') {
    lines.push(`    "${truncate(flat(n.commentPreview), 120)}"`)
  }
  return lines
}

/**
 * What the inbox shows (LUM-1233): `unread` — the default of `lumo status` —
 * or `all` (`--all`), read ones included.
 */
export type InboxFilter = 'unread' | 'all'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The first line of the inbox: how many rows, how many unread. Pure. */
function inboxSummary(data: InboxResponse, filter: InboxFilter): string {
  const n = data.notifications.length
  if (filter === 'all')
    return `${plural(n, 'notification')}, ${data.unreadCount} unread`
  // At the cap older unread ones may exist: say the count is a floor.
  return n >= INBOX_SERVER_CAP
    ? `${n}+ unread notifications (newest ${n} shown)`
    : `${data.unreadCount} unread notification${data.unreadCount === 1 ? '' : 's'}`
}

/**
 * The inbox as text, in the web's order and sections: "Needs your response"
 * (pending actions) first, then "Other". `•` marks unread. The server already
 * sorted (and, for `unread`, filtered) the rows; this only splits them.
 */
export function formatInbox(
  data: InboxResponse,
  opts: LayoutOptions = {},
  filter: InboxFilter = 'all'
): string {
  if (data.notifications.length === 0)
    return filter === 'unread'
      ? emptyState('unread notifications')
      : emptyState('notifications')
  const pending = data.notifications.filter(isPendingAction)
  const other = data.notifications.filter(n => !isPendingAction(n))
  const lines = [inboxSummary(data, filter)]
  if (pending.length > 0) {
    lines.push(...sectionHeading('Needs your response', opts))
    for (const n of pending) lines.push(...itemLines(n, opts.tty))
  }
  if (other.length > 0) {
    if (pending.length > 0) lines.push(...sectionHeading('Other', opts))
    else lines.push('')
    for (const n of other) lines.push(...itemLines(n, opts.tty))
  }
  return lines.join('\n')
}

/** The server returns at most this many notifications, newest first. */
export const INBOX_SERVER_CAP = 50

/**
 * `total` / `nextCursor` for the inbox envelope (J-2). The notifications API
 * has no paging — it returns the newest INBOX_SERVER_CAP rows — so
 * `nextCursor` is always null, and `total` is the row count, or null
 * (unknown) when the cap was reached and older rows may exist.
 */
export function inboxPage(data: InboxResponse): {
  total: number | null
  nextCursor: null
} {
  const n = data.notifications.length
  return { total: n < INBOX_SERVER_CAP ? n : null, nextCursor: null }
}

/**
 * The inbox a `lumo status` section shows (LUM-1233). `unread` keeps only the
 * unread rows: the CLI asks the server for `unread=1`, and a server that
 * predates the parameter returns read rows too — they are dropped here, not
 * reported as an error. `total` is the row count shown, or null when the
 * server returned its cap and older rows may exist. Pure.
 */
export function inboxView(
  raw: InboxResponse,
  filter: InboxFilter
): { data: InboxResponse; total: number | null } {
  const notifications =
    filter === 'unread'
      ? raw.notifications.filter(n => !n.read)
      : raw.notifications
  const capped = inboxPage(raw).total === null
  return {
    data: { ...raw, notifications },
    total: capped ? null : notifications.length,
  }
}
