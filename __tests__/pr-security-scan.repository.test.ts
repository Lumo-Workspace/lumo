/** @jest-environment node */
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
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
      }),
    })
  )
  await prSecurityScanRepository.finalize('s1', {
    status: 'CLEAN',
    judgeStatus: 'RAN',
    truncated: false,
  })
  expect(mockScan.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: 'CLEAN',
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
