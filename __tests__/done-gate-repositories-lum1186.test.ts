/**
 * @jest-environment node
 *
 * LUM-1186 — the narrow crossing read behind the Done gate's crossings row:
 * every crossing of the task with only the counted columns. (The security
 * plugin's "any scan" read is tested under __tests__/ee/security.)
 */
const crossingFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      findMany: (...a: unknown[]) => crossingFindMany(...a),
    },
  },
}))

import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

beforeEach(() => {
  crossingFindMany.mockReset().mockResolvedValue([])
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
