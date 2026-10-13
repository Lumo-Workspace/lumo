/**
 * Posting a command reply back to Slack (LUM-1096).
 *
 * - Slash command (`/lumo`): POST to the `response_url`, with
 *   `response_type` taken from the reply's visibility — `ephemeral` replies
 *   are seen only by the user who ran the command.
 * - Mention (`@Lumo`): a public reply is posted in the mention's thread. An
 *   ephemeral reply goes through `chat.postEphemeral` (same `chat:write` bot
 *   scope as `chat.postMessage`). If Slack refuses it (user_not_in_channel,
 *   rate limit, Slack Connect…), the reply goes to the user's DM
 *   (`conversations.open`, `im:write` — already in the install's scopes);
 *   if that fails too it is only logged. A private reply is NEVER downgraded
 *   to a thread reply everyone can see (LUM-1115).
 */
import { logger } from '@/lib/logger'
import { slackMessage, type SlackMessage } from './blocks'
import type { CommandResult } from './types'

const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage'
const POST_EPHEMERAL_URL = 'https://slack.com/api/chat.postEphemeral'
const CONVERSATIONS_OPEN_URL = 'https://slack.com/api/conversations.open'

/** The message body (text fallback always present, LUM-1094). */
export function commandMessage(result: CommandResult): SlackMessage {
  return slackMessage(
    result.type === 'blocks'
      ? { text: result.text, blocks: result.blocks }
      : { text: result.text }
  )
}

/** The JSON body for a slash command's `response_url`. */
export function slashCommandReplyBody(result: CommandResult) {
  return { ...commandMessage(result), response_type: result.visibility }
}

export interface MentionContext {
  channel: string
  /** The Slack user who mentioned Lumo (needed for an ephemeral reply). */
  user: string
  /** `event.thread_ts ?? event.ts` — the thread the reply belongs in. */
  threadTs?: string | undefined
}

/**
 * The Slack API call that answers a mention, or `null` for an ephemeral
 * reply with no known user — it cannot be shown privately, and is never
 * turned into a public one.
 */
export function mentionReplyRequest(
  result: CommandResult,
  ctx: MentionContext
): { url: string; body: Record<string, unknown> } | null {
  const thread = ctx.threadTs ? { thread_ts: ctx.threadTs } : {}
  const message = commandMessage(result)
  if (result.visibility === 'ephemeral') {
    if (!ctx.user) return null
    return {
      url: POST_EPHEMERAL_URL,
      body: { channel: ctx.channel, user: ctx.user, ...thread, ...message },
    }
  }
  return {
    url: POST_MESSAGE_URL,
    body: { channel: ctx.channel, ...thread, ...message },
  }
}

/**
 * POST a Slack Web API call. Success means HTTP 2xx *and* `{ ok: true }` —
 * Slack reports most failures as `200 { ok: false, error }`, and a body that
 * is not JSON is a failure too. Network errors are caught and logged; this
 * never throws. Returns the parsed body on success, `null` on failure.
 */
async function callSlack(
  token: string,
  url: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    let data: { ok?: boolean; error?: string } = {}
    try {
      data = (await res.json()) as { ok?: boolean; error?: string }
    } catch {
      // non-JSON body: treated as a failure below
    }
    if (res.ok && data.ok === true) return data as Record<string, unknown>
    logger.warn('[slack command] Slack rejected the reply', {
      url,
      status: res.status,
      error: data.error ?? null,
    })
    return null
  } catch (error) {
    logger.error('[slack command] could not reach Slack', { url, error })
    return null
  }
}

/** The DM channel id with `user`, or `null` if Slack will not open one. */
async function openDm(token: string, user: string): Promise<string | null> {
  const data = await callSlack(token, CONVERSATIONS_OPEN_URL, { users: user })
  const channel = data?.channel as { id?: unknown } | undefined
  return typeof channel?.id === 'string' ? channel.id : null
}

/**
 * Answer a mention. A private (ephemeral) reply Slack refuses goes to the
 * user's DM instead; if that fails too it is only logged — never posted to
 * the channel (LUM-1115). Never throws.
 */
export async function sendMentionReply(
  token: string,
  result: CommandResult,
  ctx: MentionContext
): Promise<void> {
  const req = mentionReplyRequest(result, ctx)
  if (!req) {
    logger.warn('[slack command] private reply not delivered: no user', {
      channel: ctx.channel,
    })
    return
  }
  const sent = await callSlack(token, req.url, req.body)
  if (sent || req.url !== POST_EPHEMERAL_URL) return

  const dm = await openDm(token, ctx.user)
  if (
    dm &&
    (await callSlack(token, POST_MESSAGE_URL, {
      channel: dm,
      ...commandMessage(result),
    }))
  ) {
    return
  }
  logger.warn('[slack command] private reply not delivered', {
    channel: ctx.channel,
    user: ctx.user,
  })
}

/**
 * Answer a slash command through its `response_url`. Never throws: the
 * response_url is single-use and expires, so a failure is logged, not retried.
 */
export async function sendSlashCommandReply(
  responseUrl: string,
  result: CommandResult
): Promise<void> {
  try {
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slashCommandReplyBody(result)),
    })
    if (!res.ok) {
      logger.warn('[slack command] response_url rejected the reply', {
        status: res.status,
      })
    }
  } catch (error) {
    logger.error('[slack command] could not reach response_url', { error })
  }
}
