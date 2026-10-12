/**
 * Posting a command reply back to Slack (LUM-1096).
 *
 * - Slash command (`/lumo`): POST to the `response_url`, with
 *   `response_type` taken from the reply's visibility — `ephemeral` replies
 *   are seen only by the user who ran the command.
 * - Mention (`@Lumo`): always answered in the mention's thread. An ephemeral
 *   reply goes through `chat.postEphemeral` (same `chat:write` bot scope as
 *   `chat.postMessage`, so no new scope); if Slack refuses it, the reply falls
 *   back to a normal thread reply so the user is never left without one.
 */
import { logger } from '@/lib/logger'
import { slackMessage, type SlackMessage } from './blocks'
import type { CommandResult } from './types'

const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage'
const POST_EPHEMERAL_URL = 'https://slack.com/api/chat.postEphemeral'

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

/** The Slack API call that answers a mention. */
export function mentionReplyRequest(
  result: CommandResult,
  ctx: MentionContext
): { url: string; body: Record<string, unknown> } {
  const thread = ctx.threadTs ? { thread_ts: ctx.threadTs } : {}
  const message = commandMessage(result)
  if (result.visibility === 'ephemeral' && ctx.user) {
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
 * never throws.
 */
async function postToSlack(
  token: string,
  url: string,
  body: Record<string, unknown>
): Promise<boolean> {
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
    if (res.ok && data.ok === true) return true
    logger.warn('[slack command] Slack rejected the reply', {
      url,
      status: res.status,
      error: data.error ?? null,
    })
    return false
  } catch (error) {
    logger.error('[slack command] could not reach Slack', { url, error })
    return false
  }
}

/**
 * Answer a mention; an ephemeral reply Slack refuses (or that fails) becomes
 * a thread reply. Never throws — failures are logged.
 */
export async function sendMentionReply(
  token: string,
  result: CommandResult,
  ctx: MentionContext
): Promise<void> {
  const req = mentionReplyRequest(result, ctx)
  const ok = await postToSlack(token, req.url, req.body)
  if (ok || req.url !== POST_EPHEMERAL_URL) return
  const fallback = mentionReplyRequest(
    { ...result, visibility: 'in_channel' },
    ctx
  )
  await postToSlack(token, fallback.url, fallback.body)
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
