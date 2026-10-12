export type SlackEventType =
  | 'task_created'
  | 'task_assigned'
  | 'task_in_review'
  | 'task_done'
  | 'task_sent_back'
  | 'pr_opened'
  | 'pr_merged'
  | 'comment_mention'

export const ALL_SLACK_EVENTS: SlackEventType[] = [
  'task_created',
  'task_assigned',
  'task_in_review',
  'task_done',
  'task_sent_back',
  'pr_opened',
  'pr_merged',
  'comment_mention',
]

export const SLACK_EVENT_LABELS: Record<SlackEventType, string> = {
  task_created: 'Task created',
  task_assigned: 'Task assigned',
  task_in_review: 'Task in review',
  task_done: 'Task done',
  task_sent_back: 'Task sent back',
  pr_opened: 'PR opened',
  pr_merged: 'PR merged',
  comment_mention: 'Comment mention',
}

/** What a notification is about — drives the title line and mention label. */
export type NotificationEntityKind =
  | 'task'
  | 'document'
  | 'project'
  | 'milestone'

/**
 * Where an @-mention was written: a comment thread, or the entity's own body
 * (task/project/milestone description, document content).
 */
export type MentionSurface = 'comment' | 'content'

/**
 * Who a message is for. A DM speaks to its recipient ("You were assigned…");
 * a channel post describes the event to everyone.
 */
export type NotificationAudience = 'channel' | 'dm'

export interface NotificationPayload {
  /** Defaults to 'task'. */
  entityKind?: NotificationEntityKind | undefined
  entityId?: string | undefined
  entityTitle?: string | undefined
  /** Tasks only, e.g. "ENG-123". */
  entityIdentifier?: string | undefined
  /** Full URL to the entity in Lumo. */
  entityUrl?: string | undefined
  /** Display name of who triggered the event. */
  actorName?: string | undefined
  /**
   * Clerk ID of who triggered the event; the sender resolves it to
   * `actorName` when no name is given. Never rendered.
   */
  actorClerkId?: string | undefined
  /**
   * Clerk IDs of the people a mention named (channel posts list their names;
   * nobody is `<@…>`-pinged). Never rendered.
   */
  mentionedClerkIds?: string[] | undefined
  /** Resolved display names for `mentionedClerkIds`. */
  mentionedNames?: string[] | undefined
  /** comment_mention only. Defaults to 'comment'. */
  mentionSurface?: MentionSurface | undefined
  prNumber?: number | undefined
  prTitle?: string | undefined
  prUrl?: string | undefined
  /** Plain text to quote; paragraphs separated by newlines. */
  quote?: string | undefined
}

// Input: the raw text after "@Lumo " or "/lumo "
// Returns: Slack Block Kit blocks array OR a plain string message. A blocks
// reply always carries `text` too — the escaped notification/screen-reader
// fallback (LUM-1094).
export type CommandResult =
  | { type: 'blocks'; blocks: object[]; text: string }
  | { type: 'text'; text: string }

/**
 * Error `code` an API returns when the stored Slack token lacks a scope the
 * action needs (installs made before the scope was requested — LUM-1080). The
 * UI answers it with a "Reconnect Slack" action instead of a bare failure.
 */
export const SLACK_RECONNECT_REQUIRED = 'SLACK_RECONNECT_REQUIRED'
