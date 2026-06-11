import { taskAgentVerdictService } from '@/lib/services/task-agent-verdict.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import {
  postSendBackComment,
  summarizeSendBackNote,
} from '@/lib/services/sendback-comment.service'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: { createMany: jest.fn(), maxRoundByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
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
const createActivity = activityRepository.create as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock
const getDetail = taskService.getTaskDetail as jest.Mock
const updateWithSideEffects = taskService.updateTaskWithSideEffects as jest.Mock
const postComment = postSendBackComment as jest.Mock
const summarize = summarizeSendBackNote as jest.Mock

const ATTR = { actorMemberId: 'member-1', actorClerkId: 'clerk-1' }

const CRITERIA = [
  { id: 'c-1', taskId: 't-1', statement: 'criterion one', verifierType: 'MACHINE', checkpointer: 'x', evidenceRequired: false, source: 'AGENT_DRAFT', addedAtRound: 0 },
  { id: 'c-2', taskId: 't-1', statement: 'criterion two', verifierType: 'HUMAN', checkpointer: null, evidenceRequired: false, source: 'AGENT_DRAFT', addedAtRound: 0 },
]

const DETAIL = { id: 't-1', status: 'IN_REVIEW' }

beforeEach(() => {
  jest.clearAllMocks()
  listCriteria.mockResolvedValue(CRITERIA)
  maxRound.mockResolvedValue(2)
  findActor.mockResolvedValue({ id: 'actor-1' })
  getDetail.mockResolvedValue({ ...DETAIL })
  updateWithSideEffects.mockResolvedValue({})
  postComment.mockResolvedValue('comment-9')
  summarize.mockReturnValue('the retry path is missing')
})

describe('contract guards', () => {
  it('400 when the task has no acceptance criteria', async () => {
    listCriteria.mockResolvedValue([])
    await expect(
      taskAgentVerdictService.recordAgentVerdict('t-1', { rejectionReasonEnum: 'CRITERION_UNMET' }, ATTR)
    ).rejects.toMatchObject({ status: 400 })
    expect(createMany).not.toHaveBeenCalled()
  })

  it('400 when a criterionIds entry is not on the task', async () => {
    await expect(
      taskAgentVerdictService.recordAgentVerdict(
        't-1',
        { rejectionReasonEnum: 'CRITERION_UNMET', criterionIds: ['c-1', 'nope'] },
        ATTR
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(createMany).not.toHaveBeenCalled()
  })
})

describe('verifierType AGENT channel', () => {
  it('writes verifierType=AGENT, verdict=FAIL rows — a distinct channel from HUMAN', async () => {
    await taskAgentVerdictService.recordAgentVerdict(
      't-1',
      { rejectionReasonEnum: 'CRITERION_UNMET' },
      ATTR
    )
    const rows = createMany.mock.calls[0]![0]
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.verifierType).toBe('AGENT')
      expect(row.verdict).toBe('FAIL')
      expect(row.evidencePointer).toBeNull()
      expect(row.rejectionReasonEnum).toBe('CRITERION_UNMET')
    }
    expect(createMany.mock.calls[0]![1]).toBe(TX)
  })

  it('mirrors every row as VERIFICATION_RUN_RECORDED with verifierType AGENT in the same transaction', async () => {
    await taskAgentVerdictService.recordAgentVerdict(
      't-1',
      { rejectionReasonEnum: 'SCOPE_MISMATCH', note: 'redo' },
      ATTR
    )
    const mirrors = createActivity.mock.calls.filter(
      c => c[0].type === 'VERIFICATION_RUN_RECORDED'
    )
    expect(mirrors).toHaveLength(2)
    for (const m of mirrors) {
      expect(m[1]).toBe(TX)
      expect(m[0].payload).toMatchObject({
        verdict: 'FAIL',
        verifierType: 'AGENT',
        rejectionReasonEnum: 'SCOPE_MISMATCH',
        commentId: 'comment-9',
      })
    }
  })
})

describe('round + status semantics', () => {
  it('records at round = current max, never incremented', async () => {
    maxRound.mockResolvedValue(3)
    const out = await taskAgentVerdictService.recordAgentVerdict('t-1', { rejectionReasonEnum: 'OTHER' }, ATTR)
    expect(out.round).toBe(3)
    expect(createMany.mock.calls[0]![0].every((r: { round: number }) => r.round === 3)).toBe(true)
  })

  it('floors the round at 1 when no machine round ran', async () => {
    maxRound.mockResolvedValue(null)
    const out = await taskAgentVerdictService.recordAgentVerdict('t-1', { rejectionReasonEnum: 'OTHER' }, ATTR)
    expect(out.round).toBe(1)
  })

  it('sends the task back to IN_PROGRESS through the state machine', async () => {
    const out = await taskAgentVerdictService.recordAgentVerdict('t-1', { rejectionReasonEnum: 'CRITERION_UNMET' }, ATTR)
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
})

describe('send-back narrative + criterion narrowing', () => {
  it('posts the note as a comment and carries the commentId + text summary onto the rows', async () => {
    const out = await taskAgentVerdictService.recordAgentVerdict(
      't-1',
      { rejectionReasonEnum: 'CRITERION_UNMET', note: 'the retry path is missing' },
      ATTR
    )
    expect(postComment).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't-1', rawNote: 'the retry path is missing', authorActorId: 'actor-1' })
    )
    expect(out.commentId).toBe('comment-9')
    const rows = createMany.mock.calls[0]![0]
    for (const row of rows) {
      expect(row.rejectionReason).toBe('the retry path is missing')
    }
  })

  it('does not post a comment when no note is given (bare send-back)', async () => {
    const out = await taskAgentVerdictService.recordAgentVerdict('t-1', { rejectionReasonEnum: 'OTHER' }, ATTR)
    expect(postComment).not.toHaveBeenCalled()
    expect(out.commentId).toBeNull()
  })

  it('narrows the fan-out to the named criteria', async () => {
    const out = await taskAgentVerdictService.recordAgentVerdict(
      't-1',
      { rejectionReasonEnum: 'CRITERION_UNMET', criterionIds: ['c-2'] },
      ATTR
    )
    const rows = createMany.mock.calls[0]![0]
    expect(rows).toHaveLength(1)
    expect(rows[0].criterionId).toBe('c-2')
    expect(out.criterionIds).toEqual(['c-2'])
  })
})
