/**
 * @jest-environment node
 *
 * LUM-1030 ruling ③ — cancel does not interrupt the executing step. The
 * persisting steps of the managed scan (SARIF persist) and the hunt ask
 * whether their run was cancelled and discard a late result instead of
 * writing it. `isCurrentRunCancelled` fails open.
 */
// LUM-1064: plugin cases live in __tests__/ee/security/lib/workflows/run-cancellation.test.ts.
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

import { getWorkflowMetadata } from 'workflow'
import { getRun } from 'workflow/api'
import { isCurrentRunCancelled } from '@/lib/workflows/run-cancellation'

const m = <T>(fn: T) => fn as unknown as jest.Mock

function runStatus(status: string) {
  m(getRun).mockImplementation(() => ({
    cancel: jest.fn(),
    status: Promise.resolve(status),
  }))
}

beforeEach(() => {
  jest.clearAllMocks()
  runStatus('running')
})

describe('isCurrentRunCancelled', () => {
  it('LUM-1030 cancel guard: true only for a cancelled run, read by the current run id', async () => {
    m(getWorkflowMetadata).mockReturnValueOnce({ workflowRunId: 'wrun_7' })
    runStatus('cancelled')
    await expect(isCurrentRunCancelled()).resolves.toBe(true)
    expect(getRun).toHaveBeenCalledWith('wrun_7')

    for (const status of ['running', 'completed', 'failed', 'pending']) {
      runStatus(status)
      await expect(isCurrentRunCancelled()).resolves.toBe(false)
    }
  })

  it('LUM-1030 cancel guard: fails open when the lookup throws', async () => {
    m(getRun).mockImplementationOnce(() => {
      throw new Error('world unavailable')
    })
    await expect(isCurrentRunCancelled()).resolves.toBe(false)
  })
})
