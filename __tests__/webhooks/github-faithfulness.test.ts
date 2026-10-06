/** @jest-environment node */
const judgeTask = jest.fn(async (_id: string) => 'FAITHFUL')
const waitUntil = jest.fn((p: Promise<unknown>) => p)

jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => waitUntil(p),
}))
jest.mock('@/lib/services/claim-faithfulness.service', () => ({
  claimFaithfulnessService: { judgeTask: (id: string) => judgeTask(id) },
}))

import { enqueueFaithfulnessJudgeOnMerge } from '@/lib/services/claim-faithfulness-trigger'

beforeEach(() => {
  judgeTask.mockClear()
  waitUntil.mockClear()
})

describe('enqueueFaithfulnessJudgeOnMerge', () => {
  it('enqueues judging when a PR is merged', () => {
    enqueueFaithfulnessJudgeOnMerge('merged', 'task1')
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(judgeTask).toHaveBeenCalledWith('task1')
  })

  it('does not enqueue judging for a non-merge state', () => {
    enqueueFaithfulnessJudgeOnMerge('closed', 'task1')
    enqueueFaithfulnessJudgeOnMerge('open', 'task1')
    expect(judgeTask).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
  })
})
