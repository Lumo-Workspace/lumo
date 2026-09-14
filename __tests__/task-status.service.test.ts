import {
  taskVerificationService,
  TASK_STATUS_SCHEMA_VERSION,
  type NextActionCriterion,
} from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { notifyWorkspaceOwners } from '@/lib/notifications/notifyWorkspaceOwners'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(),
    listByTaskIncludingDeleted: jest.fn(),
    createMany: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  // Keep the real pure exports (isPassVerdict, deriveAllPassRoundTaskIds) —
  // only the DB-backed repository is faked.
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    listByTask: jest.fn(),
    createMany: jest.fn(),
    maxRoundByTask: jest.fn(),
    latestHumanVerdictAction: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-586: the read model reads withdrawal tombstones — fake them so the view
// resolves without a DB. Defaults = nothing withdrawn.
jest.mock('@/lib/repositories/verification-run-withdrawal.repository', () => ({
  verificationRunWithdrawalRepository: {
    actionIdsByTask: jest.fn(() => Promise.resolve(new Set())),
    latestByTask: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findHeaderById: jest.fn(),
    findStatus: jest.fn(),
    // LUM-573: null snapshot → the read path falls back to the live
    // latest-session claim, so existing claim expectations are unaffected.
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))
jest.mock('@/lib/notifications/notifyWorkspaceOwners', () => ({
  notifyWorkspaceOwners: jest.fn(),
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    // LUM-564: latest session's run-claim material; null = no session (no claim).
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-583: statusForTask reads the persisted claim-faithfulness verdict.
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})) },
}))

const listCriteria = acceptanceCriterionRepository.listByTask as jest.Mock
const listRuns = verificationRunRepository.listByTask as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const writeSpies = [
  acceptanceCriterionRepository.createMany as jest.Mock,
  verificationRunRepository.createMany as jest.Mock,
  activityRepository.create as jest.Mock,
  notifyWorkspaceOwners as jest.Mock,
]

const HEADER = {
  id: 't-1',
  number: 344,
  title: 'lumo task status',
  status: 'IN_PROGRESS',
  team: { identifier: 'LUM' },
}

function criterion(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    taskId: 't-1',
    statement: 'route rejects bad input',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest x.test.ts',
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    ...over,
  }
}

function run(over: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    taskId: 't-1',
    criterionId: 'c-1',
    round: 1,
    verifierType: 'MACHINE',
    verdict: 'PASS',
    evidencePointer: 'cmd:npx jest x.test.ts#exit=0',
    rejectionReason: null,
    rejectionReasonEnum: null,
    createdAt: new Date('2026-06-02T10:00:00Z'),
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  findHeader.mockResolvedValue(HEADER)
  listCriteria.mockResolvedValue([])
  listRuns.mockResolvedValue([])
  ;(
    acceptanceCriterionRepository.listByTaskIncludingDeleted as jest.Mock
  ).mockResolvedValue([])
  ;(activityRepository.listByTaskAndType as jest.Mock).mockResolvedValue([])
})

describe('statusForTask — read model', () => {
  it('returns the versioned payload with the task header', async () => {
    const s = await taskVerificationService.statusForTask('t-1')
    expect(s.version).toBe(TASK_STATUS_SCHEMA_VERSION)
    expect(s.task).toEqual({
      id: 't-1',
      identifier: 'LUM-344',
      title: 'lumo task status',
      status: 'IN_PROGRESS',
    })
    expect(s.maxRounds).toBe(3)
  })

  it('annotates every criterion with provenance and its latest verdict', async () => {
    listCriteria.mockResolvedValue([
      criterion(),
      criterion({
        id: 'c-2',
        statement: 'gap found in review',
        source: 'REVIEW_ADDED',
        addedAtRound: 2,
        verifierType: 'HUMAN',
        checkpointer: null,
      }),
    ])
    listRuns.mockResolvedValue([
      run({ verdict: 'FAIL', rejectionReason: 'old failure' }),
      run({
        id: 'r-2',
        round: 2,
        verdict: 'PASS',
        createdAt: new Date('2026-06-03T10:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    const c1 = s.criteria.find(c => c.id === 'c-1')!
    expect(c1.source).toBe('AGENT_DRAFT')
    expect(c1.latestVerdict).toEqual({
      round: 2,
      verdict: 'PASS',
      verifierType: 'MACHINE',
      evidencePointer: 'cmd:npx jest x.test.ts#exit=0',
      rejectionReason: null,
      rejectionReasonEnum: null,
      recordedAt: '2026-06-03T10:00:00.000Z',
    })

    // REVIEW_ADDED provenance survives verbatim; never-verified → null verdict
    const c2 = s.criteria.find(c => c.id === 'c-2')!
    expect(c2.source).toBe('REVIEW_ADDED')
    expect(c2.addedAtRound).toBe(2)
    expect(c2.latestVerdict).toBeNull()
  })

  it('derives everything without touching any write path', async () => {
    listCriteria.mockResolvedValue([criterion()])
    listRuns.mockResolvedValue([run()])
    await taskVerificationService.statusForTask('t-1')
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled()
  })

  it('404s when the task does not exist', async () => {
    findHeader.mockResolvedValue(null)
    await expect(
      taskVerificationService.statusForTask('nope')
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('statusForTask — round derivation', () => {
  it('never-verified task → round 0, empty history, not escalated', async () => {
    listCriteria.mockResolvedValue([criterion()])
    const s = await taskVerificationService.statusForTask('t-1')
    expect(s.currentRound).toBe(0)
    expect(s.verificationHistory).toEqual([])
    expect(s.lastRoundFailures).toEqual([])
    expect(s.escalated).toBe(false)
  })

  it('currentRound = max(round); history grouped per round, oldest first', async () => {
    listCriteria.mockResolvedValue([criterion(), criterion({ id: 'c-2' })])
    listRuns.mockResolvedValue([
      run({ verdict: 'FAIL', rejectionReason: 'broke' }),
      run({ id: 'r-1b', criterionId: 'c-2', verdict: 'PASS' }),
      run({
        id: 'r-2',
        round: 2,
        verdict: 'PASS',
        createdAt: new Date('2026-06-03T10:00:00Z'),
      }),
      run({
        id: 'r-2b',
        criterionId: 'c-2',
        round: 2,
        verdict: 'PASS',
        createdAt: new Date('2026-06-03T10:00:05Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.currentRound).toBe(2)
    expect(s.verificationHistory).toHaveLength(2)
    expect(s.verificationHistory[0]).toMatchObject({
      round: 1,
      recordedAt: '2026-06-02T10:00:00.000Z',
      passed: 1,
      failed: 1,
    })
    expect(s.verificationHistory[1]).toMatchObject({
      round: 2,
      passed: 2,
      failed: 0,
    })
  })

  it('surfaces only the most recent round’s failures with their reasons', async () => {
    listCriteria.mockResolvedValue([criterion(), criterion({ id: 'c-2' })])
    listRuns.mockResolvedValue([
      run({ criterionId: 'c-2', verdict: 'FAIL', rejectionReason: 'r1 noise' }),
      run({ id: 'r-1b', verdict: 'PASS' }),
      run({
        id: 'r-2',
        round: 2,
        verdict: 'FAIL',
        rejectionReason: '3 tests failed',
        rejectionReasonEnum: 'CRITERION_UNMET',
        createdAt: new Date('2026-06-03T10:00:00Z'),
      }),
      run({
        id: 'r-2b',
        criterionId: 'c-2',
        round: 2,
        verdict: 'PASS',
        createdAt: new Date('2026-06-03T10:00:05Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.lastRoundFailures).toEqual([
      {
        criterionId: 'c-1',
        statement: 'route rejects bad input',
        rejectionReason: '3 tests failed',
        rejectionReasonEnum: 'CRITERION_UNMET',
      },
    ])
  })

  it('escalated only when the cap is reached with failures', async () => {
    listCriteria.mockResolvedValue([criterion()])

    listRuns.mockResolvedValue([
      run({ round: 3, verdict: 'FAIL', rejectionReason: 'still broken' }),
    ])
    expect((await taskVerificationService.statusForTask('t-1')).escalated).toBe(
      true
    )

    listRuns.mockResolvedValue([run({ round: 3, verdict: 'PASS' })])
    expect((await taskVerificationService.statusForTask('t-1')).escalated).toBe(
      false
    )

    listRuns.mockResolvedValue([
      run({ round: 2, verdict: 'FAIL', rejectionReason: 'mid loop' }),
    ])
    expect((await taskVerificationService.statusForTask('t-1')).escalated).toBe(
      false
    )
  })
})

describe('statusForTask — nextActions', () => {
  it('contains exactly the criteria whose latest verdict is not a pass', async () => {
    listCriteria.mockResolvedValue([
      criterion(), // FAILed in r2 after passing r1 → unmet
      criterion({ id: 'c-pass' }), // PASS → met
      criterion({ id: 'c-followup' }), // PASS_WITH_FOLLOWUP → met
      criterion({
        id: 'c-human',
        verifierType: 'HUMAN',
        checkpointer: null,
        statement: 'copy reads well',
      }), // never verified → unmet
    ])
    listRuns.mockResolvedValue([
      run({ verdict: 'PASS' }),
      run({ id: 'rp', criterionId: 'c-pass', verdict: 'PASS' }),
      run({
        id: 'rf',
        criterionId: 'c-followup',
        verifierType: 'HUMAN',
        verdict: 'PASS_WITH_FOLLOWUP',
      }),
      run({
        id: 'r2',
        round: 2,
        verdict: 'FAIL',
        rejectionReason: 'regressed',
        createdAt: new Date('2026-06-03T10:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(
      s.nextActions
        .flatMap(a => (a.kind === 'CRITERION' ? [a.criterionId] : []))
        .sort()
    ).toEqual(['c-1', 'c-human'])
    const failAction = s.nextActions.find(
      (a): a is NextActionCriterion =>
        a.kind === 'CRITERION' && a.criterionId === 'c-1'
    )!
    expect(failAction.rejectionReason).toBe('regressed')
    expect(failAction.checkpointer).toBe('npx jest x.test.ts')
    const humanAction = s.nextActions.find(
      (a): a is NextActionCriterion =>
        a.kind === 'CRITERION' && a.criterionId === 'c-human'
    )!
    expect(humanAction.rejectionReason).toBeNull()
    expect(humanAction.verifierType).toBe('HUMAN')
  })

  it('latest verdict wins — a FAIL fixed by a later PASS drops out', async () => {
    listCriteria.mockResolvedValue([criterion()])
    listRuns.mockResolvedValue([
      run({ verdict: 'FAIL', rejectionReason: 'broke' }),
      run({
        id: 'r-2',
        round: 2,
        verdict: 'PASS',
        createdAt: new Date('2026-06-03T10:00:00Z'),
      }),
    ])
    const s = await taskVerificationService.statusForTask('t-1')
    expect(s.nextActions).toEqual([])
  })

  it('empty contract → empty nextActions (drafting is the caller’s pointer)', async () => {
    const s = await taskVerificationService.statusForTask('t-1')
    expect(s.criteria).toEqual([])
    expect(s.nextActions).toEqual([])
  })
})
