/**
 * @jest-environment node
 *
 * LUM-1191: the two queries behind the spot-check pool are filtered by the
 * caller's workspace in the WHERE clause, and the candidate select carries
 * the runner columns `lumo spot-check` shows.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    testCaseRun: { findMany: jest.fn(async () => []) },
    testCaseRunReview: { findMany: jest.fn(async () => []) },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { testCaseRunReviewRepository } from '@/lib/repositories/test-case-run-review.repository'

const runs = prisma.testCaseRun.findMany as unknown as jest.Mock
const reviews = prisma.testCaseRunReview.findMany as unknown as jest.Mock

describe('LUM-1191 spot-check pool repository', () => {
  it('scopes the candidate and review queries to the given workspace', async () => {
    await testCaseRunReviewRepository.listPassCandidates('w-A')
    await testCaseRunReviewRepository.listForWorkspace('w-A')
    const runArgs = runs.mock.calls[0]![0]
    expect(runArgs.where.task).toEqual({ project: { workspaceId: 'w-A' } })
    expect(runArgs.where.result).toBe('PASS')
    expect(reviews.mock.calls[0]![0].where).toEqual({
      task: { project: { workspaceId: 'w-A' } },
    })
  })

  it('selects the runner columns for each candidate', async () => {
    await testCaseRunReviewRepository.listPassCandidates('w-A')
    const select = runs.mock.calls[runs.mock.calls.length - 1]![0].select
    expect(select.executedByMemberId).toBe(true)
    expect(select.sourceSessionId).toBe(true)
  })
})
