/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/workflows/security-managed-scan', () => ({
  securityManagedScanWorkflow: jest.fn(),
}))

import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { startSecurityManagedScan } from '@/lib/services/security-managed-scan-start'
import { securityManagedScanWorkflow } from '@/lib/workflows/security-managed-scan'

const startMock = start as unknown as jest.Mock

const PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }
const JOB = {
  scanId: 's1',
  pr: PR,
  headSha: 'a'.repeat(40),
  huntWanted: false,
}

beforeEach(() => jest.clearAllMocks())

it('starts the workflow with the job as its single argument and returns the run id', async () => {
  startMock.mockResolvedValue({ runId: 'run_1' })
  await expect(startSecurityManagedScan(JOB)).resolves.toBe('run_1')
  expect(startMock).toHaveBeenCalledWith(securityManagedScanWorkflow, [JOB])
  const line = (logger.info as jest.Mock).mock.calls[0]?.join(' ') ?? ''
  expect(line).toContain('scan=s1')
  expect(line).toContain('o/r#7')
})

it('returns null and logs (without the head sha) when start throws', async () => {
  startMock.mockRejectedValue(new Error('workflow backend 503'))
  await expect(startSecurityManagedScan(JOB)).resolves.toBeNull()
  const line = (logger.error as jest.Mock).mock.calls[0]?.join(' ') ?? ''
  expect(line).toContain('workflow backend 503')
  expect(line).toContain('s1')
  expect(line).toContain('o/r#7')
  expect(line).not.toContain(JOB.headSha)
})
