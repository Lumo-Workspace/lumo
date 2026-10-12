/**
 * @jest-environment node
 */
import { rankTasks, type NextTask } from '@/cli/src/lib/rank-tasks'

function task(over: Partial<NextTask>): NextTask {
  return {
    id: 'c' + (over.number ?? 1),
    number: 1,
    title: 'T',
    status: 'TODO',
    priority: 'MEDIUM',
    teamIdentifier: 'LUM',
    sprintId: null,
    dueDate: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  }
}

const NOW = new Date('2026-06-02T00:00:00.000Z')

describe('rankTasks ordering', () => {
  it('orders by priority first (URGENT before LOW)', () => {
    const r = rankTasks(
      [
        task({ number: 1, priority: 'LOW' }),
        task({ number: 2, priority: 'URGENT' }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })

  it('active-sprint membership breaks priority ties', () => {
    const r = rankTasks(
      [
        task({ number: 1, priority: 'HIGH', sprintId: null }),
        task({ number: 2, priority: 'HIGH', sprintId: 's1' }),
      ],
      new Set(['s1']),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })

  it('earlier dueDate wins after priority and sprint tie; null due sorts last', () => {
    const r = rankTasks(
      [
        task({
          number: 1,
          priority: 'HIGH',
          dueDate: '2026-06-10T00:00:00.000Z',
        }),
        task({
          number: 2,
          priority: 'HIGH',
          dueDate: '2026-06-03T00:00:00.000Z',
        }),
        task({ number: 3, priority: 'HIGH', dueDate: null }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1', 'LUM-3'])
  })

  it('in-flight status nudges ahead of TODO on remaining tie', () => {
    const r = rankTasks(
      [
        task({ number: 1, priority: 'LOW', status: 'TODO' }),
        task({ number: 2, priority: 'LOW', status: 'IN_PROGRESS' }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })

  it('tiebreaks by updatedAt desc', () => {
    const r = rankTasks(
      [
        task({ number: 1, updatedAt: '2026-05-01T00:00:00.000Z' }),
        task({ number: 2, updatedAt: '2026-06-01T00:00:00.000Z' }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })

  it('LUM-645: a task blocked by open deps sorts after unblocked peers (same priority/sprint)', () => {
    const r = rankTasks(
      [
        task({
          number: 1,
          priority: 'HIGH',
          blockedByOpenCount: 2,
          // Earlier due would win pre-topology — blockedness overrides it.
          dueDate: '2026-06-03T00:00:00.000Z',
        }),
        task({ number: 2, priority: 'HIGH', blockedByOpenCount: 0 }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })

  it('LUM-645: among unblocked peers the one releasing more open tasks ranks first, before dueDate', () => {
    const r = rankTasks(
      [
        task({
          number: 1,
          priority: 'HIGH',
          unblocksOpenCount: 0,
          dueDate: '2026-06-03T00:00:00.000Z',
        }),
        task({ number: 2, priority: 'HIGH', unblocksOpenCount: 3 }),
        task({ number: 3, priority: 'HIGH', unblocksOpenCount: 1 }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-3', 'LUM-1'])
  })

  it('LUM-645: priority and active sprint still outrank topology', () => {
    const r = rankTasks(
      [
        task({ number: 1, priority: 'URGENT', blockedByOpenCount: 1 }),
        task({ number: 2, priority: 'LOW', unblocksOpenCount: 5 }),
        task({
          number: 3,
          priority: 'URGENT',
          sprintId: 's1',
          blockedByOpenCount: 1,
        }),
        task({ number: 4, priority: 'URGENT', unblocksOpenCount: 2 }),
      ],
      new Set(['s1']),
      NOW
    )
    // URGENT+sprint (blocked or not) → URGENT unblocked → URGENT blocked → LOW
    expect(r.map(x => x.identifier)).toEqual([
      'LUM-3',
      'LUM-4',
      'LUM-1',
      'LUM-2',
    ])
  })

  it('LUM-645: fields absent (older server) — order identical to the pre-topology ranking', () => {
    const legacy = [
      task({
        number: 1,
        priority: 'HIGH',
        dueDate: '2026-06-10T00:00:00.000Z',
      }),
      task({
        number: 2,
        priority: 'HIGH',
        dueDate: '2026-06-03T00:00:00.000Z',
      }),
      task({ number: 3, priority: 'LOW', status: 'IN_PROGRESS' }),
      task({ number: 4, priority: 'LOW', status: 'TODO' }),
    ]
    const r = rankTasks(legacy, new Set(), NOW)
    expect(r.map(x => x.identifier)).toEqual([
      'LUM-2',
      'LUM-1',
      'LUM-3',
      'LUM-4',
    ])
    // No topology factor appears in any reason line.
    for (const x of r) {
      expect(x.reasons.join(' ')).not.toMatch(/blocked by|unblocks/)
    }
  })

  it('both-null dueDates do not produce a NaN comparator (regression)', () => {
    // dueValue(null) is +Infinity, so a−b = Infinity−Infinity = NaN. The
    // comparator must treat that as a tie and fall through to updatedAt, not
    // return NaN (which breaks sort transitivity). Same priority/status/sprint,
    // both null due — only updatedAt differs, and must decide the order.
    const r = rankTasks(
      [
        task({
          number: 1,
          dueDate: null,
          updatedAt: '2026-05-01T00:00:00.000Z',
        }),
        task({
          number: 2,
          dueDate: null,
          updatedAt: '2026-06-01T00:00:00.000Z',
        }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })
})

describe('rankTasks reasons', () => {
  it('includes priority always, plus active sprint / overdue due / status when present', () => {
    const [r] = rankTasks(
      [
        task({
          number: 7,
          priority: 'URGENT',
          status: 'IN_PROGRESS',
          sprintId: 's1',
          // LUM-821: a due date is the author's LOCAL midnight.
          dueDate: new Date(2026, 5, 1).toISOString(),
        }),
      ],
      new Set(['s1']),
      NOW
    )
    expect(r!.reasons).toEqual([
      'URGENT',
      'active sprint',
      'due 2026-06-01 (overdue)',
      'in progress',
    ])
  })

  it('marks a future due date without (overdue)', () => {
    const [r] = rankTasks(
      [task({ number: 8, dueDate: new Date(2026, 5, 10).toISOString() })],
      new Set(),
      NOW
    )
    expect(r!.reasons).toContain('due 2026-06-10')
    expect(r!.reasons.join(' ')).not.toContain('overdue')
  })

  it('LUM-645: reason line shows the unblocks factor with singular/plural', () => {
    const r = rankTasks(
      [
        task({ number: 9, unblocksOpenCount: 3 }),
        task({ number: 10, unblocksOpenCount: 1 }),
      ],
      new Set(),
      NOW
    )
    expect(r[0]!.reasons).toContain('unblocks 3 tasks')
    expect(r[1]!.reasons).toContain('unblocks 1 task')
  })

  it('LUM-645: reason line shows the blocked factor (and suppresses unblocks on a blocked task)', () => {
    const [r] = rankTasks(
      [task({ number: 11, blockedByOpenCount: 2, unblocksOpenCount: 4 })],
      new Set(),
      NOW
    )
    expect(r!.reasons).toContain('blocked by 2 open deps')
    expect(r!.reasons.join(' ')).not.toContain('unblocks')
  })
})
