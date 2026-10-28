/**
 * @jest-environment node
 *
 * LUM-928 — Slack notifications must not let task titles, actor names, comment
 * bodies or GitHub PR titles (external, attacker-controllable) inject mrkdwn
 * control sequences: `<!channel>` / `<!here>` mass pings, `<@U…>` mentions or
 * `<https://evil|benign text>` disguised links.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { slackIntegration: { findUnique: jest.fn() } },
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn(() => 'xoxb-test') }))
jest.mock('@/lib/integrations/slack/token', () => ({
  getSlackIntegrationToken: jest.fn(async () => ({ token: 'xoxb-test' })),
}))
jest.mock('@/lib/auth/users', () => ({
  isUserDirectoryConfigured: () => true,
  createUserDirectory: async () => ({
    getUser: async () => ({
      primaryEmailAddressId: 'em_1',
      emailAddresses: [{ id: 'em_1', emailAddress: 'dev@example.com' }],
    }),
  }),
}))

import { prisma } from '@/lib/db/prisma'
import {
  sendChannelNotification,
  sendDMNotification,
} from '@/lib/integrations/slack/notify'
import type { NotificationPayload } from '@/lib/integrations/slack/types'
import { htmlToQuote } from '@/lib/utils/htmlToPreview'

const findUnique = (
  prisma as unknown as { slackIntegration: { findUnique: jest.Mock } }
).slackIntegration.findUnique

const INJECT = '<!channel> <!here> <@U999> <https://evil.example|click> & co'
const ESCAPED =
  '&lt;!channel&gt; &lt;!here&gt; &lt;@U999&gt; &lt;https://evil.example|click&gt; &amp; co'

const payload: NotificationPayload = {
  entityIdentifier: 'LUM-<!here>',
  entityTitle: `Title ${INJECT}`,
  entityUrl: 'https://www.uselumo.ai/workspace/w/tasks/LUM-1',
  actorName: `Mallory ${INJECT}`,
  prNumber: 7,
  prTitle: `PR ${INJECT}`,
  prUrl: 'https://github.com/acme/web/pull/7',
  quote: `Hey ${INJECT}`,
}

let posted: Array<{ url: string; body: Record<string, unknown> }>

beforeEach(() => {
  posted = []
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {}
    posted.push({ url: String(url), body })
    if (String(url).includes('users.lookupByEmail'))
      return { json: async () => ({ ok: true, user: { id: 'U1' } }) }
    if (String(url).includes('conversations.open'))
      return { json: async () => ({ ok: true, channel: { id: 'D1' } }) }
    return { json: async () => ({ ok: true }) }
  }) as unknown as typeof fetch
  process.env.CLERK_SECRET_KEY = 'sk_test_dummy'
  findUnique.mockResolvedValue({
    accessToken: 'enc',
    channels: [{ channelId: 'C1' }],
  })
})

/** All mrkdwn of each posted message (sections + context), one string per message. */
function mrkdwnTexts(): string[] {
  return posted
    .filter(p => p.url.includes('chat.postMessage'))
    .map(p =>
      (p.body.blocks as Array<Record<string, unknown>>)
        .flatMap(b => {
          if (b.type === 'section') return [(b.text as { text: string }).text]
          if (b.type === 'context')
            return (b.elements as Array<{ text: string }>).map(e => e.text)
          return []
        })
        .join('\n')
    )
}

function assertNeutralised(text: string) {
  // No raw control sequence survives anywhere in the message …
  expect(text).not.toMatch(/<!channel>|<!here>|<@U999>|<https:\/\/evil/)
  // … and each injected value is still shown, escaped, as literal text.
  expect(text).toContain(`Title ${ESCAPED}`)
  expect(text).toContain(`Mallory ${ESCAPED}`)
  expect(text).toContain(`PR ${ESCAPED}`)
  expect(text).toContain('LUM-&lt;!here&gt;')
  // Exactly two links — the task title to the real task URL and the PR line
  // to the real PR URL; nothing injected becomes a third.
  const links = text.match(/<[^<>]*>/g) ?? []
  expect(links).toEqual([
    `<https://www.uselumo.ai/workspace/w/tasks/LUM-1|LUM-&lt;!here&gt; · Title ${ESCAPED}>`,
    `<https://github.com/acme/web/pull/7|#7 PR ${ESCAPED}>`,
  ])
}

describe('Slack notification mrkdwn escaping', () => {
  it('notification escapes mention and link injection in every interpolated field', async () => {
    await sendChannelNotification('ws_1', 'pr_opened', payload, 'proj_1')
    await sendDMNotification('ws_1', 'user_1', 'pr_opened', payload)

    const texts = mrkdwnTexts()
    expect(texts).toHaveLength(2)
    for (const text of texts) assertNeutralised(text)
    // Quoted text is escaped too.
    expect(texts[0]).toContain('\n> Hey &lt;!channel&gt;')
  })

  it('a PR URL cannot close the link early or add a second link', async () => {
    await sendChannelNotification(
      'ws_1',
      'pr_opened',
      {
        prNumber: 8,
        prTitle: 'ok',
        prUrl: 'https://github.com/a/b/pull/8|fake><!channel>',
      },
      'proj_1'
    )
    const [text] = mrkdwnTexts()
    expect(text).toContain(
      '<https://github.com/a/b/pull/8%7Cfake&gt;&lt;!channel&gt;|#8 ok>'
    )
    expect(text!.match(/<[^<>]*>/g)).toHaveLength(1)
  })

  it('stored comment HTML with entities is escaped exactly once', async () => {
    // What the editor stores for: Q&A: x < y  ok <!channel>
    const stored = '<p>Q&amp;A: x &lt; y&nbsp;ok &lt;!channel&gt;</p>'
    await sendChannelNotification(
      'ws_1',
      'comment_mention',
      { entityIdentifier: 'LUM-1', quote: htmlToQuote(stored) },
      'proj_1'
    )
    const [text] = mrkdwnTexts()
    expect(text).toContain('> Q&amp;A: x &lt; y ok &lt;!channel&gt;')
    expect(text).not.toContain('&amp;amp;')
    expect(text).not.toContain('&amp;lt;')
    // The decoded `<` is re-escaped: no control sequence reaches Slack.
    expect(text).not.toMatch(/<!channel>/)
  })

  it('leaves ordinary titles readable', async () => {
    await sendChannelNotification(
      'ws_1',
      'task_created',
      { entityIdentifier: 'LUM-1', entityTitle: 'Fix login — v2 "beta"' },
      'proj_1'
    )
    expect(mrkdwnTexts()[0]).toContain('LUM-1 · Fix login — v2 "beta"')
  })
})
