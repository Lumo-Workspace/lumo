/** @jest-environment node */
jest.mock('@/lib/repositories/forecast.repository', () => ({
  forecastRepository: { loadForecastInputs: jest.fn() },
}))

import { forecastRepository } from '@/lib/repositories/forecast.repository'
import { forecastService } from '@/lib/services/forecast.service'
import type { ForecastCandidate } from '@/lib/forecast/types'

const load = forecastRepository.loadForecastInputs as jest.Mock

beforeEach(() => load.mockReset())

const h = (n: number) => new Date(2026, 0, 1, n, 0, 0)

function cand(
  id: string,
  runs: number,
  prs: number,
  end: number,
  tokenCost: number | null = null
): ForecastCandidate {
  return {
    id,
    title: 'Add OAuth login',
    identifier: `LUM-${id}`,
    tags: ['auth'],
    runs: Array.from({ length: runs }, (_, i) => ({
      startedAt: h(i),
      finishedAt: h(i + 1),
    })),
    mergedPrAt: Array.from({ length: prs }, () => h(end)),
    tokenCost,
  }
}

const target = { id: 'tgt', title: 'Add OAuth login', tags: ['auth'], projectId: 'p1' }

it('returns insufficientData when the task is missing', async () => {
  load.mockResolvedValue(null)
  const f = await forecastService.getTaskForecast('missing')
  expect(f.insufficientData).toBe(true)
  expect(f.cohortSize).toBe(0)
})

it('returns insufficientData (with ≤2 sources) when cohort < 3', async () => {
  load.mockResolvedValue({
    target,
    candidates: [cand('1', 2, 1, 5), cand('2', 3, 1, 6)],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.insufficientData).toBe(true)
  expect(f.cohortSize).toBe(2)
  expect(f.iterations).toBeNull()
  expect(f.sources.length).toBeLessThanOrEqual(2)
})

it('computes intervals when cohort ≥ 3', async () => {
  load.mockResolvedValue({
    target,
    candidates: [
      cand('1', 1, 1, 1),
      cand('2', 2, 1, 2),
      cand('3', 3, 2, 3),
    ],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.insufficientData).toBe(false)
  expect(f.cohortSize).toBe(3)
  expect(f.iterations).toEqual({ p25: 1.5, median: 2, p75: 2.5 })
  expect(f.mergedPrs).toEqual({ p25: 1, median: 1, p75: 1.5 })
  expect(f.cycleHours).not.toBeNull()
  expect(f.sources).toHaveLength(3)
})

it('excludes candidates below the score threshold', async () => {
  load.mockResolvedValue({
    target,
    candidates: [
      cand('1', 1, 1, 1),
      cand('2', 2, 1, 2),
      { ...cand('3', 3, 2, 3), title: 'zzzzzzz', tags: [] },
    ],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.cohortSize).toBe(2)
  expect(f.insufficientData).toBe(true)
})

it('surfaces a project-wide token forecast even when the cohort is too small', async () => {
  // None of these match the target title → cohort is empty, but all carry cost
  // data, so the token track still produces a forecast.
  const dissimilar = (id: string, cost: number): ForecastCandidate => ({
    ...cand(id, 1, 1, 1, cost),
    title: 'totally unrelated chore',
    tags: [],
  })
  load.mockResolvedValue({
    target,
    candidates: [dissimilar('1', 100), dissimilar('2', 200), dissimilar('3', 300)],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.cohortSize).toBe(0)
  expect(f.insufficientData).toBe(false)
  expect(f.iterations).toBeNull()
  expect(f.tokenCost).toEqual({ p25: 150, median: 200, p75: 250 })
  expect(f.tokenCostBasis).toBe(3)
})

it('stays insufficient when cohort < 3 AND no token data', async () => {
  load.mockResolvedValue({
    target,
    candidates: [cand('1', 2, 1, 5), cand('2', 3, 1, 6)],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.insufficientData).toBe(true)
  expect(f.tokenCost).toBeNull()
  expect(f.tokenCostBasis).toBe(0)
})

it('computes tokenCost from all candidates with data, ignoring the cohort filter', async () => {
  load.mockResolvedValue({
    target,
    candidates: [
      cand('1', 1, 1, 1, 100),
      cand('2', 2, 1, 2, 200),
      cand('3', 3, 2, 3, 300),
      // below score threshold but still feeds the project-wide token sample
      { ...cand('4', 1, 1, 1, 400), title: 'zzzzzzz', tags: [] },
    ],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.cohortSize).toBe(3) // similarity track excludes the 4th
  expect(f.tokenCostBasis).toBe(4) // token track includes all 4
  expect(f.tokenCost).toEqual({ p25: 175, median: 250, p75: 325 })
})

it('returns null cycleHours when fewer than 3 candidates have a cycle', async () => {
  load.mockResolvedValue({
    target,
    candidates: [
      { ...cand('1', 1, 0, 0), runs: [{ startedAt: h(0), finishedAt: null }] },
      { ...cand('2', 1, 0, 0), runs: [{ startedAt: h(0), finishedAt: null }] },
      cand('3', 2, 1, 3),
    ],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.insufficientData).toBe(false)
  expect(f.iterations).not.toBeNull()
  expect(f.cycleHours).toBeNull()
})
