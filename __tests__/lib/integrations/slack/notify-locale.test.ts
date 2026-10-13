/**
 * @jest-environment node
 *
 * LUM-1097 — which language a sent notification is in: a channel post uses
 * the workspace's default language; a DM uses the recipient's own language,
 * or the workspace default when they have none. The real locale service and
 * repositories run on mocked Prisma.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    slackIntegration: { findUnique: jest.fn() },
    workspace: { findUnique: jest.fn() },
    workspaceMember: { findFirst: jest.fn() },
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

import { prisma } from '@/lib/db/prisma'
import {
  sendChannelNotification,
  sendDMNotification,
} from '@/lib/integrations/slack/notify'

const p = prisma as unknown as {
  slackIntegration: { findUnique: jest.Mock }
  workspace: { findUnique: jest.Mock }
  workspaceMember: { findFirst: jest.Mock }
}

let posted: Array<{ url: string; body: Record<string, unknown> }>

beforeEach(() => {
  jest.clearAllMocks()
  posted = []
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    posted.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) : {},
    })
    if (String(url).includes('users.lookupByEmail'))
      return { json: async () => ({ ok: true, user: { id: 'U1' } }) }
    if (String(url).includes('conversations.open'))
      return { json: async () => ({ ok: true, channel: { id: 'D1' } }) }
    return { json: async () => ({ ok: true }) }
  }) as unknown as typeof fetch
  p.slackIntegration.findUnique.mockResolvedValue({
    accessToken: 'enc',
    channels: [{ channelId: 'C1' }],
  })
})

const payload = {
  entityTitle: 'Fix login',
  entityIdentifier: 'LUM-1',
  entityUrl: 'https://lumo.test/t/LUM-1',
  actorName: 'Ada',
}

function postedText(): string {
  const msg = posted.find(x => x.url.includes('chat.postMessage'))
  return String(msg?.body.text ?? '')
}

describe('channel posts use the workspace default language', () => {
  it('zh-CN workspace', async () => {
    p.workspace.findUnique.mockResolvedValue({ defaultLocale: 'zh-CN' })
    await sendChannelNotification('ws_1', 'task_done', payload, 'proj_1')
    expect(p.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: 'ws_1' },
      select: { defaultLocale: true },
    })
    expect(postedText()).toContain('任务已完成')
    expect(postedText()).toContain('来自 Ada')
  })

  it('en workspace', async () => {
    p.workspace.findUnique.mockResolvedValue({ defaultLocale: 'en' })
    await sendChannelNotification('ws_1', 'task_done', payload, 'proj_1')
    expect(postedText()).toContain('Task done')
    expect(postedText()).toContain('by Ada')
  })

  it('unknown stored code → English', async () => {
    p.workspace.findUnique.mockResolvedValue({ defaultLocale: 'xx' })
    await sendChannelNotification('ws_1', 'task_done', payload, 'proj_1')
    expect(postedText()).toContain('Task done')
  })
})

describe('DMs use the recipient language, else the workspace default', () => {
  it('recipient zh-CN in an en workspace', async () => {
    p.workspace.findUnique.mockResolvedValue({ defaultLocale: 'en' })
    p.workspaceMember.findFirst.mockResolvedValue({
      preference: { locale: 'zh-CN' },
    })
    await sendDMNotification('ws_1', 'user_1', 'task_assigned', payload)
    expect(p.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', clerkId: 'user_1', deactivatedAt: null },
      select: { preference: { select: { locale: true } } },
    })
    expect(postedText()).toContain('你被分配了一个任务')
  })

  it('recipient en in a zh-CN workspace', async () => {
    p.workspace.findUnique.mockResolvedValue({ defaultLocale: 'zh-CN' })
    p.workspaceMember.findFirst.mockResolvedValue({
      preference: { locale: 'en' },
    })
    await sendDMNotification('ws_1', 'user_1', 'task_assigned', payload)
    expect(postedText()).toContain('You were assigned a task')
  })

  it('recipient with no preference → workspace default', async () => {
    p.workspace.findUnique.mockResolvedValue({ defaultLocale: 'ja' })
    p.workspaceMember.findFirst.mockResolvedValue({ preference: null })
    await sendDMNotification('ws_1', 'user_1', 'task_assigned', payload)
    expect(postedText()).toContain('タスクが割り当てられました')
  })

  it('a failed language lookup still sends (English)', async () => {
    p.workspace.findUnique.mockRejectedValue(new Error('db down'))
    p.workspaceMember.findFirst.mockRejectedValue(new Error('db down'))
    await sendDMNotification('ws_1', 'user_1', 'task_assigned', payload)
    expect(postedText()).toContain('You were assigned a task')
  })
})
