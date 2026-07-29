import { computeBurnupSeries } from '@/lib/services/sprint-burnup'
import type { BurnupComputeInput } from '@/lib/services/sprint-burnup'

const SPRINT = 'sprint-1'
const at = (d: string) => new Date(`${d}T12:00:00.000Z`)

function statusEvt(taskId: string, from: string, to: string, d: string) {
  return {
    taskId,
    type: 'STATUS_CHANGED' as const,
    payload: { from, to },
    createdAt: at(d),
  }
}
function baseInput(over: Partial<BurnupComputeInput> = {}): BurnupComputeInput {
  return {
    sprintId: SPRINT,
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    startedAt: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-03T00:00:00.000Z'),
    status: 'CLOSED',
    now: new Date('2026-06-10T00:00:00.000Z'),
    tasks: [],
    activities: [],
    ...over,
  }
}

describe('computeBurnupSeries', () => {
  test('smooth burnup: scope and completed both rise; completed <= scope', () => {
    const out = computeBurnupSeries(
      baseInput({
        tasks: [
          {
            id: 't1',
            sprintId: SPRINT,
            status: 'DONE',
            createdAt: at('2026-06-01'),
          },
          {
            id: 't2',
            sprintId: SPRINT,
            status: 'DONE',
            createdAt: at('2026-06-01'),
          },
          {
            id: 't3',
            sprintId: SPRINT,
            status: 'DONE',
            createdAt: at('2026-06-02'),
          },
          {
            id: 't4',
            sprintId: SPRINT,
            status: 'TODO',
            createdAt: at('2026-06-03'),
          },
        ],
        activities: [
          statusEvt('t1', 'TODO', 'DONE', '2026-06-01'),
          statusEvt('t2', 'TODO', 'DONE', '2026-06-02'),
          statusEvt('t3', 'TODO', 'DONE', '2026-06-03'),
        ],
      })
    )
    expect(out.unit).toBe('tasks')
    expect(out.scopeTotal).toBe(4)
    expect(out.series.map(p => p.scope)).toEqual([2, 3, 4])
    expect(out.series.map(p => p.completed)).toEqual([1, 2, 3])
    expect(out.series.map(p => p.projected)).toEqual([null, null, null])
    // invariant
    for (const p of out.series) expect(p.completed! <= p.scope).toBe(true)
  })

  test('ACTIVE: future days null; projection linear from today to (end, scopeTotal)', () => {
    const out = computeBurnupSeries(
      baseInput({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        startedAt: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-04T00:00:00.000Z'),
        status: 'ACTIVE',
        now: new Date('2026-06-02T06:00:00.000Z'), // 06-01, 06-02 past; 06-03, 06-04 future
        tasks: [
          {
            id: 't1',
            sprintId: SPRINT,
            status: 'DONE',
            createdAt: at('2026-06-01'),
          },
          {
            id: 't2',
            sprintId: SPRINT,
            status: 'TODO',
            createdAt: at('2026-06-01'),
          },
        ],
        activities: [statusEvt('t1', 'TODO', 'DONE', '2026-06-01')],
      })
    )
    expect(out.scopeTotal).toBe(2)
    expect(out.series.map(p => p.scope)).toEqual([2, 2, 2, 2])
    expect(out.series.map(p => p.completed)).toEqual([1, 1, null, null])
    // anchor at idx 1 (06-02, completed=1) → (idx3, 2); idx2 = 1.5
    expect(out.series.map(p => p.projected)).toEqual([null, 1, 1.5, 2])
  })

  test('reopen (DONE→TODO) makes completed dip and stay <= scope', () => {
    const out = computeBurnupSeries(
      baseInput({
        tasks: [
          {
            id: 't1',
            sprintId: SPRINT,
            status: 'TODO',
            createdAt: at('2026-06-01'),
          },
        ],
        activities: [
          statusEvt('t1', 'TODO', 'DONE', '2026-06-01'),
          statusEvt('t1', 'DONE', 'TODO', '2026-06-02'),
        ],
      })
    )
    expect(out.series.map(p => p.scope)).toEqual([1, 1, 1])
    expect(out.series.map(p => p.completed)).toEqual([1, 0, 0])
  })

  test('late startedAt does NOT truncate: window still spans from startDate', () => {
    // Sprint planned 06-01 but flipped ACTIVE on 06-03 (work happened in DRAFT).
    // The window must still start at 06-01 — otherwise the real ramp collapses.
    const out = computeBurnupSeries(
      baseInput({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        startedAt: new Date('2026-06-03T00:00:00.000Z'),
        endDate: new Date('2026-06-05T00:00:00.000Z'),
        status: 'CLOSED',
        tasks: [
          {
            id: 't1',
            sprintId: SPRINT,
            status: 'TODO',
            createdAt: at('2026-06-01'),
          },
        ],
      })
    )
    expect(out.start).toBe('2026-06-01')
    expect(out.series.map(p => p.date)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ])
  })

  test('early startedAt extends the window backwards before startDate', () => {
    // Sprint started 05-30, before its planned startDate 06-01.
    const out = computeBurnupSeries(
      baseInput({
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        startedAt: new Date('2026-05-30T00:00:00.000Z'),
        endDate: new Date('2026-06-01T00:00:00.000Z'),
        status: 'CLOSED',
        tasks: [
          {
            id: 't1',
            sprintId: SPRINT,
            status: 'TODO',
            createdAt: at('2026-05-30'),
          },
        ],
      })
    )
    expect(out.start).toBe('2026-05-30')
    expect(out.series.map(p => p.date)).toEqual([
      '2026-05-30',
      '2026-05-31',
      '2026-06-01',
    ])
  })

  test('only this sprint’s tasks are recorded — a task moved away counts on no day', () => {
    // The shape that produced the LUM-717 report: a sprint holding 2 tasks
    // charted a ceiling of 3, because a third — DONE, and long since moved to
    // another sprint — stayed in scope AND in completed forever.
    const out = computeBurnupSeries(
      baseInput({
        tasks: [
          {
            id: 'stays1',
            sprintId: SPRINT,
            status: 'DONE',
            createdAt: at('2026-06-01'),
          },
          {
            id: 'stays2',
            sprintId: SPRINT,
            status: 'DONE',
            createdAt: at('2026-06-01'),
          },
          // Sat in this sprint on 06-01, moved to `other` on 06-02.
          {
            id: 'moved',
            sprintId: 'other',
            status: 'DONE',
            createdAt: at('2026-06-01'),
          },
        ],
        activities: [
          statusEvt('stays1', 'TODO', 'DONE', '2026-06-01'),
          statusEvt('stays2', 'TODO', 'DONE', '2026-06-02'),
          statusEvt('moved', 'TODO', 'DONE', '2026-06-01'),
        ],
      })
    )
    // `moved` is another sprint's work now, so it is absent from every day —
    // including 06-01, when it still sat here. Scope therefore only ever rises.
    expect(out.scopeTotal).toBe(2)
    expect(out.series.map(p => p.scope)).toEqual([2, 2, 2])
    expect(out.series.map(p => p.completed)).toEqual([1, 2, 2])
  })

  test('empty sprint: scopeTotal 0, completed all 0', () => {
    const out = computeBurnupSeries(baseInput({ tasks: [], activities: [] }))
    expect(out.scopeTotal).toBe(0)
    expect(out.series.map(p => p.scope)).toEqual([0, 0, 0])
    expect(out.series.map(p => p.completed)).toEqual([0, 0, 0])
  })

  test('effectiveStart after endDate yields empty series', () => {
    const out = computeBurnupSeries(
      baseInput({
        startDate: new Date('2026-06-10T00:00:00.000Z'),
        startedAt: new Date('2026-06-10T00:00:00.000Z'),
        endDate: new Date('2026-06-03T00:00:00.000Z'),
      })
    )
    expect(out.series).toEqual([])
    expect(out.scopeTotal).toBe(0)
  })
})
