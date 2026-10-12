/**
 * Slack Block Kit construction layer (LUM-1094).
 *
 * Every Slack message Lumo sends is built from these helpers so that:
 * - text fields stay under Slack's per-field limits (cut with an ellipsis,
 *   never mid-escape or mid-link);
 * - every raw value a helper accepts is escaped (LUM-928) — helpers that take
 *   *mrkdwn* (`sectionBlock`, `contextBlock`, `slackMessage`) expect the
 *   caller to have escaped interpolated values with `escapeMrkdwn` already;
 * - every message carries a non-empty top-level `text` fallback, which Slack
 *   shows in push/desktop notifications and to screen readers (a blocks-only
 *   message renders there as "This content can't be displayed").
 *
 * Pure functions only — no Prisma, no network.
 */
import { escapeMrkdwn, mrkdwnLink } from './mrkdwn'

/** Slack's limit for a section block's `text`. */
export const SLACK_SECTION_TEXT_LIMIT = 3000
/** Slack's limit for a header block's `plain_text`. */
export const SLACK_HEADER_TEXT_LIMIT = 150
/** Slack's limit for a button's `plain_text` label. */
export const SLACK_BUTTON_TEXT_LIMIT = 75
/** Slack's limit on elements in one context block. */
export const SLACK_CONTEXT_ELEMENTS_LIMIT = 10
/**
 * Cap for the top-level `text` fallback. Slack accepts far more, but the
 * fallback is a notification preview — keep it to one section's worth.
 */
export const SLACK_FALLBACK_TEXT_LIMIT = SLACK_SECTION_TEXT_LIMIT

/** The single label for "open this in Lumo" buttons. */
export const OPEN_IN_LUMO_LABEL = 'Open in Lumo ↗'

const ELLIPSIS = '…'
const DEFAULT_FALLBACK_TEXT = 'New message from Lumo'

/** A Block Kit block. Kept structural — Slack validates the shape. */
export type SlackBlock = object

/** A message body: `text` is always present and non-empty. */
export interface SlackMessage {
  text: string
  blocks?: SlackBlock[]
}

/**
 * Cut `value` to at most `max` characters (code points, so emoji are never
 * split), ending in `…` when anything was removed. For plain text or for raw
 * values *before* they are escaped.
 */
export function truncate(value: string, max: number): string {
  const chars = Array.from(value)
  if (chars.length <= max) return value
  return chars.slice(0, Math.max(0, max - 1)).join('') + ELLIPSIS
}

/**
 * `truncate` for already-escaped mrkdwn: the cut point backs off so it never
 * leaves half an entity (`&am…`) or an unclosed `<…` link/control sequence.
 */
export function truncateMrkdwn(mrkdwn: string, max: number): string {
  const chars = Array.from(mrkdwn)
  if (chars.length <= max) return mrkdwn
  let cut = chars.slice(0, Math.max(0, max - 1)).join('')

  const open = cut.lastIndexOf('<')
  if (open > cut.lastIndexOf('>')) cut = cut.slice(0, open)

  const amp = cut.lastIndexOf('&')
  // Longest entity escapeMrkdwn emits is `&amp;` (5 chars).
  if (amp !== -1 && !cut.slice(amp).includes(';') && cut.length - amp < 5) {
    cut = cut.slice(0, amp)
  }
  return cut + ELLIPSIS
}

/** A mrkdwn section (text capped at 3000), with an optional accessory. */
export function sectionBlock(mrkdwn: string, accessory?: object): SlackBlock {
  const block: Record<string, unknown> = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: truncateMrkdwn(mrkdwn, SLACK_SECTION_TEXT_LIMIT),
    },
  }
  if (accessory) block.accessory = accessory
  return block
}

/**
 * A header block. `plain_text` is not parsed for mrkdwn or `<…>` control
 * sequences, so the raw value is safe as-is.
 */
export function headerBlock(plainText: string): SlackBlock {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text: truncate(plainText, SLACK_HEADER_TEXT_LIMIT),
      emoji: true,
    },
  }
}

/** A context block of small mrkdwn elements (empty ones dropped, max 10). */
export function contextBlock(mrkdwnElements: string[]): SlackBlock {
  return {
    type: 'context',
    elements: mrkdwnElements
      .filter(text => text.trim() !== '')
      .slice(0, SLACK_CONTEXT_ELEMENTS_LIMIT)
      .map(text => ({
        type: 'mrkdwn',
        text: truncateMrkdwn(text, SLACK_SECTION_TEXT_LIMIT),
      })),
  }
}

/** A URL button; the label defaults to the shared "Open in Lumo ↗". */
export function linkButton(url: string, label = OPEN_IN_LUMO_LABEL): object {
  return {
    type: 'button',
    text: {
      type: 'plain_text',
      text: truncate(label, SLACK_BUTTON_TEXT_LIMIT),
    },
    url,
  }
}

/** An actions block holding interactive elements (e.g. `linkButton`s). */
export function actionsBlock(elements: object[]): SlackBlock {
  return { type: 'actions', elements }
}

/** A mrkdwn link to a task, labelled by its identifier (both escaped). */
export function taskLink(identifier: string, url: string): string {
  return mrkdwnLink(url, identifier)
}

const STATUS_LABELS: Record<string, string> = {
  BACKLOG: '🗂️ Backlog',
  TODO: '⚪ To do',
  IN_PROGRESS: '🔵 In progress',
  IN_REVIEW: '👀 In review',
  DONE: '✅ Done',
}

const PRIORITY_LABELS: Record<string, string> = {
  URGENT: '🔴 Urgent',
  HIGH: '🟠 High',
  MEDIUM: '🟡 Medium',
  LOW: '⚪ Low',
}

/** Human-readable task status with emoji; unknown values come back escaped. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? escapeMrkdwn(status)
}

/** Human-readable task priority with emoji; unknown values come back escaped. */
export function priorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority] ?? escapeMrkdwn(priority)
}

/**
 * Assemble a message body. `text` is the notification/screen-reader fallback:
 * mrkdwn, escaped by the caller, saying the same thing as the blocks. It is
 * capped, and never sent empty.
 */
export function slackMessage(input: {
  text: string
  blocks?: SlackBlock[]
}): SlackMessage {
  const trimmed = input.text.trim()
  const text =
    trimmed === ''
      ? DEFAULT_FALLBACK_TEXT
      : truncateMrkdwn(trimmed, SLACK_FALLBACK_TEXT_LIMIT)
  return input.blocks ? { text, blocks: input.blocks } : { text }
}
