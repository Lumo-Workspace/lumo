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
}

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
  await prSecurityScanRepository.restart('s1')
  expect(mockFinding.deleteMany).toHaveBeenCalledWith({
    where: { scanId: 's1' },
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
  await prSecurityScanRepository.persistResult('s1', [finding], {
    status: 'FINDINGS',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: true,
  })
  expect(mockTransaction).toHaveBeenCalledTimes(1)
  expect(mockTransaction.mock.calls[0]![0]).toHaveLength(2)
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
  await prSecurityScanRepository.persistResult('s1', [], {
    status: 'CLEAN',
    judgeStatus: 'UNAVAILABLE',
    truncated: false,
    stages: { secrets: 'RAN', judge: 'FAILED' },
    partial: false,
  })
  expect(mockFinding.createMany).not.toHaveBeenCalled()
  expect(mockTransaction.mock.calls[0]![0]).toHaveLength(1)
})
