import { createHmac, timingSafeEqual } from 'crypto'

/** Requests older than this are rejected to block replays (Slack's own advice). */
const MAX_REQUEST_AGE_SEC = 300

/**
 * Verify a Slack request signature (`x-slack-signature`, v0 HMAC-SHA256 over
 * `v0:<timestamp>:<raw body>`). Must be run on the raw body, before any
 * parsing — the signature covers the exact bytes Slack sent.
 */
export function verifySlackSignature(
  body: string,
  signature: string,
  timestamp: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!secret || !signature || !/^\d+$/.test(timestamp)) return false
  // Both directions: a stale request is a replay, a far-future one could be
  // replayed later.
  if (Math.abs(nowSec - parseInt(timestamp, 10)) > MAX_REQUEST_AGE_SEC)
    return false

  const expected =
    'v0=' +
    createHmac('sha256', secret)
      .update(`v0:${timestamp}:${body}`, 'utf8')
      .digest('hex')

  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export type SlackRequestPayload = Record<string, unknown>

/**
 * Parse a (signature-verified) Slack request body by its Content-Type
 * (LUM-1080):
 *   - `application/x-www-form-urlencoded` — slash commands send their fields
 *     (`command`, `text`, `response_url`, `team_id`, …) form-encoded;
 *     interactive requests send one `payload=<json>` field, which is unwrapped.
 *   - anything else — JSON (Events API, `url_verification`).
 * Returns null for a body that does not parse.
 */
export function parseSlackRequestBody(
  rawBody: string,
  contentType: string | null
): SlackRequestPayload | null {
  const mediaType = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
  try {
    if (mediaType === 'application/x-www-form-urlencoded') {
      const form = new URLSearchParams(rawBody)
      const interactive = form.get('payload')
      if (interactive !== null) return asObject(JSON.parse(interactive))
      return Object.fromEntries(form.entries())
    }
    return asObject(JSON.parse(rawBody))
  } catch {
    return null
  }
}

function asObject(value: unknown): SlackRequestPayload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as SlackRequestPayload)
    : null
}

/**
 * A slash command's `response_url` must be Slack's own webhook host before
 * Lumo POSTs a reply to it — defense in depth on top of the signature check.
 */
export function isSlackResponseUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'hooks.slack.com'
  } catch {
    return false
  }
}
