import { computeBurndownSeries } from '@/lib/services/sprint-burndown'
import type { BurndownComputeInput } from '@/lib/services/sprint-burndown'

const SPRINT = 'sprint-1'

function statusEvt(taskId: string, from: string, to: string, day: string) {
  return {
    taskId,
    type: 'STATUS_CHANGED' as const,
    payload: { from, to },
    createdAt: new Date(`${day}T10:00:00.000Z`),
  }
}
function sprintEvt(
  taskId: string,
  fromSprintId: string | null,
  toSprintId: string | null,
  day: string
) {
  return {
    taskId,
    type: 'SPRINT_CHANGED' as const,
    payload: { fromSprintId, toSprintId, reason: 'manual' },
    createdAt: new Date(`${day}T10:00:00.000Z`),
  }
}

function baseInput(over: Partial<BurndownComputeInput>): BurndownComputeInput {
  return {
    sprintId: SPRINT,
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-03T00:00:00.000Z'),
    status: 'CLOSED',
    now: new Date('2026-06-10T00:00:00.000Z'),
    tasks: [],
    activities: [],
    ...over,
  }
}

describe('computeBurndownSeries', () => {
  test('basic burndown: 3 tasks, two finish over the window', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'DONE' },
          { id: 't2', sprintId: SPRINT, status: 'DONE' },
          { id: 't3', sprintId: SPRINT, status: 'TODO' },
        ],
        activities: [
          statusEvt('t1', 'TODO', 'DONE', '2026-06-02'),
          statusEvt('t2', 'TODO', 'DONE', '2026-06-03'),
        ],
      })
    )
    expect(out.series.map(p => p.remaining)).toEqual([3, 2, 1])
    expect(out.total).toBe(3)
    expect(out.start).toBe('2026-06-01')
    expect(out.end).toBe('2026-06-03')
    expect(out.unit).toBe('tasks')
  })

  test('ideal line is linear from total to 0', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'TODO' },
          { id: 't2', sprintId: SPRINT, status: 'TODO' },
        ],
      })
    )
    expect(out.series.map(p => p.ideal)).toEqual([2, 1, 0])
  })

  test('task added mid-window raises remaining on its join day', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'TODO' },
          { id: 't2', sprintId: SPRINT, status: 'TODO' },
        ],
        activities: [sprintEvt('t2', null, SPRINT, '2026-06-02')],
      })
    )
    expect(out.series.map(p => p.remaining)).toEqual([1, 2, 2])
  })

  test('task spilled out mid-window drops remaining on its leave day', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [
          { id: 't1', sprintId: SPRINT, status: 'TODO' },
          { id: 't2', sprintId: null, status: 'TODO' },
        ],
        activities: [sprintEvt('t2', SPRINT, null, '2026-06-03')],
      })
    )
    expect(out.series.map(p => p.remaining)).toEqual([2, 2, 1])
  })

  test('task with no SPRINT_CHANGED falls back to current sprintId', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'TODO' }],
        activities: [],
      })
    )
    expect(out.series.map(p => p.remaining)).toEqual([1, 1, 1])
  })

  test('status reopened then redone: statusAt uses last event before T', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'DONE' }],
        activities: [
          statusEvt('t1', 'TODO', 'DONE', '2026-06-01'),
          statusEvt('t1', 'DONE', 'IN_PROGRESS', '2026-06-02'),
          statusEvt('t1', 'IN_PROGRESS', 'DONE', '2026-06-03'),
        ],
      })
    )
    expect(out.series.map(p => p.remaining)).toEqual([0, 1, 0])
  })

  test('ACTIVE sprint: future days have null remaining, ideal still filled', () => {
    const out = computeBurndownSeries(
      baseInput({
        status: 'ACTIVE',
        now: new Date('2026-06-02T12:00:00.000Z'),
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'TODO' }],
      })
    )
    expect(out.series.map(p => p.remaining)).toEqual([1, 1, null])
    expect(out.series.map(p => p.ideal)).toEqual([1, 0.5, 0])
  })

  test('dirty payload events are skipped, not thrown', () => {
    const out = computeBurndownSeries(
      baseInput({
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'TODO' }],
        activities: [
          {
            taskId: 't1',
            type: 'STATUS_CHANGED',
            payload: null,
            createdAt: new Date('2026-06-02T10:00:00.000Z'),
          },
          {
            taskId: 't1',
            type: 'STATUS_CHANGED',
            payload: { from: 'TODO' },
            createdAt: new Date('2026-06-02T11:00:00.000Z'),
          },
        ],
      })
    )
    expect(out.series.map(p => p.remaining)).toEqual([1, 1, 1])
  })

  test('empty sprint: all zeros, no throw', () => {
    const out = computeBurndownSeries(baseInput({ tasks: [], activities: [] }))
    expect(out.total).toBe(0)
    expect(out.series.map(p => p.remaining)).toEqual([0, 0, 0])
    expect(out.series.map(p => p.ideal)).toEqual([0, 0, 0])
  })

  test('single-day window: ideal equals total', () => {
    const out = computeBurndownSeries(
      baseInput({
        endDate: new Date('2026-06-01T00:00:00.000Z'),
        tasks: [{ id: 't1', sprintId: SPRINT, status: 'TODO' }],
      })
    )
    expect(out.series).toHaveLength(1)
    expect(out.series[0].ideal).toBe(1)
  })
})
