/**
 * @jest-environment node
 *
 * LUM-1094 — every Slack message Lumo builds carries a non-empty top-level
 * `text` fallback (push/desktop notifications and screen readers show it; a
 * blocks-only message renders as "This content can't be displayed"). The
 * fallback is escaped like the blocks and says the same thing.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    slackIntegration: { findUnique: jest.fn() },
    workspaceMember: { findMany: jest.fn() },
    team: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
    task: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  },
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
jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn(async () => 'actor_1'),
}))
const mockCreateWithSequence = jest.fn()
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    createWithSequence: (...a: unknown[]) => mockCreateWithSequence(...a),
  },
}))

import { prisma } from '@/lib/db/prisma'
import {
  sendChannelNotification,
  sendDMNotification,
} from '@/lib/integrations/slack/notify'
import { handleCommand } from '@/lib/integrations/slack/commands'
import { ALL_SLACK_EVENTS } from '@/lib/integrations/slack/types'

const p = prisma as unknown as {
  slackIntegration: { findUnique: jest.Mock }
  workspaceMember: { findMany: jest.Mock }
  team: { findFirst: jest.Mock }
  project: { findFirst: jest.Mock }
  task: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock }
}

const INJECT = '<!channel> <https://evil.example|ok> & co'
const ESCAPED = '&lt;!channel&gt; &lt;https://evil.example|ok&gt; &amp; co'

let posted: Array<{ url: string; body: Record<string, unknown> }>

beforeEach(() => {
  jest.clearAllMocks()
  posted = []
  process.env.NEXT_PUBLIC_APP_URL = 'https://lumo.test'
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {}
    posted.push({ url: String(url), body })
    if (String(url).includes('users.lookupByEmail'))
      return { json: async () => ({ ok: true, user: { id: 'U1' } }) }
    if (String(url).includes('conversations.open'))
      return { json: async () => ({ ok: true, channel: { id: 'D1' } }) }
    if (String(url).includes('users.info'))
      return {
        json: async () => ({
          ok: true,
          user: { profile: { email: 'dev@example.com' } },
        }),
      }
    return { json: async () => ({ ok: true }) }
  }) as unknown as typeof fetch
  p.slackIntegration.findUnique.mockResolvedValue({
    accessToken: 'enc',
    channels: [{ channelId: 'C1' }],
  })
})

function postMessageBodies() {
  return posted.filter(x => x.url.includes('chat.postMessage')).map(x => x.body)
}

describe('notification text fallback', () => {
  it.each(ALL_SLACK_EVENTS)(
    '%s: channel and DM chat.postMessage bodies carry a non-empty text',
    async event => {
      const payload = {
        entityIdentifier: 'LUM-1',
        entityTitle: 'Fix login',
        entityUrl: 'https://lumo.test/t/LUM-1',
        actorName: 'Ada',
      }
      await sendChannelNotification('ws_1', event, payload, 'proj_1')
      await sendDMNotification('ws_1', 'user_1', event, payload)
      const bodies = postMessageBodies()
      expect(bodies).toHaveLength(2)
      for (const body of bodies) {
        expect(typeof body.text).toBe('string')
        expect((body.text as string).trim()).not.toBe('')
        expect(body.text).toContain('LUM-1 · Fix login')
        expect(Array.isArray(body.blocks)).toBe(true)
      }
    }
  )

  it('fallback text is escaped and matches the blocks', async () => {
    await sendChannelNotification(
      'ws_1',
      'pr_opened',
      {
        entityIdentifier: 'LUM-2',
        entityTitle: `Title ${INJECT}`,
        actorName: `Mallory ${INJECT}`,
        prNumber: 7,
        prTitle: `PR ${INJECT}`,
        prUrl: 'https://github.com/acme/web/pull/7',
      },
      'proj_1'
    )
    const [body] = postMessageBodies()
    const text = body!.text as string
    expect(text).not.toMatch(/<!channel>|<https:\/\/evil/)
    expect(text).toContain(`Title ${ESCAPED}`)
    expect(text).toContain(`Mallory ${ESCAPED}`)
    expect(text).toContain(`PR ${ESCAPED}`)
    expect(text).toContain('PR opened')
  })
})

describe('command reply text fallback', () => {
  const storedTask = {
    id: 'task_1',
    number: 1,
    title: `Title ${INJECT}`,
    status: 'IN_REVIEW',
    priority: 'MEDIUM',
    projectId: 'proj_1',
    assigneeActorId: null,
    project: { name: 'Backend' },
    team: { identifier: 'ENG', workspace: { slug: 'acme' } },
  }

  it('status reply: blocks + escaped text, readable labels, canonical URL', async () => {
    p.workspaceMember.findMany.mockResolvedValue([
      { id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } },
    ])
    p.team.findFirst.mockResolvedValue({ id: 'team_1' })
    p.task.findFirst.mockResolvedValue(storedTask)
    const result = await handleCommand('status ENG-1', 'U1', 'xoxb', 'ws_1')
    expect(result.type).toBe('blocks')
    if (result.type !== 'blocks') return
    expect(result.text).toContain(`ENG-1 · Title ${ESCAPED}`)
    expect(result.text).not.toMatch(/<!channel>/)
    const json = JSON.stringify(result.blocks)
    expect(json).toContain('In review')
    expect(json).toContain('Medium')
    expect(json).not.toContain('IN_REVIEW')
    expect(json).toContain(
      'https://lumo.test/workspace/acme/projects/backend/tasks/ENG-1'
    )
    expect(json).toContain('Open in Lumo ↗')
  })

  it('my-tasks reply: blocks + text, unified button label', async () => {
    p.workspaceMember.findMany.mockResolvedValue([
      { id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } },
    ])
    p.task.findMany.mockResolvedValue([
      { ...storedTask, status: 'TODO', priority: 'LOW' },
    ])
    p.task.count.mockResolvedValue(1)
    const result = await handleCommand('my-tasks', 'U1', 'xoxb', 'ws_1')
    expect(result.type).toBe('blocks')
    if (result.type !== 'blocks') return
    expect(result.text.trim()).not.toBe('')
    expect(result.text).toContain('ENG-1')
    expect(result.text).not.toMatch(/<!channel>/)
    const json = JSON.stringify(result.blocks)
    expect(json).not.toContain('Open ↗')
    expect(json).toContain('Open in Lumo ↗')
    expect(json).toContain('To do')
  })

  it('create reply: blocks + text', async () => {
    p.workspaceMember.findMany.mockResolvedValue([
      { id: 'wm_1', clerkId: 'user_1' },
    ])
    p.team.findFirst.mockResolvedValue({
      id: 'team_1',
      identifier: 'ENG',
      workspace: { slug: 'acme' },
    })
    p.project.findFirst.mockResolvedValue({ id: 'proj_1', name: 'Backend' })
    mockCreateWithSequence.mockResolvedValue({
      id: 'task_9',
      number: 9,
      title: 'Ship it',
      status: 'TODO',
      priority: 'MEDIUM',
    })
    const result = await handleCommand(
      'create "Ship it" in eng',
      'U1',
      'xoxb',
      'ws_1'
    )
    expect(result.type).toBe('blocks')
    if (result.type !== 'blocks') return
    expect(result.text).toContain('ENG-9 · Ship it')
  })
})
