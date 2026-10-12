/**
 * Slack notification messages (LUM-1095), built on the LUM-1094 Block Kit
 * layer. Every message has:
 * - a header naming the event — in a DM it speaks to the recipient
 *   ("You were assigned a task"), in a channel it describes the event;
 * - the entity title as a link (task identifier · title, or the document /
 *   project / milestone name);
 * - who did it, and — for mentions — what kind of place the mention was in;
 * - an optional quote that keeps its paragraphs, every line quoted;
 * - an "Open in Lumo" button (plus "View PR" for PR events);
 * - a `text` fallback saying the same thing in one line.
 *
 * LUM-928: every interpolated value is user- or GitHub-controlled and goes
 * through `escapeMrkdwn` / `mrkdwnLink`. Nobody is `<@U…>`-mentioned: names
 * are shown as text only.
 *
 * Pure functions only — no Prisma, no network.
 */
import { escapeMrkdwn, mrkdwnLink } from './mrkdwn'
import {
  SlackBlock,
  SlackMessage,
  actionsBlock,
  contextBlock,
  headerBlock,
  linkButton,
  sectionBlock,
  slackMessage,
  truncate,
} from './blocks'
import type {
  MentionSurface,
  NotificationAudience,
  NotificationEntityKind,
  NotificationPayload,
  SlackEventType,
} from './types'

/** Longest quote shown, in characters (before escaping). */
export const NOTIFICATION_QUOTE_LIMIT = 500
/** Most lines a quote keeps. */
export const NOTIFICATION_QUOTE_LINES = 8

export const VIEW_PR_LABEL = 'View PR ↗'

const EMOJI: Record<SlackEventType, string> = {
  task_created: '🆕',
  task_assigned: '👤',
  task_in_review: '🔍',
  task_done: '✅',
  task_sent_back: '↩️',
  pr_opened: '🔀',
  pr_merged: '🎉',
  comment_mention: '💬',
}

const ENTITY_EMOJI: Record<NotificationEntityKind, string> = {
  task: '',
  document: '📄',
  project: '📁',
  milestone: '🏁',
}

/** Channel headline per event (comment_mention is built from its carrier). */
const CHANNEL_HEADLINE: Record<
  Exclude<SlackEventType, 'comment_mention'>,
  string
> = {
  task_created: 'Task created',
  task_assigned: 'Task assigned',
  task_in_review: 'Task ready for review',
  task_done: 'Task done',
  task_sent_back: 'Task sent back',
  pr_opened: 'PR opened',
  pr_merged: 'PR merged',
}

/** DM headline per event, addressed to the recipient. */
const DM_HEADLINE: Record<
  Exclude<SlackEventType, 'comment_mention'>,
  string
> = {
  task_created: 'A new task was created',
  task_assigned: 'You were assigned a task',
  task_in_review: 'A task in your project is ready for review',
  task_done: 'Your task was marked done',
  task_sent_back: 'Your task was sent back',
  pr_opened: 'A PR was opened in your project',
  pr_merged: 'A PR on your task was merged',
}

/**
 * Where a mention was written, e.g. "a task comment", "a project description",
 * "a document". Descriptions of the entity itself vs comments on it.
 */
export function mentionPlace(
  kind: NotificationEntityKind,
  surface: MentionSurface
): string {
  if (surface === 'comment') {
    return kind === 'document' ? 'a document comment' : `a ${kind} comment`
  }
  return kind === 'document' ? 'a document' : `a ${kind} description`
}

/**
 * The header line (plain text — Slack does not parse it, so raw names are
 * safe here).
 */
export function notificationHeadline(
  event: SlackEventType,
  payload: NotificationPayload,
  audience: NotificationAudience
): string {
  if (event !== 'comment_mention') {
    return audience === 'dm' ? DM_HEADLINE[event] : CHANNEL_HEADLINE[event]
  }
  const place = mentionPlace(
    payload.entityKind ?? 'task',
    payload.mentionSurface ?? 'comment'
  )
  const actor = payload.actorName?.trim()
  if (audience === 'dm') {
    return actor
      ? `${actor} mentioned you in ${place}`
      : `You were mentioned in ${place}`
  }
  return `Mention in ${place}`
}

/** "ENG-12 · Title", the document/project/milestone name, or ''. Raw text. */
function entityLabel(payload: NotificationPayload): string {
  const title = payload.entityTitle?.trim() ?? ''
  const id = payload.entityIdentifier?.trim() ?? ''
  if (id && title) return `${id} · ${title}`
  return id || title
}

/** Bold entity title, linked when a URL is known. Escaped mrkdwn. */
function entityLine(payload: NotificationPayload, label: string): string {
  const emoji = ENTITY_EMOJI[payload.entityKind ?? 'task']
  const linked = payload.entityUrl
    ? mrkdwnLink(payload.entityUrl, label)
    : escapeMrkdwn(label)
  return `${emoji ? `${emoji} ` : ''}*${linked}*`
}

function prLabel(payload: NotificationPayload): string | null {
  if (!payload.prTitle && payload.prNumber === undefined) return null
  const num = payload.prNumber !== undefined ? `#${payload.prNumber}` : ''
  return [num, payload.prTitle ?? ''].filter(Boolean).join(' ')
}

/**
 * Quote plain text as mrkdwn: cut once (with an ellipsis) to
 * `NOTIFICATION_QUOTE_LIMIT` characters / `NOTIFICATION_QUOTE_LINES` lines,
 * escape, and prefix *every* line with `>` so paragraphs stay quoted.
 */
export function quoteMrkdwn(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (normalized === '') return ''

  let lines = normalized.split('\n')
  let cut = false
  if (lines.length > NOTIFICATION_QUOTE_LINES) {
    lines = lines.slice(0, NOTIFICATION_QUOTE_LINES)
    cut = true
  }
  let body = lines.join('\n')
  const truncated = truncate(body, NOTIFICATION_QUOTE_LIMIT)
  if (truncated !== body) {
    body = truncated
  } else if (cut) {
    body = `${body.trimEnd()}…`
  }

  return body
    .split('\n')
    .map(line => (line === '' ? '>' : `> ${escapeMrkdwn(line)}`))
    .join('\n')
}

function namesList(names: string[]): string {
  return names.map(n => `*${escapeMrkdwn(n)}*`).join(', ')
}

/**
 * Build a notification message for a channel post or a DM. The `text`
 * fallback is one line: "<emoji> <headline>: <entity> — by <actor> — PR …".
 */
export function buildNotificationMessage(
  event: SlackEventType,
  payload: NotificationPayload,
  audience: NotificationAudience
): SlackMessage {
  const emoji = EMOJI[event]
  const headline = notificationHeadline(event, payload, audience)
  const label = entityLabel(payload)
  const pr = prLabel(payload)
  const actor = payload.actorName?.trim() || null
  const mentioned = (payload.mentionedNames ?? []).filter(n => n.trim() !== '')

  const blocks: SlackBlock[] = [headerBlock(`${emoji} ${headline}`)]

  const main: string[] = []
  if (label) main.push(entityLine(payload, label))
  if (pr) {
    main.push(
      payload.prUrl
        ? `🔀 ${mrkdwnLink(payload.prUrl, pr)}`
        : `🔀 ${escapeMrkdwn(pr)}`
    )
  }
  if (main.length > 0) blocks.push(sectionBlock(main.join('\n')))

  const quote = payload.quote ? quoteMrkdwn(payload.quote) : ''
  if (quote) blocks.push(sectionBlock(quote))

  const context: string[] = []
  if (actor) context.push(`by *${escapeMrkdwn(actor)}*`)
  if (
    event === 'comment_mention' &&
    audience === 'channel' &&
    mentioned.length
  ) {
    context.push(`mentioned ${namesList(mentioned)}`)
  }
  if (context.length > 0) blocks.push(contextBlock([context.join(' · ')]))

  const buttons: object[] = []
  if (payload.entityUrl) buttons.push(linkButton(payload.entityUrl))
  if (payload.prUrl) buttons.push(linkButton(payload.prUrl, VIEW_PR_LABEL))
  if (buttons.length > 0) blocks.push(actionsBlock(buttons))

  let fallback = `${emoji} ${escapeMrkdwn(headline)}`
  if (label) fallback += `: ${escapeMrkdwn(label)}`
  if (actor && !(event === 'comment_mention' && audience === 'dm')) {
    fallback += ` — by ${escapeMrkdwn(actor)}`
  }
  if (pr) fallback += ` — PR ${escapeMrkdwn(pr)}`

  return slackMessage({ text: fallback, blocks })
}
