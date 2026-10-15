/** @jest-environment node */
/**
 * LUM-1155 — the scan row's diagram column: the command's lookup of the
 * PR's newest scan, storing (and clearing) a cleaned diagram.
 */
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prSecurityScan: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}))

import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

const scan = prisma.prSecurityScan as unknown as {
  findFirst: jest.Mock
  update: jest.Mock
}

beforeEach(() => jest.clearAllMocks())

it('findLatestForDiagram reads the newest scan of the PR', async () => {
  scan.findFirst.mockResolvedValue({ id: 's1', headSha: 'abc' })
  expect(await prSecurityScanRepository.findLatestForDiagram('pr1')).toEqual({
    id: 's1',
    headSha: 'abc',
  })
  expect(scan.findFirst).toHaveBeenCalledWith({
    where: { pullRequestId: 'pr1' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, headSha: true },
  })
})

it('setSequenceDiagram stores a diagram, and null clears it', async () => {
  const diagram = {
    participants: ['A', 'B'],
    steps: [
      { from: 0, to: 1, message: 'x', reply: false },
      { from: 1, to: 0, message: 'y', reply: true },
    ],
  }
  await prSecurityScanRepository.setSequenceDiagram('s1', diagram)
  expect(scan.update).toHaveBeenCalledWith({
    where: { id: 's1' },
    data: { sequenceDiagram: diagram },
  })
  await prSecurityScanRepository.setSequenceDiagram('s1', null)
  expect(scan.update).toHaveBeenLastCalledWith({
    where: { id: 's1' },
    data: { sequenceDiagram: Prisma.DbNull },
  })
})
