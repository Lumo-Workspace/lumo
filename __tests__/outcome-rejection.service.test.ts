import { outcomeRejectionService } from '@/lib/services/outcome-rejection.service'
import { outcomeRejectionRepository } from '@/lib/repositories/outcome-rejection.repository'
import type { DeliveryRejectionRow } from '@/lib/repositories/outcome-rejection.repository'

jest.mock('@/lib/repositories/outcome-rejection.repository', () => ({
  outcomeRejectionRepository: { listDeliveriesWithRejection: jest.fn() },
}))

const listMock =
  outcomeRejectionRepository.listDeliveriesWithRejection as jest.MockedFunction<
    typeof outcomeRejectionRepository.listDeliveriesWithRejection
  >

/** n rows in a friction bucket, `rejected` of them holding >=1 signal. */
function rows(
  prefix: string,
  friction: { verificationRounds: number | null; sendBackCount: number | null },
  n: number,
  rejected: number
): DeliveryRejectionRow[] {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `${prefix}-${i}`,
    verificationRounds: friction.verificationRounds,
    sendBackCount: friction.sendBackCount,
    signalCount: i < rejected ? 2 : 0,
  }))
}

const SINGLE_ROUND = { verificationRounds: 1, sendBackCount: 0 }
const MULTI_OR_SENDBACK = { verificationRounds: 3, sendBackCount: 1 }

describe('outcomeRejectionService.getOutcomeRejectionRate', () => {
  afterEach(() => listMock.mockReset())

  it('maps frozen friction and signal counts into bracketed rejection rates', async () => {
    // 12 single-round deliveries, 3 rejected; 12 multi-round/send-back, 6 rejected.
    listMock.mockResolvedValue([
      ...rows('si', SINGLE_ROUND, 12, 3),
      ...rows('mu', MULTI_OR_SENDBACK, 12, 6),
    ])

    const report = await outcomeRejectionService.getOutcomeRejectionRate('ws_1')

    expect(listMock).toHaveBeenCalledWith('ws_1')
    const single = report.brackets.find(b => b.bracket === 'single-round')!
    const multi = report.brackets.find(
      b => b.bracket === 'multi-round-or-sendback'
    )!

    // Denominator = snapshotted-delivery count per bucket…
    expect(single.delivered).toBe(12)
    expect(multi.delivered).toBe(12)
    // …rejected = deliveries holding >=1 signal (signalCount > 0).
    expect(single.rejected).toBe(3)
    expect(multi.rejected).toBe(6)
    expect(single.rejectionRate).toBeCloseTo(0.25, 10)
    expect(multi.rejectionRate).toBeCloseTo(0.5, 10)
  })

  it('returns an honest empty report when no delivery is snapshotted', async () => {
    listMock.mockResolvedValue([])
    const report = await outcomeRejectionService.getOutcomeRejectionRate('ws_1')
    expect(report.totalDeliveries).toBe(0)
    expect(report.comparison.status).toBe('inconclusive')
    expect(report.brackets.every(b => b.status === 'insufficient')).toBe(true)
  })
})
