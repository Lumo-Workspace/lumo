/**
 * @jest-environment node
 *
 * LUM-1095 — the sender resolves the actor (and, in channel posts, the people
 * a mention named) from Clerk IDs to display names, posts different wording
 * to a channel and a DM, and never `<@U…>`-pings anyone.
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
const NAMES: Record<string, string> = {
  user_ada: 'Ada Lovelace',
  user_bob: 'Bob',
}
const mockGetClerkUser = jest.fn(async (id: string) => ({
  name: NAMES[id] ?? 'Unknown',
  email: '',
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  getClerkUser: (id: string) => mockGetClerkUser(id),
}))

import { prisma } from '@/lib/db/prisma'
import {
  sendChannelNotification,
  sendDMNotification,
} from '@/lib/integrations/slack/notify'

const findUnique = (
  prisma as unknown as { slackIntegration: { findUnique: jest.Mock } }
).slackIntegration.findUnique

let posted: Array<{ url: string; body: Record<string, unknown> }>

beforeEach(() => {
  jest.clearAllMocks()
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
  findUnique.mockResolvedValue({
    accessToken: 'enc',
    channels: [{ channelId: 'C1' }],
  })
})

function messages() {
  return posted.filter(p => p.url.includes('chat.postMessage')).map(p => p.body)
}

const payload = {
  entityKind: 'task' as const,
  entityTitle: 'Fix login',
  entityIdentifier: 'LUM-1',
  entityUrl: 'https://lumo.test/t/LUM-1',
  actorClerkId: 'user_ada',
  mentionedClerkIds: ['user_bob', 'user_gone'],
  mentionSurface: 'comment' as const,
  quote: 'hey @Bob',
}

describe('notification names and audiences', () => {
  it('channel post resolves actor and mentioned names, without pings', async () => {
    await sendChannelNotification('ws_1', 'comment_mention', payload, 'proj_1')
    const [msg] = messages()
    const json = JSON.stringify(msg)
    expect(json).toContain('Mention in a task comment')
    expect(json).toContain('by *Ada Lovelace* · mentioned *Bob*')
    expect(json).not.toContain('Unknown')
    expect(json).not.toMatch(/<@U|<!/)
    expect(msg!.text).toContain('by Ada Lovelace')
  })

  it('DM speaks to the recipient and skips mentioned-name lookups', async () => {
    await sendDMNotification('ws_1', 'user_bob', 'comment_mention', payload)
    const [msg] = messages()
    const json = JSON.stringify(msg)
    expect(json).toContain('Ada Lovelace mentioned you in a task comment')
    expect(json).not.toContain('mentioned *Bob*')
    expect(json).not.toMatch(/<@U|<!/)
    expect(mockGetClerkUser.mock.calls.map(c => c[0])).toEqual(['user_ada'])
  })

  it('a given actorName wins over the Clerk lookup', async () => {
    await sendChannelNotification(
      'ws_1',
      'task_assigned',
      { ...payload, actorName: 'octocat (GitHub)' },
      'proj_1'
    )
    expect(JSON.stringify(messages()[0])).toContain('by *octocat (GitHub)*')
    expect(mockGetClerkUser).not.toHaveBeenCalledWith('user_ada')
  })

  it('a failed actor lookup just leaves the actor out', async () => {
    await sendChannelNotification(
      'ws_1',
      'task_done',
      { ...payload, actorClerkId: 'user_gone' },
      'proj_1'
    )
    const [msg] = messages()
    expect(JSON.stringify(msg)).not.toContain('by *')
    expect(msg!.text).toBe('✅ Task done: LUM-1 · Fix login')
  })
})
