import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { commentService } from '@/lib/services/comment.service'
import { getHumanActorId } from '@/lib/actor'
import { judgeWeakening } from '@/lib/llm/contract-weakening-judge-client'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    createMany: jest.fn(),
    create: jest.fn(),
    listByTask: jest.fn(),
    countByTask: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    softDelete: jest.fn(),
    // LUM-819: agent edits return the contract to unconfirmed.
    unconfirmAllActive: jest.fn().mockResolvedValue(0),
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
// Drift records (LUM-343) — asserted in detail in task-criteria-activity.test.ts.
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
// LUM-511 Phase 4: contract-weakening judge dispatch (dynamic-imported).
jest.mock('@/lib/llm/contract-weakening-judge-client', () => ({
  judgeWeakening: jest.fn(),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    coalesceRecurrence: jest.fn(),
    create: jest.fn(),
  },
}))

const repo = acceptanceCriterionRepository as jest.Mocked<
  typeof acceptanceCriterionRepository
>
const runRepo = verificationRunRepository as unknown as {
  maxRoundByTask: jest.Mock
  latestRunsByCriterion: jest.Mock
}
const mockCreateComment = commentService.createComment as jest.Mock
const mockGetHumanActorId = getHumanActorId as jest.Mock
const mockActivityCreate = activityRepository.create as jest.Mock
const mockJudgeWeakening = judgeWeakening as jest.Mock
const mockBoundaryCoalesce =
  boundaryCrossingRepository.coalesceRecurrence as jest.Mock
const mockBoundaryCreate = boundaryCrossingRepository.create as jest.Mock

async function flushWaitUntil(): Promise<void> {
  await Promise.all(waitUntilPromises)
}

/** CRITERION_CHANGED payloads recorded with the given op. */
function driftPayloads(op: 'ADDED' | 'UPDATED' | 'DELETED') {
  return mockActivityCreate.mock.calls
    .map(c => c[0])
    .filter(a => a.type === 'CRITERION_CHANGED' && a.payload.op === op)
    .map(a => a.payload)
}

const ATTRIBUTION = {
  actorMemberId: 'member-1',
  sourceSessionId: 'sess-1234abcd',
}

function criterion(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    taskId: 't-1',
    statement: 'all routes covered by tests',
    verifierType: 'MACHINE' as const,
    checkpointer: 'npx jest',
    evidenceRequired: false,
    judgeSteps: null,
    referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
    source: 'AGENT_DRAFT' as const,
    addedAtRound: 0,
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    deletedAt: null,
    confirmedAt: null,
    confirmedByMemberId: null,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  waitUntilPromises.length = 0
  mockGetHumanActorId.mockResolvedValue('actor-1')
  mockCreateComment.mockResolvedValue({ id: 'comment-1' })
  mockJudgeWeakening.mockResolvedValue('EVOLVED')
  mockBoundaryCoalesce.mockResolvedValue(0)
  mockBoundaryCreate.mockResolvedValue({ id: 'bc-1' })
})

describe('taskCriteriaService.listForTask', () => {
  it('returns criteria with no count warning, whatever the count (LUM-733)', async () => {
    repo.listByTask.mockResolvedValue([criterion(), criterion({ id: 'c-2' })])
    const result = await taskCriteriaService.listForTask('t-1')
    expect(result.criteria).toHaveLength(2)
    expect(result).not.toHaveProperty('warning')
  })

  it('suppresses the judgeSteps warning for an empty (undrafted) contract', async () => {
    repo.listByTask.mockResolvedValue([])
    const result = await taskCriteriaService.listForTask('t-1')
    expect(result).toEqual({ criteria: [], judgeStepsWarning: null })
  })
})

describe('taskCriteriaService.submitDraft (agent lock)', () => {
  const items = [
    {
      statement: 's1',
      verifierType: 'MACHINE' as const,
      checkpointer: 'npx jest',
      referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
    },
    {
      statement: 's2',
      verifierType: 'HUMAN' as const,
      referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
    },
    {
      statement: 's3',
      verifierType: 'HUMAN' as const,
      evidenceRequired: true,
      referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
    },
  ]

  it('creates the round-0 AGENT_DRAFT rows when the task has no criteria', async () => {
    repo.listByTask
      .mockResolvedValueOnce([]) // empty contract → initial-draft path
      .mockResolvedValueOnce([
        criterion(),
        criterion({ id: 'c-2' }),
        criterion({ id: 'c-3' }),
      ])
    repo.countByTask.mockResolvedValue(0)
    ;(repo.create as jest.Mock).mockImplementation(
      async (input: Record<string, unknown>) =>
        criterion({ ...input, id: `id-${input.statement}` })
    )

    const result = await taskCriteriaService.submitDraft(
      't-1',
      items,
      ATTRIBUTION,
      'TODO',
      null
    )

    expect(repo.countByTask).toHaveBeenCalledWith('t-1', TX)
    expect(repo.create).toHaveBeenCalledTimes(3)
    expect(repo.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        taskId: 't-1',
        statement: 's1',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest',
        evidenceRequired: false,
        source: 'AGENT_DRAFT',
      }),
      TX
    )
    expect(repo.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ statement: 's2', checkpointer: null }),
      TX
    )
    expect(repo.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ statement: 's3', evidenceRequired: true }),
      TX
    )
    expect(result.criteria).toHaveLength(3)
    expect(result).not.toHaveProperty('warning')
  })
})

describe('stage-based criteria lock', () => {
  const items = [
    {
      statement: 'n1',
      verifierType: 'MACHINE' as const,
      checkpointer: 'npx jest',
      referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
    },
    {
      statement: 'n2',
      verifierType: 'HUMAN' as const,
      referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
    },
  ]

  it('replaces the whole contract on a TODO redraft (delete-all + create-all, AGENT_DRAFT@r0)', async () => {
    repo.listByTask
      .mockResolvedValueOnce([
        criterion({ id: 'old-1' }),
        criterion({ id: 'old-2' }),
      ]) // existing → replace
      .mockResolvedValueOnce([
        criterion({ id: 'new-1' }),
        criterion({ id: 'new-2' }),
      ]) // final re-list
    runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
    ;(repo.create as jest.Mock).mockImplementation(
      async (input: Record<string, unknown>) =>
        criterion({ ...input, id: `id-${input.statement}` })
    )

    const result = await taskCriteriaService.submitDraft(
      't-1',
      items,
      ATTRIBUTION,
      'TODO',
      null
    )

    // every existing row deleted, every new row created — full-group replace
    expect(repo.delete).toHaveBeenCalledWith('old-1', TX)
    expect(repo.delete).toHaveBeenCalledWith('old-2', TX)
    expect(repo.create).toHaveBeenCalledTimes(2)
    expect(repo.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ statement: 'n1', source: 'AGENT_DRAFT' }),
      TX
    )
    expect(repo.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ statement: 'n2', source: 'AGENT_DRAFT' }),
      TX
    )
    expect(result.criteria).toHaveLength(2)

    // Faithful drift: a DELETED event per old row and an ADDED per new row,
    // all stamped AGENT_DRAFT@round0 (the redraft stays an agent draft).
    const deleted = driftPayloads('DELETED')
    const added = driftPayloads('ADDED')
    expect(deleted.map(p => p.criterionId).sort()).toEqual(['old-1', 'old-2'])
    expect(added).toHaveLength(2)
    for (const p of [...deleted, ...added]) {
      expect(p).toMatchObject({ source: 'AGENT_DRAFT', round: 0 })
    }
    expect(deleted.every(p => p.after === null)).toBe(true)
    expect(added.every(p => p.before === null)).toBe(true)
  })

  it('resolves an agent redraft once work has started (no 409 — editable until DONE)', async () => {
    // After-start edit is an identity-preserving diff, not a 409. Submitting
    // an all-new list (no ids) drops both existing rows and adds the new ones.
    repo.listByTask
      .mockResolvedValueOnce([
        criterion({ id: 'old-1' }),
        criterion({ id: 'old-2' }),
      ])
      .mockResolvedValueOnce([
        criterion({ id: 'new-1' }),
        criterion({ id: 'new-2' }),
      ])
    runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
    runRepo.maxRoundByTask.mockResolvedValue(1)
    ;(repo.create as jest.Mock).mockImplementation(
      async (input: Record<string, unknown>) =>
        criterion({ ...input, id: `id-${input.statement}` })
    )

    await expect(
      taskCriteriaService.submitDraft(
        't-1',
        items,
        ATTRIBUTION,
        'IN_PROGRESS',
        new Date('2026-06-05')
      )
    ).resolves.toMatchObject({ criteria: expect.any(Array) })

    expect(repo.create).toHaveBeenCalledTimes(2)
  })

  it('still allows the initial draft when the contract is empty, regardless of stage', async () => {
    repo.listByTask
      .mockResolvedValueOnce([]) // empty → initial-draft path even outside TODO
      .mockResolvedValueOnce([criterion(), criterion({ id: 'c-2' })])
    repo.countByTask.mockResolvedValue(0)
    ;(repo.create as jest.Mock).mockImplementation(
      async (input: Record<string, unknown>) =>
        criterion({ ...input, id: `id-${input.statement}` })
    )

    await taskCriteriaService.submitDraft(
      't-1',
      items,
      ATTRIBUTION,
      'IN_PROGRESS',
      new Date('2026-06-05')
    )

    expect(repo.create).toHaveBeenCalledTimes(2)
  })

  it('leaves human (--human) revisions stage-independent — reviseAsHuman is never gated by status', async () => {
    // reviseAsHuman takes taskStatus but applies no gate — allowed in every stage by construction.
    repo.listByTask
      .mockResolvedValueOnce([criterion({ id: 'c-1' })])
      .mockResolvedValueOnce([
        criterion({ id: 'c-1', statement: 'reworded', source: 'HUMAN_EDIT' }),
      ])
    runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
    runRepo.maxRoundByTask.mockResolvedValue(1)

    await taskCriteriaService.reviseAsHuman(
      't-1',
      [
        {
          id: 'c-1',
          statement: 'reworded',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS'
    )

    expect(repo.update).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ source: 'HUMAN_EDIT' }),
      TX
    )
  })
})

describe('verdict-bearing criterion is soft-deleted, never 409, by an after-start agent redraft', () => {
  it('soft-deletes a dropped run-bearing criterion instead of refusing (no 409)', async () => {
    // After-start agent edit keeps c-2 (by id) and drops c-1, which has runs.
    repo.listByTask
      .mockResolvedValueOnce([
        criterion({ id: 'c-1' }),
        criterion({ id: 'c-2' }),
      ])
      .mockResolvedValueOnce([criterion({ id: 'c-2' })])
    runRepo.latestRunsByCriterion.mockResolvedValue(
      new Map([['c-1', { id: 'run-1' }]])
    )
    runRepo.maxRoundByTask.mockResolvedValue(2)

    await expect(
      taskCriteriaService.submitDraft(
        't-1',
        [
          {
            id: 'c-2',
            statement: 'all routes covered by tests',
            verifierType: 'MACHINE',
            checkpointer: 'npx jest',
            referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
          },
        ],
        ATTRIBUTION,
        'IN_PROGRESS',
        new Date('2026-06-05')
      )
    ).resolves.toMatchObject({ criteria: expect.any(Array) })

    // c-1 has runs → soft-deleted (tombstone), not hard-deleted.
    expect(repo.softDelete).toHaveBeenCalledWith('c-1', TX)
    expect(repo.delete).not.toHaveBeenCalledWith('c-1', TX)
  })
})

describe('editable until DONE (LUM-437)', () => {
  it('full-replaces an existing contract on the first TODO (workStartedAt null), no 409', async () => {
    repo.listByTask
      .mockResolvedValueOnce([
        criterion({ id: 'old-1' }),
        criterion({ id: 'old-2' }),
      ])
      .mockResolvedValueOnce([
        criterion({ id: 'new-1', statement: 'r1' }),
        criterion({ id: 'new-2', statement: 'r2' }),
      ])
    runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
    ;(repo.create as jest.Mock).mockImplementation(
      async (input: Record<string, unknown>) =>
        criterion({ ...input, id: `id-${input.statement}` })
    )

    const result = await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          statement: 'r1',
          verifierType: 'HUMAN' as const,
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
        {
          statement: 'r2',
          verifierType: 'HUMAN' as const,
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'TODO',
      null
    )

    expect(repo.delete).toHaveBeenCalledWith('old-1', TX)
    expect(repo.delete).toHaveBeenCalledWith('old-2', TX)
    expect(repo.create).toHaveBeenCalledTimes(2)
    expect(result.criteria.map(c => c.statement)).toEqual(['r1', 'r2'])
  })

  it('after-start edit applies an id-keyed diff (keep + add + drop) and resolves, writing CRITERION_CHANGED drift', async () => {
    // existing c-keep, c-drop; desired keeps c-keep (reworded) + one new, drops c-drop
    repo.listByTask
      .mockResolvedValueOnce([
        criterion({ id: 'c-keep' }),
        criterion({ id: 'c-drop', statement: 'obsolete' }),
      ])
      .mockResolvedValueOnce([
        criterion({ id: 'c-keep' }),
        criterion({ id: 'id-brand new', statement: 'brand new' }),
      ])
    runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
    runRepo.maxRoundByTask.mockResolvedValue(3)
    ;(repo.create as jest.Mock).mockImplementation(
      async (input: Record<string, unknown>) =>
        criterion({ ...input, id: `id-${input.statement}` })
    )

    await expect(
      taskCriteriaService.submitDraft(
        't-1',
        [
          {
            id: 'c-keep',
            statement: 'reworded keep',
            verifierType: 'MACHINE' as const,
            checkpointer: 'npx jest',
            referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
          },
          {
            statement: 'brand new',
            verifierType: 'HUMAN' as const,
            referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
          },
        ],
        ATTRIBUTION,
        'IN_PROGRESS',
        new Date('2026-06-05')
      )
    ).resolves.toBeDefined()

    // run-free drop → hard-deleted; kept row updated; new row created
    expect(repo.delete).toHaveBeenCalledWith('c-drop', TX)
    expect(repo.update).toHaveBeenCalledWith(
      'c-keep',
      expect.objectContaining({ source: 'AGENT_DRAFT' }),
      TX
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        statement: 'brand new',
        source: 'AGENT_DRAFT',
        addedAtRound: 3,
      }),
      TX
    )
    // ≥1 CRITERION_CHANGED activity recorded
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CRITERION_CHANGED' }),
      TX
    )
  })

  it('after-start: a dropped run-bearing criterion is soft-deleted (not hard-deleted)', async () => {
    repo.listByTask
      .mockResolvedValueOnce([
        criterion({ id: 'c-keep' }),
        criterion({ id: 'c-runs' }),
      ])
      .mockResolvedValueOnce([criterion({ id: 'c-keep' })])
    runRepo.latestRunsByCriterion.mockResolvedValue(
      new Map([['c-runs', { id: 'run-9' }]])
    )
    runRepo.maxRoundByTask.mockResolvedValue(2)

    await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          id: 'c-keep',
          statement: 'all routes covered by tests',
          verifierType: 'MACHINE' as const,
          checkpointer: 'npx jest',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS',
      new Date('2026-06-05')
    )

    expect(repo.softDelete).toHaveBeenCalledWith('c-runs', TX)
    expect(repo.delete).not.toHaveBeenCalledWith('c-runs', TX)
  })

  it('after-start: a dropped run-free criterion is hard-deleted', async () => {
    repo.listByTask
      .mockResolvedValueOnce([
        criterion({ id: 'c-keep' }),
        criterion({ id: 'c-free' }),
      ])
      .mockResolvedValueOnce([criterion({ id: 'c-keep' })])
    runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
    runRepo.maxRoundByTask.mockResolvedValue(2)

    await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          id: 'c-keep',
          statement: 'all routes covered by tests',
          verifierType: 'MACHINE' as const,
          checkpointer: 'npx jest',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS',
      new Date('2026-06-05')
    )

    expect(repo.delete).toHaveBeenCalledWith('c-free', TX)
    expect(repo.softDelete).not.toHaveBeenCalledWith('c-free', TX)
  })

  it('rejects agent edits with 409 when the task is DONE (terminal lock)', async () => {
    repo.listByTask.mockResolvedValueOnce([criterion({ id: 'c-1' })])

    await expect(
      taskCriteriaService.submitDraft(
        't-1',
        [
          {
            statement: 'new',
            verifierType: 'HUMAN' as const,
            referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
          },
        ],
        ATTRIBUTION,
        'DONE',
        new Date('2026-06-05')
      )
    ).rejects.toMatchObject({ status: 409 })

    // No mutations should have been attempted.
    expect(repo.delete).not.toHaveBeenCalled()
    expect(repo.softDelete).not.toHaveBeenCalled()
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.update).not.toHaveBeenCalled()
  })
})

describe('taskCriteriaService.reviseAsHuman', () => {
  it('rejects an id that does not belong to the task (400)', async () => {
    repo.listByTask.mockResolvedValue([criterion()])

    await expect(
      taskCriteriaService.reviseAsHuman(
        't-1',
        [
          {
            id: 'c-elsewhere',
            statement: 's',
            verifierType: 'HUMAN',
            referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
          },
        ],
        ATTRIBUTION,
        'IN_PROGRESS'
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects duplicate ids in one submission (400)', async () => {
    repo.listByTask.mockResolvedValue([criterion()])

    await expect(
      taskCriteriaService.reviseAsHuman(
        't-1',
        [
          {
            id: 'c-1',
            statement: 'a',
            verifierType: 'HUMAN',
            referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
          },
          {
            id: 'c-1',
            statement: 'b',
            verifierType: 'HUMAN',
            referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
          },
        ],
        ATTRIBUTION,
        'IN_PROGRESS'
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('soft-deletes a dropped criterion that has verification runs (no 409 — editable until DONE)', async () => {
    repo.listByTask
      .mockResolvedValueOnce([criterion(), criterion({ id: 'c-2' })])
      .mockResolvedValueOnce([criterion({ id: 'c-2' })])
    runRepo.latestRunsByCriterion.mockResolvedValue(
      new Map([['c-1', { id: 'run-1' }]])
    )
    runRepo.maxRoundByTask.mockResolvedValue(2)

    await taskCriteriaService.reviseAsHuman(
      't-1',
      // c-1 missing from the desired list → dropped; it has runs → soft-deleted
      [
        {
          id: 'c-2',
          statement: 'all routes covered by tests',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS'
    )

    expect(repo.softDelete).toHaveBeenCalledWith('c-1', TX)
    expect(repo.delete).not.toHaveBeenCalledWith('c-1', TX)
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
        {
          id: 'c-keep',
          statement: 'kept as-is',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
        {
          id: 'c-change',
          statement: 'tightened statement',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
        {
          statement: 'brand new requirement',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS'
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

    // Audit comment carries the session provenance.
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
    runRepo.latestRunsByCriterion.mockResolvedValue(new Map())

    await taskCriteriaService.reviseAsHuman(
      't-1',
      [
        {
          id: 'c-1',
          statement: row.statement,
          verifierType: 'MACHINE',
          checkpointer: 'npx jest',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS'
    )

    expect(repo.update).not.toHaveBeenCalled()
    expect(waitUntilPromises).toHaveLength(0)
  })
})

describe('contract-weakening guard (Phase 4)', () => {
  const failedRuns = new Map([
    ['c-1', { criterionId: 'c-1', verifierType: 'AGENT', verdict: 'FAIL' }],
  ])

  beforeEach(() => {
    repo.listByTask.mockResolvedValue([criterion({ id: 'c-1' })])
    runRepo.maxRoundByTask.mockResolvedValue(2)
    ;(repo.update as jest.Mock).mockResolvedValue(criterion({ id: 'c-1' }))
  })

  function agentReword(statement: string) {
    return taskCriteriaService.submitDraft(
      't-1',
      [
        {
          id: 'c-1',
          statement,
          verifierType: 'MACHINE' as const,
          checkpointer: 'npx jest',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS',
      new Date('2026-06-05')
    )
  }

  it('records a CONTRACT_WEAKENING crossing when an open-FAIL criterion is reworded and judged WEAKENED', async () => {
    runRepo.latestRunsByCriterion.mockResolvedValue(failedRuns)
    mockJudgeWeakening.mockResolvedValue('WEAKENED')
    await agentReword('returns something')
    await flushWaitUntil()
    expect(mockBoundaryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        category: 'CONTRACT_WEAKENING',
        severity: 'MEDIUM',
        reversible: true,
      })
    )
  })

  it('records no crossing when the judge says EVOLVED', async () => {
    runRepo.latestRunsByCriterion.mockResolvedValue(failedRuns)
    mockJudgeWeakening.mockResolvedValue('EVOLVED')
    await agentReword('returns the full payload with status and body')
    await flushWaitUntil()
    expect(mockBoundaryCreate).not.toHaveBeenCalled()
  })

  it('does not judge when the reworded criterion has no open send-back', async () => {
    runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
    await agentReword('returns something')
    await flushWaitUntil()
    expect(mockJudgeWeakening).not.toHaveBeenCalled()
    expect(mockBoundaryCreate).not.toHaveBeenCalled()
  })

  it('exempts HUMAN_EDIT revisions from the weakening guard', async () => {
    runRepo.latestRunsByCriterion.mockResolvedValue(failedRuns)
    mockJudgeWeakening.mockResolvedValue('WEAKENED')
    await taskCriteriaService.reviseAsHuman(
      't-1',
      [
        {
          id: 'c-1',
          statement: 'returns something',
          verifierType: 'MACHINE' as const,
          checkpointer: 'npx jest',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS'
    )
    await flushWaitUntil()
    expect(mockJudgeWeakening).not.toHaveBeenCalled()
    expect(mockBoundaryCreate).not.toHaveBeenCalled()
  })
})

describe('referentKind threading', () => {
  it('derives the referentKind from the checkpointer on a fresh draft (declaration ignored, LUM-733)', async () => {
    repo.listByTask
      .mockResolvedValueOnce([]) // empty contract → initial-draft path
      .mockResolvedValueOnce([
        criterion({ id: 'c-new', referentKind: 'AGENT_CONSTRUCTED_STATE' }),
      ])
    repo.countByTask.mockResolvedValue(0)
    ;(repo.create as jest.Mock).mockImplementation(
      async (input: Record<string, unknown>) =>
        criterion({ ...input, id: 'c-new' })
    )

    await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          statement: 'fact check passes',
          verifierType: 'MACHINE' as const,
          checkpointer: 'npx jest',
          referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
        },
      ],
      ATTRIBUTION,
      'TODO',
      null
    )

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ referentKind: 'AGENT_CONSTRUCTED_STATE' }),
      expect.anything()
    )
  })
})
