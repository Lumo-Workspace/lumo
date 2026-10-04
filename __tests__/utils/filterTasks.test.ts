import {
  FILTER_DIMENSIONS,
  NO_MILESTONE_VALUE,
  NO_SPRINT_VALUE,
  UNASSIGNED_VALUE,
  UNTAGGED_VALUE,
  clearFilterDimension,
  countActiveFilters,
  dimensionValueCounts,
  dueDateBucket,
  filterTasks,
  narrowableDimensions,
  normalizeFilters,
  toggleFilterValue,
} from '@/app/workspace/[workspaceUrl]/utils/filterTasks'
import type { MyTask } from '@/app/workspace/[workspaceUrl]/types'

/** A fixed "now" so due-date buckets are deterministic: local noon, 2026-07-29. */
const NOW = new Date(2026, 6, 29, 12, 0, 0).getTime()

/**
 * A task bound to a milestone. LUM-714: a milestone is in flight unless it
 * carries a completion stamp or an archive stamp, so the fixture takes those
 * two timestamps instead of a status.
 */
function inMilestone(
  id: string,
  state: 'active' | 'completed' | 'archived' = 'active'
) {
  return {
    milestoneId: id,
    milestone: {
      id,
      name: `Milestone ${id}`,
      completedAt:
        state === 'completed' ? '2026-06-01T00:00:00.000Z' : (null as null),
      archivedAt:
        state === 'archived' ? '2026-06-01T00:00:00.000Z' : (null as null),
    },
  }
}

/** Build a local-midnight ISO string N days from NOW (local-day semantics). */
function dayOffset(days: number): string {
  const d = new Date(2026, 6, 29 + days, 0, 0, 0)
  return d.toISOString()
}

function makeTask(overrides: Partial<MyTask> = {}): MyTask {
  return {
    id: 'task_1',
    title: 'Untitled',
    status: 'TODO',
    priority: 'MEDIUM',
    projectId: 'proj_a',
    assigneeActorId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    dueDate: null,
    viewOrder: null,
    number: 1,
    teamIdentifier: 'LUM',
    project: { id: 'proj_a', name: 'Alpha', ownerActorId: null },
    ...overrides,
  } as MyTask
}

describe('dueDateBucket', () => {
  it('buckets by local calendar day relative to now', () => {
    expect(dueDateBucket(dayOffset(-1), NOW)).toBe('overdue')
    expect(dueDateBucket(dayOffset(0), NOW)).toBe('today')
    expect(dueDateBucket(dayOffset(3), NOW)).toBe('next7')
    expect(dueDateBucket(dayOffset(7), NOW)).toBe('next7')
    expect(dueDateBucket(dayOffset(8), NOW)).toBe('later')
  })

  it('treats a missing or unparseable due date as "none"', () => {
    expect(dueDateBucket(null, NOW)).toBe('none')
    expect(dueDateBucket(undefined, NOW)).toBe('none')
    expect(dueDateBucket('not-a-date', NOW)).toBe('none')
  })
})

describe('filterTasks', () => {
  it('returns the input untouched when no dimension is selected', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })]
    expect(filterTasks(tasks, {}, NOW)).toBe(tasks)
    expect(filterTasks(tasks, { status: [] }, NOW)).toBe(tasks)
  })

  it('ORs within one dimension', () => {
    const tasks = [
      makeTask({ id: 'todo', status: 'TODO' }),
      makeTask({ id: 'wip', status: 'IN_PROGRESS' }),
      makeTask({ id: 'done', status: 'DONE' }),
    ]
    const result = filterTasks(tasks, { status: ['TODO', 'IN_PROGRESS'] }, NOW)
    expect(result.map(t => t.id)).toEqual(['todo', 'wip'])
  })

  it('ANDs across dimensions', () => {
    const tasks = [
      makeTask({ id: 'match', status: 'TODO', priority: 'HIGH' }),
      makeTask({ id: 'wrong-priority', status: 'TODO', priority: 'LOW' }),
      makeTask({ id: 'wrong-status', status: 'DONE', priority: 'HIGH' }),
    ]
    const result = filterTasks(
      tasks,
      { status: ['TODO'], priority: ['HIGH'] },
      NOW
    )
    expect(result.map(t => t.id)).toEqual(['match'])
  })

  it('filters by assignee, with a sentinel for unassigned tasks', () => {
    const tasks = [
      makeTask({ id: 'mine', assigneeActorId: 'actor_1' }),
      makeTask({ id: 'theirs', assigneeActorId: 'actor_2' }),
      makeTask({ id: 'nobody', assigneeActorId: null }),
    ]
    expect(
      filterTasks(tasks, { assignee: ['actor_1'] }, NOW).map(t => t.id)
    ).toEqual(['mine'])
    expect(
      filterTasks(tasks, { assignee: [UNASSIGNED_VALUE] }, NOW).map(t => t.id)
    ).toEqual(['nobody'])
  })

  it('filters by project', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'proj_a' }),
      makeTask({ id: 'b', projectId: 'proj_b' }),
    ]
    expect(
      filterTasks(tasks, { project: ['proj_b'] }, NOW).map(t => t.id)
    ).toEqual(['b'])
  })

  it('matches a task when any of its tags is selected, and has a sentinel for untagged', () => {
    const tag = (id: string) => ({
      id,
      name: id,
      color: null,
      workspaceId: 'ws',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    const tasks = [
      makeTask({ id: 'bug-and-ui', tags: [tag('bug'), tag('ui')] }),
      makeTask({ id: 'ui-only', tags: [tag('ui')] }),
      makeTask({ id: 'untagged' }),
    ]
    expect(filterTasks(tasks, { tag: ['bug'] }, NOW).map(t => t.id)).toEqual([
      'bug-and-ui',
    ])
    expect(filterTasks(tasks, { tag: ['ui'] }, NOW).map(t => t.id)).toEqual([
      'bug-and-ui',
      'ui-only',
    ])
    expect(
      filterTasks(tasks, { tag: [UNTAGGED_VALUE] }, NOW).map(t => t.id)
    ).toEqual(['untagged'])
  })

  it('filters by due-date bucket', () => {
    const tasks = [
      makeTask({ id: 'late', dueDate: dayOffset(-2) }),
      makeTask({ id: 'today', dueDate: dayOffset(0) }),
      makeTask({ id: 'soon', dueDate: dayOffset(2) }),
      makeTask({ id: 'none' }),
    ]
    expect(
      filterTasks(tasks, { dueDate: ['overdue', 'today'] }, NOW).map(t => t.id)
    ).toEqual(['late', 'today'])
    expect(
      filterTasks(tasks, { dueDate: ['none'] }, NOW).map(t => t.id)
    ).toEqual(['none'])
  })

  it('filters by sprint, with a sentinel for backlog tasks', () => {
    const tasks = [
      makeTask({ id: 'in-s1', sprintId: 's1' }),
      makeTask({ id: 'in-s2', sprintId: 's2' }),
      makeTask({ id: 'backlog', sprintId: null }),
    ]
    expect(filterTasks(tasks, { sprint: ['s1'] }, NOW).map(t => t.id)).toEqual([
      'in-s1',
    ])
    expect(
      filterTasks(tasks, { sprint: ['s1', 's2'] }, NOW).map(t => t.id)
    ).toEqual(['in-s1', 'in-s2'])
    expect(
      filterTasks(tasks, { sprint: [NO_SPRINT_VALUE] }, NOW).map(t => t.id)
    ).toEqual(['backlog'])
  })

  it('filters by milestone, with a sentinel for unbound tasks', () => {
    const tasks = [
      makeTask({ id: 'bound', ...inMilestone('m1') }),
      makeTask({ id: 'other', ...inMilestone('m2') }),
      makeTask({ id: 'unbound', milestoneId: null }),
    ]
    expect(
      filterTasks(tasks, { milestone: ['m1'] }, NOW).map(t => t.id)
    ).toEqual(['bound'])
    expect(
      filterTasks(tasks, { milestone: [NO_MILESTONE_VALUE] }, NOW).map(
        t => t.id
      )
    ).toEqual(['unbound'])
  })

  // LUM-714: "active" is no longer a status to match — it is the absence of
  // both stamps. The old PLANNED case has no successor: a milestone whose
  // tasks have not started is simply active, and is offered like any other.
  it('only considers in-flight (uncompleted, un-archived) milestones', () => {
    const tasks = [
      makeTask({ id: 'active', ...inMilestone('m_active') }),
      makeTask({ id: 'completed', ...inMilestone('m_done', 'completed') }),
      makeTask({ id: 'cancelled', ...inMilestone('m_cancel', 'archived') }),
      makeTask({
        id: 'archived',
        milestoneId: 'm_arch',
        milestone: {
          id: 'm_arch',
          name: 'Archived',
          completedAt: null,
          archivedAt: '2026-06-01T00:00:00.000Z',
        },
      }),
      makeTask({ id: 'unbound', milestoneId: null }),
    ]

    // Only the active, un-archived milestone is offered as an option
    // (ordering is covered by the dimensionValueCounts suite).
    expect(
      dimensionValueCounts(tasks, 'milestone', NOW)
        .map(o => o.value)
        .sort()
    ).toEqual([NO_MILESTONE_VALUE, 'm_active'].sort())

    expect(
      filterTasks(tasks, { milestone: ['m_active'] }, NOW).map(t => t.id)
    ).toEqual(['active'])
    // A non-active milestone matches neither its own id...
    expect(
      filterTasks(tasks, { milestone: ['m_done', 'm_cancel', 'm_arch'] }, NOW)
    ).toEqual([])
    // ...nor the "no milestone" bucket — it has one, just not an active one.
    expect(
      filterTasks(tasks, { milestone: [NO_MILESTONE_VALUE] }, NOW).map(
        t => t.id
      )
    ).toEqual(['unbound'])
  })

  it('treats an undefined sprint field as the no-sprint bucket', () => {
    // Payloads that predate the sprint select omit the field entirely.
    const tasks = [makeTask({ id: 'legacy' })]
    expect(
      filterTasks(tasks, { sprint: [NO_SPRINT_VALUE] }, NOW).map(t => t.id)
    ).toEqual(['legacy'])
  })

  it('cannot confirm a milestone whose relation is missing, so it matches nothing', () => {
    // A stale cached payload can carry milestoneId without the relation.
    const tasks = [makeTask({ id: 'stale', milestoneId: 'm1' })]
    expect(filterTasks(tasks, { milestone: ['m1'] }, NOW)).toEqual([])
    expect(
      filterTasks(tasks, { milestone: [NO_MILESTONE_VALUE] }, NOW)
    ).toEqual([])
  })

  it('combines all eight dimensions at once', () => {
    const tag = {
      id: 'tag_x',
      name: 'x',
      color: null,
      workspaceId: 'ws',
      createdAt: '2026-07-01T00:00:00.000Z',
    }
    const base = {
      status: 'IN_PROGRESS' as const,
      priority: 'HIGH' as const,
      assigneeActorId: 'actor_1',
      projectId: 'proj_a',
      sprintId: 'sprint_1',
      milestoneId: 'ms_1',
      milestone: {
        id: 'ms_1',
        name: 'Q3',
        completedAt: null,
        archivedAt: null,
      },
      tags: [tag],
      dueDate: dayOffset(1),
    }
    const tasks = [
      makeTask({ id: 'match', ...base }),
      makeTask({ id: 'off-by-one', ...base, dueDate: dayOffset(30) }),
    ]
    const result = filterTasks(
      tasks,
      {
        status: ['IN_PROGRESS'],
        priority: ['HIGH'],
        assignee: ['actor_1'],
        project: ['proj_a'],
        milestone: ['ms_1'],
        sprint: ['sprint_1'],
        tag: ['tag_x'],
        dueDate: ['next7'],
      },
      NOW
    )
    expect(result.map(t => t.id)).toEqual(['match'])
  })

  it('does not mutate the input array', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'TODO' }),
      makeTask({ id: 'b', status: 'DONE' }),
    ]
    filterTasks(tasks, { status: ['TODO'] }, NOW)
    expect(tasks.map(t => t.id)).toEqual(['a', 'b'])
  })
})

describe('countActiveFilters', () => {
  it('counts dimensions, not values', () => {
    expect(countActiveFilters({})).toBe(0)
    expect(countActiveFilters({ status: ['TODO', 'DONE'] })).toBe(1)
    expect(countActiveFilters({ status: ['TODO'], priority: ['HIGH'] })).toBe(2)
    expect(countActiveFilters({ status: [] })).toBe(0)
  })
})

describe('dimensionValueCounts', () => {
  it('returns statuses in canonical order with counts', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'DONE' }),
      makeTask({ id: 'b', status: 'TODO' }),
      makeTask({ id: 'c', status: 'TODO' }),
    ]
    expect(dimensionValueCounts(tasks, 'status', NOW)).toEqual([
      { value: 'TODO', count: 2 },
      { value: 'DONE', count: 1 },
    ])
  })

  it('orders count-ranked dimensions by frequency', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'proj_b' }),
      makeTask({ id: 'b', projectId: 'proj_a' }),
      makeTask({ id: 'c', projectId: 'proj_a' }),
    ]
    expect(
      dimensionValueCounts(tasks, 'project', NOW).map(o => o.value)
    ).toEqual(['proj_a', 'proj_b'])
  })
})

describe('dimension coverage', () => {
  it('offers exactly the eight board dimensions, container ones grouped after project', () => {
    expect([...FILTER_DIMENSIONS]).toEqual([
      'status',
      'priority',
      'assignee',
      'project',
      'milestone',
      'sprint',
      'tag',
      'dueDate',
    ])
  })
})

describe('narrowableDimensions', () => {
  it('drops contextual dimensions every task agrees on', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'TODO', projectId: 'proj_a' }),
      makeTask({ id: 'b', status: 'DONE', projectId: 'proj_a' }),
    ]
    const dims = narrowableDimensions(tasks, {}, NOW)
    expect(dims).toContain('status')
    expect(dims).not.toContain('project')
  })

  it('offers assignee even when every task shares one assignee', () => {
    // The shape that made the filter unusable: a whole sprint owned by one
    // person. "Who is this for" is a question the board must always answer.
    const oneOwner = [
      makeTask({ id: 'a', assigneeActorId: 'actor_1' }),
      makeTask({ id: 'b', assigneeActorId: 'actor_1' }),
    ]
    expect(narrowableDimensions(oneOwner, {}, NOW)).toContain('assignee')

    const allUnassigned = [
      makeTask({ id: 'a', assigneeActorId: null }),
      makeTask({ id: 'b', assigneeActorId: null }),
    ]
    expect(narrowableDimensions(allUnassigned, {}, NOW)).toContain('assignee')

    // One task is enough — the dimension is not gated on task count.
    expect(narrowableDimensions([makeTask({ id: 'a' })], {}, NOW)).toContain(
      'assignee'
    )
  })

  it('still hides single-valued contextual dimensions', () => {
    // The always-offered exception is assignee only — the self-adjusting rule
    // still governs project / sprint / milestone / tag.
    const uniform = [
      makeTask({
        id: 'a',
        projectId: 'proj_a',
        sprintId: 's1',
        ...inMilestone('m1'),
        tags: [
          {
            id: 'tag_1',
            name: 'bug',
            color: null,
            workspaceId: 'ws',
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
      makeTask({
        id: 'b',
        projectId: 'proj_a',
        sprintId: 's1',
        ...inMilestone('m1'),
        tags: [
          {
            id: 'tag_1',
            name: 'bug',
            color: null,
            workspaceId: 'ws',
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    ]
    const dims = narrowableDimensions(uniform, {}, NOW)
    expect(dims).not.toContain('project')
    expect(dims).not.toContain('sprint')
    expect(dims).not.toContain('milestone')
    expect(dims).not.toContain('tag')
  })

  it('offers no dimension at all for an empty task set', () => {
    // Nothing in scope means every dimension — assignee included — would open
    // an option list with zero entries. Offer none rather than an empty panel.
    expect(narrowableDimensions([], {}, NOW)).toEqual([])
  })

  it('hides sprint on a sprint board and milestone on a milestone board', () => {
    const oneSprint = [
      makeTask({ id: 'a', sprintId: 's1', ...inMilestone('m1') }),
      makeTask({ id: 'b', sprintId: 's1', ...inMilestone('m2') }),
    ]
    const dims = narrowableDimensions(oneSprint, {}, NOW)
    expect(dims).not.toContain('sprint')
    expect(dims).toContain('milestone')

    const oneMilestone = [
      makeTask({ id: 'a', sprintId: 's1', ...inMilestone('m1') }),
      makeTask({ id: 'b', sprintId: 's2', ...inMilestone('m1') }),
    ]
    const dims2 = narrowableDimensions(oneMilestone, {}, NOW)
    expect(dims2).toContain('sprint')
    expect(dims2).not.toContain('milestone')
  })

  it('keeps a dimension that is already being filtered on', () => {
    const tasks = [makeTask({ id: 'a', projectId: 'proj_a' })]
    expect(narrowableDimensions(tasks, { project: ['proj_a'] }, NOW)).toContain(
      'project'
    )
  })

  it('never returns a dimension outside the known set', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b', status: 'DONE' })]
    for (const dim of narrowableDimensions(tasks, {}, NOW)) {
      expect(FILTER_DIMENSIONS).toContain(dim)
    }
  })
})

describe('normalizeFilters', () => {
  it('keeps known dimensions and dedupes values', () => {
    expect(
      normalizeFilters({ status: ['TODO', 'TODO', 'DONE'], priority: ['HIGH'] })
    ).toEqual({ status: ['TODO', 'DONE'], priority: ['HIGH'] })
  })

  it('drops unknown keys, non-arrays, non-strings and empty selections', () => {
    expect(
      normalizeFilters({
        status: ['TODO'],
        bogus: ['x'],
        priority: 'HIGH',
        assignee: [1, null],
        project: [],
      })
    ).toEqual({ status: ['TODO'] })
  })

  it('returns an empty selection for non-objects', () => {
    expect(normalizeFilters(null)).toEqual({})
    expect(normalizeFilters('nope')).toEqual({})
  })
})

describe('toggleFilterValue / clearFilterDimension', () => {
  it('adds, removes, and drops the key when the dimension empties', () => {
    const one = toggleFilterValue({}, 'status', 'TODO')
    expect(one).toEqual({ status: ['TODO'] })
    const two = toggleFilterValue(one, 'status', 'DONE')
    expect(two).toEqual({ status: ['TODO', 'DONE'] })
    expect(toggleFilterValue(two, 'status', 'TODO')).toEqual({
      status: ['DONE'],
    })
    expect(toggleFilterValue(one, 'status', 'TODO')).toEqual({})
  })

  it('does not mutate the input selection', () => {
    const filters = { status: ['TODO'] }
    toggleFilterValue(filters, 'status', 'DONE')
    clearFilterDimension(filters, 'status')
    expect(filters).toEqual({ status: ['TODO'] })
  })

  it('clearFilterDimension removes only that dimension', () => {
    expect(
      clearFilterDimension({ status: ['TODO'], priority: ['HIGH'] }, 'status')
    ).toEqual({ priority: ['HIGH'] })
  })
})
