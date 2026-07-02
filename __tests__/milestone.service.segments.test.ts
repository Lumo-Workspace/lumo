/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    segmentationRows: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: { findByIds: jest.fn() },
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { sprintRepository } from '@/lib/repositories/sprint.repository'

const segmentationRows = milestoneRepository.segmentationRows as jest.Mock
const findByIds = sprintRepository.findByIds as jest.Mock

beforeEach(() => {
  segmentationRows.mockReset()
  findByIds.mockReset()
})

describe('milestoneService.getSegmentsForMilestone', () => {
  it('maps repository rows (ref = identifier-number, flattened tags) and resolves sprint metadata once per sprint', async () => {
    segmentationRows.mockResolvedValue([
      {
        id: 't1',
        number: 283,
        title: 'Bundle diet',
        status: 'DONE',
        priority: 'HIGH',
        sprintId: 's3',
        team: { identifier: 'LUM' },
        taskTags: [{ tag: { id: 'tag-a', name: 'perf' } }],
      },
      {
        id: 't2',
        number: 290,
        title: 'Board polish',
        status: 'TODO',
        priority: 'LOW',
        sprintId: 's3',
        team: { identifier: 'LUM' },
        taskTags: [],
      },
    ])
    findByIds.mockResolvedValue([
      { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
    ])

    const segments = await milestoneService.getSegmentsForMilestone(
      'm-1',
      'team-1'
    )

    expect(segmentationRows).toHaveBeenCalledWith('m-1')
    // Sprint ids are deduped before the metadata lookup.
    expect(findByIds).toHaveBeenCalledWith(['s3'], 'team-1')
    expect(segments.tasks).toEqual([
      { taskId: 't1', ref: 'LUM-283', title: 'Bundle diet', status: 'DONE' },
      { taskId: 't2', ref: 'LUM-290', title: 'Board polish', status: 'TODO' },
    ])
    expect(segments.sprint).toEqual([
      { key: 's3', label: 'Sprint 3', taskIds: ['t1', 't2'], doneCount: 1 },
    ])
    expect(segments.workstream).toEqual([
      { key: 'tag-a', label: 'perf', taskIds: ['t1'], doneCount: 1 },
      { key: 'NONE', label: null, taskIds: ['t2'], doneCount: 0 },
    ])
  })
})
