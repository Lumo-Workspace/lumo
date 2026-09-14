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
    softDelete: jest.fn(),
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
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))

const repo = acceptanceCriterionRepository as jest.Mocked<
  typeof acceptanceCriterionRepository
>
const runRepo = verificationRunRepository as unknown as {
  maxRoundByTask: jest.Mock
  latestRunsByCriterion: jest.Mock
}

function existingHuman(id = 'c-old') {
  return {
    id,
    taskId: 't1',
    statement: 'old',
    verifierType: 'HUMAN',
    checkpointer: null,
    evidenceRequired: false,
    referentKind: 'AGENT_CONSTRUCTED_STATE',
    source: 'HUMAN_EDIT',
    addedAtRound: 0,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  waitUntilPromises.length = 0
  runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
  runRepo.maxRoundByTask.mockResolvedValue(2)
  repo.create.mockImplementation(async (input: any) => ({
    id: 'c-new',
    ...input,
  }))
  ;(getHumanActorId as jest.Mock).mockResolvedValue('actor-web')
  ;(commentService.createComment as jest.Mock).mockResolvedValue({
    id: 'comment-1',
  })
})

describe('reviseAsHuman REVIEW_ADDED derivation', () => {
  it('reviseAsHuman stamps REVIEW_ADDED in review for a newly added criterion', async () => {
    repo.listByTask.mockResolvedValue([existingHuman()] as any)
    await taskCriteriaService.reviseAsHuman(
      't1',
      [
        {
          id: 'c-old',
          statement: 'old',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE',
        },
        {
          statement: 'fresh gap',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE',
        },
      ],
      { actorMemberId: 'm1', sourceSessionId: null },
      'IN_REVIEW'
    )
    const createArg =
      repo.create.mock.calls[repo.create.mock.calls.length - 1]![0]
    expect(createArg.source).toBe('REVIEW_ADDED')
    expect(createArg.addedAtRound).toBe(2)
  })

  it('reviseAsHuman stamps HUMAN_EDIT outside review for a newly added criterion', async () => {
    repo.listByTask.mockResolvedValue([existingHuman()] as any)
    await taskCriteriaService.reviseAsHuman(
      't1',
      [
        {
          id: 'c-old',
          statement: 'old',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE',
        },
        {
          statement: 'fresh gap',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE',
        },
      ],
      { actorMemberId: 'm1', sourceSessionId: null },
      'IN_PROGRESS'
    )
    expect(
      repo.create.mock.calls[repo.create.mock.calls.length - 1]![0].source
    ).toBe('HUMAN_EDIT')
  })

  it('reviseAsHuman keeps an edited row HUMAN_EDIT in review', async () => {
    repo.listByTask.mockResolvedValue([existingHuman()] as any)
    await taskCriteriaService.reviseAsHuman(
      't1',
      [
        {
          id: 'c-old',
          statement: 'reworded',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE',
        },
      ],
      { actorMemberId: 'm1', sourceSessionId: null },
      'IN_REVIEW'
    )
    expect(repo.update).toHaveBeenCalledWith(
      'c-old',
      expect.objectContaining({ source: 'HUMAN_EDIT' }),
      expect.anything()
    )
    expect(repo.create).not.toHaveBeenCalled()
  })
})

describe('revision audit comment via web', () => {
  it('revision audit comment attributes via web for a clerk-origin edit', async () => {
    repo.listByTask.mockResolvedValue([existingHuman()] as any)
    await taskCriteriaService.reviseAsHuman(
      't1',
      [
        {
          id: 'c-old',
          statement: 'reworded by human',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE',
        },
      ],
      { actorMemberId: 'm1', sourceSessionId: null, origin: 'web' },
      'IN_REVIEW'
    )
    await Promise.all(waitUntilPromises.splice(0))
    const calls = (commentService.createComment as jest.Mock).mock.calls
    const body = calls[calls.length - 1]![0].body as string
    expect(body).toMatch(/via web/)
    expect(body).not.toMatch(/session unknown/)
  })
})
