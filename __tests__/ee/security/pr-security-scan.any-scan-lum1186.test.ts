/**
 * @jest-environment node
 *
 * LUM-1186 — "does any linked PR of the task have a scan": the Done gate's
 * security row reads "not scanned" vs "clear" from it.
 */
const scanFindFirst = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prSecurityScan: {
      findFirst: (...a: unknown[]) => scanFindFirst(...a),
    },
  },
}))

import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

beforeEach(() => {
  scanFindFirst.mockReset()
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
