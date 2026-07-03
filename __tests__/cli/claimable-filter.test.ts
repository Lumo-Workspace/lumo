/**
 * @jest-environment node
 *
 * LUM-646: the `lumo next --claimable` autonomy gate (pure filter) and the
 * guarantee that the default (ungated) ranking is unaffected by the new
 * claimable / budget fields.
 */
import {
  filterClaimable,
  formatClaimableExclusions,
} from '@/cli/src/lib/claimable-filter'
import { rankTasks, type NextTask } from '@/cli/src/lib/rank-tasks'

function task(over: Partial<NextTask>): NextTask {
  return {
    id: 'c' + (over.number ?? 1),
    number: over.number ?? 1,
    title: 'T',
    status: 'TODO',
    priority: 'MEDIUM',
    teamIdentifier: 'LUM',
    sprintId: null,
    dueDate: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  }
}

describe('LUM-646 filterClaimable', () => {
  it('keeps claimable unblocked in-budget tasks', () => {
    const kept = task({
      number: 1,
      claimable: true,
      blockedByOpenCount: 0,
      milestoneBudgetExceeded: false,
    })
    const res = filterClaimable([kept])
    expect(res.supported).toBe(true)
    expect(res.kept.map(t => t.id)).toEqual(['c1'])
    expect(res.excluded).toEqual({
      notClaimable: 0,
      blocked: 0,
      overBudget: 0,
    })
  })

  it('excludes non-claimable tasks', () => {
    // claimable false AND claimable unset (undefined) both count as not-claimable,
    // as long as at least one task carries the field so the server is "supported".
    const anchor = task({ number: 1, claimable: true })
    const falseTask = task({ number: 2, claimable: false })
    const unsetTask = task({ number: 3 }) // no claimable field
    const res = filterClaimable([anchor, falseTask, unsetTask])
    expect(res.kept.map(t => t.id)).toEqual(['c1'])
    expect(res.excluded.notClaimable).toBe(2)
  })

  it('excludes tasks with open blockers', () => {
    const blocked = task({
      number: 1,
      claimable: true,
      blockedByOpenCount: 2,
    })
    const res = filterClaimable([blocked])
    expect(res.kept).toHaveLength(0)
    expect(res.excluded.blocked).toBe(1)
  })

  it('excludes over-budget milestone tasks', () => {
    const over = task({
      number: 1,
      claimable: true,
      blockedByOpenCount: 0,
      milestoneBudgetExceeded: true,
    })
    // null / false / undefined budget signals never exclude (fail-open).
    const nullBudget = task({
      number: 2,
      claimable: true,
      milestoneBudgetExceeded: null,
    })
    const res = filterClaimable([over, nullBudget])
    expect(res.kept.map(t => t.id)).toEqual(['c2'])
    expect(res.excluded.overBudget).toBe(1)
  })

  it('reports an honest exclusion breakdown that sums to the excluded count', () => {
    const tasks = [
      task({ number: 1, claimable: true, blockedByOpenCount: 0 }), // kept
      task({ number: 2, claimable: false }), // notClaimable
      task({ number: 3, claimable: true, blockedByOpenCount: 1 }), // blocked
      task({
        number: 4,
        claimable: true,
        blockedByOpenCount: 0,
        milestoneBudgetExceeded: true,
      }), // overBudget
    ]
    const res = filterClaimable(tasks)
    expect(res.kept).toHaveLength(1)
    const { notClaimable, blocked, overBudget } = res.excluded
    expect(notClaimable + blocked + overBudget).toBe(
      tasks.length - res.kept.length
    )
    expect(formatClaimableExclusions(res.excluded)).toBe(
      '1 not triaged claimable, 1 blocked by open deps, 1 over milestone budget'
    )
  })

  it('reports unsupported when the server sends no claimable field (old server)', () => {
    const res = filterClaimable([task({ number: 1 }), task({ number: 2 })])
    expect(res.supported).toBe(false)
    expect(res.kept).toHaveLength(0)
  })
})

describe('LUM-646 default next ignores claimable gate', () => {
  // Regression guard for the user's decision: `lumo next` without --claimable
  // must behave exactly as LUM-645 did. The new claimable / budget fields must
  // be inert in the ranking path — same order, same reasons, with or without them.
  const withFields: NextTask[] = [
    task({
      number: 1,
      priority: 'LOW',
      claimable: false,
      milestoneBudgetExceeded: true,
      blockedByOpenCount: 0,
      unblocksOpenCount: 3,
    }),
    task({
      number: 2,
      priority: 'HIGH',
      claimable: true,
      milestoneBudgetExceeded: false,
      blockedByOpenCount: 0,
      unblocksOpenCount: 0,
    }),
    task({
      number: 3,
      priority: 'HIGH',
      claimable: false,
      blockedByOpenCount: 2,
      unblocksOpenCount: 0,
    }),
  ]
  const withoutFields: NextTask[] = withFields.map(t => {
    const { claimable, milestoneBudgetExceeded, ...rest } = t
    void claimable
    void milestoneBudgetExceeded
    return rest
  })
  const now = new Date('2026-07-03T00:00:00.000Z')

  it('produces identical order with or without the new fields', () => {
    const a = rankTasks(withFields, new Set(), now).map(r => r.identifier)
    const b = rankTasks(withoutFields, new Set(), now).map(r => r.identifier)
    expect(a).toEqual(b)
    // HIGH-priority, unblocked LUM-2 leads; blocked HIGH LUM-3 sinks below it.
    expect(a).toEqual(['LUM-2', 'LUM-3', 'LUM-1'])
  })

  it('produces identical reason lines with or without the new fields', () => {
    const a = rankTasks(withFields, new Set(), now).map(r =>
      r.reasons.join('|')
    )
    const b = rankTasks(withoutFields, new Set(), now).map(r =>
      r.reasons.join('|')
    )
    expect(a).toEqual(b)
  })
})
