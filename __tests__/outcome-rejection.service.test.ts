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

/** n rows in a bracket (cohort/basis), `rejected` of them holding >=1 signal. */
function rows(
  prefix: string,
  cohort: number,
  n: number,
  rejected: number
): DeliveryRejectionRow[] {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `${prefix}-${i}`,
    cohortSize: cohort,
    tokenCostBasis: cohort,
    signalCount: i < rejected ? 2 : 0,
  }))
}

describe('outcomeRejectionService.getOutcomeRejectionRate', () => {
  afterEach(() => listMock.mockReset())

  it('maps snapshots and signal counts into bracketed rejection rates', async () => {
    // 12 high-confidence deliveries (cohort 12), 3 rejected; 12 low (cohort 3), 6 rejected.
    listMock.mockResolvedValue([
      ...rows('hi', 12, 12, 3),
      ...rows('lo', 3, 12, 6),
    ])

    const report = await outcomeRejectionService.getOutcomeRejectionRate('ws_1')

    expect(listMock).toHaveBeenCalledWith('ws_1')
    const high = report.brackets.find(b => b.bracket === 'high')!
    const low = report.brackets.find(b => b.bracket === 'low')!

    // Denominator = snapshotted-delivery count per bracket…
    expect(high.delivered).toBe(12)
    expect(low.delivered).toBe(12)
    // …rejected = deliveries holding >=1 signal (signalCount > 0).
    expect(high.rejected).toBe(3)
    expect(low.rejected).toBe(6)
    expect(high.rejectionRate).toBeCloseTo(0.25, 10)
    expect(low.rejectionRate).toBeCloseTo(0.5, 10)
  })

  it('returns an honest empty report when no delivery is snapshotted', async () => {
    listMock.mockResolvedValue([])
    const report = await outcomeRejectionService.getOutcomeRejectionRate('ws_1')
    expect(report.totalDeliveries).toBe(0)
    expect(report.comparison.status).toBe('inconclusive')
    expect(report.brackets.every(b => b.status === 'insufficient')).toBe(true)
  })
})
