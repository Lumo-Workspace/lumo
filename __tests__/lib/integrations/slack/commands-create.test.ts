/**
 * @jest-environment node
 */

// LUM-920: the Slack `create` command must take the task number from the
// team's atomic taskSeq (taskRepository.createWithSequence), not count+1.
// Prisma is mocked; the real repository runs on top of it so the test pins
// the number to what the sequence increment returned.

const mockTx = {
  team: { update: jest.fn() },
  task: { create: jest.fn() },
}

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: { findMany: jest.fn() },
    team: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
    task: { create: jest.fn(), findUniqueOrThrow: jest.fn() },
    $transaction: jest.fn((fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
  },
}))

// LUM-1103: mock the directory abstraction (not the Clerk SDK); the member
// lookup batches by id through getUserList.
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

import { prisma } from '@/lib/db/prisma'
import { handleCommand } from '@/lib/integrations/slack/commands'

const p = prisma as unknown as {
  workspaceMember: { findMany: jest.Mock }
  team: { findFirst: jest.Mock }
  project: { findFirst: jest.Mock }
  task: { create: jest.Mock; findUniqueOrThrow: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async () => ({
    json: async () => ({
      ok: true,
      user: { profile: { email: 'dev@example.com' } },
    }),
  })) as unknown as typeof fetch

  p.workspaceMember.findMany.mockResolvedValue([
    { id: 'wm_1', clerkId: 'user_1', actor: { id: 'actor_1' } },
  ])
  // Team holds 3 live tasks but its sequence is already at 7 (tasks deleted):
  // count+1 would re-issue 4; the sequence must hand out 8.
  p.team.findFirst.mockResolvedValue({
    id: 'team_1',
    identifier: 'ENG',
    _count: { tasks: 3 },
    workspace: { slug: 'acme' },
  })
  p.project.findFirst.mockResolvedValue({ id: 'proj_1', name: 'Backend' })
  mockTx.team.update.mockResolvedValue({ taskSeq: 8 })
  mockTx.task.create.mockImplementation(async ({ data }) => ({
    id: 'task_1',
    ...data,
  }))
  p.task.findUniqueOrThrow.mockImplementation(async () => ({
    id: 'task_1',
    number: mockTx.task.create.mock.calls[0][0].data.number,
    title: mockTx.task.create.mock.calls[0][0].data.title,
    team: { identifier: 'ENG' },
    assignee: null,
  }))
})

describe('slack create command (LUM-920)', () => {
  it('number comes from the team sequence', async () => {
    await handleCommand('create "Fix bug" in eng', 'U1', 'xoxb', 'ws_1')

    expect(mockTx.team.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'team_1', workspaceId: 'ws_1' },
        data: { taskSeq: { increment: 1 } },
      })
    )
    expect(mockTx.task.create.mock.calls[0][0].data.number).toBe(8)
    // The count-based direct create path is gone.
    expect(p.task.create).not.toHaveBeenCalled()
    expect(p.team.findFirst.mock.calls[0][0].select).not.toHaveProperty(
      '_count'
    )
  })

  it('keeps the slack defaults', async () => {
    const result = await handleCommand(
      'create "Fix bug" in eng',
      'U1',
      'xoxb',
      'ws_1'
    )

    expect(p.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws_1', teamId: 'team_1' },
        orderBy: { updatedAt: 'desc' },
      })
    )
    const data = mockTx.task.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      projectId: 'proj_1',
      teamId: 'team_1',
      title: 'Fix bug',
      status: 'TODO',
      priority: 'MEDIUM',
      order: 0,
    })
    expect(JSON.stringify(result)).toContain('ENG-8 · Fix bug')
  })

  it('replies with an error instead of creating when the team has no project', async () => {
    p.project.findFirst.mockResolvedValue(null)

    const result = await handleCommand(
      'create "Fix bug" in eng',
      'U1',
      'xoxb',
      'ws_1'
    )

    expect(result).toEqual({
      type: 'text',
      text: 'Team `ENG` has no project to create the task in.',
      visibility: 'ephemeral',
    })
    expect(mockTx.task.create).not.toHaveBeenCalled()
  })
})
