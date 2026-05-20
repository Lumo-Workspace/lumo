export interface ParsedSlackPermalink {
  teamSubdomain: string
  channelId: string
  ts: string
  threadTs: string | undefined
}

const URL_REGEX =
  /^https:\/\/([a-z0-9-]+)\.slack\.com\/archives\/(C[A-Z0-9]+)\/p(\d{16,})(\?.*)?$/

/**
 * Parses a Slack permalink. Returns null when the URL is not a recognized
 * archive-style message permalink. Recognizes both single-message and
 * thread-reply formats. The presence of a `thread_ts` query parameter is
 * what makes a permalink a reply, even if the message id itself looks
 * normal — Slack does not encode "this is a reply" anywhere else.
 */
export function parseSlackPermalink(
  input: string
): ParsedSlackPermalink | null {
  const match = URL_REGEX.exec(input.trim())
  if (!match) return null

  const teamSubdomain = match[1]
  const channelId = match[2]
  const pDigits = match[3]
  const query = match[4]

  if (!teamSubdomain || !channelId || !pDigits) return null
  if (pDigits.length < 16) return null

  // p1700000000000100 -> 1700000000.000100 (insert "." 6 chars from the right)
  const ts = pDigits.slice(0, pDigits.length - 6) + '.' + pDigits.slice(-6)

  let threadTs: string | undefined
  if (query) {
    const params = new URLSearchParams(query.slice(1))
    threadTs = params.get('thread_ts') ?? undefined
  }

  return { teamSubdomain, channelId, ts, threadTs }
}
