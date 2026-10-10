/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/workflows/security-sarif-ingest', () => ({
  securitySarifIngestWorkflow: jest.fn(),
}))

import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { startSecuritySarifIngest } from '@/lib/services/security-sarif-ingest-start'
import { securitySarifIngestWorkflow } from '@/lib/workflows/security-sarif-ingest'

const startMock = start as unknown as jest.Mock

const JOB = {
  url: 'https://blob.vercel-storage.com/security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  pathname: 'security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  repository: 'o/r',
  headSha: 'sha1',
  prNumber: 7,
  tool: 'semgrep',
}

beforeEach(() => jest.clearAllMocks())

it('starts the workflow with the job as its single argument and returns the run id', async () => {
  startMock.mockResolvedValue({ runId: 'run_1' })
  await expect(startSecuritySarifIngest(JOB)).resolves.toBe('run_1')
  expect(startMock).toHaveBeenCalledWith(securitySarifIngestWorkflow, [JOB])
})

it('returns null and logs (without the blob URL) when start throws', async () => {
  startMock.mockRejectedValue(new Error('workflow backend 503'))
  await expect(startSecuritySarifIngest(JOB)).resolves.toBeNull()
  const line = (logger.error as jest.Mock).mock.calls[0]?.join(' ') ?? ''
  expect(line).toContain('workflow backend 503')
  expect(line).toContain('semgrep')
  expect(line).not.toContain(JOB.url)
})
