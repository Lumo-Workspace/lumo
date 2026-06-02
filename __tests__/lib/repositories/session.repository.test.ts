/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => {
  const session = {
    upsert: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  }
  const hookEvent = { findMany: jest.fn() }
  return {
    prisma: {
      session,
      hookEvent,
      // $transaction(cb) is used by upsertWithTaskId — feed the same
      // mocked client to the callback so tx.session.* hits the same spies
      // the test asserts on.
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ session, hookEvent })
      ),
    },
  }
})

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

  it('never sets taskId on update — the hook path is not allowed to write taskId, only the bind path is', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
    })
    const args = upsert.mock.calls[0][0]
    expect(args.update).not.toHaveProperty('taskId')
  })

  it('selects taskId so callers can tag the HookEvent without a second query', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
    })
    const args = upsert.mock.calls[0][0]
    expect(args.select).toEqual({ id: true, taskId: true })
  })

  it('sets agent on create when supplied', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      agent: 'CODEX',
      now,
    })
    const args = upsert.mock.calls[0][0]
    expect(args.create.agent).toBe('CODEX')
  })

  it('omits agent on create when not supplied, letting the DB default apply', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
    })
    const args = upsert.mock.calls[0][0]
    expect(args.create).not.toHaveProperty('agent')
  })

  it('never sets agent on update — agent is fixed for the session lifetime', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      agent: 'CODEX',
      now,
    })
    const args = upsert.mock.calls[0][0]
    expect(args.update).not.toHaveProperty('agent')
  })
})

describe('sessionRepository.upsertWithTaskId', () => {
  const sessionUpdate = () => prisma.session.update as jest.Mock
  const sessionCreate = () => prisma.session.create as jest.Mock

  it('creates a new session row when none exists', async () => {
    findUnique.mockResolvedValue(null)
    sessionCreate().mockResolvedValue({ id: 'sess_1', taskId: 'task_42' })

    const result = await sessionRepository.upsertWithTaskId({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      taskId: 'task_42',
      now,
    })

    expect(result).toEqual({
      ownedByOther: false,
      session: { id: 'sess_1', taskId: 'task_42' },
    })
    expect(sessionCreate()).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'sess_1',
          workspaceId: 'ws_1',
          workspaceMemberId: 'wm_1',
          taskId: 'task_42',
          eventCount: 0,
          startedAt: now,
          lastActivityAt: now,
        }),
      })
    )
  })

  it('updates taskId when session exists and belongs to the same member', async () => {
    findUnique.mockResolvedValue({ workspaceMemberId: 'wm_1' })
    sessionUpdate().mockResolvedValue({ id: 'sess_1', taskId: 'task_42' })

    const result = await sessionRepository.upsertWithTaskId({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      taskId: 'task_42',
      now,
    })

    expect(result).toEqual({
      ownedByOther: false,
      session: { id: 'sess_1', taskId: 'task_42' },
    })
    expect(sessionUpdate()).toHaveBeenCalledWith({
      where: { id: 'sess_1' },
      data: { taskId: 'task_42' },
      select: { id: true, taskId: true },
    })
    expect(sessionCreate()).not.toHaveBeenCalled()
  })

  it('returns ownedByOther when session belongs to a different member', async () => {
    findUnique.mockResolvedValue({ workspaceMemberId: 'wm_other' })

    const result = await sessionRepository.upsertWithTaskId({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      taskId: 'task_42',
      now,
    })

    expect(result).toEqual({ ownedByOther: true })
    expect(sessionUpdate()).not.toHaveBeenCalled()
    expect(sessionCreate()).not.toHaveBeenCalled()
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

describe('sessionRepository.findAgent', () => {
  it('returns the session agent', async () => {
    findUnique.mockResolvedValue({ agent: 'CODEX' })
    const result = await sessionRepository.findAgent('sess_1')
    expect(result).toBe('CODEX')
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'sess_1' },
      select: { agent: true },
    })
  })

  it('returns null when the session does not exist', async () => {
    findUnique.mockResolvedValue(null)
    expect(await sessionRepository.findAgent('missing')).toBeNull()
  })
})

describe('sessionRepository.findTaskBinding', () => {
  const findUnique = () => prisma.session.findUnique as jest.Mock

  it('returns bound:true with identifier and title when session has a task', async () => {
    findUnique().mockResolvedValue({
      taskId: 'task-abc',
      task: { number: 12, title: 'Add OAuth', team: { identifier: 'LUM' } },
    })
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({
      bound: true,
      taskId: 'task-abc',
      taskIdentifier: 'LUM-12',
      taskTitle: 'Add OAuth',
    })
    expect(findUnique()).toHaveBeenCalledWith({
      where: { id: 'sess_1' },
      select: {
        taskId: true,
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

describe('sessionRepository.linkToWorktreeByCwd', () => {
  it('points every session whose cwd equals the worktree path at the worktree', async () => {
    ;(prisma.session.updateMany as jest.Mock).mockResolvedValue({ count: 2 })

    const result = await sessionRepository.linkToWorktreeByCwd({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      worktreeId: 'wt_1',
    })

    expect(result).toEqual({ count: 2 })
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', cwd: '/repo/.worktrees/x' },
      data: { worktreeId: 'wt_1' },
    })
  })
})
