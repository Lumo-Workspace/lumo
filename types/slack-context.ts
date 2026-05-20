// types/slack-context.ts
export interface SlackContextMessage {
  /** Slack message timestamp, e.g. "1700000000.000100" — also serves as the per-thread id. */
  ts: string
  /** Slack user id (e.g. "U01ABC"). Always present from Slack. */
  userId: string
  /** Display name resolved from users.info. Null when the API call failed; UI falls back to `@<userId>`. */
  userName: string | null
  /** image_72 URL from users.info; null when missing. */
  userAvatarUrl: string | null
  /** Raw Slack mrkdwn — rendered by slackMrkdwn helper on the client. */
  text: string
  /** True when the source message has `edited` populated. */
  edited: boolean
  /** Optional file attachments — just enough to render a "file pill". */
  files?: Array<{
    name: string
    permalink: string
    mimeType: string
  }>
}

export interface SlackContextSnapshot {
  messages: SlackContextMessage[]
}
