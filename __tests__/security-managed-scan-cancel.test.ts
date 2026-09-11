/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { getRun } from 'workflow/api'
import { logger } from '@/lib/logger'
import { cancelManagedRun } from '@/lib/services/security-managed-scan-cancel'

const getRunMock = getRun as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

it('cancels the run by id and returns true', async () => {
  const cancel = jest.fn(async () => undefined)
  getRunMock.mockReturnValue({ cancel })
  await expect(cancelManagedRun('run_1', 's1')).resolves.toBe(true)
  expect(getRunMock).toHaveBeenCalledWith('run_1')
  expect(cancel).toHaveBeenCalled()
  const line = (logger.info as jest.Mock).mock.calls[0]?.join(' ') ?? ''
  expect(line).toContain('run=run_1')
  expect(line).toContain('scan=s1')
})

it('returns false and warns when the run cannot be cancelled (never throws)', async () => {
  getRunMock.mockReturnValue({
    cancel: jest.fn(async () => {
      throw new Error('WorkflowRunNotFoundError')
    }),
  })
  await expect(cancelManagedRun('run_x', 's1')).resolves.toBe(false)
  const line = (logger.warn as jest.Mock).mock.calls[0]?.join(' ') ?? ''
  expect(line).toContain('run=run_x')
  expect(line).toContain('WorkflowRunNotFoundError')
})

it('returns false when getRun itself throws', async () => {
  getRunMock.mockImplementation(() => {
    throw new Error('no world')
  })
  await expect(cancelManagedRun('run_y', 's2')).resolves.toBe(false)
  const line = (logger.warn as jest.Mock).mock.calls[0]?.join(' ') ?? ''
  expect(line).toContain('run=run_y')
  expect(line).toContain('scan=s2')
  expect(line).toContain('no world')
})
