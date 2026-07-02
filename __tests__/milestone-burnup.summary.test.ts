/** @jest-environment node */
import {
  computeMilestoneBurnup,
  type MilestoneBurnupInput,
} from '@/lib/summaries/milestone-burnup'

const d = (iso: string) => new Date(iso)

const sprints = [
  {
    id: 's2',
    number: 2,
    name: 'Sprint 2',
    startDate: d('2026-01-12T00:00:00Z'),
    endDate: d('2026-01-16T00:00:00Z'),
  },
  {
    id: 's1',
    number: 1,
    name: 'Sprint 1',
    startDate: d('2026-01-05T00:00:00Z'),
    endDate: d('2026-01-09T00:00:00Z'),
  },
]

function point(
  burnup: ReturnType<typeof computeMilestoneBurnup>,
  date: string
) {
  const p = burnup.series.find(x => x.date === date)
  if (!p) throw new Error(`no point for ${date}`)
  return p
}

it('milestone burnup replays status history across sprint windows', () => {
  // Task A: created 01-04, DONE on 01-07, reopened 01-13, re-done 01-15.
  // Task B: created 01-13, still IN_PROGRESS (no status trail).
  const input: MilestoneBurnupInput = {
    tasks: [
      { id: 'a', status: 'DONE', createdAt: d('2026-01-04T10:00:00Z') },
      { id: 'b', status: 'IN_PROGRESS', createdAt: d('2026-01-13T09:00:00Z') },
    ],
    activities: [
      {
        taskId: 'a',
        payload: { from: 'IN_PROGRESS', to: 'DONE' },
        createdAt: d('2026-01-07T12:00:00Z'),
      },
      {
        taskId: 'a',
        payload: { from: 'DONE', to: 'IN_PROGRESS' },
        createdAt: d('2026-01-13T12:00:00Z'),
      },
      {
        taskId: 'a',
        payload: { from: 'IN_PROGRESS', to: 'DONE' },
        createdAt: d('2026-01-15T12:00:00Z'),
      },
    ],
    sprints,
    now: d('2026-01-16T08:00:00Z'),
  }

  const burnup = computeMilestoneBurnup(input)

  // Window spans from the earliest task creation to today — across both sprints.
  expect(burnup.start).toBe('2026-01-04')
  expect(burnup.end).toBe('2026-01-16')
  expect(burnup.unit).toBe('tasks')
  expect(burnup.scopeTotal).toBe(2)

  // Scope counts tasks created by end-of-day.
  expect(point(burnup, '2026-01-04')).toMatchObject({ scope: 1 })
  expect(point(burnup, '2026-01-12')).toMatchObject({ scope: 1 })
  expect(point(burnup, '2026-01-13')).toMatchObject({ scope: 2 })

  // Completed is replayed from STATUS_CHANGED, not the current status:
  // before the first DONE the curve is 0 even though task A is DONE today...
  expect(point(burnup, '2026-01-05')).toMatchObject({ completed: 0 })
  // ...DONE at end-of-day 01-07...
  expect(point(burnup, '2026-01-07')).toMatchObject({ completed: 1 })
  // ...the reopen DECREMENTS the curve...
  expect(point(burnup, '2026-01-13')).toMatchObject({ completed: 0 })
  // ...and the re-done brings it back.
  expect(point(burnup, '2026-01-15')).toMatchObject({ completed: 1 })
  expect(point(burnup, '2026-01-16')).toMatchObject({ scope: 2, completed: 1 })

  // Covering sprints' calendar windows ride along, sorted by start date.
  expect(burnup.sprintWindows).toEqual([
    {
      sprintId: 's1',
      number: 1,
      name: 'Sprint 1',
      start: '2026-01-05',
      end: '2026-01-09',
    },
    {
      sprintId: 's2',
      number: 2,
      name: 'Sprint 2',
      start: '2026-01-12',
      end: '2026-01-16',
    },
  ])
})

it('falls back to the current status for tasks with no status trail', () => {
  // A DONE task with no STATUS_CHANGED rows counts as DONE from creation —
  // the same fallback semantics the sprint burnup uses.
  const burnup = computeMilestoneBurnup({
    tasks: [{ id: 'a', status: 'DONE', createdAt: d('2026-01-04T10:00:00Z') }],
    activities: [],
    sprints: [],
    now: d('2026-01-06T08:00:00Z'),
  })
  expect(point(burnup, '2026-01-04')).toMatchObject({ scope: 1, completed: 1 })
  expect(burnup.scopeTotal).toBe(1)
  expect(burnup.sprintWindows).toEqual([])
})

it('a task-less milestone yields an empty series, never a fake curve', () => {
  const burnup = computeMilestoneBurnup({
    tasks: [],
    activities: [],
    sprints,
    now: d('2026-01-16T08:00:00Z'),
  })
  expect(burnup.series).toEqual([])
  expect(burnup.scopeTotal).toBe(0)
  // Sprint windows still surface (context is real even with zero tasks).
  expect(burnup.sprintWindows).toHaveLength(2)
})

it('extends the window back to an earlier sprint start', () => {
  // Sprint started before the first task was created — the window anchors at
  // the sprint start so the band renders fully.
  const burnup = computeMilestoneBurnup({
    tasks: [{ id: 'a', status: 'TODO', createdAt: d('2026-01-07T10:00:00Z') }],
    activities: [],
    sprints: [sprints[1]!],
    now: d('2026-01-08T08:00:00Z'),
  })
  expect(burnup.start).toBe('2026-01-05')
  expect(point(burnup, '2026-01-05')).toMatchObject({ scope: 0, completed: 0 })
  expect(point(burnup, '2026-01-07')).toMatchObject({ scope: 1, completed: 0 })
})
