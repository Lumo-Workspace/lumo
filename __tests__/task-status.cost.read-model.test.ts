import { taskVerificationService } from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'

// LUM-560: the cost section of the task-status read model is read from the SAME
// retrospectiveRepository.loadActuals the web delivery card consumes. These
// tests mock loadActuals and assert the status cost mirrors it exactly (no
// independent re-summation), and that a usage-less task reads as not-measured.

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
  // Keep the real pure exports (isPassVerdict, deriveMachinePassedCriteria) —
  // only the DB-backed repo is faked.
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findHeaderById: jest.fn(),
    // LUM-573: null snapshot → live latest-session claim fallback.
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-583: statusForTask reads the persisted claim-faithfulness verdict.
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-564: statusForTask reads the latest session's run-claim material.
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
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
// Mocked to keep its GitHub/octokit ESM import chain out of the test runtime.
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

const listActive = acceptanceCriterionRepository.listByTask as jest.Mock
const listAll =
  acceptanceCriterionRepository.listByTaskIncludingDeleted as jest.Mock
const listRuns = verificationRunRepository.listByTask as jest.Mock
const listEvents = activityRepository.listByTaskAndType as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const loadActuals = retrospectiveRepository.loadActuals as jest.Mock

const HEADER = {
  id: 't-1',
  number: 560,
  title: 'unified task cost report',
  status: 'IN_REVIEW',
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

function actuals(over: Record<string, unknown> = {}) {
  return {
    projectId: 'p-1',
    tokenCost: 1_250_000,
    iterations: 2,
    interactionRounds: 4,
    totalDurationSec: 8040,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  findHeader.mockResolvedValue(HEADER)
  listActive.mockResolvedValue([criterion()])
  listAll.mockResolvedValue([criterion()])
  listRuns.mockResolvedValue([run()])
  listEvents.mockResolvedValue([])
  loadActuals.mockResolvedValue(actuals())
})

describe('task-status cost read model LUM-560 (LUM-560)', () => {
  it('cost section is derived from loadActuals (token + active time + rework rounds)', async () => {
    // A round-1 FAIL → one rework round; a round-2 all-pass on a second run.
    listRuns.mockResolvedValue([
      run({ id: 'r-fail', round: 1, verdict: 'FAIL', evidencePointer: null }),
      run({ id: 'r-pass', round: 2, verdict: 'PASS' }),
    ])
    loadActuals.mockResolvedValue(
      actuals({ tokenCost: 1_250_000, totalDurationSec: 8040 })
    )

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.cost.tokenCost).toBe(1_250_000)
    expect(s.cost.activeTimeSec).toBe(8040)
    // reworkRounds = verification rounds with ≥1 FAIL (round 1 here).
    expect(s.cost.reworkRounds).toBe(1)
  })

  it('token cost is not-measured null when no usage is recorded (花了0 vs 没测到)', async () => {
    // A session exists but recorded no token usage → loadActuals.tokenCost null.
    loadActuals.mockResolvedValue(actuals({ tokenCost: null }))

    const s = await taskVerificationService.statusForTask('t-1')

    // null = not measured, kept distinct from a measured 0.
    expect(s.cost.tokenCost).toBeNull()
    expect(s.cost.tokenCost).not.toBe(0)

    // A genuine measured zero stays 0, never collapsed to null.
    loadActuals.mockResolvedValue(actuals({ tokenCost: 0 }))
    const zero = await taskVerificationService.statusForTask('t-1')
    expect(zero.cost.tokenCost).toBe(0)
  })

  it('falls back to not-measured cost when loadActuals returns null (task row gone)', async () => {
    loadActuals.mockResolvedValue(null)

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.cost.tokenCost).toBeNull()
    expect(s.cost.activeTimeSec).toBe(0)
  })

  it('status cost matches the loadActuals source the web card reads (no drift)', async () => {
    // The exact values loadActuals (the web delivery card's source) returns must
    // surface verbatim on the status read model — proving same-source, no
    // independent re-summation that could drift from the web card.
    const src = actuals({ tokenCost: 987_654, totalDurationSec: 3725 })
    loadActuals.mockResolvedValue(src)

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.cost.tokenCost).toBe(src.tokenCost)
    expect(s.cost.activeTimeSec).toBe(src.totalDurationSec)
  })
})
