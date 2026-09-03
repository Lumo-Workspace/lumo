/**
 * LUM-733: the acceptance contract no longer asks the agent for a referentKind
 * declaration — the server derives the kind from the checkpointer — and the
 * server no longer emits the 3–7 criterion-count warning.
 */
import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { criteriaSetBodySchema } from '@/lib/validation/acceptance'
import { deriveReferentKind } from '../shared/src/referent-kind'

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

const JEST_ITEM = {
  statement: 'the read model returns the new column',
  verifierType: 'MACHINE' as const,
  checkpointer: 'npx jest __tests__/read-model.test.ts',
}
const GIT_ITEM = {
  statement: 'no migration file is deleted vs origin/main',
  verifierType: 'MACHINE' as const,
  checkpointer:
    'bash -c "test -z \"$(git diff --diff-filter=D --name-only origin/main -- prisma/migrations/)\""',
}
const HUMAN_ITEM = {
  statement: 'the copy reads naturally',
  verifierType: 'HUMAN' as const,
  judgeSteps: 'Open the tab; pass if it reads well.',
}

beforeEach(() => jest.clearAllMocks())

describe('LUM-733 acceptance contract: derived kind, no count warning', () => {
  it('LUM-733 criteria set accepts items without referentKind and emits no count warning', async () => {
    // Schema: a single item without referentKind is a valid body (a count the
    // old soft-cap would have warned on).
    const body = criteriaSetBodySchema.safeParse({
      source: 'AGENT_DRAFT',
      criteria: [JEST_ITEM],
    })
    expect(body.success).toBe(true)

    // Service: the stored kind is derived from the checkpointer, and the
    // response carries no count/grounding warning fields at all.
    listByTask.mockResolvedValueOnce([])
    repoCreate.mockImplementation(async (row: Record<string, unknown>) => ({
      id: `c-${String(row.statement).length}`,
      taskId: 't-1',
      evidenceRequired: false,
      judgeSteps: null,
      addedAtRound: 0,
      ...row,
    }))
    listByTask.mockResolvedValueOnce([])

    const res = await taskCriteriaService.submitDraft(
      't-1',
      [JEST_ITEM, GIT_ITEM, HUMAN_ITEM],
      ATTR,
      'TODO',
      null
    )

    const kinds = repoCreate.mock.calls.map(
      ([row]: [{ statement: string; referentKind: string | null }]) => [
        row.statement,
        row.referentKind,
      ]
    )
    expect(kinds).toEqual([
      [JEST_ITEM.statement, 'AGENT_CONSTRUCTED_STATE'],
      [GIT_ITEM.statement, 'EXTERNAL_FACT'],
      [HUMAN_ITEM.statement, null],
    ])
    expect(res).not.toHaveProperty('warning')
    expect(res).not.toHaveProperty('referentWarning')
  })

  it('ignores a declaration on a MACHINE criterion and keeps one on a HUMAN criterion', () => {
    expect(
      deriveReferentKind({ ...JEST_ITEM, declared: 'EXTERNAL_FACT' })
    ).toBe('AGENT_CONSTRUCTED_STATE')
    expect(
      deriveReferentKind({ ...GIT_ITEM, declared: 'AGENT_CONSTRUCTED_STATE' })
    ).toBe('EXTERNAL_FACT')
    expect(
      deriveReferentKind({
        verifierType: 'HUMAN',
        checkpointer: null,
        declared: 'EXTERNAL_FACT',
      })
    ).toBe('EXTERNAL_FACT')
    expect(
      deriveReferentKind({
        verifierType: 'HUMAN',
        checkpointer: null,
        declared: 'PENDING_OUTCOME',
      })
    ).toBeNull()
  })
})
