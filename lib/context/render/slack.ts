import { shortRef } from '@/shared/src/short-ref'
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
 * Render a single Slack context card body (no section heading). `identifier` is
 * the LUM-N task identifier — the first positional of the on-demand fetch
 * command, not the cuid.
 */
export function slackCard(c: SlackContextCard, identifier: string): string {
  const channelLabel = c.slackChannelName
    ? `#${c.slackChannelName}`
    : '#channel'
  const fetchedAt =
    c.snapshotAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const meta = c.isThread
    ? `Thread (${c.snapshot.messages.length} messages, fetched ${fetchedAt})`
    : `Single message (fetched ${fetchedAt})`
  const errSuffix = c.refreshError ? ` (refresh failed: ${c.refreshError})` : ''
  // LUM-347: entry-level source attribution — this is fetched Slack content,
  // not something a teammate wrote for the agent.
  const lines: string[] = [
    `### [external:slack] ${channelLabel} · ${meta}${errSuffix}`,
  ]
  lines.push(`permalink: ${c.permalink}`)

  const summary = c.summary?.trim()
  if (summary) {
    lines.push(summary)
  } else {
    for (const m of c.snapshot.messages.slice(0, FALLBACK_MESSAGE_COUNT)) {
      const author = m.userName ?? `@${m.userId}`
      lines.push(`- ${author}: ${plainText(m.text)}`)
    }
  }
  lines.push(
    `  ↳ full text: lumo task slack show ${identifier} ${shortRef(c.id)}`
  )
  return lines.join('\n')
}

/**
 * Truncate a one-line descriptor to keep a manifest line short and decision-
 * useful. Collapses internal whitespace, then clips at `max` chars with an
 * ellipsis. Returns "" for empty/whitespace-only input.
 */
function truncateDescriptor(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length === 0) return ''
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * One-line manifest for a Tier-2 Slack card (LUM-500): channel + a short
 * snippet of the summary so an agent can decide whether to pull, plus the
 * retrieval hint. Falls back to channel-only when there is no summary.
 *
 * `identifier` is the human task id (e.g. "LUM-42") — emitted as the first
 * positional of the `lumo task slack show` hint so an agent can run it verbatim.
 */
export function slackManifest(c: SlackContextCard, identifier: string): string {
  const channelLabel = c.slackChannelName
    ? `#${c.slackChannelName}`
    : '#channel'
  const snippet = truncateDescriptor(c.summary ?? '')
  const descriptor = snippet ? `${channelLabel} — ${snippet}` : channelLabel
  return `- [external:slack] ${descriptor} → lumo task slack show ${identifier} ${shortRef(c.id)}`
}

/**
 * Render the "## Slack Context" tiered card section. Unchanged public output;
 * now composed from `slackCard`.
 */
export function renderSlackContextSection(
  contexts: SlackContextCard[],
  identifier: string
): string {
  if (contexts.length === 0) return ''
  const lines: string[] = ['## Slack Context', '']
  for (const c of contexts) {
    lines.push(slackCard(c, identifier))
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
