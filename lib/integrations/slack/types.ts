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

export interface NotificationPayload {
  taskId?: string
  taskTitle?: string
  taskIdentifier?: string // e.g. "ENG-123"
  taskUrl?: string // full URL to task in Lumo
  actorName?: string // display name of who triggered the event
  prNumber?: number
  prTitle?: string
  prUrl?: string
  commentBody?: string
}

// Input: the raw text after "@Lumo " or "/lumo "
// Returns: Slack Block Kit blocks array OR a plain string message. A blocks
// reply always carries `text` too — the escaped notification/screen-reader
// fallback (LUM-1094).
//
// `visibility` (LUM-1096) is decided per reply: errors, usage hints and help
// are `ephemeral` (only the invoking user sees them); results the channel
// benefits from are `in_channel`.
export type CommandVisibility = 'in_channel' | 'ephemeral'

export type CommandResult =
  | {
      type: 'blocks'
      blocks: object[]
      text: string
      visibility: CommandVisibility
    }
  | { type: 'text'; text: string; visibility: CommandVisibility }

/**
 * Error `code` an API returns when the stored Slack token lacks a scope the
 * action needs (installs made before the scope was requested — LUM-1080). The
 * UI answers it with a "Reconnect Slack" action instead of a bare failure.
 */
export const SLACK_RECONNECT_REQUIRED = 'SLACK_RECONNECT_REQUIRED'
