/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    session: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    hookEvent: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'

const upsert = prisma.session.upsert as jest.Mock
const findMany = prisma.session.findMany as jest.Mock
const findUnique = prisma.session.findUnique as jest.Mock
const now = new Date('2026-04-23T10:00:00Z')

beforeEach(() => {
  jest.clearAllMocks()
  upsert.mockResolvedValue({ id: 'sess_1' })
  findMany.mockResolvedValue([])
})

describe('sessionRepository.findWorkspaceId', () => {
  it('selects only workspaceId', async () => {
    findUnique.mockResolvedValue({ workspaceId: 'ws_1' })

    const result = await sessionRepository.findWorkspaceId('sess_1')

    expect(result).toEqual({ workspaceId: 'ws_1' })
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'sess_1' },
      select: { workspaceId: true },
    })
  })

  it('returns null when session does not exist', async () => {
    findUnique.mockResolvedValue(null)
    expect(await sessionRepository.findWorkspaceId('missing')).toBeNull()
  })
})

describe('sessionRepository.upsertForHookEvent', () => {
  it('creates on first touch with eventCount=1 and both timestamps set to now', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
    })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess_1' },
        create: {
          id: 'sess_1',
          workspaceId: 'ws_1',
          workspaceMemberId: 'wm_1',
          cwd: '/repo',
          taskId: null,
          startedAt: now,
          lastActivityAt: now,
          eventCount: 1,
        },
      })
    )
  })

  it('on update, bumps lastActivityAt + increments eventCount', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
    })

    const args = upsert.mock.calls[0][0]
    expect(args.update.lastActivityAt).toBe(now)
    expect(args.update.eventCount).toEqual({ increment: 1 })
    expect(args.update.cwd).toBe('/repo')
  })

  it('does not set cwd on update when payload omits it', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: null,
      now,
    })

    const args = upsert.mock.calls[0][0]
    expect(args.update).not.toHaveProperty('cwd')
  })

  it('sets taskId in create payload when provided', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      taskId: 'task_abc',
      now,
    })
    const args = upsert.mock.calls[0][0]
    expect(args.create.taskId).toBe('task_abc')
  })

  it('sets taskId=null in create payload when omitted', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
    })
    const args = upsert.mock.calls[0][0]
    expect(args.create.taskId).toBeNull()
  })

  it('never sets taskId on update (create-time taskId is immutable for the session)', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      taskId: 'task_different',
      now,
    })
    const args = upsert.mock.calls[0][0]
    expect(args.update).not.toHaveProperty('taskId')
  })
})

describe('sessionRepository.listForClerkUser', () => {
  it('filters by member.clerkId, orders by lastActivityAt desc, selects display fields', async () => {
    await sessionRepository.listForClerkUser('clerk_1')

    expect(findMany).toHaveBeenCalledWith({
      where: { member: { clerkId: 'clerk_1' } },
      orderBy: { lastActivityAt: 'desc' },
      take: 50,
      select: {
        id: true,
        cwd: true,
        startedAt: true,
        lastActivityAt: true,
        eventCount: true,
      },
    })
  })

  it('honors a custom limit', async () => {
    await sessionRepository.listForClerkUser('clerk_1', 10)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }))
  })
})

describe('sessionRepository.findTaskBinding', () => {
  const findUnique = () => prisma.session.findUnique as jest.Mock

  it('returns bound:true with identifier and title when session has a task', async () => {
    findUnique().mockResolvedValue({
      task: { number: 12, title: 'Add OAuth', team: { identifier: 'LUM' } },
    })
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({
      bound: true,
      taskIdentifier: 'LUM-12',
      taskTitle: 'Add OAuth',
    })
    expect(findUnique()).toHaveBeenCalledWith({
      where: { id: 'sess_1' },
      select: {
        task: {
          select: {
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
  })

  it('returns bound:false when session has no task', async () => {
    findUnique().mockResolvedValue({ task: null })
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({ bound: false })
  })

  it('returns bound:false when session does not exist', async () => {
    findUnique().mockResolvedValue(null)
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({ bound: false })
  })
})
