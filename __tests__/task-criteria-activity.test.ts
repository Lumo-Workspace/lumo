/**
 * LUM-343 drift records (milestone rule 9): every criteria add/update/delete
 * — including the pre-existing LUM-342 submitDraft / reviseAsHuman paths —
 * lands a structured CRITERION_CHANGED TaskActivity inside the same write
 * transaction, payload {op, criterionId, source, round, causeTag?, before,
 * after}.
 */
import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

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
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))

const TX = { __tx: true }
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))

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
const createActivity = activityRepository.create as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock

const ATTRIBUTION = {
  actorMemberId: 'member-1',
  sourceSessionId: 'sess-1234abcd',
}

function existing(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    taskId: 't-1',
    statement: `old statement ${id}`,
    verifierType: 'MACHINE',
    checkpointer: 'npx jest old',
    evidenceRequired: false,
    // LUM-733: the stored kind is derived from the checkpointer — a jest check
    // is AGENT_CONSTRUCTED_STATE. A fixture declaring EXTERNAL_FACT here would
    // make an untouched criterion look changed on every revision.
    referentKind: 'AGENT_CONSTRUCTED_STATE',
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    ...over,
  }
}

function activityCalls(op?: string) {
  const calls = createActivity.mock.calls.filter(
    c => c[0].type === 'CRITERION_CHANGED'
  )
  return op ? calls.filter(c => c[0].payload.op === op) : calls
}

beforeEach(() => {
  jest.clearAllMocks()
  waitUntilPromises.length = 0
  findActor.mockResolvedValue({ id: 'actor-1' })
  runRepo.maxRoundByTask.mockResolvedValue(2)
  runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
  ;(repo.create as jest.Mock).mockImplementation(
    async (input: Record<string, unknown>) => ({
      id: `new-${String(input.statement).slice(0, 4)}`,
      ...input,
    })
  )
  ;(repo.countByTask as jest.Mock).mockResolvedValue(0)
  ;(repo.listByTask as jest.Mock).mockResolvedValue([])
})

describe('submitDraft drift records', () => {
  it('writes one ADDED activity per drafted criterion, in the tx, at round 0', async () => {
    await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          statement: 'first',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest a',
          referentKind: 'EXTERNAL_FACT',
        },
        {
          statement: 'second',
          verifierType: 'HUMAN',
          referentKind: 'EXTERNAL_FACT',
        },
      ],
      ATTRIBUTION,
      'TODO'
    )
    const added = activityCalls('ADDED')
    expect(added).toHaveLength(2)
    for (const call of added) {
      expect(call[1]).toBe(TX)
      expect(call[0].actorId).toBe('actor-1')
      expect(call[0].payload).toMatchObject({
        source: 'AGENT_DRAFT',
        round: 0,
        before: null,
      })
      expect(call[0].payload.after.statement).toBeTruthy()
      expect(call[0].payload.causeTag).toBeUndefined()
    }
  })
})

describe('reviseAsHuman drift records', () => {
  it('writes ADDED / UPDATED / DELETED activities with before/after, round, and causeTag', async () => {
    ;(repo.listByTask as jest.Mock).mockResolvedValue([
      existing('keep-1'),
      existing('gone-1'),
    ])

    await taskCriteriaService.reviseAsHuman(
      't-1',
      [
        {
          id: 'keep-1',
          statement: 'reworded statement',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest new',
          referentKind: 'EXTERNAL_FACT',
        },
        {
          statement: 'brand new',
          verifierType: 'HUMAN',
          referentKind: 'EXTERNAL_FACT',
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS',
      'SCOPE_CHANGE'
    )

    const deleted = activityCalls('DELETED')
    expect(deleted).toHaveLength(1)
    expect(deleted[0]![1]).toBe(TX)
    expect(deleted[0]![0].payload).toMatchObject({
      criterionId: 'gone-1',
      source: 'HUMAN_EDIT',
      round: 2,
      causeTag: 'SCOPE_CHANGE',
      after: null,
    })
    expect(deleted[0]![0].payload.before.statement).toBe('old statement gone-1')

    const updated = activityCalls('UPDATED')
    expect(updated).toHaveLength(1)
    expect(updated[0]![0].payload.before.statement).toBe('old statement keep-1')
    expect(updated[0]![0].payload.after.statement).toBe('reworded statement')
    expect(updated[0]![0].payload.causeTag).toBe('SCOPE_CHANGE')

    const added = activityCalls('ADDED')
    expect(added).toHaveLength(1)
    expect(added[0]![0].payload.before).toBeNull()
    expect(added[0]![0].payload.after.statement).toBe('brand new')
  })

  it('writes no UPDATED activity for an untouched criterion and no causeTag when omitted', async () => {
    ;(repo.listByTask as jest.Mock).mockResolvedValue([existing('keep-1')])

    await taskCriteriaService.reviseAsHuman(
      't-1',
      [
        {
          id: 'keep-1',
          statement: 'old statement keep-1',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest old',
          referentKind: 'EXTERNAL_FACT',
        },
        {
          statement: 'extra',
          verifierType: 'HUMAN',
          referentKind: 'EXTERNAL_FACT',
        },
      ],
      ATTRIBUTION,
      'IN_PROGRESS'
    )

    expect(activityCalls('UPDATED')).toHaveLength(0)
    const added = activityCalls('ADDED')
    expect(added).toHaveLength(1)
    expect(added[0]![0].payload.causeTag).toBeUndefined()
  })
})
