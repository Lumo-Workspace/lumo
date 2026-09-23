/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/workflows/security-hunt', () => ({
  securityHuntWorkflow: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: { recordHuntStart: jest.fn() },
}))

import { getRun, start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import {
  cancelHuntRun,
  recordHuntStartBestEffort,
  startSecurityHunt,
} from '@/lib/services/security-hunt-start'
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
  reasons: ['diff:sink:prisma-raw'],
  touchedSourcePaths: ['lib/s.ts'],
  managedScanStarted: true,
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

describe('LUM-822 hunt run bookkeeping', () => {
  const record = prSecurityScanRepository.recordHuntStart as jest.Mock

  it('records the job, run id and attempt 1 for the run stage A started', async () => {
    record.mockResolvedValue(undefined)
    await recordHuntStartBestEffort('s1', JOB, 'run_1')
    expect(record).toHaveBeenCalledWith('s1', {
      job: JOB,
      runId: 'run_1',
      attempt: 1,
    })
  })

  it('never throws when the record write fails', async () => {
    record.mockRejectedValue(new Error('db down'))
    await expect(
      recordHuntStartBestEffort('s1', { ...JOB, attempt: 2 }, 'run_2')
    ).resolves.toBeUndefined()
    const line = (logger.warn as jest.Mock).mock.calls[0]?.join(' ') ?? ''
    expect(line).toContain('db down')
  })

  it('cancelHuntRun cancels the run and reports whether it worked', async () => {
    const cancel = jest.fn(async () => undefined)
    ;(getRun as jest.Mock).mockReturnValueOnce({ cancel })
    await expect(cancelHuntRun('run_1', 's1')).resolves.toBe(true)
    expect(getRun).toHaveBeenCalledWith('run_1')
    expect(cancel).toHaveBeenCalled()
    ;(getRun as jest.Mock).mockReturnValueOnce({
      cancel: jest.fn(async () => {
        throw new Error('gone')
      }),
    })
    await expect(cancelHuntRun('run_1', 's1')).resolves.toBe(false)
  })
})
