import {
  computeMilestoneSegments,
  SEGMENT_NONE_KEY,
  type MilestoneSegmentTaskInput,
} from '@/lib/summaries/milestone-segments'
import type { SprintMeta } from '@/lib/summaries/sprint-coverage'

function task(
  over: Partial<MilestoneSegmentTaskInput>
): MilestoneSegmentTaskInput {
  return {
    id: 't1',
    ref: 'LUM-1',
    title: 'A task',
    status: 'TODO',
    priority: 'MEDIUM',
    sprintId: null,
    tags: [],
    ...over,
  }
}

const sprints: SprintMeta[] = [
  { id: 's2', number: 2, name: 'Sprint 2', status: 'CLOSED' },
  { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
]

describe('computeMilestoneSegments', () => {
  it('groups by sprint in sprint-number order with an explicit unsprinted NONE bucket last', () => {
    const result = computeMilestoneSegments(
      [
        task({ id: 't1', ref: 'LUM-1', sprintId: 's3', status: 'DONE' }),
        task({ id: 't2', ref: 'LUM-2', sprintId: 's2' }),
        task({ id: 't3', ref: 'LUM-3', sprintId: null }),
      ],
      sprints
    )
    expect(result.sprint).toEqual([
      { key: 's2', label: 'Sprint 2', taskIds: ['t2'], doneCount: 0 },
      { key: 's3', label: 'Sprint 3', taskIds: ['t1'], doneCount: 1 },
      { key: SEGMENT_NONE_KEY, label: null, taskIds: ['t3'], doneCount: 0 },
    ])
  })

  it('groups by priority in URGENT→LOW order, dropping empty priorities', () => {
    const result = computeMilestoneSegments(
      [
        task({ id: 't1', priority: 'LOW', status: 'DONE' }),
        task({ id: 't2', priority: 'URGENT' }),
        task({ id: 't3', priority: 'LOW' }),
      ],
      []
    )
    expect(result.priority).toEqual([
      { key: 'URGENT', label: null, taskIds: ['t2'], doneCount: 0 },
      { key: 'LOW', label: null, taskIds: ['t1', 't3'], doneCount: 1 },
    ])
  })

  it('puts a multi-tag task under each of its tags and untagged tasks in an explicit NONE bucket', () => {
    const result = computeMilestoneSegments(
      [
        task({
          id: 't1',
          status: 'DONE',
          tags: [
            { id: 'tag-b', name: 'backend' },
            { id: 'tag-a', name: 'api' },
          ],
        }),
        task({ id: 't2', tags: [{ id: 'tag-a', name: 'api' }] }),
        task({ id: 't3', tags: [] }),
      ],
      []
    )
    expect(result.workstream).toEqual([
      { key: 'tag-a', label: 'api', taskIds: ['t1', 't2'], doneCount: 1 },
      { key: 'tag-b', label: 'backend', taskIds: ['t1'], doneCount: 1 },
      { key: SEGMENT_NONE_KEY, label: null, taskIds: ['t3'], doneCount: 0 },
    ])
  })

  it('per-segment done counts match member statuses across dimensions', () => {
    const result = computeMilestoneSegments(
      [
        task({ id: 't1', sprintId: 's3', priority: 'HIGH', status: 'DONE' }),
        task({ id: 't2', sprintId: 's3', priority: 'HIGH', status: 'DONE' }),
        task({
          id: 't3',
          sprintId: 's3',
          priority: 'HIGH',
          status: 'IN_REVIEW',
        }),
      ],
      sprints
    )
    expect(result.sprint).toEqual([
      {
        key: 's3',
        label: 'Sprint 3',
        taskIds: ['t1', 't2', 't3'],
        doneCount: 2,
      },
    ])
    expect(result.priority).toEqual([
      { key: 'HIGH', label: null, taskIds: ['t1', 't2', 't3'], doneCount: 2 },
    ])
  })

  it('keeps a sprint segment whose meta is unresolved (label null), never dropping its tasks', () => {
    const result = computeMilestoneSegments(
      [task({ id: 't1', sprintId: 's-gone' })],
      []
    )
    expect(result.sprint).toEqual([
      { key: 's-gone', label: null, taskIds: ['t1'], doneCount: 0 },
    ])
  })

  it('returns the shared task rows the drill-down renders, and empty dimensions for no tasks', () => {
    const withTasks = computeMilestoneSegments(
      [
        task({
          id: 't1',
          ref: 'LUM-283',
          title: 'Bundle diet',
          status: 'DONE',
        }),
      ],
      []
    )
    expect(withTasks.tasks).toEqual([
      { taskId: 't1', ref: 'LUM-283', title: 'Bundle diet', status: 'DONE' },
    ])

    const empty = computeMilestoneSegments([], [])
    expect(empty).toEqual({
      tasks: [],
      sprint: [],
      priority: [],
      workstream: [],
    })
  })
})
