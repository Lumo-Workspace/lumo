/**
 * @jest-environment node
 *
 * LUM-1057 — BACKLOG task status: transitions, board visibility, and the rule
 * that sprint / milestone progress leaves unscheduled (BACKLOG) work out.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/events/dispatcher', () => ({ dispatchEvents: jest.fn() }))

import {
  isValidTaskTransition,
  taskWorkflowCatalog,
} from '@/lib/task/state-machine'
import {
  boardStatuses,
  statusLabel,
} from '@/app/workspace/[workspaceUrl]/utils/taskStatus'
import { statusFromDropTarget } from '@/lib/editor/nodes/task-view-kanban-drop'
import {
  memberBreakdown,
  priorityBreakdown,
} from '@/lib/services/sprint-breakdown'
import { computeBurnupSeries } from '@/lib/services/sprint-burnup'
import { computeWeightedProgress } from '@/lib/summaries/milestone-weighted-progress'
import { formatMilestoneShow } from '@/cli/src/commands/milestone-show'

describe('state machine', () => {
  it('moves BACKLOG to and from every other status', () => {
    for (const s of ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const) {
      expect(isValidTaskTransition('BACKLOG', s)).toBe(true)
      expect(isValidTaskTransition(s, 'BACKLOG')).toBe(true)
    }
  })

  it('lists BACKLOG first in the workflow catalog', () => {
    expect(taskWorkflowCatalog().statuses[0]?.value).toBe('BACKLOG')
  })
})

describe('boardStatuses', () => {
  it('hides BACKLOG when no task is in it', () => {
    expect(boardStatuses([{ status: 'TODO' }, { status: 'DONE' }])).toEqual([
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ])
  })

  it('adds a leading BACKLOG column once a task is in it', () => {
    expect(boardStatuses([{ status: 'BACKLOG' }])).toEqual([
      'BACKLOG',
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ])
  })

  it('accepts a drop onto the BACKLOG column', () => {
    expect(statusFromDropTarget('BACKLOG', 'TODO')).toBe('BACKLOG')
  })
})

describe('statusLabel', () => {
  const intl = { formatMessage: ({ id }: { id: string }) => `t:${id}` }

  it('localizes every status through its status.* message id', () => {
    expect(statusLabel(intl, 'BACKLOG')).toBe('t:status.backlog')
    expect(statusLabel(intl, 'IN_REVIEW')).toBe('t:status.inReview')
  })

  it('echoes an unknown status back unchanged', () => {
    expect(statusLabel(intl, 'ARCHIVED')).toBe('ARCHIVED')
  })
})

describe('sprint breakdown', () => {
  const tasks = [
    {
      priority: 'HIGH' as const,
      status: 'DONE' as const,
      assigneeActorId: 'a1',
    },
    {
      priority: 'HIGH' as const,
      status: 'BACKLOG' as const,
      assigneeActorId: 'a1',
    },
    {
      priority: 'LOW' as const,
      status: 'BACKLOG' as const,
      assigneeActorId: 'a1',
    },
  ]

  it('leaves BACKLOG out of priority buckets', () => {
    expect(priorityBreakdown(tasks)).toEqual([
      { priority: 'HIGH', done: 1, total: 1 },
    ])
  })

  it('leaves BACKLOG out of member buckets', () => {
    const member = { id: 'm1', name: 'Ada', actorId: 'a1' }
    expect(memberBreakdown(tasks, [member])).toEqual([
      { member, done: 1, total: 1 },
    ])
  })
})

describe('sprint burnup', () => {
  const at = (d: string) => new Date(`${d}T12:00:00.000Z`)

  it('keeps a task out of scope on the days it sat in BACKLOG', () => {
    const out = computeBurnupSeries({
      sprintId: 's1',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      startedAt: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-03T00:00:00.000Z'),
      status: 'CLOSED',
      now: new Date('2026-06-10T00:00:00.000Z'),
      tasks: [
        {
          id: 't1',
          sprintId: 's1',
          status: 'TODO',
          createdAt: at('2026-06-01'),
        },
        {
          id: 't2',
          sprintId: 's1',
          status: 'TODO',
          createdAt: at('2026-06-01'),
        },
        {
          id: 't3',
          sprintId: 's1',
          status: 'BACKLOG',
          createdAt: at('2026-06-01'),
        },
      ],
      activities: [
        // t2 started in BACKLOG and was scheduled on day 2.
        {
          taskId: 't2',
          type: 'STATUS_CHANGED',
          payload: { from: 'BACKLOG', to: 'TODO' },
          createdAt: at('2026-06-02'),
        },
      ],
    })
    expect(out.series.map(p => p.scope)).toEqual([1, 2, 2])
    expect(out.scopeTotal).toBe(2)
  })
})

describe('milestone weighted progress', () => {
  it('ignores BACKLOG tasks in the weight totals', () => {
    const out = computeWeightedProgress([
      { status: 'DONE', changedFileCount: 4 },
      { status: 'BACKLOG', changedFileCount: 10 },
    ])
    expect(out.totalWeight).toBe(4)
    expect(out.measuredTasks).toBe(1)
  })
})

describe('lumo milestone show', () => {
  const milestone = {
    id: 'm-1',
    name: 'Q3',
    completedAt: null,
    startDate: null,
    targetDate: null,
    archivedAt: null,
    description: null,
    projectName: 'Lumo',
    taskCounts: { BACKLOG: 2, TODO: 1, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 1 },
  }

  it('reports BACKLOG next to, not inside, the progress total', () => {
    const out = formatMilestoneShow(milestone, [])
    expect(out).toContain('  Done:       1 / 2\n')
    expect(out).toContain('  Backlog:    2 (not in the total)')
  })

  it('stays silent about BACKLOG when there is none (or an old server)', () => {
    const { BACKLOG: _omit, ...oldCounts } = milestone.taskCounts
    const out = formatMilestoneShow({ ...milestone, taskCounts: oldCounts }, [])
    expect(out).not.toContain('BACKLOG')
  })
})

describe('CLI invalid --status error', () => {
  it('lists backlog among the allowed statuses', async () => {
    const { taskList } = await import('@/cli/src/commands/task-list')
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await taskList({ status: 'nope' })).toBe(1)
      expect(err).toHaveBeenCalledWith(
        'Error: invalid status "nope". Allowed: backlog, todo, in_progress, in_review, done'
      )
    } finally {
      err.mockRestore()
    }
  })
})
