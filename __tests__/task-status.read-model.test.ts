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
  // Keep the real pure exports (isPassVerdict) — only the DB-backed repo is faked.
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findHeaderById: jest.fn() },
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
const listChangeEvents = activityRepository.listByTaskAndType as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock

const HEADER = {
  id: 't-1',
  number: 437,
  title: 'editable acceptance contract',
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

/** A CRITERION_CHANGED activity row (only payload + createdAt are read). */
function changeEvent(payload: Record<string, unknown>) {
  return { payload, createdAt: new Date('2026-06-02T09:00:00Z') }
}

beforeEach(() => {
  jest.clearAllMocks()
  findHeader.mockResolvedValue(HEADER)
  listActive.mockResolvedValue([])
  listAll.mockResolvedValue([])
  listRuns.mockResolvedValue([])
  listChangeEvents.mockResolvedValue([])
})

// The describe name carries both `read model LUM-437` (so the acceptance
// checkpointer's `jest -t 'read model (LUM-437)'` regex — parens are a capture
// group, not literal — matches) and the human-readable `(LUM-437)` tag.
describe('acceptance status read model LUM-437 (LUM-437)', () => {
  it('surfaces a soft-deleted criterion in removedCriteria with its preserved last verdict and run count', async () => {
    const active = criterion({ id: 'c-active', statement: 'active one' })
    const removed = criterion({
      id: 'c-gone',
      statement: 'the dropped requirement',
      deletedAt: new Date('2026-06-03T00:00:00Z'),
    })
    listActive.mockResolvedValue([active])
    listAll.mockResolvedValue([active, removed])
    // The tombstoned criterion carries one FAIL run.
    listRuns.mockResolvedValue([
      run({
        id: 'r-gone',
        criterionId: 'c-gone',
        verdict: 'FAIL',
        rejectionReason: 'no longer needed',
        rejectionReasonEnum: 'SCOPE_MISMATCH',
        evidencePointer: null,
      }),
    ])
    listChangeEvents.mockResolvedValue([
      changeEvent({
        op: 'DELETED',
        criterionId: 'c-gone',
        round: 2,
        before: { statement: 'the dropped requirement' },
        after: null,
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.removedCriteria).toHaveLength(1)
    const r = s.removedCriteria[0]!
    expect(r.id).toBe('c-gone')
    expect(r.statement).toBe('the dropped requirement')
    expect(r.removedAtRound).toBe(2)
    expect(r.runCount).toBe(1)
    expect(r.lastVerdict?.verdict).toBe('FAIL')
    // The active criterion is not in removedCriteria.
    expect(s.criteria.map(c => c.id)).toEqual(['c-active'])
  })

  it("marks an active criterion 'edited' with the latest reword and its round", async () => {
    const c = criterion({ id: 'c-1', statement: 'reworded statement' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listChangeEvents.mockResolvedValue([
      changeEvent({
        op: 'UPDATED',
        criterionId: 'c-1',
        round: 2,
        before: { statement: 'original statement' },
        after: { statement: 'reworded statement' },
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    const view = s.criteria[0]!
    expect(view.changeState).toBe('edited')
    expect(view.changedAtRound).toBe(2)
    expect(view.lastEdit).toEqual({
      before: 'original statement',
      after: 'reworded statement',
    })
  })

  it("marks an active criterion 'added' when born after work started with no reword", async () => {
    const c = criterion({ id: 'c-new', addedAtRound: 1 })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listChangeEvents.mockResolvedValue([
      changeEvent({
        op: 'ADDED',
        criterionId: 'c-new',
        round: 1,
        before: null,
        after: { statement: 'route rejects bad input' },
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    const view = s.criteria[0]!
    expect(view.changeState).toBe('added')
    expect(view.changedAtRound).toBe(1)
    expect(view.lastEdit).toBeNull()
  })
})

// LUM-456: the rollup must distinguish a MACHINE criterion an actual
// checkpointer passed from one passed by a human override, and never claim
// machine verification that no checkpointer produced.
describe('machine-verification rollup honesty (LUM-456)', () => {
  it('machine-verified aggregate excludes human-overridden machine criteria', async () => {
    const cMachine = criterion({
      id: 'c-mp',
      statement: 'genuinely machine-passed',
    })
    const cOverride = criterion({
      id: 'c-ov',
      statement: 'human-overridden machine criterion',
    })
    listActive.mockResolvedValue([cMachine, cOverride])
    listAll.mockResolvedValue([cMachine, cOverride])
    listRuns.mockResolvedValue([
      // c-mp: a checkpointer ran and passed it — a genuine machine PASS.
      run({
        id: 'r-mp',
        criterionId: 'c-mp',
        round: 1,
        verifierType: 'MACHINE',
        verdict: 'PASS',
      }),
      // c-ov: only ever passed by a human (no MACHINE run at all) — an override.
      run({
        id: 'r-ov',
        criterionId: 'c-ov',
        round: 1,
        verifierType: 'HUMAN',
        verdict: 'PASS',
        evidencePointer: null,
        createdAt: new Date('2026-06-02T11:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    // Both MACHINE criteria are currently passing, but only the checkpointer-
    // backed one counts as machine-verified; the override is tallied separately.
    expect(s.machineVerification.total).toBe(2)
    expect(s.machineVerification.machineVerified).toBe(1)
    expect(s.machineVerification.humanOverridden).toBe(1)

    const byId = new Map(s.criteria.map(c => [c.id, c]))
    expect(byId.get('c-mp')!.machinePassed).toBe(true)
    expect(byId.get('c-ov')!.machinePassed).toBe(false)
  })

  it('a redundant human PASS on top of a real machine PASS stays machine-verified, not an override', async () => {
    const c = criterion({
      id: 'c-1',
      statement: 'machine passed then human signed off',
    })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        id: 'r-m',
        criterionId: 'c-1',
        round: 1,
        verifierType: 'MACHINE',
        verdict: 'PASS',
      }),
      // A later human "pass all" sign-off does not demote the machine result.
      run({
        id: 'r-h',
        criterionId: 'c-1',
        round: 1,
        verifierType: 'HUMAN',
        verdict: 'PASS',
        evidencePointer: null,
        createdAt: new Date('2026-06-02T12:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.machineVerification.machineVerified).toBe(1)
    expect(s.machineVerification.humanOverridden).toBe(0)
    expect(s.criteria[0]!.machinePassed).toBe(true)
  })
})
