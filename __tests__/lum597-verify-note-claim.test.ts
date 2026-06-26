/**
 * LUM-597 — claim 取数改为「verify 必填自述」(重档).
 *
 * The pre-fix claim was a summarizer LLM paraphrasing the session event stream,
 * frozen only at DONE. The RFC (ratified) moves the claim to the agent's own
 * required self-report attached to the verify action: when a machine round
 * all-passes and the task flips to IN_REVIEW, the agent's `--note` is persisted
 * as the task's claim with source=AGENT, at that moment (not DONE). The
 * faithfulness audit then judges the agent's OWN words, not a paraphrase.
 *
 * Red line unchanged (milestone rule 5): the agent/CLI verify path still only
 * writes MACHINE rows — the note rides alongside as a self-report and never
 * becomes a passing or human verdict. machineRoundBodySchema stays strict.
 */
import { taskVerificationService } from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
// pull-request.repository is mocked below (the read model imports it); no
// binding is needed here.
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import { machineRoundBodySchema } from '@/lib/validation/acceptance'

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
    createMany: jest.fn(),
    maxRoundByTask: jest.fn(),
    listByTask: jest.fn(),
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
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findStatus: jest.fn(),
    findHeaderById: jest.fn(),
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
    // LUM-597: the AGENT self-claim write path.
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

const TX = { __tx: true }
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
// task-claim-snapshot.service (the real one runs) reaches these for its
// resolve path; recordAgentSelfClaim only touches taskRepository.setClaimSnapshot.
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
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))

const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock
const createMany = verificationRunRepository.createMany as jest.Mock
const maxRound = verificationRunRepository.maxRoundByTask as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const findStatus = taskRepository.findStatus as jest.Mock
const setClaimSnapshot = taskRepository.setClaimSnapshot as jest.Mock
const findCap = workspaceRepository.findVerificationMaxRounds as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock
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

const NOTE =
  'Implemented the AGENT claim source in task-claim.ts because the summarizer paraphrase judged the wrong object.'

beforeEach(() => {
  jest.clearAllMocks()
  listByTask.mockResolvedValue([
    machineCriterion('c-1'),
    machineCriterion('c-2'),
  ])
  maxRound.mockResolvedValue(null)
  findCap.mockResolvedValue(null)
  findActor.mockResolvedValue({ id: 'actor-1' })
  findStatus.mockResolvedValue({ status: 'IN_PROGRESS' })
  getDetail.mockResolvedValue({ status: 'IN_PROGRESS', projectId: 'p-1' })
  updateWithSideEffects.mockResolvedValue({})
})

describe('LUM-597 · verify --note → AGENT claim', () => {
  it('persists the verify note as an AGENT-sourced claim when the round flips the task to IN_REVIEW', async () => {
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), pass('c-2')],
      ATTR,
      NOTE
    )

    expect(out.allPassed).toBe(true)
    expect(out.taskStatus).toBe('IN_REVIEW')
    // The agent's own words are frozen as the claim, source AGENT, at this
    // moment (IN_REVIEW) — not deferred to DONE, not a summarizer paraphrase.
    expect(setClaimSnapshot).toHaveBeenCalledTimes(1)
    const [tid, snap] = setClaimSnapshot.mock.calls[0]
    expect(tid).toBe('t-1')
    expect(snap).toMatchObject({
      text: NOTE,
      source: 'AGENT',
      sessionId: 'sess-1',
    })
    expect(snap.at).toBeInstanceOf(Date)
  })

  it('does not write a claim on a FAIL round even when a note is supplied', async () => {
    await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), fail('c-2')],
      ATTR,
      NOTE
    )
    expect(setClaimSnapshot).not.toHaveBeenCalled()
  })

  it('does not overwrite the claim on re-verify of an already-DONE task', async () => {
    getDetail.mockResolvedValue({ status: 'DONE', projectId: 'p-1' })
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), pass('c-2')],
      ATTR,
      NOTE
    )
    expect(out.taskStatus).toBe('DONE')
    expect(setClaimSnapshot).not.toHaveBeenCalled()
  })

  it('falls back gracefully (no AGENT claim, no throw) when an old CLI omits the note', async () => {
    const out = await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), pass('c-2')],
      ATTR
      // no note — old CLI / non-verify path: degrade to SYNTHESIZED at DONE.
    )
    expect(out.allPassed).toBe(true)
    expect(setClaimSnapshot).not.toHaveBeenCalled()
  })

  it('verify --note path never produces a passing or human verdict and the round body stays MACHINE-only', async () => {
    await taskVerificationService.recordMachineRound(
      't-1',
      'w-1',
      [pass('c-1'), pass('c-2')],
      ATTR,
      NOTE
    )
    // Every persisted row is hard-coded MACHINE — the note does not open a
    // passing/human verdict channel.
    const rows = createMany.mock.calls[0]![0]
    expect(rows.length).toBe(2)
    for (const row of rows) expect(row.verifierType).toBe('MACHINE')
    // No verdict-bearing activity smuggles a verifierType other than the
    // machine round mirror.
    const recorded = createActivity.mock.calls.map(c => c[0].type)
    expect(recorded.every(t => t === 'VERIFICATION_RUN_RECORDED')).toBe(true)

    // The body schema is the schema-layer lock: a note is accepted, but a
    // smuggled verifierType (or a verdict field) is rejected by .strict().
    expect(
      machineRoundBodySchema.safeParse({
        results: [
          {
            criterionId: 'c-1',
            verdict: 'PASS',
            evidencePointer: 'cmd:x#exit=0',
          },
        ],
        note: NOTE,
      }).success
    ).toBe(true)
    expect(
      machineRoundBodySchema.safeParse({
        results: [
          {
            criterionId: 'c-1',
            verdict: 'PASS',
            evidencePointer: 'cmd:x#exit=0',
          },
        ],
        note: NOTE,
        verifierType: 'HUMAN',
      }).success
    ).toBe(false)
  })
})
