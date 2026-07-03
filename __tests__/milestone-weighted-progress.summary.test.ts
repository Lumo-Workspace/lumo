/** @jest-environment node */
/**
 * LUM-650 — the complexity-weighted progress reading for the milestone
 * Overview ring. A current-status snapshot (NOT a cumulative-over-time curve,
 * so the backward-replay convention does not apply): DONE tasks weighted by
 * TaskComplexity.changedFileCount over the measured tasks. Three-state
 * discipline (LUM-634): a task with no complexity row is unmeasured — excluded
 * from both sums and counted only against coverage, NEVER read as a 0 weight;
 * zero measured tasks yields a null pct (Unavailable), never 0%.
 */
import {
  computeWeightedProgress,
  type WeightedProgressTaskRow,
} from '@/lib/summaries/milestone-weighted-progress'
import type { TaskStatus } from '@prisma/client'

const row = (
  status: TaskStatus,
  changedFileCount: number | null
): WeightedProgressTaskRow => ({ status, changedFileCount })

describe('computeWeightedProgress', () => {
  it('weights DONE tasks by changedFileCount over the measured tasks', () => {
    // DONE: 8 + 2 = 10 weighted-done; total measured weight = 8 + 2 + 5 = 15.
    const r = computeWeightedProgress([
      row('DONE', 8),
      row('DONE', 2),
      row('IN_PROGRESS', 5),
    ])
    expect(r.doneWeight).toBe(10)
    expect(r.totalWeight).toBe(15)
    expect(r.pct).toBe(67) // round(10/15*100)
    expect(r.measuredTasks).toBe(3)
    expect(r.totalTasks).toBe(3)
  })

  it('excludes unmeasured tasks from both sums and counts them against coverage, never as 0', () => {
    // Two measured (DONE 4, TODO 6), two unmeasured (null). The unmeasured
    // tasks must NOT drag the denominator down as if they were 0-weight.
    const r = computeWeightedProgress([
      row('DONE', 4),
      row('TODO', 6),
      row('DONE', null),
      row('IN_REVIEW', null),
    ])
    expect(r.doneWeight).toBe(4)
    expect(r.totalWeight).toBe(10)
    expect(r.pct).toBe(40) // 4/10, unaffected by the two unmeasured tasks
    expect(r.measuredTasks).toBe(2)
    expect(r.totalTasks).toBe(4) // coverage gap surfaced, not hidden
  })

  it('reads null (Unavailable), not 0%, when no task is measured', () => {
    const r = computeWeightedProgress([row('DONE', null), row('TODO', null)])
    expect(r.pct).toBeNull()
    expect(r.doneWeight).toBeNull()
    expect(r.totalWeight).toBeNull()
    expect(r.measuredTasks).toBe(0)
    expect(r.totalTasks).toBe(2)
  })

  it('reads null (Unavailable) for an empty milestone', () => {
    const r = computeWeightedProgress([])
    expect(r.pct).toBeNull()
    expect(r.measuredTasks).toBe(0)
    expect(r.totalTasks).toBe(0)
  })

  it('is a snapshot: only currently-DONE tasks count in the numerator', () => {
    // IN_REVIEW is not DONE — its weight sits in the denominator only.
    const r = computeWeightedProgress([row('DONE', 3), row('IN_REVIEW', 7)])
    expect(r.doneWeight).toBe(3)
    expect(r.totalWeight).toBe(10)
    expect(r.pct).toBe(30)
  })

  it('reads a real measured zero as measured with a null pct, never a fabricated 100%', () => {
    // A task can carry a complexity row of 0 changed files (a no-op run).
    // Measured, but the weighted ratio is undefined — pct null, not 0/0=NaN
    // and not a fake 100%.
    const r = computeWeightedProgress([row('DONE', 0), row('TODO', 0)])
    expect(r.measuredTasks).toBe(2)
    expect(r.doneWeight).toBe(0)
    expect(r.totalWeight).toBe(0)
    expect(r.pct).toBeNull()
  })

  it('reports 100% when every measured task is DONE', () => {
    const r = computeWeightedProgress([row('DONE', 5), row('DONE', 5)])
    expect(r.pct).toBe(100)
    expect(r.doneWeight).toBe(10)
    expect(r.totalWeight).toBe(10)
  })
})
