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
  end: number
): ForecastCandidate {
  return {
    id,
    title: 'Add OAuth login',
    identifier: `LUM-${id}`,
    tags: ['auth'],
    agentRuns: Array.from({ length: runs }, (_, i) => ({
      startedAt: h(i),
      finishedAt: h(i + 1),
    })),
    mergedPrAt: Array.from({ length: prs }, () => h(end)),
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

it('returns null cycleHours when fewer than 3 candidates have a cycle', async () => {
  load.mockResolvedValue({
    target,
    candidates: [
      { ...cand('1', 1, 0, 0), agentRuns: [{ startedAt: h(0), finishedAt: null }] },
      { ...cand('2', 1, 0, 0), agentRuns: [{ startedAt: h(0), finishedAt: null }] },
      cand('3', 2, 1, 3),
    ],
  })
  const f = await forecastService.getTaskForecast('tgt')
  expect(f.insufficientData).toBe(false)
  expect(f.iterations).not.toBeNull()
  expect(f.cycleHours).toBeNull()
})
