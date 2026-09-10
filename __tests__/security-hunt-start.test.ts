/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/workflows/security-hunt', () => ({
  securityHuntWorkflow: jest.fn(),
}))

import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { startSecurityHunt } from '@/lib/services/security-hunt-start'
import { securityHuntWorkflow } from '@/lib/workflows/security-hunt'

const startMock = start as unknown as jest.Mock
const JOB = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: 't1',
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'a'.repeat(40),
}

beforeEach(() => jest.clearAllMocks())

describe('LUM-739 hunt start', () => {
  it('starts the workflow with the job as its single argument and returns the run id', async () => {
    startMock.mockResolvedValue({ runId: 'run_1' })
    await expect(startSecurityHunt(JOB)).resolves.toBe('run_1')
    expect(startMock).toHaveBeenCalledWith(securityHuntWorkflow, [JOB])
    const line = (logger.info as jest.Mock).mock.calls[0]?.join(' ') ?? ''
    expect(line).toContain('scan=s1')
    expect(line).toContain('o/r#7')
  })

  it('returns null and logs (without the head sha) when start throws', async () => {
    startMock.mockRejectedValue(new Error('workflow backend 503'))
    await expect(startSecurityHunt(JOB)).resolves.toBeNull()
    const line = (logger.error as jest.Mock).mock.calls[0]?.join(' ') ?? ''
    expect(line).toContain('workflow backend 503')
    expect(line).toContain('s1')
    expect(line).not.toContain(JOB.headSha)
  })
})
