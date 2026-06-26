/**
 * LUM-605 write path: declaring a MACHINE criterion EXTERNAL_FACT whose
 * checkpointer does not ground external is STORED (not rejected — an agent may
 * legitimately intend external behavior and the verdict path is the hard gate),
 * but the service response carries a non-rejecting warning naming the
 * ungrounded-EXTERNAL criterion so the drafter re-grounds or re-declares early.
 */
import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    create: jest.fn(),
    listByTask: jest.fn(),
    countByTask: jest.fn(() => Promise.resolve(0)),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: {
    maxRoundByTask: jest.fn(() => Promise.resolve(null)),
    latestRunsByCriterion: jest.fn(() => Promise.resolve(new Map())),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
const TX = { __tx: true }
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

const repoCreate = acceptanceCriterionRepository.create as jest.Mock
const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock

const ATTR = { actorMemberId: 'member-1', sourceSessionId: null }

const UNGROUNDED = {
  id: 'c-ext',
  taskId: 't-1',
  statement: 'no DROP reaches prod migrations',
  verifierType: 'MACHINE' as const,
  checkpointer: 'npx jest scripts/check.test.ts',
  evidenceRequired: false,
  referentKind: 'EXTERNAL_FACT' as const,
}

const HONEST = {
  ...UNGROUNDED,
  id: 'c-ok',
  statement: 'the read model returns the new column',
  referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
}

beforeEach(() => jest.clearAllMocks())

describe('LUM-605 referent-grounding write-path warning', () => {
  it('stores the ungrounded-EXTERNAL criterion and returns a warning naming it', async () => {
    listByTask.mockResolvedValueOnce([]) // existing (empty → initial draft)
    repoCreate.mockResolvedValue(UNGROUNDED)
    listByTask.mockResolvedValueOnce([UNGROUNDED]) // final read-back

    const res = await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          statement: UNGROUNDED.statement,
          verifierType: 'MACHINE',
          checkpointer: UNGROUNDED.checkpointer,
          referentKind: 'EXTERNAL_FACT',
        },
      ],
      ATTR,
      'TODO',
      null
    )

    // Stored, not rejected.
    expect(repoCreate).toHaveBeenCalledTimes(1)
    // Warning present and names the criterion + the mismatch.
    expect(res.referentWarning).toEqual(expect.any(String))
    expect(res.referentWarning).toMatch(/EXTERNAL_FACT/)
    expect(res.referentWarning).toContain('no DROP reaches prod migrations')
  })

  it('no warning when every EXTERNAL_FACT criterion is genuinely grounded / honestly declared', async () => {
    listByTask.mockResolvedValueOnce([])
    repoCreate.mockResolvedValue(HONEST)
    listByTask.mockResolvedValueOnce([HONEST])

    const res = await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          statement: HONEST.statement,
          verifierType: 'MACHINE',
          checkpointer: HONEST.checkpointer,
          referentKind: 'AGENT_CONSTRUCTED_STATE',
        },
      ],
      ATTR,
      'TODO',
      null
    )
    expect(res.referentWarning).toBeNull()
  })
})
