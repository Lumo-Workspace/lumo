import { taskVerificationService } from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(),
    listByTaskIncludingDeleted: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    listByTask: jest.fn(),
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
  activityRepository: { listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findHeaderById: jest.fn(),
    // LUM-573: statusForTask reads the frozen claim snapshot; null → live fallback.
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-564 / LUM-583: statusForTask also reads the latest session's run-claim
// material and the persisted claim-faithfulness verdict.
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findVerificationMaxRounds: jest.fn() },
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
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

const listActive = acceptanceCriterionRepository.listByTask as jest.Mock
const listAll =
  acceptanceCriterionRepository.listByTaskIncludingDeleted as jest.Mock
const listRuns = verificationRunRepository.listByTask as jest.Mock
const listChangeEvents = activityRepository.listByTaskAndType as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock

const HEADER = {
  id: 't-1',
  number: 457,
  title: 'stale-verdict detection',
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
    deletedAt: null,
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
  listActive.mockResolvedValue([])
  listAll.mockResolvedValue([])
  listRuns.mockResolvedValue([])
  listChangeEvents.mockResolvedValue([])
})

// LUM-457 invariant: the DONE gate is unchanged. A criterion whose latest
// verdict is a PASS still counts as met even when that PASS is stale or its
// machine evidence mismatches the current checkpointer — v1 is a render-only
// hint, it does NOT tighten the gate. Stale detection must never silently turn
// a passing criterion into an unmet one (which would block DONE).
describe('stale PASS stays met — DONE gate unchanged (LUM-457)', () => {
  it('keeps a stale-but-passing criterion out of nextActions', async () => {
    const c = criterion({
      // edited after the verdict (stale) AND checkpointer renamed (mismatch).
      checkpointer: 'npx jest renamed.test.ts',
      updatedAt: new Date('2026-06-05T00:00:00Z'),
    })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({ evidencePointer: 'cmd:npx jest old.test.ts#exit=0' }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    // The flags fire…
    expect(s.criteria[0]!.verdictStale).toBe(true)
    expect(s.criteria[0]!.checkMismatch).toBe(true)
    // …but the criterion is still met: not in nextActions, gate not blocked.
    expect(
      s.nextActions.flatMap(a =>
        a.kind === 'CRITERION' ? [a.criterionId] : []
      )
    ).not.toContain('c-1')
    expect(s.nextActions).toHaveLength(0)
  })

  it('still lists a genuinely unmet (FAIL) criterion in nextActions', async () => {
    const c = criterion({ id: 'c-fail' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        criterionId: 'c-fail',
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: 'still broken',
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(
      s.nextActions.flatMap(a =>
        a.kind === 'CRITERION' ? [a.criterionId] : []
      )
    ).toContain('c-fail')
  })
})
