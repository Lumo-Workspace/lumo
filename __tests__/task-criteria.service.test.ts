import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { commentService } from '@/lib/services/comment.service'
import { getHumanActorId } from '@/lib/actor'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    createMany: jest.fn(),
    create: jest.fn(),
    listByTask: jest.fn(),
    countByTask: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: {
    maxRoundByTask: jest.fn(),
    latestRunsByCriterion: jest.fn(),
  },
}))

// $transaction just runs the callback with a sentinel tx so repo calls can be
// asserted to have happened inside the transaction.
const TX = { __tx: true }
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))

// Capture waitUntil promises so the audit-comment side effect can be awaited.
const waitUntilPromises: Promise<unknown>[] = []
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
}))

jest.mock('@/lib/services/comment.service', () => ({
  commentService: { createComment: jest.fn() },
}))
jest.mock('@/lib/actor', () => ({ getHumanActorId: jest.fn() }))

const repo = acceptanceCriterionRepository as jest.Mocked<
  typeof acceptanceCriterionRepository
>
const runRepo = verificationRunRepository as unknown as {
  maxRoundByTask: jest.Mock
  latestRunsByCriterion: jest.Mock
}
const mockCreateComment = commentService.createComment as jest.Mock
const mockGetHumanActorId = getHumanActorId as jest.Mock

const ATTRIBUTION = { actorMemberId: 'member-1', sourceSessionId: 'sess-1234abcd' }

function criterion(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    taskId: 't-1',
    statement: 'all routes covered by tests',
    verifierType: 'MACHINE' as const,
    checkpointer: 'npx jest',
    evidenceRequired: false,
    source: 'AGENT_DRAFT' as const,
    addedAtRound: 0,
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  waitUntilPromises.length = 0
  mockGetHumanActorId.mockResolvedValue('actor-1')
  mockCreateComment.mockResolvedValue({ id: 'comment-1' })
})

describe('taskCriteriaService.listForTask', () => {
  it('returns criteria with the soft-cap warning when outside 3–7', async () => {
    repo.listByTask.mockResolvedValue([criterion(), criterion({ id: 'c-2' })])
    const result = await taskCriteriaService.listForTask('t-1')
    expect(result.criteria).toHaveLength(2)
    expect(result.warning).toMatch(/below the recommended minimum/)
  })

  it('suppresses the warning for an empty (undrafted) contract', async () => {
    repo.listByTask.mockResolvedValue([])
    const result = await taskCriteriaService.listForTask('t-1')
    expect(result).toEqual({ criteria: [], warning: null })
  })
})

describe('taskCriteriaService.submitDraft (agent lock)', () => {
  const items = [
    { statement: 's1', verifierType: 'MACHINE' as const, checkpointer: 'npx jest' },
    { statement: 's2', verifierType: 'HUMAN' as const },
    { statement: 's3', verifierType: 'HUMAN' as const, evidenceRequired: true },
  ]

  it('creates the round-0 AGENT_DRAFT batch when the task has no criteria', async () => {
    repo.countByTask.mockResolvedValue(0)
    repo.createMany.mockResolvedValue({ count: 3 })
    repo.listByTask.mockResolvedValue([
      criterion(),
      criterion({ id: 'c-2' }),
      criterion({ id: 'c-3' }),
    ])

    const result = await taskCriteriaService.submitDraft('t-1', items)

    expect(repo.countByTask).toHaveBeenCalledWith('t-1', TX)
    expect(repo.createMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          taskId: 't-1',
          statement: 's1',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest',
          evidenceRequired: false,
          source: 'AGENT_DRAFT',
        }),
        expect.objectContaining({ statement: 's2', checkpointer: null }),
        expect.objectContaining({ statement: 's3', evidenceRequired: true }),
      ],
      TX
    )
    expect(result.criteria).toHaveLength(3)
    expect(result.warning).toBeNull()
  })

  it('rejects a second agent draft with 409 once any criteria exist', async () => {
    repo.countByTask.mockResolvedValue(3)

    await expect(
      taskCriteriaService.submitDraft('t-1', items)
    ).rejects.toMatchObject({ status: 409 })
    expect(repo.createMany).not.toHaveBeenCalled()
  })
})

describe('taskCriteriaService.reviseAsHuman', () => {
  it('rejects an id that does not belong to the task (400)', async () => {
    repo.listByTask.mockResolvedValue([criterion()])

    await expect(
      taskCriteriaService.reviseAsHuman(
        't-1',
        [{ id: 'c-elsewhere', statement: 's', verifierType: 'HUMAN' }],
        ATTRIBUTION
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects duplicate ids in one submission (400)', async () => {
    repo.listByTask.mockResolvedValue([criterion()])

    await expect(
      taskCriteriaService.reviseAsHuman(
        't-1',
        [
          { id: 'c-1', statement: 'a', verifierType: 'HUMAN' },
          { id: 'c-1', statement: 'b', verifierType: 'HUMAN' },
        ],
        ATTRIBUTION
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses to delete a criterion that has verification runs (409), writing nothing', async () => {
    repo.listByTask.mockResolvedValue([criterion(), criterion({ id: 'c-2' })])
    runRepo.latestRunsByCriterion.mockResolvedValue(
      new Map([['c-1', { id: 'run-1' }]])
    )

    await expect(
      taskCriteriaService.reviseAsHuman(
        't-1',
        // c-1 missing from the desired list → would be deleted
        [{ id: 'c-2', statement: 'all routes covered by tests', verifierType: 'MACHINE', checkpointer: 'npx jest' }],
        ATTRIBUTION
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(repo.delete).not.toHaveBeenCalled()
    expect(repo.update).not.toHaveBeenCalled()
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('updates changed rows as HUMAN_EDIT, keeps untouched provenance, creates at the current round, deletes run-free rows', async () => {
    const unchanged = criterion({
      id: 'c-keep',
      statement: 'kept as-is',
      verifierType: 'HUMAN',
      checkpointer: null,
    })
    const toChange = criterion({ id: 'c-change' })
    const toDrop = criterion({ id: 'c-drop', statement: 'obsolete' })
    repo.listByTask
      .mockResolvedValueOnce([unchanged, toChange, toDrop])
      .mockResolvedValueOnce([unchanged, toChange]) // final re-list
    runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
    runRepo.maxRoundByTask.mockResolvedValue(2)

    await taskCriteriaService.reviseAsHuman(
      't-1',
      [
        { id: 'c-keep', statement: 'kept as-is', verifierType: 'HUMAN' },
        {
          id: 'c-change',
          statement: 'tightened statement',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest',
        },
        { statement: 'brand new requirement', verifierType: 'HUMAN' },
      ],
      ATTRIBUTION
    )

    expect(repo.delete).toHaveBeenCalledWith('c-drop', TX)
    expect(repo.update).toHaveBeenCalledTimes(1)
    expect(repo.update).toHaveBeenCalledWith(
      'c-change',
      expect.objectContaining({
        statement: 'tightened statement',
        source: 'HUMAN_EDIT',
      }),
      TX
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        statement: 'brand new requirement',
        source: 'HUMAN_EDIT',
        addedAtRound: 2,
      }),
      TX
    )

    // Audit comment carries the session 出处.
    expect(waitUntilPromises).toHaveLength(1)
    await Promise.all(waitUntilPromises)
    expect(mockCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        authorActorId: 'actor-1',
        body: expect.stringContaining('session sess-123'),
      })
    )
    expect(mockCreateComment.mock.calls[0]![0].body).toContain('HUMAN_EDIT')
  })

  it('schedules no audit comment for a no-op revision', async () => {
    const row = criterion()
    repo.listByTask.mockResolvedValue([row])
    runRepo.maxRoundByTask.mockResolvedValue(null)

    await taskCriteriaService.reviseAsHuman(
      't-1',
      [
        {
          id: 'c-1',
          statement: row.statement,
          verifierType: 'MACHINE',
          checkpointer: 'npx jest',
        },
      ],
      ATTRIBUTION
    )

    expect(repo.update).not.toHaveBeenCalled()
    expect(waitUntilPromises).toHaveLength(0)
  })
})
