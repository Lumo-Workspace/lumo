// Mock @prisma/adapter-pg to prevent pg from loading (pg uses TextEncoder
// at module-evaluation time which is unavailable in jsdom environment)
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}))

// Mock prisma
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    team: { findFirst: jest.fn() },
    task: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    workspaceMember: { findMany: jest.fn() },
    project: { findFirst: jest.fn() },
  },
}))

// LUM-1096: `status` now requires a linked Slack user.
// LUM-1103: the member lookup batches by id through getUserList.
jest.mock('@/lib/auth/users', () => ({
  createUserDirectory: async () => ({
    getUserList: async ({
      userId = [],
      emailAddress = [],
    }: {
      userId?: string[]
      emailAddress?: string[]
    }) => ({
      // LUM-1115: the Slack member lookup filters by email.
      data: [
        ...userId,
        ...(emailAddress.some(e => e.toLowerCase() === 'dev@example.com')
          ? ['user_1']
          : []),
      ].map(id => ({
        id,
        primaryEmailAddressId: 'em_1',
        emailAddresses: [{ id: 'em_1', emailAddress: 'dev@example.com' }],
      })),
    }),
  }),
}))

import { handleCommand } from '@/lib/integrations/slack'
import { prisma } from '@/lib/db/prisma'

const asMock = (fn: unknown): jest.Mock<any> => fn as jest.Mock<any>

const mockTeam = {
  id: 'team-1',
  identifier: 'ENG',
  workspace: { slug: 'acme' },
}
const mockTask = {
  id: 'task-1',
  number: 42,
  title: 'Fix the bug',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  projectId: 'proj-1',
  assigneeId: null,
  team: { identifier: 'ENG', workspace: { slug: 'acme' } },
  project: { name: 'Core' },
}

describe('handleCommand — status', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({
        ok: true,
        user: { profile: { email: 'dev@example.com' } },
      }),
    })) as unknown as typeof fetch
    asMock(prisma.workspaceMember.findMany).mockResolvedValue([
      { id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } },
    ])
  })

  it('returns blocks when task exists', async () => {
    asMock(prisma.team.findFirst).mockResolvedValue(mockTeam)
    asMock(prisma.task.findFirst).mockResolvedValue(mockTask)

    const result = await handleCommand(
      'status ENG-42',
      'U123',
      'xoxb-token',
      'ws-1'
    )
    expect(result.type).toBe('blocks')
  })

  it('returns not-found text when identifier has no matching task', async () => {
    asMock(prisma.team.findFirst).mockResolvedValue(mockTeam)
    asMock(prisma.task.findFirst).mockResolvedValue(null)

    const result = await handleCommand(
      'status ENG-99',
      'U123',
      'xoxb-token',
      'ws-1'
    )
    expect(result.type).toBe('text')
    expect((result as { type: 'text'; text: string }).text).toMatch(/not found/)
  })

  it('returns not-found text when team does not exist', async () => {
    asMock(prisma.team.findFirst).mockResolvedValue(null)

    const result = await handleCommand(
      'status NOPE-1',
      'U123',
      'xoxb-token',
      'ws-1'
    )
    expect(result.type).toBe('text')
    expect((result as { type: 'text'; text: string }).text).toMatch(/not found/)
  })
})

describe('handleCommand — unknown command', () => {
  it('returns the ephemeral help card for an unrecognised command', async () => {
    const result = await handleCommand('banana', 'U123', 'xoxb-token', 'ws-1')
    expect(result.type).toBe('blocks')
    expect(result.visibility).toBe('ephemeral')
    expect(result.text).toContain('Available commands')
  })
})

describe('handleCommand — create', () => {
  it('returns usage hint when title is not quoted', async () => {
    const result = await handleCommand(
      'create Fix the bug in ENG',
      'U123',
      'xoxb-token',
      'ws-1'
    )
    expect(result.type).toBe('text')
    expect((result as { type: 'text'; text: string }).text).toMatch(/Usage/)
  })
})
