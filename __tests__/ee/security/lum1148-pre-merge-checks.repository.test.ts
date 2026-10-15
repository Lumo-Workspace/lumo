/**
 * @jest-environment node
 *
 * LUM-1148 — reading back a scan's stored pre-merge check results (the
 * runner keeps an earlier failure of the same head when the model fails).
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { prSecurityScan: { findUnique: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

const findUnique = prisma.prSecurityScan.findUnique as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

it('returns the scan’s stored results, selecting only that column', async () => {
  const stored = { headSha: 'a'.repeat(40), ranAt: 'x', results: [] }
  findUnique.mockResolvedValue({ preMergeChecks: stored })
  await expect(prSecurityScanRepository.findPreMergeChecks('s1')).resolves.toBe(
    stored
  )
  expect(findUnique).toHaveBeenCalledWith({
    where: { id: 's1' },
    select: { preMergeChecks: true },
  })
})

it('a missing scan reads as null', async () => {
  findUnique.mockResolvedValue(null)
  await expect(
    prSecurityScanRepository.findPreMergeChecks('nope')
  ).resolves.toBeNull()
})
