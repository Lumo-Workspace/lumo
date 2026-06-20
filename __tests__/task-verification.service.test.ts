import {
  taskVerificationService,
  VERIFICATION_MAX_ROUNDS,
} from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { notifyWorkspaceOwners } from '@/lib/notifications/notifyWorkspaceOwners'
import { taskService } from '@/lib/services/task.service'

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
  // Keep the real pure exports (isPassVerdict, deriveAllPassRoundTaskIds) —
  // only the DB-backed repository is faked.
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    createMany: jest.fn(),
    maxRoundByTask: jest.fn(),
    listByTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findStatus: jest.fn(), findHeaderById: jest.fn() },
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

const TX = { __tx: true }
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))

const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock
const listIncludingDeleted =
  acceptanceCriterionRepository.listByTaskIncludingDeleted as jest.Mock
const listChangeEvents = activityRepository.listByTaskAndType as jest.Mock
const createMany = verificationRunRepository.createMany as jest.Mock
const maxRound = verificationRunRepository.maxRoundByTask as jest.Mock
const listRuns = verificationRunRepository.listByTask as jest.Mock
const listLifecyclePrs = pullRequestRepository.listForLifecycle as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const findStatus = taskRepository.findStatus as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const findCap = workspaceRepository.findVerificationMaxRounds as jest.Mock
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
    {
      id: 'c-h',
      verifierType: 'HUMAN',
      statement: 'reads well',
      checkpointer: null,
    },
  ])
  maxRound.mockResolvedValue(null)
  // Default: workspace has no configured cap → service falls back to the
  // default VERIFICATION_MAX_ROUNDS, so existing assertions hold unchanged.
  findCap.mockResolvedValue(null)
  findActor.mockResolvedValue({ id: 'actor-1' })
  findStatus.mockResolvedValue({ status: 'IN_PROGRESS' })
  getDetail.mockResolvedValue({ status: 'IN_PROGRESS', projectId: 'p-1' })
  updateWithSideEffects.mockResolvedValue({})
  // statusForTask read-model dependencies (LUM-437) default to empty.
  listIncludingDeleted.mockResolvedValue([])
  listChangeEvents.mockResolvedValue([])
})

describe('coverage validation', () => {
  it('400 when the task has no MACHINE criteria', async () => {
    listByTask.mockResolvedValue([
      { id: 'c-h', verifierType: 'HUMAN', statement: 's', checkpointer: null },
    ])
    await expect(
      taskVerificationService.recordMachineRound(
        't-1',
        'w-1',
        [pass('c-h')],
        ATTR
      )
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
      taskVerificationService.recordMachineRound(
        't-1',
        'w-1',
        [pass('c-1')],
        ATTR
      )
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
    listByTask.mockResolvedValue([
      machineCriterion('c-1'),
      machineCriterion('c-2'),
    ])
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

// LUM-429: recordMachineRound honors the task's workspace cap instead of a
// hardcoded 3. A workspace left at the default behaves exactly as before.
describe('configured cap', () => {
  it('allows a 4th and 5th machine round when the workspace cap is 5', async () => {
    findCap.mockResolvedValue(5)

    maxRound.mockResolvedValue(3) // about to record round 4
    const r4 = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2')],
      ATTR
    )
    expect(r4.round).toBe(4)
    expect(r4.maxRounds).toBe(5)
    expect(r4.escalated).toBe(false) // 4 < 5, no escalation yet
    expect(notify).not.toHaveBeenCalled()

    jest.clearAllMocks()
    listByTask.mockResolvedValue([
      machineCriterion('c-1'),
      machineCriterion('c-2'),
    ])
    findActor.mockResolvedValue({ id: 'actor-1' })
    findStatus.mockResolvedValue({ status: 'IN_PROGRESS' })
    getDetail.mockResolvedValue({ status: 'IN_PROGRESS', projectId: 'p-1' })
    findCap.mockResolvedValue(5)
    maxRound.mockResolvedValue(4) // about to record round 5
    const r5 = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2')],
      ATTR
    )
    expect(r5.round).toBe(5)
    expect(r5.maxRounds).toBe(5)
    expect(r5.escalated).toBe(true) // 5 >= 5 escalates exactly here
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('refuses with 409 only once the configured cap is reached', async () => {
    findCap.mockResolvedValue(5)
    // currentRound 4 < cap 5 → still allowed.
    maxRound.mockResolvedValue(4)
    await expect(
      taskVerificationService.recordMachineRound(
        't-1',
        'w-1',
        [pass('c-1'), pass('c-2')],
        ATTR
      )
    ).resolves.toBeDefined()

    // currentRound 5 >= cap 5 → 409, nothing written.
    jest.clearAllMocks()
    listByTask.mockResolvedValue([
      machineCriterion('c-1'),
      machineCriterion('c-2'),
    ])
    findActor.mockResolvedValue({ id: 'actor-1' })
    findCap.mockResolvedValue(5)
    maxRound.mockResolvedValue(5)
    await expect(
      taskVerificationService.recordMachineRound(
        't-1',
        'w-1',
        [pass('c-1'), pass('c-2')],
        ATTR
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(createMany).not.toHaveBeenCalled()
  })

  it('a workspace left at the default 3 still escalates at round 3', async () => {
    findCap.mockResolvedValue(null) // unconfigured → fallback to default 3
    maxRound.mockResolvedValue(2)
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2')],
      ATTR
    )
    expect(out.round).toBe(3)
    expect(out.maxRounds).toBe(VERIFICATION_MAX_ROUNDS)
    expect(out.escalated).toBe(true)
  })
})

// LUM-429: the status read model reports the configured cap, resolved
// task → workspace, and derives `escalated` against it.
describe('configured maxRounds', () => {
  function header(verificationMaxRounds: number | null) {
    return {
      id: 't-1',
      number: 42,
      title: 'Ship it',
      status: 'IN_PROGRESS',
      team: { identifier: 'LUM' },
      project: { workspace: { verificationMaxRounds } },
    }
  }

  function run(round: number, verdict: 'PASS' | 'FAIL') {
    return {
      id: `run-${round}-${verdict}`,
      taskId: 't-1',
      criterionId: 'c-1',
      round,
      verifierType: 'MACHINE' as const,
      verdict,
      evidencePointer: null,
      rejectionReason: null,
      rejectionReasonEnum: null,
      createdAt: new Date('2026-06-11T00:00:00Z'),
    }
  }

  it('reports maxRounds equal to the workspace cap and derives escalated against it', async () => {
    findHeader.mockResolvedValue(header(5))
    listByTask.mockResolvedValue([machineCriterion('c-1')])
    // Three rounds run, last one failing — under a cap of 5 this is NOT escalated.
    listRuns.mockResolvedValue([run(1, 'FAIL'), run(2, 'FAIL'), run(3, 'FAIL')])

    const status = await taskVerificationService.statusForTask('t-1')
    expect(status.maxRounds).toBe(5)
    expect(status.currentRound).toBe(3)
    expect(status.escalated).toBe(false) // 3 < 5
  })

  it('a default-3 workspace is unchanged: escalated once round 3 fails', async () => {
    findHeader.mockResolvedValue(header(null)) // unconfigured → fallback 3
    listByTask.mockResolvedValue([machineCriterion('c-1')])
    listRuns.mockResolvedValue([run(1, 'FAIL'), run(2, 'FAIL'), run(3, 'FAIL')])

    const status = await taskVerificationService.statusForTask('t-1')
    expect(status.maxRounds).toBe(VERIFICATION_MAX_ROUNDS)
    expect(status.escalated).toBe(true) // 3 >= 3 with a failure
  })
})

describe('statusForTask — send-back lifecycle (Phase 5)', () => {
  it('attaches resolved sendBackResolution with the in-window closing PR', async () => {
    findHeader.mockResolvedValue({
      id: 't-1',
      number: 42,
      title: 'Ship it',
      status: 'IN_PROGRESS',
      team: { identifier: 'LUM' },
      project: { workspace: { verificationMaxRounds: null } },
    })
    listByTask.mockResolvedValue([
      {
        id: 'c-1',
        verifierType: 'MACHINE',
        statement: 's',
        checkpointer: 'npx jest',
      },
    ])
    listRuns.mockResolvedValue([
      {
        criterionId: 'c-1',
        round: 1,
        verdict: 'FAIL',
        verifierType: 'AGENT',
        createdAt: new Date('2026-06-01'),
      },
      {
        criterionId: 'c-1',
        round: 2,
        verdict: 'PASS',
        verifierType: 'MACHINE',
        createdAt: new Date('2026-06-03'),
      },
    ])
    listLifecyclePrs.mockResolvedValue([
      { number: 42, url: 'http://pr/42', createdAt: new Date('2026-06-02') },
    ])

    const status = await taskVerificationService.statusForTask('t-1')
    const c = status.criteria.find(x => x.id === 'c-1')
    expect(c?.sendBackResolution).toEqual({
      status: 'resolved',
      failedAtRound: 1,
      resolvedAtRound: 2,
      closingPrNumber: 42,
      closingPrUrl: 'http://pr/42',
    })
  })
})
