import {
  flattenTaskForListing,
  liftTaskTags,
  shapeSprintTask,
} from '@/lib/api/task-shape'

const TAG_A = {
  id: 'tag_a',
  name: 'bug',
  color: '#ff0000',
  workspaceId: 'ws_1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}
const TAG_B = {
  id: 'tag_b',
  name: 'ui',
  color: null,
  workspaceId: 'ws_1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

/** A row shaped like the list includes select it (TASK_LIST/ASSIGNED_INCLUDE). */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_1',
    title: 'Fix the thing',
    status: 'TODO',
    priority: 'HIGH',
    projectId: 'proj_1',
    team: { identifier: 'LUM' },
    project: {
      id: 'proj_1',
      name: 'Alpha',
      owner: { actor: { id: 'actor_owner' } },
    },
    parent: null,
    children: [{ id: 'child_done' }],
    _count: { children: 2 },
    taskTags: [{ tag: TAG_A }, { tag: TAG_B }],
    sprintId: 'sprint_1',
    sprint: { id: 'sprint_1', status: 'ACTIVE', name: 'Sprint 12' },
    milestoneId: 'ms_1',
    milestone: { id: 'ms_1', status: 'ACTIVE', name: 'Q3 Launch' },
    ...overrides,
  }
}

describe('liftTaskTags', () => {
  it('lifts the join rows into a flat tags array', () => {
    const shaped = liftTaskTags(row())
    expect(shaped).toHaveProperty('tags', [TAG_A, TAG_B])
  })

  it('drops the taskTags join key so it never reaches the client', () => {
    const shaped = liftTaskTags(row())
    expect(shaped).not.toHaveProperty('taskTags')
    expect(JSON.stringify(shaped)).not.toContain('taskTags')
  })

  it('yields an empty tags array for a task with no labels', () => {
    expect(liftTaskTags(row({ taskTags: [] }))).toHaveProperty('tags', [])
  })

  it('adds no tags key when the row was selected without taskTags', () => {
    const bare = row()
    delete (bare as Record<string, unknown>).taskTags
    const shaped = liftTaskTags(bare)
    expect(shaped).not.toHaveProperty('tags')
    expect(shaped).not.toHaveProperty('taskTags')
  })

  it('leaves the other fields untouched', () => {
    const shaped = liftTaskTags(row()) as Record<string, unknown>
    expect(shaped.id).toBe('task_1')
    expect(shaped.title).toBe('Fix the thing')
    expect(shaped.status).toBe('TODO')
  })
})

describe('sprint / milestone pass-through', () => {
  // Board filtering labels these by name, so the relations must survive the
  // shapers untouched — they are plain relations, not a lifted join.
  it('keeps sprint and milestone on the assigned/milestone listing shape', () => {
    const shaped = flattenTaskForListing(row())
    expect(shaped).toMatchObject({
      sprintId: 'sprint_1',
      sprint: { id: 'sprint_1', name: 'Sprint 12' },
      milestoneId: 'ms_1',
      milestone: { id: 'ms_1', name: 'Q3 Launch' },
    })
  })

  it('keeps sprint and milestone on the sprint listing shape', () => {
    const shaped = shapeSprintTask(row())
    expect(shaped).toMatchObject({
      sprintId: 'sprint_1',
      sprint: { id: 'sprint_1', name: 'Sprint 12' },
      milestoneId: 'ms_1',
      milestone: { id: 'ms_1', name: 'Q3 Launch' },
    })
  })

  it('survives a task with neither a sprint nor a milestone', () => {
    const shaped = flattenTaskForListing(
      row({ sprintId: null, sprint: null, milestoneId: null, milestone: null })
    )
    expect(shaped).toMatchObject({ sprint: null, milestone: null })
  })
})

describe('flattenTaskForListing', () => {
  it('exposes tags and hides the join rows', () => {
    const shaped = flattenTaskForListing(row())
    expect(shaped).toHaveProperty('tags', [TAG_A, TAG_B])
    expect(shaped).not.toHaveProperty('taskTags')
  })

  it('still flattens team / project / parent / children', () => {
    const shaped = flattenTaskForListing(
      row({
        parent: {
          id: 'p1',
          title: 'Parent',
          number: 7,
          team: { identifier: 'LUM' },
        },
      })
    )
    expect(shaped.teamIdentifier).toBe('LUM')
    expect(shaped.project).toEqual({
      id: 'proj_1',
      name: 'Alpha',
      ownerActorId: 'actor_owner',
    })
    expect(shaped.parent).toEqual({
      id: 'p1',
      title: 'Parent',
      number: 7,
      teamIdentifier: 'LUM',
    })
    expect(shaped.childrenDoneCount).toBe(1)
  })
})

describe('shapeSprintTask', () => {
  it('exposes tags and hides the join rows', () => {
    const shaped = shapeSprintTask(row())
    expect(shaped).toHaveProperty('tags', [TAG_A, TAG_B])
    expect(shaped).not.toHaveProperty('taskTags')
  })

  it('keeps its sprint-specific contract (null viewOrder, tolerant team)', () => {
    const shaped = shapeSprintTask(row({ team: null }))
    expect(shaped.viewOrder).toBeNull()
    expect(shaped.teamIdentifier).toBe('')
  })
})
