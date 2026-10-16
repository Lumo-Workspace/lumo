import { emptyState, fmtTimestamp } from '../lib/format'
import { sectionHeading, type LayoutOptions } from '../lib/report-layout'
import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import { colorEnabled, icons, truncate } from '../lib/ui'

/** One row of `GET /api/notifications` (the fields the CLI renders). */
export interface InboxNotification {
  id: string
  type: string
  read: boolean
  requiresAction: boolean
  actionTakenAt: string | null
  createdAt: string
  actor: { name: string } | null
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
 * the type is about, else the task (`LUM-1 Title`), else "a task".
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
  } else {
    subject = 'a task'
  }
  return `${actor} ${verb} ${subject}`
}

function itemLines(n: InboxNotification): string[] {
  const mark = n.read ? ' ' : icons.bullet
  const lines = [
    `${mark} ${fmtTimestamp(n.createdAt)}  ${notificationSentence(n)}`,
  ]
  if (n.commentPreview && n.type === 'TASK_MENTIONED') {
    lines.push(`    "${truncate(flat(n.commentPreview), 120)}"`)
  }
  return lines
}

/**
 * The inbox as text, in the web's order and sections: "Needs your response"
 * (pending actions) first, then "Other". `•` marks unread. The server already
 * sorted the rows; this only splits them.
 */
export function formatInbox(
  data: InboxResponse,
  opts: LayoutOptions = {}
): string {
  if (data.notifications.length === 0) return emptyState('notifications')
  const pending = data.notifications.filter(isPendingAction)
  const other = data.notifications.filter(n => !isPendingAction(n))
  const lines = [
    `${data.notifications.length} notification${data.notifications.length === 1 ? '' : 's'}, ${data.unreadCount} unread`,
  ]
  if (pending.length > 0) {
    lines.push(...sectionHeading('Needs your response', opts))
    for (const n of pending) lines.push(...itemLines(n))
  }
  if (other.length > 0) {
    if (pending.length > 0) lines.push(...sectionHeading('Other', opts))
    else lines.push('')
    for (const n of other) lines.push(...itemLines(n))
  }
  return lines.join('\n')
}

/** `lumo inbox list` (LUM-1192) — your notifications, read-only. */
export async function inboxList(
  opts: { json?: boolean } = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<InboxResponse>(
    ctx,
    '/api/notifications',
    {},
    'inbox list'
  )
  if (!r.ok || !r.data) return 1
  if (opts.json) {
    process.stdout.write(JSON.stringify(r.data, null, 2) + '\n')
    return
  }
  process.stdout.write(formatInbox(r.data, { color: colorEnabled() }) + '\n')
}
