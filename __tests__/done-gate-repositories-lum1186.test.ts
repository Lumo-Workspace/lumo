/**
 * @jest-environment node
 *
 * LUM-1186 — the two narrow reads behind the Done gate rows: every crossing
 * of the task with only the counted columns, and "does any linked PR have a
 * scan" (the security row's not scanned vs clear).
 */
const crossingFindMany = jest.fn()
const scanFindFirst = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      findMany: (...a: unknown[]) => crossingFindMany(...a),
    },
    prSecurityScan: {
      findFirst: (...a: unknown[]) => scanFindFirst(...a),
    },
  },
}))

import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

beforeEach(() => {
  crossingFindMany.mockReset().mockResolvedValue([])
  scanFindFirst.mockReset()
})

describe('boundaryCrossingRepository.findGateFieldsByTask', () => {
  it('reads every crossing of the task, open and dispositioned, narrow select', async () => {
    await boundaryCrossingRepository.findGateFieldsByTask('t-1')
    expect(crossingFindMany).toHaveBeenCalledWith({
      where: { taskId: 't-1' },
      select: { disposition: true, advisory: true, severity: true },
    })
  })
})

describe('prSecurityScanRepository.anyScanForTask', () => {
  it('true when some linked PR has a scan', async () => {
    scanFindFirst.mockResolvedValue({ id: 's1' })
    await expect(prSecurityScanRepository.anyScanForTask('t-1')).resolves.toBe(
      true
    )
    expect(scanFindFirst).toHaveBeenCalledWith({
      where: { pullRequest: { taskId: 't-1' } },
      select: { id: true },
    })
  })

  it('false when none has', async () => {
    scanFindFirst.mockResolvedValue(null)
    await expect(prSecurityScanRepository.anyScanForTask('t-1')).resolves.toBe(
      false
    )
  })
})
