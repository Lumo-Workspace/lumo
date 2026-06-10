import {
  taskVerificationService,
  VERIFICATION_MAX_ROUNDS,
} from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { notifyWorkspaceOwners } from '@/lib/notifications/notifyWorkspaceOwners'
import { taskService } from '@/lib/services/task.service'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  // Keep the real pure exports (isPassVerdict, deriveAllPassRoundTaskIds) —
  // only the DB-backed repository is faked.
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    createMany: jest.fn(),
    maxRoundByTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findStatus: jest.fn() },
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

const TX = { __tx: true }
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))

const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock
const createMany = verificationRunRepository.createMany as jest.Mock
const maxRound = verificationRunRepository.maxRoundByTask as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const findStatus = taskRepository.findStatus as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock
const notify = notifyWorkspaceOwners as jest.Mock
const getDetail = taskService.getTaskDetail as jest.Mock
const updateWithSideEffects = taskService.updateTaskWithSideEffects as jest.Mock

const ATTR = {
  actorMemberId: 'member-1',
  actorClerkId: 'clerk-1',
  sourceSessionId: 'sess-1',
}

function machineCriterion(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    taskId: 't-1',
    statement: `statement ${id}`,
    verifierType: 'MACHINE',
    checkpointer: `npx jest ${id}`,
    evidenceRequired: false,
    ...over,
  }
}

function pass(criterionId: string) {
  return {
    criterionId,
    verdict: 'PASS' as const,
    evidencePointer: 'cmd:npx jest#exit=0',
    rejectionReason: null,
    rejectionReasonEnum: null,
  }
}

function fail(criterionId: string, reason = 'tests failed') {
  return {
    criterionId,
    verdict: 'FAIL' as const,
    evidencePointer: null,
    rejectionReason: reason,
    rejectionReasonEnum: 'CRITERION_UNMET' as const,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  listByTask.mockResolvedValue([
    machineCriterion('c-1'),
    machineCriterion('c-2'),
    { id: 'c-h', verifierType: 'HUMAN', statement: 'reads well', checkpointer: null },
  ])
  maxRound.mockResolvedValue(null)
  findActor.mockResolvedValue({ id: 'actor-1' })
  findStatus.mockResolvedValue({ status: 'IN_PROGRESS' })
  getDetail.mockResolvedValue({ status: 'IN_PROGRESS', projectId: 'p-1' })
  updateWithSideEffects.mockResolvedValue({})
})

describe('coverage validation', () => {
  it('400 when the task has no MACHINE criteria', async () => {
    listByTask.mockResolvedValue([
      { id: 'c-h', verifierType: 'HUMAN', statement: 's', checkpointer: null },
    ])
    await expect(
      taskVerificationService.recordMachineRound('t-1', 'w-1', [pass('c-h')], ATTR)
    ).rejects.toMatchObject({ status: 400 })
  })

  it('400 on a verdict for a non-MACHINE or unknown criterion', async () => {
    await expect(
      taskVerificationService.recordMachineRound(
        't-1',
        'w-1',
        [pass('c-1'), pass('c-2'), pass('c-h')],
        ATTR
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('400 when a MACHINE criterion is missing from the round', async () => {
    await expect(
      taskVerificationService.recordMachineRound('t-1', 'w-1', [pass('c-1')], ATTR)
    ).rejects.toMatchObject({ status: 400 })
    expect(createMany).not.toHaveBeenCalled()
  })

  it('400 on duplicate verdicts for one criterion', async () => {
    await expect(
      taskVerificationService.recordMachineRound(
        't-1',
        'w-1',
        [pass('c-1'), pass('c-1')],
        ATTR
      )
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('round recording', () => {
  it('records one VerificationRun per criterion at round = max + 1, verifierType hard-coded MACHINE', async () => {
    maxRound.mockResolvedValue(1)
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2')],
      ATTR
    )
    expect(out.round).toBe(2)
    const rows = createMany.mock.calls[0]![0]
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.round).toBe(2)
      expect(row.verifierType).toBe('MACHINE')
    }
    expect(createMany.mock.calls[0]![1]).toBe(TX)
  })

  it('mirrors every verdict as a VERIFICATION_RUN_RECORDED activity inside the same transaction', async () => {
    await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2')],
      ATTR
    )
    const mirrors = createActivity.mock.calls.filter(
      c => c[0].type === 'VERIFICATION_RUN_RECORDED'
    )
    expect(mirrors).toHaveLength(2)
    for (const m of mirrors) {
      expect(m[1]).toBe(TX)
      expect(m[0].payload).toMatchObject({ round: 1 })
      expect(m[0].payload.criterionId).toMatch(/^c-/)
    }
    const failMirror = mirrors.find(m => m[0].payload.verdict === 'FAIL')!
    expect(failMirror[0].payload.rejectionReasonEnum).toBe('CRITERION_UNMET')
  })

  it('control-char-sanitizes rejectionReason before storage (LUM-346 口径)', async () => {
    await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2', 'bad \x1b[31mANSI\x1b[0m \x07output')],
      ATTR
    )
    const rows = createMany.mock.calls[0]![0]
    const failRow = rows.find((r: { verdict: string }) => r.verdict === 'FAIL')
    expect(failRow.rejectionReason).toBe('bad [31mANSI[0m output')
  })
})

describe('FAIL rounds keep status and surface nextActions', () => {
  it('does not touch task status and returns the failed criteria', async () => {
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2')],
      ATTR
    )
    expect(updateWithSideEffects).not.toHaveBeenCalled()
    expect(out.allPassed).toBe(false)
    expect(out.escalated).toBe(false)
    expect(out.taskStatus).toBe('IN_PROGRESS')
    expect(out.nextActions).toEqual([
      expect.objectContaining({
        criterionId: 'c-2',
        statement: 'statement c-2',
        checkpointer: 'npx jest c-2',
      }),
    ])
  })
})

describe('escalation', () => {
  it(`round ${VERIFICATION_MAX_ROUNDS} with FAILs escalates exactly once: AGENT_VERIFY requiresAction + activity`, async () => {
    maxRound.mockResolvedValue(VERIFICATION_MAX_ROUNDS - 1)
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2')],
      ATTR
    )
    expect(out.escalated).toBe(true)
    expect(out.round).toBe(VERIFICATION_MAX_ROUNDS)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      taskId: 't-1',
      type: 'AGENT_VERIFY',
      triggerActorId: null,
      requiresAction: true,
    })
    const escalations = createActivity.mock.calls.filter(
      c => c[0].type === 'VERIFICATION_ESCALATED'
    )
    expect(escalations).toHaveLength(1)
    expect(escalations[0]![0].payload).toMatchObject({
      round: VERIFICATION_MAX_ROUNDS,
      failedCriterionIds: ['c-2'],
    })
  })

  it('earlier failing rounds do not escalate', async () => {
    maxRound.mockResolvedValue(0)
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2')],
      ATTR
    )
    expect(out.escalated).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects any round past the cap with 409 and writes nothing', async () => {
    maxRound.mockResolvedValue(VERIFICATION_MAX_ROUNDS)
    await expect(
      taskVerificationService.recordMachineRound(
        't-1',
        'w-1',
        [pass('c-1'), pass('c-2')],
        ATTR
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(createMany).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('all-pass → IN_REVIEW', () => {
  it('transitions through the existing state machine with the caller attribution', async () => {
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), pass('c-2')],
      ATTR
    )
    expect(out.allPassed).toBe(true)
    expect(out.taskStatus).toBe('IN_REVIEW')
    expect(updateWithSideEffects).toHaveBeenCalledWith(
      't-1',
      { status: 'IN_REVIEW' },
      expect.anything(),
      'actor-1',
      'clerk-1',
      'sess-1'
    )
  })

  it('performs no transition beyond IN_REVIEW when the task is already there or DONE', async () => {
    getDetail.mockResolvedValue({ status: 'IN_REVIEW', projectId: 'p-1' })
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), pass('c-2')],
      ATTR
    )
    expect(updateWithSideEffects).not.toHaveBeenCalled()
    expect(out.taskStatus).toBe('IN_REVIEW')

    jest.clearAllMocks()
    listByTask.mockResolvedValue([machineCriterion('c-1'), machineCriterion('c-2')])
    maxRound.mockResolvedValue(null)
    findActor.mockResolvedValue({ id: 'actor-1' })
    getDetail.mockResolvedValue({ status: 'DONE', projectId: 'p-1' })
    const out2 = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), pass('c-2')],
      ATTR
    )
    expect(updateWithSideEffects).not.toHaveBeenCalled()
    expect(out2.taskStatus).toBe('DONE')
  })
})
