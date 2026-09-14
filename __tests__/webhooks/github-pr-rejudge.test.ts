/** @jest-environment node */
const rejudgeForTask = jest.fn(async (_id: string) => ({ judged: 0 }))
const waitUntil = jest.fn((p: Promise<unknown>) => p)
const warn = jest.fn()

jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => waitUntil(p),
}))
jest.mock('@/lib/services/boundary-crossing-rejudge.service', () => ({
  boundaryCrossingRejudgeService: {
    rejudgeTestFileDeletedForTask: (id: string) => rejudgeForTask(id),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: (...a: unknown[]) => warn(...a),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

import { enqueueCrossingRejudgeOnPrClose } from '@/lib/services/boundary-crossing-rejudge-trigger'

beforeEach(() => {
  rejudgeForTask.mockClear()
  waitUntil.mockClear()
  warn.mockClear()
})

/** Drain the detached promise handed to waitUntil. */
async function drained(): Promise<void> {
  const p = waitUntil.mock.calls[0]?.[0]
  if (p) await p
}

describe('enqueueCrossingRejudgeOnPrClose (LUM-780 PR-close trigger)', () => {
  it('re-judges the task when a PR merges', async () => {
    enqueueCrossingRejudgeOnPrClose('merged', 'task1')
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await drained()
    expect(rejudgeForTask).toHaveBeenCalledWith('task1')
  })

  it('re-judges the task when a PR closes unmerged — the review window closed either way', async () => {
    enqueueCrossingRejudgeOnPrClose('closed', 'task1')
    await drained()
    expect(rejudgeForTask).toHaveBeenCalledWith('task1')
  })

  it('does nothing while the PR is still open', () => {
    enqueueCrossingRejudgeOnPrClose('open', 'task1')
    expect(waitUntil).not.toHaveBeenCalled()
    expect(rejudgeForTask).not.toHaveBeenCalled()
  })

  it('swallows a re-judge failure (warned) so the webhook never fails', async () => {
    rejudgeForTask.mockRejectedValueOnce(new Error('db down'))
    enqueueCrossingRejudgeOnPrClose('merged', 'task1')
    await expect(drained()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('task1'))
  })
})
