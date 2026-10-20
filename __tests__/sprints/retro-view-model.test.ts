import type { IntlShape } from 'react-intl'
import {
  buildProcessStages,
  pickNextSprint,
  readRetroStats,
} from '@/app/workspace/[workspaceUrl]/sprints/components/detail/retro-view-model'
import { formatStageMedian } from '@/app/workspace/[workspaceUrl]/sprints/components/detail/format'
import type { ProcessStagesStats } from '@/lib/summaries/sprint-process-stages'

// LUM-1281 — pure readers for the closed-sprint retro: stored fields only.

const HOUR = 3600_000
const DAY = 24 * HOUR

const stagesOf = (
  medians: Partial<Record<string, number | null>>,
  n = 3
): ProcessStagesStats => ({
  tasks: 5,
  stages: {
    ruling: { medianMs: medians.ruling ?? null, n: medians.ruling ? n : 0 },
    agent: { medianMs: medians.agent ?? null, n: medians.agent ? n : 0 },
    review: { medianMs: medians.review ?? null, n: medians.review ? n : 0 },
    verification: {
      medianMs: medians.verification ?? null,
      n: medians.verification ? n : 0,
    },
    other: { medianMs: medians.other ?? null, n: medians.other ? n : 0 },
  },
})

describe('readRetroStats', () => {
  test('reads the LUM-1280 fields when present', () => {
    const ps = stagesOf({ agent: DAY })
    expect(
      readRetroStats({
        totalTasks: 31,
        done: 29,
        spillover: 4,
        verifiedCount: 27,
        processStages: ps,
      })
    ).toEqual({
      totalTasks: 31,
      spillover: 4,
      verifiedCount: 27,
      processStages: ps,
    })
  })

  test('a summary written before LUM-1280 has no verified count or stages — null, never 0', () => {
    expect(readRetroStats({ totalTasks: 10, done: 8, spillover: 2 })).toEqual({
      totalTasks: 10,
      spillover: 2,
      verifiedCount: null,
      processStages: null,
    })
  })

  test('no stats object → null', () => {
    expect(readRetroStats(null)).toBeNull()
    expect(readRetroStats(undefined)).toBeNull()
    expect(readRetroStats('x')).toBeNull()
  })
})

describe('buildProcessStages', () => {
  test('no stored stages this sprint → null (the card shows its empty state)', () => {
    expect(buildProcessStages(null, null)).toBeNull()
    expect(
      buildProcessStages(null, { name: 'Sprint 12', stages: stagesOf({}) })
    ).toBeNull()
  })

  test('rows in design order with n and median, no comparison without a previous sprint', () => {
    const model = buildProcessStages(
      stagesOf({ agent: 0.9 * DAY, review: 2 * HOUR }),
      null
    )
    expect(model?.previousName).toBeNull()
    expect(model?.rows.map(r => r.stage)).toEqual([
      'agent',
      'review',
      'ruling',
      'verification',
      'other',
    ])
    expect(model?.rows[0]).toEqual({
      stage: 'agent',
      n: 3,
      medianMs: 0.9 * DAY,
    })
    expect(model?.rows[2]).toEqual({ stage: 'ruling', n: 0, medianMs: null })
    expect('previousMedianMs' in (model?.rows[0] ?? {})).toBe(false)
  })

  test('a previous sprint without stored stages hides the comparison column', () => {
    const model = buildProcessStages(stagesOf({ agent: DAY }), {
      name: 'Sprint 12',
      stages: null,
    })
    expect(model?.previousName).toBeNull()
  })

  test('a previous sprint with stored stages adds its medians', () => {
    const model = buildProcessStages(stagesOf({ agent: DAY }), {
      name: 'Sprint 12',
      stages: stagesOf({ agent: 1.1 * DAY }),
    })
    expect(model?.previousName).toBe('Sprint 12')
    expect(model?.rows[0]?.previousMedianMs).toBe(1.1 * DAY)
    expect(model?.rows[1]?.previousMedianMs).toBeNull()
  })
})

describe('pickNextSprint', () => {
  test('the lowest-numbered sprint after this one', () => {
    const sprints = [
      { number: 12 },
      { number: 16 },
      { number: 14 },
      { number: 13 },
    ]
    expect(pickNextSprint(sprints, 13)).toEqual({ number: 14 })
    expect(pickNextSprint(sprints, 16)).toBeNull()
    expect(pickNextSprint(undefined, 1)).toBeNull()
  })
})

describe('formatStageMedian', () => {
  const intl = {
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, string | number>
    ) => `${id}:${Object.values(values ?? {}).join('/')}`,
    formatNumber: (n: number) => String(n),
  } as unknown as IntlShape

  test('under a day reads as minutes / hours, then days to one decimal', () => {
    expect(formatStageMedian(intl, 20 * 60_000)).toBe(
      'sprints.detail.wait.minutes:20'
    )
    expect(formatStageMedian(intl, 19 * HOUR)).toBe(
      'sprints.detail.wait.hours:19'
    )
    expect(formatStageMedian(intl, 0.9 * DAY)).toBe(
      'sprints.detail.wait.hours:21'
    )
    expect(formatStageMedian(intl, 2.64 * DAY)).toBe(
      'sprints.detail.retro.stages.days:2.6'
    )
  })
})
