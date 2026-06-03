import {
  computeSprintCoverage,
  type SprintCoverageCountRow,
  type SprintMeta,
} from '@/lib/summaries/sprint-coverage'

const sprints: SprintMeta[] = [
  { id: 's2', number: 2, name: 'Sprint 2', status: 'CLOSED' },
  { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
]

describe('computeSprintCoverage', () => {
  it('groups counts per sprint with done/total and sorts by number asc', () => {
    const counts: SprintCoverageCountRow[] = [
      { sprintId: 's3', status: 'DONE', count: 4 },
      { sprintId: 's3', status: 'TODO', count: 2 },
      { sprintId: 's2', status: 'DONE', count: 1 },
      { sprintId: 's2', status: 'IN_REVIEW', count: 1 },
    ]
    const result = computeSprintCoverage(counts, sprints)
    expect(result.sprints).toEqual([
      {
        sprintId: 's2',
        number: 2,
        name: 'Sprint 2',
        status: 'CLOSED',
        taskCount: 2,
        doneCount: 1,
      },
      {
        sprintId: 's3',
        number: 3,
        name: 'Sprint 3',
        status: 'ACTIVE',
        taskCount: 6,
        doneCount: 4,
      },
    ])
    expect(result.unsprinted).toBe(0)
  })

  it('buckets sprintId === null into unsprinted', () => {
    const counts: SprintCoverageCountRow[] = [
      { sprintId: null, status: 'TODO', count: 3 },
      { sprintId: null, status: 'DONE', count: 1 },
      { sprintId: 's3', status: 'TODO', count: 1 },
    ]
    const result = computeSprintCoverage(counts, sprints)
    expect(result.unsprinted).toBe(4)
    expect(result.sprints).toHaveLength(1)
    expect(result.sprints[0]).toMatchObject({
      sprintId: 's3',
      taskCount: 1,
      doneCount: 0,
    })
  })

  it('drops sprints with zero tasks and ignores counts for unknown sprints', () => {
    const counts: SprintCoverageCountRow[] = [
      { sprintId: 's3', status: 'TODO', count: 1 },
      { sprintId: 'gone', status: 'TODO', count: 9 },
    ]
    const result = computeSprintCoverage(counts, sprints)
    expect(result.sprints.map(s => s.sprintId)).toEqual(['s3'])
  })

  it('returns empty coverage when there are no tasks', () => {
    expect(computeSprintCoverage([], sprints)).toEqual({
      sprints: [],
      unsprinted: 0,
    })
  })
})
