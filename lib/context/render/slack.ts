import { makeBudgetSection } from '@/lib/context/budget'

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

/** Render a single Slack context card body (no section heading). */
export function slackCard(c: SlackContextCard): string {
  const channelLabel = c.slackChannelName ? `#${c.slackChannelName}` : '#channel'
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
  lines.push(`  ↳ 全文: lumo task slack show ${c.id}`)
  return lines.join('\n')
}

/** One-line manifest for an overflowed Slack card. */
export function slackManifest(c: SlackContextCard): string {
  const channelLabel = c.slackChannelName ? `#${c.slackChannelName}` : '#channel'
  return `- [external:slack] ${channelLabel} — lumo task slack show ${c.id}`
}

/**
 * Render the "## Slack Context" tiered card section. Unchanged public output;
 * now composed from `slackCard`.
 */
export function renderSlackContextSection(
  contexts: SlackContextCard[]
): string {
  if (contexts.length === 0) return ''
  const lines: string[] = ['## Slack Context', '']
  for (const c of contexts) {
    lines.push(slackCard(c))
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** Budget-section wrapper for Slack contexts (LUM-147). */
export function slackBudgetSection(contexts: SlackContextCard[]) {
  return makeBudgetSection(
    '## Slack Context',
    contexts,
    slackCard,
    slackManifest
  )
}
