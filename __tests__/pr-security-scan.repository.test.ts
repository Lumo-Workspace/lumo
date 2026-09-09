/** @jest-environment node */
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    prSecurityScan: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    prSecurityFinding: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  },
}))

import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'

const mockTransaction = (prisma as unknown as { $transaction: jest.Mock })
  .$transaction
const mockScan = prisma.prSecurityScan as unknown as {
  findUnique: jest.Mock
  create: jest.Mock
  update: jest.Mock
  findMany: jest.Mock
}
const mockFinding = prisma.prSecurityFinding as unknown as {
  createMany: jest.Mock
  deleteMany: jest.Mock
  findMany: jest.Mock
  findUnique: jest.Mock
  update: jest.Mock
  count: jest.Mock
}

const txClient = { prSecurityScan: mockScan, prSecurityFinding: mockFinding }
type TxCallback = (tx: typeof txClient) => unknown
mockTransaction.mockImplementation(async (arg: unknown) =>
  typeof arg === 'function'
    ? (arg as TxCallback)(txClient)
    : Promise.all(arg as Promise<unknown>[])
)

beforeEach(() => jest.clearAllMocks())

test('findByPrAndSha keys on the compound unique and create starts RUNNING', async () => {
  mockScan.findUnique.mockResolvedValue(null)
  // startedAt comes back too: the service needs it to spot a scan wedged in
  // RUNNING past the stale window (LUM-732 review I6).
  expect(await prSecurityScanRepository.findByPrAndSha('pr1', 'abc')).toBeNull()
  expect(mockScan.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        pullRequestId_headSha: { pullRequestId: 'pr1', headSha: 'abc' },
      },
    })
  )
  mockScan.create.mockResolvedValue({ id: 's1' })
  await prSecurityScanRepository.create({
    pullRequestId: 'pr1',
    taskId: 't1',
    workspaceId: 'w1',
    headSha: 'abc',
    trigger: 'PR_EVENT',
    detectorVersion: 'secrets@1;judge@1',
  })
  expect(mockScan.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'RUNNING' }),
    })
  )
})

test('restart clears old findings and resets the scan; finalize stamps finishedAt', async () => {
  mockScan.findUnique.mockResolvedValueOnce({ stages: null })
  await prSecurityScanRepository.restart('s1')
  // LUM-735: the read -> deleteMany -> update sequence must be one atomic
  // transaction, not three round trips a crash could interleave.
  expect(mockTransaction).toHaveBeenCalledTimes(1)
  expect(mockFinding.deleteMany).toHaveBeenCalledWith({
    where: { scanId: 's1', provenance: { not: 'EXTERNAL_TOOL' } },
  })
  expect(mockScan.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 's1' },
      data: expect.objectContaining({
        status: 'RUNNING',
        error: null,
        finishedAt: null,
        stages: Prisma.DbNull,
        partial: false,
      }),
    })
  )
  await prSecurityScanRepository.finalize('s1', {
    status: 'CLEAN',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
    partial: false,
  })
  expect(mockScan.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: 'CLEAN',
        stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
        partial: false,
        finishedAt: expect.any(Date),
      }),
    })
  )
})

test('findScanRow selects and returns partial alongside stages', async () => {
  const startedAt = new Date('2026-09-03T10:00:00Z')
  mockScan.findUnique.mockResolvedValueOnce({
    id: 's1',
    status: 'RUNNING',
    stages: { secrets: 'RAN' },
    partial: true,
    startedAt,
  })
  const row = await prSecurityScanRepository.findScanRow('s1')
  expect(row).toEqual({
    id: 's1',
    status: 'RUNNING',
    stages: { secrets: 'RAN' },
    partial: true,
    startedAt,
  })
  expect(mockScan.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      select: {
        id: true,
        status: true,
        stages: true,
        partial: true,
        startedAt: true,
      },
    })
  )
})

test('findDispositionedByPullRequest only returns dispositioned findings on that PR', async () => {
  mockFinding.findMany.mockResolvedValue([])
  await prSecurityScanRepository.findDispositionedByPullRequest('pr1')
  expect(mockFinding.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { scan: { pullRequestId: 'pr1' }, disposition: { not: null } },
    })
  )
})

test('findByPrAndSha selects startedAt so the service can age a RUNNING scan out', async () => {
  const startedAt = new Date('2026-09-03T10:00:00Z')
  mockScan.findUnique.mockResolvedValue({
    id: 's1',
    status: 'RUNNING',
    startedAt,
  })
  const row = await prSecurityScanRepository.findByPrAndSha('pr1', 'abc')
  expect(row).toEqual({ id: 's1', status: 'RUNNING', startedAt })
  expect(mockScan.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      select: { id: true, status: true, startedAt: true },
    })
  )
})

test('findLatestByPullRequestIds is bounded to one row per PR by distinct', async () => {
  // LUM-732 review I5: without `distinct` this read every scan ever made for
  // every linked PR — unbounded growth on a long-lived PR, with the findings
  // of each historical scan hydrated alongside.
  mockScan.findMany.mockResolvedValue([])
  expect(await prSecurityScanRepository.findLatestByPullRequestIds([])).toEqual(
    []
  )
  expect(mockScan.findMany).not.toHaveBeenCalled()

  await prSecurityScanRepository.findLatestByPullRequestIds(['pr1', 'pr2'])
  expect(mockScan.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { pullRequestId: { in: ['pr1', 'pr2'] } },
      orderBy: { startedAt: 'desc' },
      distinct: ['pullRequestId'],
    })
  )
})

test('persistResult writes findings and the finalize update in one transaction', async () => {
  // Spec §6.1: a scan that stamps FINDINGS but loses its rows (or the reverse)
  // is a lying panel. Both writes go through $transaction.
  const finding = {
    scanId: 's1',
    kind: 'SECRET' as const,
    ruleId: 'secret:aws-access-key-id',
    severity: 'HIGH' as const,
    provenance: 'DETERMINISTIC' as const,
    filePath: 'src/cfg.ts',
    line: 3,
    title: 't',
    detail: 'd',
    evidence: 'e',
    fingerprint: 'fp',
  }
  mockScan.findUnique.mockResolvedValueOnce({ stages: null })
  await prSecurityScanRepository.persistResult('s1', [finding], {
    status: 'FINDINGS',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: true,
  })
  expect(mockTransaction).toHaveBeenCalledTimes(1)
  expect(mockFinding.createMany).toHaveBeenCalledWith({ data: [finding] })
  expect(mockScan.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 's1' },
      data: expect.objectContaining({
        status: 'FINDINGS',
        judgeStatus: 'RAN',
        stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
        partial: true,
        finishedAt: expect.any(Date),
      }),
    })
  )
})

test('persistResult with no findings still finalizes, in a one-op transaction', async () => {
  mockScan.findUnique.mockResolvedValueOnce({ stages: null })
  await prSecurityScanRepository.persistResult('s1', [], {
    status: 'CLEAN',
    judgeStatus: 'UNAVAILABLE',
    truncated: false,
    stages: { secrets: 'RAN', judge: 'FAILED' },
    partial: false,
  })
  expect(mockFinding.createMany).not.toHaveBeenCalled()
  expect(mockTransaction).toHaveBeenCalledTimes(1)
})

test('persistResult never clears a partial already set by the other writer', async () => {
  // LUM-735: `partial` means "some layer hit a cap" and must be monotone —
  // once true it stays true regardless of what this writer's own outcome was.
  mockScan.findUnique.mockResolvedValueOnce({ stages: null, partial: true })
  await prSecurityScanRepository.persistResult('s1', [], {
    status: 'CLEAN',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', judge: 'RAN' },
    partial: false,
  })
  expect(mockScan.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ partial: true }),
    })
  )
})

describe('LUM-735 SARIF push — shared scan row', () => {
  test('createIfAbsent returns created:false on a unique violation and re-reads the winner', async () => {
    mockScan.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 'P2002' })
    )
    mockScan.findUnique.mockResolvedValueOnce({
      id: 's1',
      status: 'RUNNING',
      startedAt: new Date(),
    })
    const out = await prSecurityScanRepository.createIfAbsent({
      pullRequestId: 'pr1',
      taskId: null,
      workspaceId: 'w1',
      headSha: 'abc',
      trigger: 'SARIF_PUSH',
      detectorVersion: 'x',
      status: 'PENDING',
    })
    expect(out).toMatchObject({ id: 's1', created: false, status: 'RUNNING' })
  })

  test('claimPending flips PENDING to RUNNING without touching findings', async () => {
    await prSecurityScanRepository.claimPending('s1')
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'RUNNING' }),
      })
    )
    expect(mockFinding.deleteMany).not.toHaveBeenCalled()
  })

  test('restart keeps EXTERNAL_TOOL findings and the ingest-owned external stage', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    })
    await prSecurityScanRepository.restart('s1')
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockFinding.deleteMany).toHaveBeenCalledWith({
      where: { scanId: 's1', provenance: { not: 'EXTERNAL_TOOL' } },
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RUNNING',
          stages: { external: 'RAN' },
        }),
      })
    )
  })

  test('replaceExternalFindings deletes only that tool’s rows, then inserts, in one transaction', async () => {
    mockFinding.createMany.mockResolvedValueOnce({ count: 2 })
    const rows = [
      {
        scanId: 's1',
        kind: 'VULNERABILITY' as const,
        ruleId: 'ext:semgrep:a',
        severity: 'HIGH' as const,
        provenance: 'EXTERNAL_TOOL' as const,
        filePath: 'a',
        line: 1,
        title: 't',
        detail: 'd',
        evidence: '',
        fingerprint: 'f1',
      },
      {
        scanId: 's1',
        kind: 'VULNERABILITY' as const,
        ruleId: 'ext:semgrep:b',
        severity: 'LOW' as const,
        provenance: 'EXTERNAL_TOOL' as const,
        filePath: 'b',
        line: 2,
        title: 't',
        detail: 'd',
        evidence: '',
        fingerprint: 'f2',
      },
    ]
    const n = await prSecurityScanRepository.replaceExternalFindings(
      's1',
      'semgrep',
      rows
    )
    expect(n).toBe(2)
    expect(mockFinding.deleteMany).toHaveBeenCalledWith({
      where: {
        scanId: 's1',
        provenance: 'EXTERNAL_TOOL',
        ruleId: { startsWith: 'ext:semgrep:' },
      },
    })
    expect(mockFinding.createMany).toHaveBeenCalledWith({ data: rows })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  test('mergeStages read-modify-writes the JSON and can flip a finalized CLEAN to FINDINGS', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'PENDING' },
      status: 'CLEAN',
      partial: false,
    })
    await prSecurityScanRepository.mergeStages(
      's1',
      { external: 'RAN' },
      { partial: true, status: 'FINDINGS' }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: {
          stages: { secrets: 'RAN', external: 'RAN' },
          partial: true,
          status: 'FINDINGS',
        },
      })
    )
  })

  test('persistResult never overwrites an ingest-owned external stage', async () => {
    mockScan.findUnique.mockResolvedValueOnce({ stages: { external: 'RAN' } })
    await prSecurityScanRepository.persistResult('s1', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      partial: false,
      stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
        }),
      })
    )
  })

  test('mergeStages cannot clear a partial already set by the other writer', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'PENDING' },
      status: 'FINDINGS',
      partial: true,
    })
    await prSecurityScanRepository.mergeStages(
      's1',
      { external: 'RAN' },
      { partial: false }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ partial: true }),
      })
    )
  })

  test('mergeStages sets partial true when this writer is the first to hit a cap', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'PENDING' },
      status: 'CLEAN',
      partial: false,
    })
    await prSecurityScanRepository.mergeStages(
      's1',
      { external: 'RAN' },
      { partial: true }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ partial: true }),
      })
    )
  })

  test('countExternalFindings counts EXTERNAL_TOOL rows of the scan', async () => {
    mockFinding.count.mockResolvedValueOnce(3)
    expect(await prSecurityScanRepository.countExternalFindings('s1')).toBe(3)
    expect(mockFinding.count).toHaveBeenCalledWith({
      where: { scanId: 's1', provenance: 'EXTERNAL_TOOL' },
    })
  })
})
