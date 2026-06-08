/** @jest-environment node */
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    findSnapshot: jest.fn(),
    createSnapshotIfAbsent: jest.fn(),
    loadActuals: jest.fn(),
    countReferenceLibrary: jest.fn(),
  },
}))
jest.mock('@/lib/services/forecast.service', () => ({
  forecastService: { getTaskForecast: jest.fn() },
}))

import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { forecastService } from '@/lib/services/forecast.service'
import { retrospectiveService } from '@/lib/services/retrospective.service'

const findSnapshot = retrospectiveRepository.findSnapshot as jest.Mock
const createSnap = retrospectiveRepository.createSnapshotIfAbsent as jest.Mock
const loadActuals = retrospectiveRepository.loadActuals as jest.Mock
const countRef = retrospectiveRepository.countReferenceLibrary as jest.Mock
const getForecast = forecastService.getTaskForecast as jest.Mock

beforeEach(() =>
  [findSnapshot, createSnap, loadActuals, countRef, getForecast].forEach(m =>
    m.mockReset()
  )
)

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

describe('captureSnapshot', () => {
  it('skips when a snapshot already exists (keep-first)', async () => {
    findSnapshot.mockResolvedValue({ capturedAt: new Date() })
    await retrospectiveService.captureSnapshot('t1')
    expect(getForecast).not.toHaveBeenCalled()
    expect(createSnap).not.toHaveBeenCalled()
  })

  it('does not persist when every track is null', async () => {
    findSnapshot.mockResolvedValue(null)
    getForecast.mockResolvedValue({
      iterations: null,
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 0,
      tokenCostBasis: 0,
    })
    await retrospectiveService.captureSnapshot('t1')
    expect(createSnap).not.toHaveBeenCalled()
  })

  it('persists the forecast intervals when at least one track is present', async () => {
    findSnapshot.mockResolvedValue(null)
    getForecast.mockResolvedValue({
      iterations: iv(2, 3, 3),
      clarifyRounds: iv(1, 1, 2),
      tokenCost: iv(2e7, 2.6e7, 3e7),
      cohortSize: 5,
      tokenCostBasis: 8,
    })
    await retrospectiveService.captureSnapshot('t1')
    expect(createSnap).toHaveBeenCalledWith('t1', {
      iterations: iv(2, 3, 3),
      clarifyRounds: iv(1, 1, 2),
      tokenCost: iv(2e7, 2.6e7, 3e7),
      cohortSize: 5,
      tokenCostBasis: 8,
    })
  })
})

describe('getRetrospective', () => {
  it('returns null when there is no snapshot', async () => {
    findSnapshot.mockResolvedValue(null)
    expect(await retrospectiveService.getRetrospective('t1')).toBeNull()
  })

  it('computes deltaPct and band per metric', async () => {
    const capturedAt = new Date('2026-06-01')
    findSnapshot.mockResolvedValue({
      iterations: iv(2, 3, 3),
      clarifyRounds: iv(1, 1, 2),
      tokenCost: iv(2.4e7, 2.6e7, 3e7),
      cohortSize: 5,
      tokenCostBasis: 8,
      capturedAt,
    })
    loadActuals.mockResolvedValue({
      projectId: 'p1',
      tokenCost: 2.95e7,
      iterations: 3,
      clarifyRounds: 2,
    })
    countRef.mockResolvedValue(27)

    const r = await retrospectiveService.getRetrospective('t1')
    expect(r!.tokenCost.band).toBe('within') // 2.95e7 ∈ [2.4e7, 3e7]
    expect(r!.tokenCost.deltaPct).toBe(13) // round((2.95-2.6)/2.6*100)
    expect(r!.iterations.band).toBe('within') // 3 ∈ [2,3]
    expect(r!.clarifyRounds.band).toBe('within') // actual=2, p75=2 → 2 is NOT > 2 → within
    expect(r!.referenceLibrarySize).toBe(27)
    expect(r!.capturedAt).toBe(capturedAt)
  })

  it('degrades a metric to actual-only when its forecast is null', async () => {
    findSnapshot.mockResolvedValue({
      iterations: iv(1, 2, 2),
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 4,
      tokenCostBasis: 0,
      capturedAt: new Date(),
    })
    loadActuals.mockResolvedValue({
      projectId: 'p1',
      tokenCost: null,
      iterations: 4,
      clarifyRounds: 3,
    })
    countRef.mockResolvedValue(10)

    const r = await retrospectiveService.getRetrospective('t1')
    expect(r!.clarifyRounds).toEqual({
      forecast: null,
      actual: 3,
      deltaPct: null,
      band: null,
    })
    expect(r!.tokenCost).toEqual({
      forecast: null,
      actual: null,
      deltaPct: null,
      band: null,
    })
    expect(r!.iterations.band).toBe('above') // 4 > p75 2
  })

  it('returns null when actuals cannot be loaded', async () => {
    findSnapshot.mockResolvedValue({
      iterations: iv(1, 2, 2),
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 4,
      tokenCostBasis: 0,
      capturedAt: new Date(),
    })
    loadActuals.mockResolvedValue(null)
    expect(await retrospectiveService.getRetrospective('t1')).toBeNull()
  })
})
