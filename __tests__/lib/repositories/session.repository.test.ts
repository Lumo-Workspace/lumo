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
import {
  sessionRepository,
  diffUsageByModel,
} from '@/lib/repositories/session.repository'

const upsert = prisma.session.upsert as jest.Mock
const findMany = prisma.session.findMany as jest.Mock
const findUnique = prisma.session.findUnique as jest.Mock
const now = new Date('2026-04-23T10:00:00Z')

beforeEach(() => {
  jest.clearAllMocks()
  upsert.mockResolvedValue({ id: 'sess_1', taskId: null })
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

describe('sessionRepository.findPreviousSessionIdForMember (LUM-165)', () => {
  const findFirst = prisma.session.findFirst as jest.Mock

  it('resolves the member off the current session, then the prior session by lastActivityAt desc', async () => {
    findUnique.mockResolvedValue({ workspaceMemberId: 'wm_1' })
    findFirst.mockResolvedValue({ id: 'sess_prev' })

    const result =
      await sessionRepository.findPreviousSessionIdForMember('sess_cur')

    expect(result).toBe('sess_prev')
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'sess_cur' },
      select: { workspaceMemberId: true },
    })
    expect(findFirst).toHaveBeenCalledWith({
      where: { workspaceMemberId: 'wm_1', id: { not: 'sess_cur' } },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    })
  })

  it('returns null when the current session is unknown (no member lookup follow-up)', async () => {
    findUnique.mockResolvedValue(null)
    expect(
      await sessionRepository.findPreviousSessionIdForMember('missing')
    ).toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('returns null when the member has no prior session', async () => {
    findUnique.mockResolvedValue({ workspaceMemberId: 'wm_1' })
    findFirst.mockResolvedValue(null)
    expect(
      await sessionRepository.findPreviousSessionIdForMember('sess_cur')
    ).toBeNull()
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

  it('does not set token columns or loopCount on update when neither usage nor isStop are provided', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
    })

    const args = upsert.mock.calls[0][0]
    expect(args.update).not.toHaveProperty('inputTokens')
    expect(args.update).not.toHaveProperty('outputTokens')
    expect(args.update).not.toHaveProperty('cacheReadTokens')
    expect(args.update).not.toHaveProperty('cacheCreationTokens')
    expect(args.update).not.toHaveProperty('loopCount')
  })

  it('does not set token columns in CREATE when usage is absent', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
    })

    const args = upsert.mock.calls[0][0]
    expect(args.create).not.toHaveProperty('inputTokens')
    expect(args.create).not.toHaveProperty('loopCount')
  })
})

describe('sessionRepository.upsertForHookEvent — mid-turn usage (LUM-345)', () => {
  const usage = {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 1000,
    cacheCreationTokens: 20,
    byModel: {
      'claude-fable-5': {
        input: 100,
        output: 50,
        cacheRead: 1000,
        cacheCreation: 20,
      },
    },
  }

  it('overwrites flat token columns on update without touching usageByModel or loopCount', async () => {
    const result = await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
      usage,
      isStop: false,
    })

    const args = upsert.mock.calls[0][0]
    expect(args.update.inputTokens).toBe(100)
    expect(args.update.outputTokens).toBe(50)
    expect(args.update.cacheReadTokens).toBe(1000)
    expect(args.update.cacheCreationTokens).toBe(20)
    // usageByModel column (the per-turn-delta anchor) — only STOP may advance it.
    expect(args.update).not.toHaveProperty('usageByModel')
    expect(args.update).not.toHaveProperty('loopCount')
    // LUM-523: with no prior snapshot, the per-step delta is the full batch
    // usage, returned so the caller can store it on the HookEvent row.
    expect(result.turnUsageByModel).toEqual(usage.byModel)
  })

  it('sets flat token columns on create but leaves usageByModel unset so the first STOP settles the full turn', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
      usage,
      isStop: false,
    })

    const args = upsert.mock.calls[0][0]
    expect(args.create.inputTokens).toBe(100)
    expect(args.create.outputTokens).toBe(50)
    expect(args.create.cacheReadTokens).toBe(1000)
    expect(args.create.cacheCreationTokens).toBe(20)
    expect(args.create).not.toHaveProperty('usageByModel')
    expect(args.create).not.toHaveProperty('loopCount')
  })

  it('opens a transaction and computes the per-step delta against the prior snapshot (LUM-523)', async () => {
    // Prior cumulative: last STOP anchor at 60 in, live snapshot stale at 40.
    // pickLatestCumulative picks the larger total (the STOP anchor), so the
    // per-step delta is the batch usage minus that baseline.
    findUnique.mockResolvedValueOnce({
      usageByModel: {
        'claude-fable-5': {
          input: 60,
          output: 30,
          cacheRead: 600,
          cacheCreation: 10,
        },
      },
      liveUsageByModel: {
        'claude-fable-5': {
          input: 40,
          output: 20,
          cacheRead: 400,
          cacheCreation: 5,
        },
      },
    })

    const result = await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
      usage,
      isStop: false,
    })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(result.turnUsageByModel).toEqual({
      'claude-fable-5': {
        input: 40,
        output: 20,
        cacheRead: 400,
        cacheCreation: 10,
      },
    })
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
      data: { taskId: 'task_42', bindingSource: 'ATTACH' },
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
            deletedAt: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
  })

  it('LUM-923 returns bound:false when the bound task is in the trash', async () => {
    findUnique().mockResolvedValue({
      taskId: 'task-abc',
      task: {
        number: 12,
        title: 'Add OAuth',
        deletedAt: new Date('2026-09-30T00:00:00Z'),
        team: { identifier: 'LUM' },
      },
    })
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({ bound: false })
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

describe('diffUsageByModel', () => {
  it('subtracts prior cumulative per field per model, clamped to >= 0', () => {
    const prior = {
      opus: { input: 100, output: 10, cacheRead: 5, cacheCreation: 2 },
    }
    const next = {
      opus: { input: 250, output: 25, cacheRead: 5, cacheCreation: 4 },
      sonnet: { input: 30, output: 3, cacheRead: 0, cacheCreation: 0 },
    }
    expect(diffUsageByModel(prior, next)).toEqual({
      opus: { input: 150, output: 15, cacheRead: 0, cacheCreation: 2 },
      sonnet: { input: 30, output: 3, cacheRead: 0, cacheCreation: 0 },
    })
  })

  it('returns full next when prior is null (first STOP)', () => {
    const next = {
      opus: { input: 100, output: 10, cacheRead: 5, cacheCreation: 2 },
    }
    expect(diffUsageByModel(null, next)).toEqual(next)
  })

  it('clamps a shrunk cumulative (compaction) to 0', () => {
    const prior = {
      opus: { input: 100, output: 10, cacheRead: 5, cacheCreation: 2 },
    }
    const next = {
      opus: { input: 80, output: 8, cacheRead: 4, cacheCreation: 1 },
    }
    expect(diffUsageByModel(prior, next)).toEqual({
      opus: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    })
  })
})

describe('sessionRepository.upsertForHookEvent — STOP with usage', () => {
  const findUnique = prisma.session.findUnique as jest.Mock
  const upsert = prisma.session.upsert as jest.Mock

  const stopArgs = {
    id: 'sess_1',
    workspaceId: 'ws_1',
    workspaceMemberId: 'wm_1',
    cwd: '/repo',
    now,
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      byModel: {
        opus: { input: 1000, output: 500, cacheRead: 200, cacheCreation: 100 },
      },
    },
    isStop: true,
  }

  it('overwrites flat columns + usageByModel, bumps loopCount, returns the per-turn delta', async () => {
    findUnique.mockResolvedValue({
      usageByModel: {
        opus: { input: 400, output: 200, cacheRead: 50, cacheCreation: 40 },
      },
    })
    upsert.mockResolvedValue({ id: 'sess_1', taskId: 'task_42' })

    const result = await sessionRepository.upsertForHookEvent(stopArgs)

    const args = upsert.mock.calls[0][0]
    expect(args.update.inputTokens).toBe(1000)
    expect(args.update.outputTokens).toBe(500)
    expect(args.update.cacheReadTokens).toBe(200)
    expect(args.update.cacheCreationTokens).toBe(100)
    expect(args.update.loopCount).toEqual({ increment: 1 })
    expect(args.update.usageByModel).toEqual(stopArgs.usage.byModel)
    expect(result).toEqual({
      taskId: 'task_42',
      turnUsageByModel: {
        opus: { input: 600, output: 300, cacheRead: 150, cacheCreation: 60 },
      },
    })
  })

  it('on first STOP (no prior row) the delta is the full cumulative', async () => {
    findUnique.mockResolvedValue(null)
    upsert.mockResolvedValue({ id: 'sess_1', taskId: null })

    const result = await sessionRepository.upsertForHookEvent(stopArgs)

    const args = upsert.mock.calls[0][0]
    expect(args.create.usageByModel).toEqual(stopArgs.usage.byModel)
    expect(args.create.loopCount).toBe(1)
    expect(result.turnUsageByModel).toEqual(stopArgs.usage.byModel)
  })

  it('STOP without usage still bumps loopCount and returns null delta', async () => {
    upsert.mockResolvedValue({ id: 'sess_1', taskId: null })
    const result = await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
      isStop: true,
    })
    expect((upsert.mock.calls[0][0] as any).update.loopCount).toEqual({
      increment: 1,
    })
    expect(result.turnUsageByModel).toBeNull()
  })
})

describe('sessionRepository.upsertForHookEvent — liveUsageByModel snapshot (LUM-345 follow-up)', () => {
  const usage = {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 1000,
    cacheCreationTokens: 20,
    byModel: {
      'claude-fable-5': {
        input: 100,
        output: 50,
        cacheRead: 1000,
        cacheCreation: 20,
      },
    },
  }

  it('writes the per-model live snapshot on mid-turn usage (create and update)', async () => {
    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
      usage,
      isStop: false,
    })

    const args = upsert.mock.calls[0][0]
    expect(args.update.liveUsageByModel).toEqual(usage.byModel)
    expect(args.create.liveUsageByModel).toEqual(usage.byModel)
    // The settlement anchor still must not move mid-turn.
    expect(args.update).not.toHaveProperty('usageByModel')
  })

  it('leaves liveUsageByModel untouched on STOP — the settled anchor self-heals the diff', async () => {
    findUnique.mockResolvedValue(null)
    upsert.mockResolvedValue({ id: 'sess_1', taskId: null })

    await sessionRepository.upsertForHookEvent({
      id: 'sess_1',
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      cwd: '/repo',
      now,
      usage,
      isStop: true,
    })

    const args = upsert.mock.calls[0][0]
    expect(args.update).not.toHaveProperty('liveUsageByModel')
    expect(args.create).not.toHaveProperty('liveUsageByModel')
  })
})

describe('sessionRepository timeline child reads (LUM-932)', () => {
  it('lists child sessions bound to the task with the timeline projection + parent id', async () => {
    findMany.mockResolvedValue([])
    await sessionRepository.listChildrenForTask('t1')
    const arg = findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ taskId: 't1', parentSessionId: { not: null } })
    expect(arg.select).toEqual(
      expect.objectContaining({
        parentSessionId: true,
        usageByModel: true,
        liveUsageByModel: true,
        inputTokens: true,
      })
    )
  })

  it('reads host parent rows by id and skips the query for an empty list', async () => {
    expect(await sessionRepository.listTimelineRowsByIds([])).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
    findMany.mockResolvedValue([])
    await sessionRepository.listTimelineRowsByIds(['p1'])
    expect(findMany.mock.calls[0]![0].where).toEqual({ id: { in: ['p1'] } })
  })
})
