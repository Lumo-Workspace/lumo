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
          dueDate: '2026-06-01T00:00:00.000Z',
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
      [task({ number: 8, dueDate: '2026-06-10T00:00:00.000Z' })],
      new Set(),
      NOW
    )
    expect(r!.reasons).toContain('due 2026-06-10')
    expect(r!.reasons.join(' ')).not.toContain('overdue')
  })
})
