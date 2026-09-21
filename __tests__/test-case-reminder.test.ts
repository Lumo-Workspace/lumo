/**
 * LUM-807 — test-case reminders across the CLI flow.
 *
 * Four surfaces, two gates: the start-of-work nudge (attach / task context)
 * fires on a task with no recorded script regardless of PRs; the delivery-time
 * three (`Next:` block — covered in next-steps-compute.test.ts — the all-pass
 * verify line, and the `task status` advisory) additionally require a linked
 * PR. The invariant test at the bottom is the one that matters most: none of
 * this may reach the DONE gate or the round counter.
 */
import { taskContextService } from '@/lib/services/task-context.service'
import { taskVerificationService } from '@/lib/services/task-verification.service'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'
import { readFileSync } from 'fs'
import { join } from 'path'

// task-context.service eagerly imports document.service → @clerk/nextjs, whose
// ESM build jest cannot parse. The section under test never touches documents.
jest.mock('@/lib/services/document.service', () => ({
  documentService: {},
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: { hasForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listIdAndNumberByTask: jest.fn(),
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(() => Promise.resolve([])),
    listByTaskIncludingDeleted: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    createMany: jest.fn(),
    maxRoundByTask: jest.fn(),
    listByTask: jest.fn(() => Promise.resolve([])),
    latestHumanVerdictAction: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/verification-run-withdrawal.repository', () => ({
  verificationRunWithdrawalRepository: {
    actionIdsByTask: jest.fn(() => Promise.resolve(new Set())),
    latestByTask: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listByTaskAndType: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(),
    findStatus: jest.fn(),
    findHeaderById: jest.fn(),
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
    setClaimSnapshot: jest.fn(() => Promise.resolve({ id: 't-1' })),
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
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { findMergedSessionIds: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
    loadRunClaimForSessions: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: {
    loadOpenFindingsForTask: jest.fn(() =>
      Promise.resolve({
        findings: [],
        blockingCount: 0,
        unconfirmedPrs: [],
        latestScans: [],
      })
    ),
  },
}))
// Best-effort side writes of an all-pass round; not under test here, and
// unmocked they only log a warning — stubbed to keep the run's output clean.
jest.mock('@/lib/services/task-criteria-snapshot.service', () => ({
  taskCriteriaSnapshotService: {
    recordDeliverySnapshot: jest.fn(() => Promise.resolve()),
  },
}))
jest.mock('@/lib/services/task-claim-snapshot.service', () => ({
  taskClaimSnapshotService: {
    recordAgentSelfClaim: jest.fn(() => Promise.resolve()),
  },
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
  },
}))

const hasTestCases = testCaseRepository.hasForTask as jest.Mock
const listPrs = pullRequestRepository.listIdAndNumberByTask as jest.Mock
const findTask = taskRepository.findById as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const findStatus = taskRepository.findStatus as jest.Mock
const listCriteria = acceptanceCriterionRepository.listByTask as jest.Mock
const maxRound = verificationRunRepository.maxRoundByTask as jest.Mock
const findCap = workspaceRepository.findVerificationMaxRounds as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock
const getDetail = taskService.getTaskDetail as jest.Mock

const ATTR = {
  actorMemberId: 'member-1',
  actorClerkId: 'clerk-1',
  sourceSessionId: 'sess-1',
}

/** A task detail carrying the identifier parts the verify nudge renders with. */
const DETAIL = {
  status: 'IN_PROGRESS',
  projectId: 'p-1',
  number: 807,
  team: { identifier: 'LUM' },
}

function machineCriterion(id: string) {
  return {
    id,
    taskId: 't-1',
    statement: `statement ${id}`,
    verifierType: 'MACHINE',
    checkpointer: `npx jest ${id}`,
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
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

beforeEach(() => {
  jest.clearAllMocks()
  hasTestCases.mockResolvedValue(false)
  listPrs.mockResolvedValue([{ id: 'pr-1', number: 1042 }])
  findTask.mockResolvedValue({ id: 't-1', status: 'IN_PROGRESS' })
  findHeader.mockResolvedValue({
    id: 't-1',
    number: 807,
    title: 'CLI test-case reminders',
    status: 'IN_PROGRESS',
    team: { identifier: 'LUM' },
  })
  findStatus.mockResolvedValue({ status: 'IN_PROGRESS' })
  listCriteria.mockResolvedValue([machineCriterion('c-1')])
  maxRound.mockResolvedValue(null)
  findCap.mockResolvedValue(null)
  findActor.mockResolvedValue({ id: 'actor-1' })
  getDetail.mockResolvedValue({ ...DETAIL })
})

describe('LUM-807 · start-of-work nudge', () => {
  it('reminder on attach and context appears only when the task has zero test cases', async () => {
    // Both `session attach` and `task context` render this one section, so the
    // gate is asserted where they share it.
    const withoutScript = await taskContextService.buildTestCaseSectionForTask(
      't-1',
      'LUM-807',
      'IN_PROGRESS'
    )
    expect(withoutScript).toContain('## Test cases')
    expect(withoutScript).toContain('lumo task testcase add LUM-807')

    hasTestCases.mockResolvedValue(true)
    const withScript = await taskContextService.buildTestCaseSectionForTask(
      't-1',
      'LUM-807',
      'IN_PROGRESS'
    )
    expect(withScript).toBe('')

    // No PR gate here: the nudge must survive the state every task starts in.
    hasTestCases.mockResolvedValue(false)
    listPrs.mockResolvedValue([])
    const noPrYet = await taskContextService.buildTestCaseSectionForTask(
      't-1',
      'LUM-807',
      'IN_PROGRESS'
    )
    expect(noPrYet).toContain('lumo task testcase add LUM-807')

    // A delivered task is past the point of being nudged.
    const done = await taskContextService.buildTestCaseSectionForTask(
      't-1',
      'LUM-807',
      'DONE'
    )
    expect(done).toBe('')
  })
})

describe('LUM-807 · all-pass verify line', () => {
  it('all-pass verify output nudges sinking the run into a test case', async () => {
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1')],
      ATTR,
      'ran the script by hand'
    )
    expect(out.allPassed).toBe(true)
    expect(out.testCaseNudge).toContain('lumo task testcase add LUM-807')

    // Gated on delivery: a task with a recorded script gets nothing.
    hasTestCases.mockResolvedValue(true)
    maxRound.mockResolvedValue(null)
    const quiet = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1')],
      ATTR,
      'ran it again'
    )
    expect(quiet.testCaseNudge).toBeNull()

    // And a FAIL round never carries it — failures own that screen.
    hasTestCases.mockResolvedValue(false)
    const failed = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [
        {
          criterionId: 'c-1',
          verdict: 'FAIL' as const,
          evidencePointer: null,
          rejectionReason: 'tests failed',
          rejectionReasonEnum: 'CRITERION_UNMET' as const,
        },
      ],
      ATTR,
      'still red'
    )
    expect(failed.testCaseNudge).toBeNull()
  })
})

describe('LUM-807 · task status advisory', () => {
  it('task status nextActions carries a TEST_CASE advisory not counted as unmet', async () => {
    const s = await taskVerificationService.statusForTask('t-1')
    const advisory = s.nextActions.filter(a => a.kind === 'TEST_CASE')
    expect(advisory).toHaveLength(1)
    expect(advisory[0]).toMatchObject({
      kind: 'TEST_CASE',
      advisory: true,
      command: expect.stringContaining('lumo task testcase add LUM-807'),
    })
    // It is appended after the contract rows, never interleaved with them.
    expect(s.nextActions[s.nextActions.length - 1]?.kind).toBe('TEST_CASE')

    // The row must not be readable as "one more unmet criterion": the CLI
    // renders its unmet arithmetic off the same nextActions array.
    const rendered = formatTaskStatus(payloadWithAdvisory())
    expect(rendered).toContain('[TEST CASE]')
    expect(rendered).toContain('(advisory)')
    expect(rendered).toContain('Criteria (1 total, 0 unmet)')
    expect(rendered).not.toContain('Next actions (1 unmet')

    // No PR → no advisory at all (the delivery gate).
    listPrs.mockResolvedValue([])
    const early = await taskVerificationService.statusForTask('t-1')
    expect(early.nextActions.some(a => a.kind === 'TEST_CASE')).toBe(false)
  })
})

describe('LUM-807 · invariant', () => {
  it('test case reminder never blocks DONE nor consumes a verify round', async () => {
    // 1. The DONE gate is three assertions in task-state.service; none of them
    //    may learn about test cases. Source-level so it survives a refactor of
    //    how the gate is wired, and fails loudly if a future change routes a
    //    test-case read into the gate.
    const gateSource = readFileSync(
      join(process.cwd(), 'lib/services/task-state.service.ts'),
      'utf8'
    )
    expect(gateSource).not.toMatch(/test-?[Cc]ase/)

    // 2. The advisory row is structurally incapable of blocking: it carries no
    //    `blocking` field at all, and `advisory` is a `true` literal.
    const s = await taskVerificationService.statusForTask('t-1')
    const row = s.nextActions.find(a => a.kind === 'TEST_CASE')
    expect(row).toBeDefined()
    expect(row && 'blocking' in row).toBe(false)

    // 3. The nudge rides on a round that was already recorded — it does not
    //    add one. Round 1 all-passes with the nudge attached; the next round
    //    number is still driven purely by the run log.
    maxRound.mockResolvedValue(null)
    const first = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1')],
      ATTR,
      'note'
    )
    expect(first.round).toBe(1)
    expect(first.testCaseNudge).not.toBeNull()
    maxRound.mockResolvedValue(1)
    const second = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1')],
      ATTR,
      'note'
    )
    expect(second.round).toBe(2)
  })
})

/**
 * A minimal `task status` payload carrying one met criterion plus the advisory
 * row — the shape the server produces for a delivered-but-scriptless task.
 */
function payloadWithAdvisory(): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't-1',
      identifier: 'LUM-807',
      title: 'CLI test-case reminders',
      status: 'IN_PROGRESS',
    },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [
      {
        id: 'c-1',
        statement: 'reminder renders',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest x.test.ts',
        evidenceRequired: false,
        judgeSteps: null,
        source: 'AGENT_DRAFT',
        addedAtRound: 0,
        verdictStale: false,
        checkMismatch: false,
        machinePassed: true,
        confirmedAt: null,
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          evidencePointer: 'cmd:npx jest#exit=0',
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-09-21T10:00:00.000Z',
        },
      },
    ],
    machineVerification: { total: 1, machineVerified: 1, humanOverridden: 0 },
    cost: { tokenCost: 0, activeTimeSec: 0, reworkRounds: 0 },
    struggleTrail: {
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    },
    trend: {
      passRate: [],
      cost: [],
      rework: { reworkRounds: 0, reopens: 0, extraPrCycles: 0, total: 0 },
    },
    claim: { text: null, source: null },
    faithfulness: {
      state: 'PENDING',
      verdict: null,
      evidence: [],
      reasoning: null,
      diffShas: [],
      prNumbers: [],
      judgedAt: null,
      judgedClaimAt: null,
    },
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [
      {
        kind: 'TEST_CASE',
        statement: 'No test case recorded on a task that already has a PR',
        command: 'lumo task testcase add LUM-807 --title "<title>"',
        advisory: true,
      },
    ],
  }
}
