import { taskHumanVerdictService } from '@/lib/services/task-human-verdict.service'
import { taskVerificationService } from '@/lib/services/task-verification.service'
import { humanVerdictBodySchema } from '@/lib/validation/acceptance'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import {
  postSendBackComment,
  summarizeSendBackNote,
} from '@/lib/services/sendback-comment.service'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(),
    listByTaskIncludingDeleted: jest.fn(),
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
    latestRunsByCriterion: jest.fn(),
    machinePassedCriteria: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findStatus: jest.fn(), findHeaderById: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/services/sendback-comment.service', () => ({
  postSendBackComment: jest.fn(),
  summarizeSendBackNote: jest.fn(),
}))

const TX = { __tx: true }
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))

const listCriteria = acceptanceCriterionRepository.listByTask as jest.Mock
const createMany = verificationRunRepository.createMany as jest.Mock
const maxRound = verificationRunRepository.maxRoundByTask as jest.Mock
const listRuns = verificationRunRepository.listByTask as jest.Mock
const latestRuns = verificationRunRepository.latestRunsByCriterion as jest.Mock
const machinePassedCriteria =
  verificationRunRepository.machinePassedCriteria as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const listIncludingDeleted =
  acceptanceCriterionRepository.listByTaskIncludingDeleted as jest.Mock
const listChangeEvents = activityRepository.listByTaskAndType as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const getDetail = taskService.getTaskDetail as jest.Mock
const updateWithSideEffects = taskService.updateTaskWithSideEffects as jest.Mock
const postComment = postSendBackComment as jest.Mock
const summarize = summarizeSendBackNote as jest.Mock

const ATTR = { actorMemberId: 'member-1', actorClerkId: 'clerk-1' }

const CRITERIA = [
  {
    id: 'c-1',
    taskId: 't-1',
    statement: 'machine criterion one',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest c-1',
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
  },
  {
    id: 'c-2',
    taskId: 't-1',
    statement: 'machine criterion two',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest c-2',
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
  },
  {
    id: 'c-h',
    taskId: 't-1',
    statement: 'human criterion',
    verifierType: 'HUMAN',
    checkpointer: null,
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
  },
]

const DETAIL = {
  id: 't-1',
  status: 'IN_REVIEW',
  projectId: 'p-1',
  title: 'Ship the thing',
  number: 42,
  teamIdentifier: 'LUM',
  priority: 'MEDIUM',
  assigneeActorId: 'actor-9',
}

beforeEach(() => {
  jest.clearAllMocks()
  listCriteria.mockResolvedValue(CRITERIA)
  // statusForTask read-model dependencies (LUM-437) default to empty.
  listIncludingDeleted.mockResolvedValue([])
  listChangeEvents.mockResolvedValue([])
  maxRound.mockResolvedValue(2)
  // No prior verdicts by default — every select-all test overlays the whole
  // contract with its own verdict, so the snapshot is irrelevant there.
  latestRuns.mockResolvedValue(new Map())
  // By the time a human bulk-passes, the MACHINE criteria have machine-passed
  // (that is how the task reached IN_REVIEW). The LUM-456 gate only drops
  // un-machine-passed MACHINE criteria, so this realistic default keeps the
  // whole-contract fan-out intact; tests that exercise the gate override it.
  machinePassedCriteria.mockResolvedValue(new Set(['c-1', 'c-2']))
  findActor.mockResolvedValue({ id: 'actor-1' })
  getDetail.mockResolvedValue({ ...DETAIL })
  updateWithSideEffects.mockResolvedValue({})
  postComment.mockResolvedValue('comment-1')
  summarize.mockImplementation((n: string | null | undefined) =>
    n ? 'the send-back summary' : null
  )
})

describe('contract guard', () => {
  it('400 when the task has no acceptance criteria at all', async () => {
    listCriteria.mockResolvedValue([])
    await expect(
      taskHumanVerdictService.recordHumanVerdict(
        't-1',
        { verdict: 'PASS' },
        ATTR
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(createMany).not.toHaveBeenCalled()
  })
})

describe('round stamping & fan-out', () => {
  it('fans out one verifierType=HUMAN row per criterion at round = current max round, never incremented', async () => {
    maxRound.mockResolvedValue(2)
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS' },
      ATTR
    )
    expect(out.round).toBe(2)
    const rows = createMany.mock.calls[0]![0]
    expect(rows).toHaveLength(3)
    expect(rows.map((r: { criterionId: string }) => r.criterionId)).toEqual([
      'c-1',
      'c-2',
      'c-h',
    ])
    for (const row of rows) {
      expect(row.round).toBe(2) // same round as the machine all-pass — review, not a new round
      expect(row.verifierType).toBe('HUMAN')
      expect(row.evidencePointer).toBeNull()
    }
    expect(createMany.mock.calls[0]![1]).toBe(TX)
  })

  it('floors the round at 1 when no machine round has ever run', async () => {
    maxRound.mockResolvedValue(null)
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS' },
      ATTR
    )
    expect(out.round).toBe(1)
  })

  it('mirrors every fan-out row as VERIFICATION_RUN_RECORDED with null enum + the send-back commentId (LUM-422)', async () => {
    await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'FAIL', note: 'wrong scope' },
      ATTR
    )
    const mirrors = createActivity.mock.calls.filter(
      c => c[0].type === 'VERIFICATION_RUN_RECORDED'
    )
    expect(mirrors).toHaveLength(3)
    for (const m of mirrors) {
      expect(m[1]).toBe(TX)
      expect(m[0].payload).toMatchObject({
        round: 2,
        verdict: 'FAIL',
        verifierType: 'HUMAN',
        rejectionReasonEnum: null,
        commentId: 'comment-1',
      })
    }
  })

  it("keeps 'machine all-pass but human FAIL' derivable from rows alone: human rows share the machine round, split by verifierType", async () => {
    maxRound.mockResolvedValue(3)
    await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'FAIL' },
      ATTR
    )
    const humanRows = createMany.mock.calls[0]![0]
    // Simulated machine all-pass at round 3 + the human rows just written:
    // filtering the same round by verifierType cleanly derives the signal.
    const machineRows = [
      { round: 3, verifierType: 'MACHINE', verdict: 'PASS' },
      { round: 3, verifierType: 'MACHINE', verdict: 'PASS' },
    ]
    const sameRound = [...machineRows, ...humanRows].filter(r => r.round === 3)
    const machineAllPass = sameRound
      .filter(r => r.verifierType === 'MACHINE')
      .every(r => r.verdict === 'PASS')
    const humanFailed = sameRound.some(
      r => r.verifierType === 'HUMAN' && r.verdict === 'FAIL'
    )
    expect(machineAllPass).toBe(true)
    expect(humanFailed).toBe(true)
  })
})

describe('FAIL semantics', () => {
  it('schema (LUM-422 de-enumeration): no rejection-reason enum; a bare FAIL or a noted FAIL is valid', () => {
    // De-enumerated: a bare send-back is valid, and there is NO enum field —
    // smuggling one is now a strict-reject (along with verifierType).
    expect(humanVerdictBodySchema.safeParse({ verdict: 'FAIL' }).success).toBe(
      true
    )
    expect(
      humanVerdictBodySchema.safeParse({
        verdict: 'FAIL',
        note: 'missing the retry path',
      }).success
    ).toBe(true)
    expect(
      humanVerdictBodySchema.safeParse({
        verdict: 'FAIL',
        rejectionReasonEnum: 'CRITERION_UNMET',
      }).success
    ).toBe(false)
    expect(
      humanVerdictBodySchema.safeParse({
        verdict: 'FAIL',
        verifierType: 'MACHINE',
      }).success
    ).toBe(false)
    // A clean PASS still carries no note.
    expect(
      humanVerdictBodySchema.safeParse({ verdict: 'PASS', note: 'nice' })
        .success
    ).toBe(false)
  })

  it('posts the FAIL note as a comment, stores a text summary, and links the commentId (LUM-422 ①)', async () => {
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'FAIL', note: '<p>bad scope</p>' },
      ATTR
    )
    expect(postComment).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        rawNote: '<p>bad scope</p>',
        authorActorId: 'actor-1',
        authorClerkId: 'clerk-1',
      })
    )
    expect(out.commentId).toBe('comment-1')
    const rows = createMany.mock.calls[0]![0]
    for (const row of rows) {
      expect(row.rejectionReason).toBe('the send-back summary')
      expect(row.rejectionReasonEnum).toBeNull()
    }
  })

  it('records a bare send-back (no note) without a comment', async () => {
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'FAIL' },
      ATTR
    )
    expect(postComment).not.toHaveBeenCalled()
    expect(out.commentId).toBeNull()
    const rows = createMany.mock.calls[0]![0]
    for (const row of rows) {
      expect(row.rejectionReason).toBeNull()
      expect(row.rejectionReasonEnum).toBeNull()
    }
  })

  it('transitions the task back to IN_PROGRESS through the state machine', async () => {
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'FAIL', note: 'redo' },
      ATTR
    )
    expect(updateWithSideEffects).toHaveBeenCalledWith(
      't-1',
      { status: 'IN_PROGRESS' },
      expect.anything(),
      'actor-1',
      'clerk-1',
      null
    )
    expect(out.taskStatus).toBe('IN_PROGRESS')
  })

  it('surfaces the human rejection reason in the status read model nextActions (free consumption)', async () => {
    findHeader.mockResolvedValue({
      id: 't-1',
      title: 'Ship the thing',
      status: 'IN_PROGRESS',
      number: 42,
      team: { identifier: 'LUM' },
    })
    listCriteria.mockResolvedValue(CRITERIA)
    const base = new Date('2026-06-10T10:00:00Z')
    const later = new Date('2026-06-10T11:00:00Z')
    listRuns.mockResolvedValue([
      // Machine all-pass at round 1…
      ...CRITERIA.filter(c => c.verifierType === 'MACHINE').map(c => ({
        id: `run-m-${c.id}`,
        taskId: 't-1',
        criterionId: c.id,
        round: 1,
        verifierType: 'MACHINE',
        verdict: 'PASS',
        evidencePointer: 'cmd:npx jest#exit=0',
        rejectionReason: null,
        rejectionReasonEnum: null,
        createdAt: base,
      })),
      // …then the human FAIL fan-out at the same round, written later.
      ...CRITERIA.map(c => ({
        id: `run-h-${c.id}`,
        taskId: 't-1',
        criterionId: c.id,
        round: 1,
        verifierType: 'HUMAN',
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: 'not what we agreed',
        rejectionReasonEnum: 'SCOPE_MISMATCH',
        createdAt: later,
      })),
    ])
    const status = await taskVerificationService.statusForTask('t-1')
    expect(status.nextActions).toHaveLength(3)
    for (const action of status.nextActions) {
      expect(action.rejectionReason).toBe('not what we agreed')
    }
    expect(status.lastRoundFailures.map(f => f.rejectionReasonEnum)).toContain(
      'SCOPE_MISMATCH'
    )
  })
})

describe('PASS semantics', () => {
  it('PASS transitions the task to DONE through the state machine and opens nothing', async () => {
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS' },
      ATTR
    )
    expect(updateWithSideEffects).toHaveBeenCalledWith(
      't-1',
      { status: 'DONE' },
      expect.anything(),
      'actor-1',
      'clerk-1',
      null
    )
    expect(out.taskStatus).toBe('DONE')
    const rows = createMany.mock.calls[0]![0]
    for (const row of rows) {
      expect(row.rejectionReason).toBeNull()
      expect(row.rejectionReasonEnum).toBeNull()
    }
  })

  it('PASS on an already-DONE task records the verdict without a transition', async () => {
    getDetail.mockResolvedValue({ ...DETAIL, status: 'DONE' })
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS' },
      ATTR
    )
    expect(updateWithSideEffects).not.toHaveBeenCalled()
    expect(out.taskStatus).toBe('DONE')
    expect(createMany).toHaveBeenCalled()
  })
})

// LUM-425: the optional criterionIds array on the human-verdict body narrows
// the fan-out; omitting it is the legacy whole-contract verdict (the select-all
// special case). The schema bounds the shape; the service rejects ids that
// aren't on the task (no cross-task or unknown-id write).
describe('criterionIds (per-criterion narrowing)', () => {
  it('schema: accepts a non-empty criterionIds array, omitting it stays valid (backward compatible)', () => {
    expect(
      humanVerdictBodySchema.safeParse({
        verdict: 'PASS',
        criterionIds: ['c-1'],
      }).success
    ).toBe(true)
    expect(
      humanVerdictBodySchema.safeParse({
        verdict: 'FAIL',
        criterionIds: ['c-1', 'c-2'],
      }).success
    ).toBe(true)
    // Omitting it = whole-contract fan-out, the legacy task-level verdict.
    expect(humanVerdictBodySchema.safeParse({ verdict: 'PASS' }).success).toBe(
      true
    )
  })

  it('schema: rejects an empty array and an empty-string id (non-empty when present)', () => {
    expect(
      humanVerdictBodySchema.safeParse({ verdict: 'PASS', criterionIds: [] })
        .success
    ).toBe(false)
    expect(
      humanVerdictBodySchema.safeParse({ verdict: 'PASS', criterionIds: [''] })
        .success
    ).toBe(false)
  })

  it('omitting criterionIds preserves the whole-contract fan-out', async () => {
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS' },
      ATTR
    )
    const rows = createMany.mock.calls[0]![0]
    expect(rows.map((r: { criterionId: string }) => r.criterionId)).toEqual([
      'c-1',
      'c-2',
      'c-h',
    ])
    expect(out.criterionIds).toEqual(['c-1', 'c-2', 'c-h'])
  })

  it('rejects a criterionIds entry that is not on this task with 400 (no cross-task / unknown-id write)', async () => {
    await expect(
      taskHumanVerdictService.recordHumanVerdict(
        't-1',
        { verdict: 'PASS', criterionIds: ['c-1', 'c-not-on-this-task'] },
        ATTR
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(createMany).not.toHaveBeenCalled()
  })
})

// LUM-425: a per-criterion verdict writes HUMAN rows only for the selected
// criteria, then recomputes the task status from EVERY criterion's latest
// verdict across the whole contract (not just the ones it touched).
describe('per-criterion verdict status recompute', () => {
  it('writes verifierType=HUMAN rows only for the selected criteria at round = max', async () => {
    maxRound.mockResolvedValue(2)
    // c-1 / c-2 already machine-passed; the human sends back only the HUMAN one.
    latestRuns.mockResolvedValue(
      new Map([
        ['c-1', { criterionId: 'c-1', round: 2, verdict: 'PASS' }],
        ['c-2', { criterionId: 'c-2', round: 2, verdict: 'PASS' }],
      ])
    )
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      {
        verdict: 'FAIL',
        criterionIds: ['c-h'],
        note: 'not in the running app',
      },
      ATTR
    )
    const rows = createMany.mock.calls[0]![0]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ criterionId: 'c-h', verifierType: 'HUMAN' })
    expect(out.criterionIds).toEqual(['c-h'])
    // Only the selected criterion is mirrored as an activity.
    const mirrors = createActivity.mock.calls.filter(
      c => c[0].type === 'VERIFICATION_RUN_RECORDED'
    )
    expect(mirrors).toHaveLength(1)
    expect(mirrors[0]![0].payload.criterionId).toBe('c-h')
  })

  it('a per-criterion send-back bounces the task to IN_PROGRESS even though the other criteria passed', async () => {
    latestRuns.mockResolvedValue(
      new Map([
        ['c-1', { criterionId: 'c-1', round: 2, verdict: 'PASS' }],
        ['c-2', { criterionId: 'c-2', round: 2, verdict: 'PASS' }],
      ])
    )
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'FAIL', criterionIds: ['c-h'] },
      ATTR
    )
    expect(updateWithSideEffects).toHaveBeenCalledWith(
      't-1',
      { status: 'IN_PROGRESS' },
      expect.anything(),
      'actor-1',
      'clerk-1',
      null
    )
    expect(out.taskStatus).toBe('IN_PROGRESS')
  })

  it('passing the last unmet criterion lands the task in DONE', async () => {
    // c-1 / c-2 already passed; c-h is the only remaining unmet criterion.
    latestRuns.mockResolvedValue(
      new Map([
        ['c-1', { criterionId: 'c-1', round: 2, verdict: 'PASS' }],
        ['c-2', { criterionId: 'c-2', round: 2, verdict: 'PASS' }],
      ])
    )
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS', criterionIds: ['c-h'] },
      ATTR
    )
    expect(updateWithSideEffects).toHaveBeenCalledWith(
      't-1',
      { status: 'DONE' },
      expect.anything(),
      'actor-1',
      'clerk-1',
      null
    )
    expect(out.taskStatus).toBe('DONE')
  })

  it('passing one of several still-unmet criteria with no FAIL leaves the task in IN_REVIEW', async () => {
    // Two HUMAN criteria still unjudged; passing one leaves the other unmet.
    listCriteria.mockResolvedValue([
      { ...CRITERIA[0], id: 'c-1' },
      { ...CRITERIA[2], id: 'c-h1' },
      { ...CRITERIA[2], id: 'c-h2' },
    ])
    latestRuns.mockResolvedValue(
      new Map([['c-1', { criterionId: 'c-1', round: 2, verdict: 'PASS' }]])
    )
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS', criterionIds: ['c-h1'] },
      ATTR
    )
    expect(updateWithSideEffects).not.toHaveBeenCalled()
    expect(out.taskStatus).toBe('IN_REVIEW')
  })

  it('the legacy whole-task PASS is the select-all special case: every criterion met → DONE', async () => {
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS' },
      ATTR
    )
    expect(out.taskStatus).toBe('DONE')
    expect(createMany.mock.calls[0]![0]).toHaveLength(3)
  })
})

// LUM-429 RED LINE: the configurable machine-round cap governs ONLY the
// machine loop. A human verdict records at round = max with no cap check, so
// it succeeds even when the workspace's machine-round cap is already exhausted.
describe('human path ignores the configured cap', () => {
  it('records a human verdict at round = max even past any machine cap, with no 409', async () => {
    // Far beyond any configurable cap (1..10): the machine loop would have
    // refused with 409, the human path must not.
    maxRound.mockResolvedValue(9)
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS' },
      ATTR
    )
    expect(out.round).toBe(9) // round = max, never incremented, never capped
    const rows = createMany.mock.calls[0]![0]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.round).toBe(9)
      expect(row.verifierType).toBe('HUMAN')
    }
  })

  it('a human FAIL also records past the cap (no cap-derived 409)', async () => {
    maxRound.mockResolvedValue(9)
    await expect(
      taskHumanVerdictService.recordHumanVerdict(
        't-1',
        { verdict: 'FAIL', note: 'needs another look' },
        ATTR
      )
    ).resolves.toMatchObject({ round: 9 })
  })
})

// LUM-456: a task-level / bulk human PASS must not silently mark a MACHINE
// criterion whose checkpointer has not run-and-passed as PASS — that would let
// the rollup impersonate machine verification. Overriding such a criterion is a
// deliberate, explicit per-criterion action recorded with override provenance.
describe('machine-verification override honesty', () => {
  it('bulk human pass does not silently override un-machine-passed MACHINE criteria', async () => {
    // Neither MACHINE criterion has a passing checkpointer run.
    machinePassedCriteria.mockResolvedValue(new Set<string>())
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS' },
      ATTR
    )
    const ids = createMany.mock.calls[0]![0].map(
      (r: { criterionId: string }) => r.criterionId
    )
    // The un-machine-passed MACHINE criteria are dropped from the silent bulk
    // pass; only the HUMAN criterion is vouched for.
    expect(ids).not.toContain('c-1')
    expect(ids).not.toContain('c-2')
    expect(ids).toEqual(['c-h'])
    expect(out.criterionIds).toEqual(['c-h'])
    // No row impersonates a machine result, so none is flagged an override.
    const mirrors = createActivity.mock.calls.filter(
      c => c[0].type === 'VERIFICATION_RUN_RECORDED'
    )
    expect(mirrors).toHaveLength(1)
    expect(mirrors[0]![0].payload.override).toBe(false)
  })

  it('an explicit per-criterion pass overrides an un-machine-passed MACHINE criterion with override provenance', async () => {
    machinePassedCriteria.mockResolvedValue(new Set<string>())
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS', criterionIds: ['c-1'] },
      ATTR
    )
    const rows = createMany.mock.calls[0]![0]
    // The deliberate selection IS honoured — a human can still override.
    expect(rows.map((r: { criterionId: string }) => r.criterionId)).toEqual([
      'c-1',
    ])
    expect(out.criterionIds).toEqual(['c-1'])
    // …and the mirror marks it an override (auditable, zero schema).
    const mirror = createActivity.mock.calls.find(
      c => c[0].type === 'VERIFICATION_RUN_RECORDED'
    )!
    expect(mirror[0].payload.override).toBe(true)
  })

  it('a bulk pass still vouches for genuinely machine-passed MACHINE criteria', async () => {
    // Both machine criteria have a passing checkpointer run (the default).
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS' },
      ATTR
    )
    expect(out.criterionIds).toEqual(['c-1', 'c-2', 'c-h'])
    const mirrors = createActivity.mock.calls.filter(
      c => c[0].type === 'VERIFICATION_RUN_RECORDED'
    )
    for (const m of mirrors) expect(m[0].payload.override).toBe(false)
  })
})
