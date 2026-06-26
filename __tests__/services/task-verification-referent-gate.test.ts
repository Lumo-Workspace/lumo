/**
 * LUM-605: the verdict path (recordMachineRound) is the gate, not a mirror. A
 * criterion declared EXTERNAL_FACT whose checkpointer does not actually invoke
 * external tooling (effectiveReferentKind → UNVERIFIED_ASSERTION) must not
 * launder a clean machine-PASS — the round is blocked (422, no round burned).
 * An honestly-declared AGENT_CONSTRUCTED_STATE criterion with the same jest
 * checkpointer passes through. Both declared classes run through the REAL
 * recordMachineRound, per the acceptance contract (not just a classifier unit).
 */
import { taskVerificationService } from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { taskService } from '@/lib/services/task.service'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    createMany: jest.fn(),
    maxRoundByTask: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findStatus: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findVerificationMaxRounds: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(() => Promise.resolve({ id: 'actor-1' })),
  },
}))
jest.mock('@/lib/notifications/notifyWorkspaceOwners', () => ({
  notifyWorkspaceOwners: jest.fn(),
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    getTaskDetail: jest.fn(() => Promise.resolve({ status: 'IN_PROGRESS' })),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-claim-snapshot.service', () => ({
  taskClaimSnapshotService: { recordAgentSelfClaim: jest.fn() },
}))

const TX = { __tx: true }
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))

const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock
const createMany = verificationRunRepository.createMany as jest.Mock
const findStatus = taskRepository.findStatus as jest.Mock
const getDetail = taskService.getTaskDetail as jest.Mock
const updateWithSideEffects = taskService.updateTaskWithSideEffects as jest.Mock

const ATTR = {
  actorMemberId: 'member-1',
  actorClerkId: 'clerk-1',
  sourceSessionId: 'sess-1',
}

function criterion(referentKind: string) {
  return {
    id: 'c-ext',
    taskId: 't-1',
    statement: 'the migration introduces no DROP on prod',
    verifierType: 'MACHINE',
    // A jest checkpointer grounds AGENT_HARNESS, never EXTERNAL — declaring it
    // EXTERNAL_FACT is the exact LUM-601 fakeGit shape the gate must catch.
    checkpointer: 'npx jest scripts/check.test.ts',
    evidenceRequired: false,
    referentKind,
  }
}

function pass(criterionId: string) {
  return {
    criterionId,
    verdict: 'PASS' as const,
    evidencePointer: 'cmd:npx jest scripts/check.test.ts#exit=0',
    rejectionReason: null,
    rejectionReasonEnum: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  findStatus.mockResolvedValue({ status: 'IN_PROGRESS' })
  getDetail.mockResolvedValue({ status: 'IN_PROGRESS' })
})

describe('LUM-605 verdict-path enforcement', () => {
  it('blocks a declared-EXTERNAL_FACT + jest PASS (422, no round burned, no IN_REVIEW)', async () => {
    listByTask.mockResolvedValue([criterion('EXTERNAL_FACT')])

    await expect(
      taskVerificationService.recordMachineRound(
        't-1',
        'w-1',
        [pass('c-ext')],
        ATTR,
        'migration is clean; tests pass'
      )
    ).rejects.toMatchObject({ status: 422 })

    // No round was recorded, and the task was not flipped to IN_REVIEW.
    expect(createMany).not.toHaveBeenCalled()
    expect(updateWithSideEffects).not.toHaveBeenCalled()
  })

  it('names the ungrounded criterion and the two dispositions in the message', async () => {
    listByTask.mockResolvedValue([criterion('EXTERNAL_FACT')])
    await expect(
      taskVerificationService.recordMachineRound(
        't-1',
        'w-1',
        [pass('c-ext')],
        ATTR,
        'note'
      )
    ).rejects.toThrow(/EXTERNAL_FACT|external tooling/i)
  })

  it('lets an honest AGENT_CONSTRUCTED_STATE + jest PASS through (records round, → IN_REVIEW)', async () => {
    listByTask.mockResolvedValue([criterion('AGENT_CONSTRUCTED_STATE')])

    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-ext')],
      ATTR,
      'note'
    )

    expect(out.allPassed).toBe(true)
    expect(out.taskStatus).toBe('IN_REVIEW')
    expect(createMany).toHaveBeenCalledTimes(1)
    expect(updateWithSideEffects).toHaveBeenCalledTimes(1)
  })

  it('does NOT block a FAIL on a declared-EXTERNAL_FACT criterion (no false green to prevent)', async () => {
    listByTask.mockResolvedValue([criterion('EXTERNAL_FACT')])
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [
        {
          criterionId: 'c-ext',
          verdict: 'FAIL' as const,
          evidencePointer: null,
          rejectionReason: 'check failed',
          rejectionReasonEnum: 'CRITERION_UNMET' as const,
        },
      ],
      ATTR,
      'note'
    )
    expect(out.allPassed).toBe(false)
    expect(createMany).toHaveBeenCalledTimes(1)
  })
})
