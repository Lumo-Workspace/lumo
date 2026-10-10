/** @jest-environment node */
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    prSecurityScan: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    prSecurityFinding: { createMany: jest.fn() },
  },
}))

import {
  prSecurityScanRepository,
  type NewFindingInput,
} from '@/ee/security/repositories/pr-security-scan.repository'

const mockTransaction = (prisma as unknown as { $transaction: jest.Mock })
  .$transaction
const mockScan = prisma.prSecurityScan as unknown as {
  findUnique: jest.Mock
  update: jest.Mock
  findMany: jest.Mock
  updateMany: jest.Mock
  count: jest.Mock
}
const mockFinding = prisma.prSecurityFinding as unknown as {
  createMany: jest.Mock
}
const txClient = { prSecurityScan: mockScan, prSecurityFinding: mockFinding }
type TxCallback = (tx: typeof txClient) => unknown
mockTransaction.mockImplementation(async (arg: unknown, _opts?: unknown) =>
  (arg as TxCallback)(txClient)
)

const row: NewFindingInput = {
  scanId: 's1',
  kind: 'VULNERABILITY',
  ruleId: 'hunt:idor',
  severity: 'MEDIUM',
  provenance: 'LLM_JUDGE',
  filePath: 'lib/a.ts',
  line: 3,
  title: 't',
  detail: 'd',
  evidence: 'e',
  fingerprint: 'f'.repeat(16),
  externalRef: null,
  disposition: null,
  cwe: 'CWE-639',
  reachability: 'EXTERNAL',
  callChain: [{ from: 'a', to: 'b' }],
  falsifierVerdict: 'INCONCLUSIVE',
}

beforeEach(() => jest.clearAllMocks())

describe('LUM-739 repository', () => {
  test('persistHuntResult merges hunt into stages, keeps partial monotone, writes audit/tokens, flips to FINDINGS and inserts rows', async () => {
    const calls: string[] = []
    mockScan.findUnique.mockResolvedValueOnce({
      stages: {
        secrets: 'RAN',
        external: 'RAN',
        judge: 'RAN',
        hunt: 'PENDING',
      },
      partial: true,
    })
    mockScan.update.mockImplementation(async () => calls.push('update'))
    mockFinding.createMany.mockImplementation(async () =>
      calls.push('createMany')
    )
    await prSecurityScanRepository.persistHuntResult('s1', [row], {
      hunt: 'RAN',
      huntAudit: { candidates: 1 },
      tokenSpent: 1234,
      partialCauses: [],
    })
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 15000,
    })
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'RAN' },
        partial: true,
        partialCauses: [],
        huntAudit: { candidates: 1 },
        tokenSpent: 1234,
        status: 'FINDINGS',
      },
    })
    expect(mockFinding.createMany).toHaveBeenCalledWith({ data: [row] })
    expect(calls).toEqual(['update', 'createMany'])
  })

  test('a FAILED hunt writes no rows, changes no status, still records tokens and the audit error', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', hunt: 'PENDING' },
      partial: false,
    })
    await prSecurityScanRepository.persistHuntResult('s1', [], {
      hunt: 'FAILED',
      huntAudit: { error: 'boom' },
      tokenSpent: 20,
      partialCauses: [],
    })
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        stages: { secrets: 'RAN', hunt: 'FAILED' },
        partial: false,
        partialCauses: [],
        huntAudit: { error: 'boom' },
        tokenSpent: 20,
      },
    })
    expect(mockFinding.createMany).not.toHaveBeenCalled()
  })

  test('a PARTIAL hunt sets partial even when the row was not partial before', async () => {
    mockScan.findUnique.mockResolvedValueOnce({ stages: null, partial: false })
    await prSecurityScanRepository.persistHuntResult('s1', [], {
      hunt: 'PARTIAL',
      huntAudit: {},
      tokenSpent: null,
      partialCauses: ['HUNT_INCOMPLETE'],
    })
    expect(mockScan.update.mock.calls[0]?.[0].data).toMatchObject({
      stages: { hunt: 'PARTIAL' },
      partial: true,
      tokenSpent: null,
    })
  })
})

describe('LUM-822 hunt attempts', () => {
  test('persistHuntResult drops a write from an older hunt attempt', async () => {
    // The sweep claimed the retry (huntAttempts = 2); attempt 1 lands late.
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', hunt: 'PENDING' },
      partial: false,
      huntAttempts: 2,
    })
    const applied = await prSecurityScanRepository.persistHuntResult(
      's1',
      [row],
      { hunt: 'RAN', huntAudit: {}, tokenSpent: 10, partialCauses: [] }
    )
    expect(applied).toBe(false)
    expect(mockScan.update).not.toHaveBeenCalled()
    expect(mockFinding.createMany).not.toHaveBeenCalled()
  })

  test('persistHuntResult applies the current attempt and rows from before LUM-822', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { hunt: 'PENDING' },
      partial: false,
      huntAttempts: 2,
    })
    await expect(
      prSecurityScanRepository.persistHuntResult('s1', [], {
        hunt: 'SKIPPED',
        huntAudit: {},
        tokenSpent: 0,
        partialCauses: [],
        attempt: 2,
      })
    ).resolves.toBe(true)
    // A row written before the column existed reads huntAttempts 0.
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { hunt: 'PENDING' },
      partial: false,
      huntAttempts: 0,
    })
    await expect(
      prSecurityScanRepository.persistHuntResult('s1', [], {
        hunt: 'RAN',
        huntAudit: {},
        tokenSpent: 0,
        partialCauses: [],
      })
    ).resolves.toBe(true)
    expect(mockScan.update).toHaveBeenCalledTimes(2)
  })

  test('failStaleHunt stamps FAILED only while PENDING at the attempt it read', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', hunt: 'PENDING' },
      huntAttempts: 2,
    })
    await expect(
      prSecurityScanRepository.failStaleHunt('s1', 2, 'dead')
    ).resolves.toBe(true)
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        stages: { secrets: 'RAN', hunt: 'FAILED' },
        huntAudit: { error: 'dead' },
      },
    })
    mockScan.update.mockClear()
    // The hunt landed in between: its result wins.
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { hunt: 'RAN' },
      huntAttempts: 2,
    })
    await expect(
      prSecurityScanRepository.failStaleHunt('s1', 2, 'dead')
    ).resolves.toBe(false)
    // A newer attempt was claimed in between.
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { hunt: 'PENDING' },
      huntAttempts: 2,
    })
    await expect(
      prSecurityScanRepository.failStaleHunt('s1', 1, 'dead')
    ).resolves.toBe(false)
    expect(mockScan.update).not.toHaveBeenCalled()
  })
})

describe('LUM-822 stale-hunt queries', () => {
  test('recordHuntStart stores the job, run id, attempt and a start time', async () => {
    await prSecurityScanRepository.recordHuntStart('s1', {
      job: { scanId: 's1' },
      runId: 'run_1',
      attempt: 1,
    })
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        huntJob: { scanId: 's1' },
        huntRunId: 'run_1',
        huntAttempts: 1,
        huntStartedAt: expect.any(Date),
      },
    })
  })

  test('findStalePendingHunts reads PENDING hunts by their latest start, falling back to the scan start', async () => {
    const before = new Date('2026-09-23T11:20:00Z')
    mockScan.findMany.mockResolvedValue([])
    await prSecurityScanRepository.findStalePendingHunts(before, 25)
    expect(mockScan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stages: { path: ['hunt'], equals: 'PENDING' },
          OR: [
            { huntStartedAt: { lt: before } },
            { huntStartedAt: null, startedAt: { lt: before } },
          ],
        },
        orderBy: { startedAt: 'asc' },
        take: 25,
      })
    )
  })

  test('hasNewerScan counts later scans of the same PR', async () => {
    const at = new Date('2026-09-23T10:00:00Z')
    mockScan.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    await expect(
      prSecurityScanRepository.hasNewerScan('pr1', at)
    ).resolves.toBe(true)
    await expect(
      prSecurityScanRepository.hasNewerScan('pr1', at)
    ).resolves.toBe(false)
    expect(mockScan.count).toHaveBeenCalledWith({
      where: { pullRequestId: 'pr1', startedAt: { gt: at } },
    })
  })

  test('claimHuntRetry is a compare-and-set on the attempt while PENDING', async () => {
    mockScan.updateMany.mockResolvedValueOnce({ count: 1 })
    await expect(
      prSecurityScanRepository.claimHuntRetry('s1', 1)
    ).resolves.toBe(true)
    expect(mockScan.updateMany).toHaveBeenCalledWith({
      where: {
        id: 's1',
        huntAttempts: 1,
        stages: { path: ['hunt'], equals: 'PENDING' },
      },
      data: {
        huntAttempts: 2,
        huntStartedAt: expect.any(Date),
        huntRunId: null,
      },
    })
    mockScan.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(
      prSecurityScanRepository.claimHuntRetry('s1', 1)
    ).resolves.toBe(false)
  })

  test('setHuntRunId writes the retry run id', async () => {
    await prSecurityScanRepository.setHuntRunId('s1', 'run_2')
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { huntRunId: 'run_2' },
    })
  })
})

describe('LUM-832 findForReliability', () => {
  test('reads only the columns the read-out needs, in the window, with a legacy row read as no causes', async () => {
    const since = new Date('2026-09-18T00:00:00Z')
    const until = new Date('2026-09-25T00:00:00Z')
    mockScan.findMany.mockResolvedValueOnce([
      {
        status: 'CLEAN',
        stages: { hunt: 'RAN' },
        partial: false,
        partialCauses: ['JUDGE_TRUNCATED'],
        huntAudit: null,
      },
      {
        status: 'CLEAN',
        stages: null,
        partial: true,
        partialCauses: null,
        huntAudit: null,
      },
    ])
    const rows = await prSecurityScanRepository.findForReliability(since, until)
    expect(mockScan.findMany).toHaveBeenCalledWith({
      where: { startedAt: { gte: since, lt: until } },
      select: {
        status: true,
        stages: true,
        partial: true,
        partialCauses: true,
        huntAudit: true,
      },
    })
    expect(rows[0]!.partialCauses).toEqual(['JUDGE_TRUNCATED'])
    expect(rows[1]).toMatchObject({ stages: null, partialCauses: [] })
  })
})

describe('LUM-832 in-run re-queue', () => {
  test('claimHuntRetry hands the faulted attempt audit and spend to the row, still only while PENDING at that attempt', async () => {
    mockScan.updateMany.mockResolvedValueOnce({ count: 1 })
    await expect(
      prSecurityScanRepository.claimHuntRetry('s1', 1, {
        faulted: {
          huntAudit: { requeued: { fromAttempt: 1 } },
          tokenSpent: 250,
        },
        huntJob: { scanId: 's1', attempt: 2, tries: 2 },
      })
    ).resolves.toBe(true)
    expect(mockScan.updateMany).toHaveBeenCalledWith({
      where: {
        id: 's1',
        huntAttempts: 1,
        stages: { path: ['hunt'], equals: 'PENDING' },
      },
      data: expect.objectContaining({
        huntAttempts: 2,
        huntRunId: null,
        huntAudit: { requeued: { fromAttempt: 1 } },
        tokenSpent: 250,
        huntJob: { scanId: 's1', attempt: 2, tries: 2 },
      }),
    })
  })

  test('a retry adds its spend to the faulted attempt’s; the first attempt owns the column', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { hunt: 'PENDING' },
      partial: false,
      partialCauses: [],
      huntAttempts: 2,
      tokenSpent: 250,
    })
    await prSecurityScanRepository.persistHuntResult('s1', [], {
      hunt: 'RAN',
      huntAudit: {},
      tokenSpent: 300,
      partialCauses: [],
      attempt: 2,
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenSpent: 550 }),
      })
    )
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { hunt: 'PENDING' },
      partial: false,
      huntAttempts: 1,
      tokenSpent: 999,
    })
    await prSecurityScanRepository.persistHuntResult('s1', [], {
      hunt: 'RAN',
      huntAudit: {},
      tokenSpent: 300,
      partialCauses: [],
    })
    expect(mockScan.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenSpent: 300 }),
      })
    )
  })

  test('hasNewerScanThan reads the scan’s own PR and start', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      pullRequestId: 'pr1',
      startedAt: new Date('2026-09-25T00:00:00Z'),
    })
    mockScan.count.mockResolvedValueOnce(1)
    await expect(prSecurityScanRepository.hasNewerScanThan('s1')).resolves.toBe(
      true
    )
    expect(mockScan.count).toHaveBeenCalledWith({
      where: {
        pullRequestId: 'pr1',
        startedAt: { gt: new Date('2026-09-25T00:00:00Z') },
      },
    })
    mockScan.findUnique.mockResolvedValueOnce(null)
    await expect(
      prSecurityScanRepository.hasNewerScanThan('gone')
    ).resolves.toBe(false)
  })
})
