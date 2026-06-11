import {
  taskHumanVerdictService,
  FOLLOW_UP_TITLE_PREFIX,
} from '@/lib/services/task-human-verdict.service'
import { taskVerificationService } from '@/lib/services/task-verification.service'
import { humanVerdictBodySchema } from '@/lib/validation/acceptance'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import {
  createTask,
  createFromAutomation,
} from '@/lib/services/task-creation.service'
import {
  postSendBackComment,
  summarizeSendBackNote,
} from '@/lib/services/sendback-comment.service'

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
    listByTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
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
jest.mock('@/lib/services/task-creation.service', () => ({
  createTask: jest.fn(),
  createFromAutomation: jest.fn(),
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
const createActivity = activityRepository.create as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const getDetail = taskService.getTaskDetail as jest.Mock
const updateWithSideEffects = taskService.updateTaskWithSideEffects as jest.Mock
const createTaskMock = createTask as jest.Mock
const createFromAutomationMock = createFromAutomation as jest.Mock
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
  maxRound.mockResolvedValue(2)
  findActor.mockResolvedValue({ id: 'actor-1' })
  getDetail.mockResolvedValue({ ...DETAIL })
  updateWithSideEffects.mockResolvedValue({})
  createTaskMock.mockResolvedValue({
    task: {
      id: 't-fu',
      number: 43,
      title: `${FOLLOW_UP_TITLE_PREFIX}Ship the thing`,
    },
    taskTags: [],
  })
  createFromAutomationMock.mockResolvedValue({
    task: {
      id: 't-fu',
      number: 43,
      title: `${FOLLOW_UP_TITLE_PREFIX}Ship the thing`,
    },
  })
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
    expect(out.followUpTask).toBeNull()
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

describe('PASS and PASS_WITH_FOLLOWUP semantics', () => {
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
    expect(out.followUpTask).toBeNull()
    expect(createTaskMock).not.toHaveBeenCalled()
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

  it('PASS_WITH_FOLLOWUP transitions to DONE and auto-creates the follow-up: prefixed task referencing the origin, no sprint', async () => {
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS_WITH_FOLLOWUP', note: 'docs still missing' },
      ATTR
    )
    expect(createTaskMock).toHaveBeenCalledTimes(1)
    const [projectId, input, actorId, actorClerkId] =
      createTaskMock.mock.calls[0]!
    expect(projectId).toBe('p-1')
    expect(input.title).toBe(`${FOLLOW_UP_TITLE_PREFIX}Ship the thing`)
    expect(input.title.startsWith('follow-up: ')).toBe(true)
    expect(input.description).toContain('LUM-42')
    expect(input.description).toContain('docs still missing')
    expect(input.status).toBe('TODO')
    expect(input.sprintId).toBeNull()
    expect(input.milestoneId).toBeUndefined()
    expect(actorId).toBe('actor-1')
    expect(actorClerkId).toBe('clerk-1')
    expect(updateWithSideEffects).toHaveBeenCalledWith(
      't-1',
      { status: 'DONE' },
      expect.anything(),
      'actor-1',
      'clerk-1',
      null
    )
    expect(out.taskStatus).toBe('DONE')
    expect(out.followUpTask).toEqual({
      id: 't-fu',
      number: 43,
      title: `${FOLLOW_UP_TITLE_PREFIX}Ship the thing`,
    })
    // The note rides along on the rows as the human's outstanding-items text.
    const rows = createMany.mock.calls[0]![0]
    for (const row of rows) {
      expect(row.rejectionReason).toBe('docs still missing')
      expect(row.rejectionReasonEnum).toBeNull()
    }
  })

  it('PASS_WITH_FOLLOWUP falls back to the automation create path when the adjudicator has no Actor row', async () => {
    findActor.mockResolvedValue(null)
    const out = await taskHumanVerdictService.recordHumanVerdict(
      't-1',
      { verdict: 'PASS_WITH_FOLLOWUP', note: 'edge case' },
      ATTR
    )
    expect(createTaskMock).not.toHaveBeenCalled()
    expect(createFromAutomationMock).toHaveBeenCalledTimes(1)
    expect(out.followUpTask).not.toBeNull()
  })
})
