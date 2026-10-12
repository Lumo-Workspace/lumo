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

// Mock Clerk so resolveSlackUser can short-circuit
jest.mock('@clerk/nextjs/server', () => ({
  createClerkClient: () => ({
    users: { getUser: jest.fn() },
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
