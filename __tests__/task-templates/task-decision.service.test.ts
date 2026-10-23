/**
 * @jest-environment node
 *
 * LUM-1303: task decisions are rows of their own (no longer a description
 * edit); every write is pinned to the task and workspace.
 */
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByWorkspaceAndClerkId: jest.fn(),
    findActorByMemberId: jest.fn(async (id: string) => ({ id: `actor_${id}` })),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/db/transaction', () => ({
  runInTransaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn('tx')),
}))
jest.mock('@/lib/repositories/task-decision.repository', () => ({
  taskDecisionRepository: {
    listByTask: jest.fn(),
    findById: jest.fn(),
    createNumbered: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  },
  isDecisionNumberCollision: (e: unknown) =>
    (e as { code?: string } | null)?.code === 'P2002',
  isDecisionGone: (e: unknown) =>
    (e as { code?: string } | null)?.code === 'P2025',
}))
jest.mock('@/lib/utils/public-url', () => ({
  resolvePublicUrl: () => 'https://app.test',
}))

import { taskService } from '@/lib/services/task.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskDecisionRepository as repo } from '@/lib/repositories/task-decision.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskDecisionService } from '@/lib/services/task-decision.service'

const cli = {
  workspaceId: 'ws_1',
  workspaceSlug: 'lumo',
  callerClerkId: 'clerk_1',
  identifier: 'LUM-42',
  text: 'keep v1',
  sourceSessionId: 'sess_1',
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(repo.createNumbered as jest.Mock).mockImplementation(async d => ({
    id: 'd1',
    number: 5,
    ...d,
  }))
  ;(repo.update as jest.Mock).mockImplementation(async (_id, _ws, d) => ({
    id: 'd1',
    text: 'keep v1',
    rationale: 'why',
    ...d,
  }))
})

describe('taskDecisionService.recordFromCli', () => {
  beforeEach(() => {
    ;(taskService.resolveIdentifier as jest.Mock).mockResolvedValue({
      id: 'task_42',
      identifier: 'LUM-42',
      title: 'T',
    })
    ;(
      memberRepository.findByWorkspaceAndClerkId as jest.Mock
    ).mockResolvedValue({ id: 'mem_1' })
  })

  it('creates a row with the caller, session and rationale, and links the Decisions tab', async () => {
    const r = await taskDecisionService.recordFromCli({
      ...cli,
      rationale: '  v2 is its own task  ',
    })
    expect(repo.createNumbered).toHaveBeenCalledWith(
      {
        taskId: 'task_42',
        workspaceId: 'ws_1',
        text: 'keep v1',
        rationale: 'v2 is its own task',
        createdById: 'mem_1',
        sourceSessionId: 'sess_1',
      },
      'tx'
    )
    // Attributed to the member, in the same transaction.
    expect(activityRepository.create).toHaveBeenCalledWith(
      {
        taskId: 'task_42',
        actorId: 'actor_mem_1',
        type: 'DECISION_ADDED',
        payload: {
          decisionId: 'd1',
          number: 5,
          text: 'keep v1',
          rationale: 'v2 is its own task',
        },
      },
      'tx'
    )
    expect(r.task.url).toBe(
      'https://app.test/workspace/lumo/my-tasks/LUM-42/decisions'
    )
  })

  it('drops the date an older CLI prefixed (createdAt carries it) and an empty rationale', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-04T10:00:00Z') })
    await taskDecisionService.recordFromCli({
      ...cli,
      text: '2026-10-04 keep v1',
      rationale: '   ',
      stripLegacyDatePrefix: true,
    })
    jest.useRealTimers()
    expect(repo.createNumbered).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'keep v1', rationale: null }),
      'tx'
    )
  })

  it('keeps a decision that really starts with a date when the caller did not prefix one', async () => {
    await taskDecisionService.recordFromCli({
      ...cli,
      text: '2026-11-01 is the launch date',
    })
    expect(repo.createNumbered).toHaveBeenCalledWith(
      expect.objectContaining({ text: '2026-11-01 is the launch date' }),
      'tx'
    )
  })

  it('404s an unknown task without writing', async () => {
    ;(taskService.resolveIdentifier as jest.Mock).mockResolvedValue(null)
    await expect(taskDecisionService.recordFromCli(cli)).rejects.toMatchObject({
      status: 404,
    })
    expect(repo.createNumbered).not.toHaveBeenCalled()
  })

  it('403s a caller who is not a member', async () => {
    ;(
      memberRepository.findByWorkspaceAndClerkId as jest.Mock
    ).mockResolvedValue(null)
    await expect(taskDecisionService.recordFromCli(cli)).rejects.toMatchObject({
      status: 403,
    })
    expect(repo.createNumbered).not.toHaveBeenCalled()
  })
})

describe('taskDecisionService web CRUD', () => {
  it('lists through the repository, pinned to the workspace', async () => {
    ;(repo.listByTask as jest.Mock).mockResolvedValue([])
    await taskDecisionService.listForTask('task_1', 'ws_1')
    expect(repo.listByTask).toHaveBeenCalledWith('task_1', 'ws_1')
  })

  it('create trims text and stores a null rationale when none is given', async () => {
    await taskDecisionService.create({
      taskId: 'task_1',
      workspaceId: 'ws_1',
      text: ' ship it ',
      createdById: 'mem_1',
    })
    expect(repo.createNumbered).toHaveBeenCalledWith(
      {
        taskId: 'task_1',
        workspaceId: 'ws_1',
        text: 'ship it',
        rationale: null,
        createdById: 'mem_1',
        sourceSessionId: null,
      },
      'tx'
    )
  })

  it('update sends only the fields given; "" clears the rationale; the Activity keeps before/after', async () => {
    ;(repo.findById as jest.Mock).mockResolvedValue({
      id: 'd1',
      taskId: 'task_1',
      number: 3,
      text: 'keep v1',
      rationale: 'why',
    })
    await taskDecisionService.update({
      decisionId: 'd1',
      taskId: 'task_1',
      workspaceId: 'ws_1',
      actorMemberId: 'mem_2',
      rationale: '',
    })
    expect(repo.update).toHaveBeenCalledWith(
      'd1',
      'ws_1',
      { rationale: null },
      'tx'
    )
    expect(activityRepository.create).toHaveBeenCalledWith(
      {
        taskId: 'task_1',
        actorId: 'actor_mem_2',
        type: 'DECISION_UPDATED',
        payload: {
          decisionId: 'd1',
          number: 3,
          before: { text: 'keep v1', rationale: 'why' },
          after: { text: 'keep v1', rationale: null },
        },
      },
      'tx'
    )
  })

  it('a save that changes nothing records no Activity', async () => {
    ;(repo.findById as jest.Mock).mockResolvedValue({
      id: 'd1',
      taskId: 'task_1',
      number: 3,
      text: 'keep v1',
      rationale: 'why',
    })
    await taskDecisionService.update({
      decisionId: 'd1',
      taskId: 'task_1',
      workspaceId: 'ws_1',
      actorMemberId: 'mem_2',
      text: ' keep v1 ',
    })
    expect(repo.update).toHaveBeenCalled()
    expect(activityRepository.create).not.toHaveBeenCalled()
  })

  it('update / remove 404 a decision of another task (or workspace)', async () => {
    ;(repo.findById as jest.Mock).mockResolvedValue({
      id: 'd1',
      taskId: 'other',
    })
    await expect(
      taskDecisionService.update({
        decisionId: 'd1',
        taskId: 'task_1',
        workspaceId: 'ws_1',
        actorMemberId: 'mem_1',
        text: 'x',
      })
    ).rejects.toMatchObject({ status: 404 })
    ;(repo.findById as jest.Mock).mockResolvedValue(null)
    await expect(
      taskDecisionService.remove({
        decisionId: 'd1',
        taskId: 'task_1',
        workspaceId: 'ws_1',
        actorMemberId: 'mem_1',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(repo.update).not.toHaveBeenCalled()
    expect(repo.softDelete).not.toHaveBeenCalled()
    expect(activityRepository.create).not.toHaveBeenCalled()
  })

  it('remove tombstones the decision (its number stays taken) and keeps its text in the Activity', async () => {
    ;(repo.findById as jest.Mock).mockResolvedValue({
      id: 'd1',
      taskId: 'task_1',
      number: 3,
      text: 'keep v1',
      rationale: null,
    })
    await taskDecisionService.remove({
      decisionId: 'd1',
      taskId: 'task_1',
      workspaceId: 'ws_1',
      actorMemberId: 'mem_1',
    })
    expect(repo.softDelete).toHaveBeenCalledWith('d1', 'ws_1', 'tx')
    expect(activityRepository.create).toHaveBeenCalledWith(
      {
        taskId: 'task_1',
        actorId: 'actor_mem_1',
        type: 'DECISION_REMOVED',
        payload: {
          decisionId: 'd1',
          number: 3,
          text: 'keep v1',
          rationale: null,
        },
      },
      'tx'
    )
  })

  it('a number race retries the whole transaction, then gives up after 5 tries', async () => {
    const { Prisma } = jest.requireActual('@prisma/client')
    const collision = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    })
    ;(repo.createNumbered as jest.Mock)
      .mockRejectedValueOnce(collision)
      .mockImplementationOnce(async d => ({ id: 'd9', number: 6, ...d }))
    const d = await taskDecisionService.create({
      taskId: 'task_1',
      workspaceId: 'ws_1',
      text: 'x',
      createdById: 'mem_1',
    })
    expect(d.number).toBe(6)
    expect(repo.createNumbered).toHaveBeenCalledTimes(2)
    expect(activityRepository.create).toHaveBeenCalledTimes(1)
    ;(repo.createNumbered as jest.Mock).mockReset()
    ;(repo.createNumbered as jest.Mock).mockRejectedValue(collision)
    await expect(
      taskDecisionService.create({
        taskId: 'task_1',
        workspaceId: 'ws_1',
        text: 'x',
        createdById: 'mem_1',
      })
    ).rejects.toBe(collision)
    expect(repo.createNumbered).toHaveBeenCalledTimes(5)
  })

  it('a decision deleted after it was looked up is a 404 for edit and delete, not a revival', async () => {
    ;(repo.findById as jest.Mock).mockResolvedValue({
      id: 'd1',
      taskId: 'task_1',
      number: 3,
      text: 'keep v1',
      rationale: null,
    })
    const gone = Object.assign(new Error('not found'), { code: 'P2025' })
    ;(repo.update as jest.Mock).mockRejectedValueOnce(gone)
    await expect(
      taskDecisionService.update({
        decisionId: 'd1',
        taskId: 'task_1',
        workspaceId: 'ws_1',
        actorMemberId: 'mem_1',
        text: 'edited',
      })
    ).rejects.toMatchObject({ status: 404 })
    ;(repo.softDelete as jest.Mock).mockRejectedValueOnce(gone)
    await expect(
      taskDecisionService.remove({
        decisionId: 'd1',
        taskId: 'task_1',
        workspaceId: 'ws_1',
        actorMemberId: 'mem_1',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(activityRepository.create).not.toHaveBeenCalled()
  })
})
