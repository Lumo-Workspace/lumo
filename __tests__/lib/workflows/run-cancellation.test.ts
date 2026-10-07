/**
 * @jest-environment node
 *
 * LUM-1030 ruling ③ — cancel does not interrupt the executing step. The
 * persisting steps of the managed scan (SARIF persist) and the hunt ask
 * whether their run was cancelled and discard a late result instead of
 * writing it. `isCurrentRunCancelled` fails open.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))
jest.mock('@/lib/services/security-sarif-ingest.service', () => ({
  securitySarifIngestService: { persistFindings: jest.fn() },
}))
jest.mock('@/lib/services/security-hunt.service', () => ({
  securityHuntService: { persist: jest.fn() },
}))

import { getWorkflowMetadata } from 'workflow'
import { getRun } from 'workflow/api'
import { isCurrentRunCancelled } from '@/lib/workflows/run-cancellation'
import { persistSarifFindingsStep } from '@/lib/workflows/security-sarif-ingest.steps'
import { persistHuntFindingsStep } from '@/lib/workflows/security-hunt.steps'
import { securitySarifIngestService } from '@/lib/services/security-sarif-ingest.service'
import { securityHuntService } from '@/lib/services/security-hunt.service'
import type { PersistInput } from '@/lib/services/security-sarif-ingest.service'
import type { PersistHuntInput } from '@/lib/services/security-hunt.config'

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

describe('persisting steps after a cancel', () => {
  const sarifInput = { scanId: 's1' } as unknown as PersistInput
  const huntInput = { job: { scanId: 's1' } } as unknown as PersistHuntInput

  it('LUM-1030 cancel guard: a managed-scan report arriving after cancel is discarded, not written', async () => {
    runStatus('cancelled')
    await expect(persistSarifFindingsStep(sarifInput)).resolves.toEqual({
      written: 0,
      partial: false,
    })
    expect(securitySarifIngestService.persistFindings).not.toHaveBeenCalled()
  })

  it('LUM-1030 cancel guard: hunt findings arriving after cancel are discarded, not written', async () => {
    runStatus('cancelled')
    await expect(persistHuntFindingsStep(huntInput)).resolves.toEqual({
      written: 0,
    })
    expect(securityHuntService.persist).not.toHaveBeenCalled()
  })

  it('LUM-1030 cancel guard: a live run persists as before', async () => {
    m(securitySarifIngestService.persistFindings).mockResolvedValue({
      written: 3,
      partial: false,
    })
    m(securityHuntService.persist).mockResolvedValue({ written: 2 })
    await expect(persistSarifFindingsStep(sarifInput)).resolves.toEqual({
      written: 3,
      partial: false,
    })
    await expect(persistHuntFindingsStep(huntInput)).resolves.toEqual({
      written: 2,
    })
  })
})
