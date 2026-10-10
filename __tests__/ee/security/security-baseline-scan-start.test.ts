/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/workflows/security-baseline-scan', () => ({
  securityBaselineScanWorkflow: jest.fn(),
}))

import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { startSecurityBaselineScan } from '@/lib/services/security-baseline-scan-start'
import { securityBaselineScanWorkflow } from '@/lib/workflows/security-baseline-scan'

const startMock = start as unknown as jest.Mock
const JOB = { workspaceId: 'w1', repo: 'o/r', sha: 'b'.repeat(40) }

beforeEach(() => jest.clearAllMocks())

describe('LUM-738 baseline lifecycle — start wrapper', () => {
  it('starts the baseline workflow with the job and returns the run id', async () => {
    startMock.mockResolvedValue({ runId: 'run_b' })
    await expect(startSecurityBaselineScan(JOB)).resolves.toBe('run_b')
    expect(startMock).toHaveBeenCalledWith(securityBaselineScanWorkflow, [JOB])
    expect((logger.info as jest.Mock).mock.calls[0]?.join(' ')).toContain(
      'o/r@bbbbbbb'
    )
  })

  it('returns null and logs when start throws', async () => {
    startMock.mockRejectedValue(new Error('workflow backend 503'))
    await expect(startSecurityBaselineScan(JOB)).resolves.toBeNull()
    expect((logger.error as jest.Mock).mock.calls[0]?.join(' ')).toContain(
      '503'
    )
  })
})
