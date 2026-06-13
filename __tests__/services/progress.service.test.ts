jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: { loadActuals: jest.fn() },
}))
jest.mock('@/lib/services/forecast.service', () => ({
  forecastService: { getTaskForecast: jest.fn() },
}))

import { progressService } from '@/lib/services/progress.service'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { forecastService } from '@/lib/services/forecast.service'

const loadActuals = retrospectiveRepository.loadActuals as jest.Mock
const getForecast = forecastService.getTaskForecast as jest.Mock

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

const baseForecast = {
  insufficientData: false,
  cohortSize: 5,
  iterations: iv(1, 2, 3),
  mergedPrs: null,
  cycleHours: null,
  tokenCost: iv(12e6, 22e6, 35e6),
  tokenCostBasis: 8,
  clarifyRounds: iv(0, 1, 1),
  confidence: 'medium' as const,
  sources: [],
}

beforeEach(() => {
  loadActuals.mockReset()
  getForecast.mockReset()
})

it('returns null when the task is not found', async () => {
  loadActuals.mockResolvedValue(null)
  expect(await progressService.getProgress('t1')).toBeNull()
  expect(getForecast).not.toHaveBeenCalled()
})

it('returns forecast + sessionCount even when no sessions yet (pre-delivery)', async () => {
  loadActuals.mockResolvedValue({
    projectId: 'p1',
    tokenCost: null,
    iterations: 0,
    clarifyRounds: 0,
    totalDurationSec: 0,
  })
  getForecast.mockResolvedValue(baseForecast)
  const r = await progressService.getProgress('t1')
  expect(r?.sessionCount).toBe(0)
  expect(r?.forecast).toBe(baseForecast)
})

it('computes per-metric bands against live actuals (over on token)', async () => {
  loadActuals.mockResolvedValue({
    projectId: 'p1',
    tokenCost: 52e6, // > p75 (35M) → over
    iterations: 2, // within (1..3) → on-track
    clarifyRounds: 0,
    totalDurationSec: 0,
  })
  getForecast.mockResolvedValue(baseForecast)
  const r = await progressService.getProgress('t1')
  expect(r?.sessionCount).toBe(2)
  expect(r?.tokenCost.band).toBe('over')
  expect(r?.iterations.band).toBe('on-track')
})

it('exposes totalDuration as an actual-only progress metric', async () => {
  loadActuals.mockResolvedValue({
    projectId: 'p1',
    tokenCost: null,
    iterations: 1,
    clarifyRounds: 0,
    totalDurationSec: 900,
  })
  getForecast.mockResolvedValue(baseForecast)
  const progress = await progressService.getProgress('t1')
  expect(progress?.totalDuration).toEqual({
    forecast: null,
    actual: 900,
    deltaPct: null,
    band: null,
  })
})
