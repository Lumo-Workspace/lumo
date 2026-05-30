/**
 * Strip Slack mrkdwn tokens that would confuse the agent. Local to the slack
 * renderer — the only consumer of Slack message text.
 */
function plainText(text: string): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)>/g, '@$1')
    .replace(/<#[CG][A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<#[CG][A-Z0-9]+>/g, '#channel')
}

export interface SlackContextCard {
  id: string
  isThread: boolean
  slackChannelName: string | null
  permalink: string
  snapshotAt: Date
  refreshError: string | null
  summary: string | null
  snapshot: {
    messages: Array<{
      ts: string
      userName: string | null
      userId: string
      text: string
    }>
  }
}

const FALLBACK_MESSAGE_COUNT = 3

/**
 * Render the "## Slack Context" tiered card section.
 *
 * Each context becomes a cheap card: channel + metadata heading, the cached
 * one-line `summary` (or, when not yet generated, the first few messages as a
 * fallback), and the retrieval command for the full stored thread. The full
 * thread is no longer inlined — agents fetch it on demand.
 */
export function renderSlackContextSection(
  contexts: SlackContextCard[]
): string {
  if (contexts.length === 0) return ''

  const lines: string[] = ['## Slack Context', '']

  for (const c of contexts) {
    const channelLabel = c.slackChannelName
      ? `#${c.slackChannelName}`
      : '#channel'
    const fetchedAt =
      c.snapshotAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    const meta = c.isThread
      ? `Thread (${c.snapshot.messages.length} messages, fetched ${fetchedAt})`
      : `Single message (fetched ${fetchedAt})`
    const errSuffix = c.refreshError
      ? ` (refresh failed: ${c.refreshError})`
      : ''
    lines.push(`### ${channelLabel} · ${meta}${errSuffix}`)
    lines.push(`permalink: ${c.permalink}`)

    const summary = c.summary?.trim()
    if (summary) {
      lines.push(summary)
    } else {
      // Fallback: no summary cached yet → show first few messages, truncated,
      // so the card still carries signal.
      for (const m of c.snapshot.messages.slice(0, FALLBACK_MESSAGE_COUNT)) {
        const author = m.userName ?? `@${m.userId}`
        lines.push(`- ${author}: ${plainText(m.text)}`)
      }
    }

    lines.push(`  ↳ 全文: lumo task slack show ${c.id}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
