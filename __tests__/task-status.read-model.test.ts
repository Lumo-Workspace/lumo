import { taskVerificationService } from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'

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
  // Keep the real pure exports (isPassVerdict, isRunWithdrawn) — only the
  // DB-backed repo is faked.
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    listByTask: jest.fn(),
    // LUM-586: the undo target lookup the read model now performs.
    latestHumanVerdictAction: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-586: the read model now reads withdrawal tombstones — fake them so the
// view resolves without a DB. Defaults = nothing withdrawn.
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
    // LUM-573: null snapshot → live latest-session claim fallback.
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-564: statusForTask reads the latest session's run-claim material as the
// pre-snapshot live fallback — mock it so the read model resolves without a DB.
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-583: statusForTask reads the persisted claim-faithfulness verdict.
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
// Mocked to keep its GitHub/octokit ESM import chain out of the test runtime.
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    // LUM-562: statusForTask reads the per-session cost trajectory from the same
    // repo as loadActuals.
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
const loadActuals = retrospectiveRepository.loadActuals as jest.Mock
const loadPerSessionCost =
  retrospectiveRepository.loadPerSessionCost as jest.Mock
const latestHumanVerdictAction =
  verificationRunRepository.latestHumanVerdictAction as jest.Mock
const withdrawalRepo = (
  require('@/lib/repositories/verification-run-withdrawal.repository') as {
    verificationRunWithdrawalRepository: {
      actionIdsByTask: jest.Mock
      latestByTask: jest.Mock
    }
  }
).verificationRunWithdrawalRepository

const listLifecyclePrs = (
  require('@/lib/repositories/pull-request.repository') as {
    pullRequestRepository: { listForLifecycle: jest.Mock }
  }
).pullRequestRepository.listForLifecycle

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
  listLifecyclePrs.mockResolvedValue([])
  loadActuals.mockResolvedValue(null)
  loadPerSessionCost.mockResolvedValue([])
  latestHumanVerdictAction.mockResolvedValue(null)
  withdrawalRepo.actionIdsByTask.mockResolvedValue(new Set())
  withdrawalRepo.latestByTask.mockResolvedValue(null)
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

  // LUM-611: a human PASS sign-off pushes latestVerdict to HUMAN (no evidence
  // pointer), but the machine round below it still holds the cmd: evidence. The
  // read model must expose that machine round (machineVerdict) so the web tab
  // can show "machine-verified @rN" + its evidence instead of "No machine check
  // ran" / "evidence pending".
  it('machineVerdict carries the machine round evidence and round after a human override LUM611', async () => {
    const c = criterion({
      id: 'c-1',
      statement: 'machine passed at round 1 then human signed off at round 1',
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
        evidencePointer: 'cmd:npx jest target.test.ts#exit=0',
      }),
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

    const got = s.criteria[0]!
    // Latest verdict is the human override — no evidence pointer on it…
    expect(got.latestVerdict?.verifierType).toBe('HUMAN')
    expect(got.latestVerdict?.evidencePointer).toBeNull()
    // …but the machine round below it is preserved with its round + cmd evidence.
    expect(got.machineVerdict?.verifierType).toBe('MACHINE')
    expect(got.machineVerdict?.round).toBe(1)
    expect(got.machineVerdict?.evidencePointer).toBe(
      'cmd:npx jest target.test.ts#exit=0'
    )
    expect(got.machinePassed).toBe(true)
  })

  // A genuine human override (no MACHINE run at all) has no machine verdict to
  // expose — machineVerdict stays null, so the tab keeps its override copy.
  it('machineVerdict is null for a pure human override with no machine run LUM611', async () => {
    const c = criterion({ id: 'c-1', statement: 'only ever human-passed' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        id: 'r-h',
        criterionId: 'c-1',
        round: 1,
        verifierType: 'HUMAN',
        verdict: 'PASS',
        evidencePointer: null,
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.criteria[0]!.machineVerdict ?? null).toBeNull()
    expect(s.criteria[0]!.machinePassed).toBe(false)
  })
})

// LUM-561: the report must preserve struggle traces (rework / send-backs /
// leftover follow-ups) instead of wiping them the moment everything passes.
// statusForTask derives these from the append-only run log so the renderer can
// force an honest "難点/返工/遺留" section even on a clean all-pass task.
describe('struggle trail read model LUM-561', () => {
  it('derives rework rounds from rounds that had a FAIL', async () => {
    const c = criterion({ id: 'c-1' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        id: 'r1',
        round: 1,
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: 'first attempt failed',
        rejectionReasonEnum: 'OTHER',
        createdAt: new Date('2026-06-02T10:00:00Z'),
      }),
      run({
        id: 'r2',
        round: 2,
        verdict: 'PASS',
        createdAt: new Date('2026-06-03T10:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.struggleTrail.reworkRounds).toEqual([{ round: 1, failed: 1 }])
  })

  it('derives a resolved send-back from a HUMAN/AGENT FAIL later passed', async () => {
    const c = criterion({ id: 'c-1', statement: 'the bounced requirement' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        id: 'r1',
        round: 1,
        verifierType: 'AGENT',
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: 'sent back',
        rejectionReasonEnum: 'OTHER',
        createdAt: new Date('2026-06-02T10:00:00Z'),
      }),
      run({
        id: 'r2',
        round: 2,
        verifierType: 'MACHINE',
        verdict: 'PASS',
        createdAt: new Date('2026-06-03T10:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.struggleTrail.sendBacks).toEqual([
      {
        criterionId: 'c-1',
        statement: 'the bounced requirement',
        status: 'resolved',
        failedAtRound: 1,
        resolvedAtRound: 2,
      },
    ])
  })

  it('does not count a MACHINE verify-loop FAIL as a send-back, but it is still a rework round', async () => {
    const c = criterion({ id: 'c-1' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        id: 'r1',
        round: 1,
        verifierType: 'MACHINE',
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: 'machine check failed',
        rejectionReasonEnum: 'OTHER',
        createdAt: new Date('2026-06-02T10:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.struggleTrail.sendBacks).toEqual([])
    expect(s.struggleTrail.reworkRounds).toEqual([{ round: 1, failed: 1 }])
  })

  it('surfaces a send-back recorded against a now-removed criterion', async () => {
    const active = criterion({ id: 'c-live', statement: 'still here' })
    const removed = criterion({
      id: 'c-gone',
      statement: 'the wiped struggle',
      deletedAt: new Date('2026-06-04T00:00:00Z'),
    })
    listActive.mockResolvedValue([active])
    listAll.mockResolvedValue([active, removed])
    listRuns.mockResolvedValue([
      run({
        id: 'r-active',
        criterionId: 'c-live',
        round: 1,
        verdict: 'PASS',
        createdAt: new Date('2026-06-02T10:00:00Z'),
      }),
      // The removed criterion was sent back and never resolved.
      run({
        id: 'r-gone',
        criterionId: 'c-gone',
        round: 1,
        verifierType: 'HUMAN',
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: 'dropped after a bounce',
        rejectionReasonEnum: 'OTHER',
        createdAt: new Date('2026-06-02T11:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.struggleTrail.sendBacks).toEqual([
      {
        criterionId: 'c-gone',
        statement: 'the wiped struggle',
        status: 'open',
        failedAtRound: 1,
        resolvedAtRound: null,
      },
    ])
  })

  it('derives a follow-up from a latest PASS_WITH_FOLLOWUP verdict', async () => {
    const c = criterion({ id: 'c-1', statement: 'passed with leftover work' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        id: 'r1',
        round: 1,
        verdict: 'PASS_WITH_FOLLOWUP',
        createdAt: new Date('2026-06-02T10:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.struggleTrail.followUps).toEqual([
      { criterionId: 'c-1', statement: 'passed with leftover work', round: 1 },
    ])
  })

  it('returns an all-empty trail when every round passed cleanly', async () => {
    const c = criterion({ id: 'c-1' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        id: 'r1',
        round: 1,
        verdict: 'PASS',
        createdAt: new Date('2026-06-02T10:00:00Z'),
      }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.struggleTrail).toEqual({
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    })
  })
})

// LUM-561 follow-up: the verify loop is NOT where this team's rework lives — it
// lives in PR cycles and status reopens (measured on LUM-557: ~10 PRs, 1 verify
// round, 1 send-back). The trail must surface both or it under-reports an
// order of magnitude.
describe('struggle trail pr-cycle and reopen signals LUM-561', () => {
  it('surfaces every PR opened against the task, oldest-first', async () => {
    const c = criterion({ id: 'c-1' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        id: 'r1',
        round: 1,
        verdict: 'PASS',
        createdAt: new Date('2026-06-02T10:00:00Z'),
      }),
    ])
    listLifecyclePrs.mockResolvedValue([
      {
        number: 654,
        url: 'https://github.com/x/lumo/pull/654',
        createdAt: new Date('2026-06-01T00:00:00Z'),
      },
      {
        number: 657,
        url: 'https://github.com/x/lumo/pull/657',
        createdAt: new Date('2026-06-02T00:00:00Z'),
      },
      {
        number: 660,
        url: 'https://github.com/x/lumo/pull/660',
        createdAt: new Date('2026-06-03T00:00:00Z'),
      },
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.struggleTrail.pullRequests).toEqual([
      { number: 654, url: 'https://github.com/x/lumo/pull/654' },
      { number: 657, url: 'https://github.com/x/lumo/pull/657' },
      { number: 660, url: 'https://github.com/x/lumo/pull/660' },
    ])
  })

  it('counts a backward IN_REVIEW/DONE transition as a reopen and ignores forward ones', async () => {
    const c = criterion({ id: 'c-1' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([])
    // listChangeEvents backs BOTH activity reads (CRITERION_CHANGED and
    // STATUS_CHANGED) — route by the type arg so only the status read sees
    // these rows.
    listChangeEvents.mockImplementation((_taskId: string, type: string) =>
      Promise.resolve(
        type === 'STATUS_CHANGED'
          ? [
              // forward: not a reopen
              {
                payload: { from: 'TODO', to: 'IN_PROGRESS' },
                createdAt: new Date('2026-06-01T00:00:00Z'),
              },
              // backward after review: a reopen
              {
                payload: { from: 'IN_REVIEW', to: 'IN_PROGRESS' },
                createdAt: new Date('2026-06-02T00:00:00Z'),
              },
              // backward after done: a reopen
              {
                payload: { from: 'DONE', to: 'IN_PROGRESS' },
                createdAt: new Date('2026-06-03T00:00:00Z'),
              },
            ]
          : []
      )
    )

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.struggleTrail.reopens).toEqual([
      { from: 'IN_REVIEW', to: 'IN_PROGRESS', at: '2026-06-02T00:00:00.000Z' },
      { from: 'DONE', to: 'IN_PROGRESS', at: '2026-06-03T00:00:00.000Z' },
    ])
  })
})

// LUM-562 規律7: the report must carry the *movement* of the key quantities
// across attempts — pass rate per round, per-session spend, accrued rework —
// not just the latest snapshot value.
describe('trend read model LUM-562', () => {
  it('trend read model LUM-562 derives pass-rate cost and rework trajectories', async () => {
    const c = criterion({ id: 'c-1' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    // Round 1 mixed (1 PASS / 1 FAIL), round 2 all-passed — a climbing pass rate.
    listRuns.mockResolvedValue([
      run({
        id: 'r1a',
        round: 1,
        verdict: 'PASS',
        createdAt: new Date('2026-06-02T10:00:00Z'),
      }),
      run({
        id: 'r1b',
        round: 1,
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: 'x',
        rejectionReasonEnum: 'OTHER',
        createdAt: new Date('2026-06-02T10:00:01Z'),
      }),
      run({
        id: 'r2',
        round: 2,
        verdict: 'PASS',
        createdAt: new Date('2026-06-03T10:00:00Z'),
      }),
    ])
    // Two sessions, spend falling session 1 -> session 2 (time-ordered).
    loadPerSessionCost.mockResolvedValue([
      {
        sessionId: 's-1',
        tokenCost: 4200,
        loopCount: 3,
        startedAt: new Date('2026-06-02T09:00:00Z'),
      },
      {
        sessionId: 's-2',
        tokenCost: 1100,
        loopCount: 1,
        startedAt: new Date('2026-06-03T09:00:00Z'),
      },
    ])
    // Reopen + 2 PRs feed the rework accrual.
    listChangeEvents.mockImplementation((_t: string, type: string) =>
      Promise.resolve(
        type === 'STATUS_CHANGED'
          ? [
              {
                payload: { from: 'IN_REVIEW', to: 'IN_PROGRESS' },
                createdAt: new Date('2026-06-02T20:00:00Z'),
              },
            ]
          : []
      )
    )
    listLifecyclePrs.mockResolvedValue([
      {
        number: 1,
        url: 'https://x/1',
        createdAt: new Date('2026-06-01T00:00:00Z'),
      },
      {
        number: 2,
        url: 'https://x/2',
        createdAt: new Date('2026-06-02T00:00:00Z'),
      },
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.trend.passRate).toEqual([
      { round: 1, passed: 1, failed: 1 },
      { round: 2, passed: 1, failed: 0 },
    ])
    expect(s.trend.cost).toEqual([
      {
        sessionId: 's-1',
        total: 4200,
        loopCount: 3,
        at: '2026-06-02T09:00:00.000Z',
      },
      {
        sessionId: 's-2',
        total: 1100,
        loopCount: 1,
        at: '2026-06-03T09:00:00.000Z',
      },
    ])
    expect(s.trend.rework).toEqual({
      reworkRounds: 1,
      reopens: 1,
      extraPrCycles: 1,
      total: 3,
    })
  })

  it('trend per-session cost reconciles with the LUM-560 cost total', async () => {
    const c = criterion({ id: 'c-1' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({
        id: 'r1',
        round: 1,
        verdict: 'PASS',
        createdAt: new Date('2026-06-02T10:00:00Z'),
      }),
    ])
    // The Cost section total (loadActuals) and the per-session trajectory come
    // from the SAME session-usage source: Σ trajectory == cost.tokenCost.
    loadActuals.mockResolvedValue({
      projectId: 'p-1',
      tokenCost: 29,
      iterations: 2,
      interactionRounds: 0,
      totalDurationSec: 120,
    })
    loadPerSessionCost.mockResolvedValue([
      {
        sessionId: 's-A',
        tokenCost: 22,
        loopCount: 2,
        startedAt: new Date('2026-06-02T09:00:00Z'),
      },
      {
        sessionId: 's-B',
        tokenCost: 7,
        loopCount: 1,
        startedAt: new Date('2026-06-02T10:00:00Z'),
      },
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    const trajectoryTotal = s.trend.cost.reduce((a, p) => a + p.total, 0)
    expect(trajectoryTotal).toBe(s.cost.tokenCost)
    expect(s.cost.tokenCost).toBe(29)
    // Time-ordered per-session points, reconciling with the total.
    expect(s.trend.cost).toEqual([
      {
        sessionId: 's-A',
        total: 22,
        loopCount: 2,
        at: '2026-06-02T09:00:00.000Z',
      },
      {
        sessionId: 's-B',
        total: 7,
        loopCount: 1,
        at: '2026-06-02T10:00:00.000Z',
      },
    ])
  })
})

// LUM-586: undo of a human verdict is reflected in the read model — a standing
// human verdict surfaces undoableHumanVerdict; once withdrawn it clears and the
// latest verdict falls back to the underlying machine PASS.
describe('acceptance status read model undo (LUM-586)', () => {
  const machineRun = run({
    id: 'r-m',
    criterionId: 'c-1',
    verifierType: 'MACHINE',
    verdict: 'PASS',
    createdAt: new Date('2026-06-02T10:00:00Z'),
  })
  const humanRun = run({
    id: 'r-h',
    criterionId: 'c-1',
    verifierType: 'HUMAN',
    verdict: 'PASS',
    verdictActionId: 'a1',
    evidencePointer: null,
    createdAt: new Date('2026-06-02T11:00:00Z'),
  })

  it('surfaces undoableHumanVerdict while a human verdict stands', async () => {
    const c = criterion({ id: 'c-1' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([machineRun, humanRun])
    latestHumanVerdictAction.mockResolvedValue({
      verdictActionId: 'a1',
      verdict: 'PASS',
      criterionIds: ['c-1'],
      recordedAt: new Date('2026-06-02T11:00:00Z'),
    })

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.undoableHumanVerdict).toMatchObject({
      verdictActionId: 'a1',
      verdict: 'PASS',
    })
    // The human PASS is the criterion's latest verdict.
    expect(s.criteria[0]!.latestVerdict?.verifierType).toBe('HUMAN')
    expect(s.lastVerdictWithdrawal).toBeNull()
  })

  it('LUM-586 withdrawn verdict clears undoable and falls back to machine', async () => {
    const c = criterion({ id: 'c-1' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([machineRun, humanRun])
    // The human action 'a1' is withdrawn → no live human verdict to undo.
    latestHumanVerdictAction.mockResolvedValue(null)
    withdrawalRepo.actionIdsByTask.mockResolvedValue(new Set(['a1']))
    withdrawalRepo.latestByTask.mockResolvedValue({
      verdictActionId: 'a1',
      withdrawnById: 'm-1',
      createdAt: new Date('2026-06-02T12:00:00Z'),
    })

    const s = await taskVerificationService.statusForTask('t-1')

    // Undo target is gone; the latest verdict falls back to the machine PASS.
    expect(s.undoableHumanVerdict).toBeNull()
    expect(s.criteria[0]!.latestVerdict?.verifierType).toBe('MACHINE')
    // The correction line still surfaces the withdrawn verdict (read off the
    // surviving run rows — not hidden, not hardcoded).
    expect(s.lastVerdictWithdrawal).toMatchObject({ verdict: 'PASS' })
    // The withdrawn human run stays visible in history, badged withdrawn.
    const round1 = s.verificationHistory.find(h => h.round === 1)!
    const hRun = round1.verdicts.find(v => v.verifierType === 'HUMAN')!
    expect(hRun.withdrawn).toBe(true)
  })
})

// LUM-602: referentKind must survive the read-model mapping — not dropped.
// The component test previously masked this by injecting referentKind via
// fixture spread rather than going through statusForTask.
describe('referentKind round-trip through read model (LUM-602)', () => {
  it('projects referentKind from the repository row onto TaskStatusCriterionView', async () => {
    const c = criterion({ referentKind: 'EXTERNAL_FACT' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.criteria[0]!.referentKind).toBe('EXTERNAL_FACT')
  })

  it('projects AGENT_CONSTRUCTED_STATE referentKind correctly', async () => {
    const c = criterion({ referentKind: 'AGENT_CONSTRUCTED_STATE' })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.criteria[0]!.referentKind).toBe('AGENT_CONSTRUCTED_STATE')
  })

  it('maps a null referentKind (legacy row) to null in the view', async () => {
    const c = criterion({ referentKind: null })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.criteria[0]!.referentKind).toBeNull()
  })
})
