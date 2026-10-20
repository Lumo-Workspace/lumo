/**
 * @jest-environment node
 *
 * LUM-1282 metric semantics, applied everywhere: CANCELED leaves both the
 * numerator and the denominator of completion rates, burnup scope and sprint
 * / milestone progress; it counts as closed for the milestone completion
 * rollup (a milestone whose remaining open tasks are CANCELED completes), for
 * blockers and for the "next" lists.
 */
import type { TaskStatus } from '@prisma/client'
import { computeMilestoneBurnup } from '@/lib/summaries/milestone-burnup'
import { computeBurnupSeries } from '@/lib/services/sprint-burnup'
import { computeSprintCoverage } from '@/lib/summaries/sprint-coverage'
import { computeWeightedProgress } from '@/lib/summaries/milestone-weighted-progress'
import { milestoneHealthFromCounts } from '@/lib/summaries/milestone-health'
import {
  allCountedTasksDone,
  deriveCompletionChange,
} from '@/lib/summaries/milestone-rollup'
import {
  memberBreakdown,
  priorityBreakdown,
} from '@/lib/services/sprint-breakdown'
import { computeMilestoneSegments } from '@/lib/summaries/milestone-segments'
import { computeMilestoneTopology } from '@/lib/summaries/milestone-topology'
import { collectTopBlockers } from '@/lib/summaries/top-blockers'

function counts(
  partial: Partial<Record<TaskStatus, number>>
): Record<TaskStatus, number> {
  return {
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
    CANCELED: 0,
    ...partial,
  }
}

const D = (s: string) => new Date(`${s}T12:00:00.000Z`)

describe('milestone completion rollup', () => {
  it('stamps completedAt when the remaining open tasks are CANCELED', () => {
    const taskCounts = counts({ DONE: 3, CANCELED: 2 })
    expect(allCountedTasksDone(taskCounts)).toBe(true)
    expect(
      deriveCompletionChange({ completedAt: null, archived: false, taskCounts })
    ).toBe('complete')
  })

  it('an open task still holds it open; a stamped milestone stays complete after a cancel', () => {
    expect(
      deriveCompletionChange({
        completedAt: null,
        archived: false,
        taskCounts: counts({ DONE: 3, TODO: 1, CANCELED: 2 }),
      })
    ).toBeNull()
    expect(
      deriveCompletionChange({
        completedAt: D('2026-10-01'),
        archived: false,
        taskCounts: counts({ DONE: 3, CANCELED: 1 }),
      })
    ).toBeNull()
  })

  it('an all-CANCELED milestone carries no completion signal', () => {
    expect(
      deriveCompletionChange({
        completedAt: null,
        archived: false,
        taskCounts: counts({ CANCELED: 4 }),
      })
    ).toBeNull()
  })
})

describe('milestone progress', () => {
  it('health counts done / total without CANCELED', () => {
    // 2 done of 4 counted (2 canceled ignored): 50% on a half-elapsed window
    // is on track; were CANCELED in the total it would read 2/6 = at risk.
    const health = milestoneHealthFromCounts(
      {
        completedAt: null,
        archivedAt: null,
        startDate: D('2026-10-01'),
        targetDate: D('2026-10-21'),
      },
      counts({ TODO: 2, DONE: 2, CANCELED: 2 }),
      D('2026-10-11')
    )
    const withoutCancels = milestoneHealthFromCounts(
      {
        completedAt: null,
        archivedAt: null,
        startDate: D('2026-10-01'),
        targetDate: D('2026-10-21'),
      },
      counts({ TODO: 2, DONE: 2 }),
      D('2026-10-11')
    )
    expect(health).not.toBeNull()
    expect(health).toBe(withoutCancels)
  })

  it('weighted progress drops CANCELED from weights and the coverage total', () => {
    const p = computeWeightedProgress([
      { status: 'DONE', changedFileCount: 4 },
      { status: 'TODO', changedFileCount: 4 },
      { status: 'CANCELED', changedFileCount: 100 },
      { status: 'CANCELED', changedFileCount: null },
    ])
    expect(p.doneWeight).toBe(4)
    expect(p.totalWeight).toBe(8)
    expect(p.pct).toBe(50)
    expect(p.totalTasks).toBe(2)
  })

  it('segments leave CANCELED tasks out', () => {
    const seg = computeMilestoneSegments(
      [
        {
          id: 't1',
          ref: 'LUM-1',
          title: 'a',
          status: 'DONE',
          priority: 'HIGH',
          sprintId: null,
          tags: [],
        },
        {
          id: 't2',
          ref: 'LUM-2',
          title: 'b',
          status: 'CANCELED',
          priority: 'HIGH',
          sprintId: null,
          tags: [],
        },
      ],
      []
    )
    const high = seg.priority.find(s => s.key === 'HIGH')
    expect(high?.taskIds).toEqual(['t1'])
    expect(high?.doneCount).toBe(1)
  })
})

describe('burnup scope', () => {
  it('milestone burnup: a task leaves scope the day it is canceled', () => {
    const b = computeMilestoneBurnup({
      tasks: [
        { id: 'a', status: 'DONE', createdAt: D('2026-10-01') },
        { id: 'b', status: 'CANCELED', createdAt: D('2026-10-01') },
      ],
      activities: [
        {
          taskId: 'a',
          payload: { from: 'TODO', to: 'DONE' },
          createdAt: D('2026-10-02'),
        },
        {
          taskId: 'b',
          payload: { from: 'TODO', to: 'CANCELED' },
          createdAt: D('2026-10-03'),
        },
      ],
      sprints: [],
      now: D('2026-10-03'),
    })
    expect(b.series.map(p => [p.date, p.scope, p.completed])).toEqual([
      ['2026-10-01', 2, 0],
      ['2026-10-02', 2, 1],
      ['2026-10-03', 1, 1],
    ])
    expect(b.scopeTotal).toBe(1)
  })

  it('sprint burnup: CANCELED is out of scope and never completed', () => {
    const s = computeBurnupSeries({
      sprintId: 's1',
      startDate: D('2026-10-01'),
      endDate: D('2026-10-02'),
      status: 'CLOSED',
      now: D('2026-10-05'),
      tasks: [
        { id: 'a', sprintId: 's1', status: 'DONE', createdAt: D('2026-09-30') },
        {
          id: 'b',
          sprintId: 's1',
          status: 'CANCELED',
          createdAt: D('2026-09-30'),
        },
      ],
      activities: [],
    })
    expect(s.scopeTotal).toBe(1)
    for (const p of s.series) {
      expect(p.scope).toBe(1)
      if (p.completed !== null) expect(p.completed).toBeLessThanOrEqual(1)
    }
  })
})

describe('sprint progress', () => {
  it('sprint coverage leaves CANCELED out of taskCount', () => {
    const c = computeSprintCoverage(
      [
        { sprintId: 's1', status: 'DONE', count: 2 },
        { sprintId: 's1', status: 'CANCELED', count: 5 },
        { sprintId: 's1', status: 'TODO', count: 1 },
      ],
      [{ id: 's1', number: 1, name: 'S1', status: 'ACTIVE' }]
    )
    expect(c.sprints[0]).toMatchObject({ taskCount: 3, doneCount: 2 })
  })

  it('priority and member breakdowns skip CANCELED', () => {
    const tasks = [
      {
        priority: 'HIGH' as const,
        status: 'DONE' as const,
        assigneeActorId: 'a1',
      },
      {
        priority: 'HIGH' as const,
        status: 'CANCELED' as const,
        assigneeActorId: 'a1',
      },
    ]
    expect(priorityBreakdown(tasks)).toEqual([
      { priority: 'HIGH', done: 1, total: 1 },
    ])
    const members = memberBreakdown(tasks, [
      { id: 'm1', name: 'Ann', actorId: 'a1' },
    ])
    expect(members.map(m => [m.done, m.total])).toEqual([[1, 1]])
  })
})

describe('closed for blockers and next lists', () => {
  it('a CANCELED blocker releases its dependent; a CANCELED task is never next', () => {
    const topo = computeMilestoneTopology({
      tasks: [
        { id: 'a', ref: 'LUM-1', title: 'blocker', status: 'CANCELED' },
        { id: 'b', ref: 'LUM-2', title: 'dependent', status: 'TODO' },
      ],
      edges: [
        {
          blockedTaskId: 'b',
          blockingTaskId: 'a',
          kind: 'BLOCKS',
          status: 'CONFIRMED',
          blockingStatus: 'CANCELED',
        },
      ],
    })
    expect(topo.nextBatch.map(n => n.ref)).toEqual(['LUM-2'])
    expect(topo.blockedOpenCount).toBe(0)
  })

  it('top blockers never list a CANCELED task as overdue or stalled', () => {
    const old = new Date('2026-01-01T00:00:00.000Z')
    const tb = collectTopBlockers({
      tasks: [
        {
          id: 't1',
          identifier: 'LUM-1',
          title: 'x',
          status: 'CANCELED',
          priority: 'HIGH',
          dueDate: old,
          updatedAt: old,
        },
      ],
      agents: [],
      prs: [],
      now: new Date('2026-10-19T00:00:00.000Z'),
    })
    expect(JSON.stringify(tb)).not.toContain('LUM-1')
  })
})
