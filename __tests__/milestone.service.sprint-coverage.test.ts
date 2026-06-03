jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn(), sprintCoverageCounts: jest.fn() },
}))
jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: { findByIds: jest.fn() },
}))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: jest.fn() },
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { projectService } from '@/lib/services/project.service'

const findById = milestoneRepository.findById as jest.Mock
const counts = milestoneRepository.sprintCoverageCounts as jest.Mock
const findByIds = sprintRepository.findByIds as jest.Mock
const getProject = projectService.getProject as jest.Mock

beforeEach(() => {
  findById.mockReset()
  counts.mockReset()
  findByIds.mockReset()
  getProject.mockReset()
})

describe('milestoneService.getSprintCoverage', () => {
  it('aggregates coverage scoped by the project team', async () => {
    findById.mockResolvedValue({ id: 'm-1', projectId: 'p-1' })
    getProject.mockResolvedValue({ id: 'p-1', teamId: 'team-1' })
    counts.mockResolvedValue([
      { sprintId: 's3', status: 'DONE', count: 2 },
      { sprintId: 's3', status: 'TODO', count: 1 },
      { sprintId: null, status: 'TODO', count: 4 },
    ])
    findByIds.mockResolvedValue([
      { id: 's3', number: 3, name: 'Sprint 3', status: 'ACTIVE' },
    ])

    const result = await milestoneService.getSprintCoverage('m-1', 'mem-1')

    expect(getProject).toHaveBeenCalledWith('p-1', 'mem-1')
    expect(findByIds).toHaveBeenCalledWith(['s3'], 'team-1')
    expect(result).toEqual({
      sprints: [
        {
          sprintId: 's3',
          number: 3,
          name: 'Sprint 3',
          status: 'ACTIVE',
          taskCount: 3,
          doneCount: 2,
        },
      ],
      unsprinted: 4,
    })
  })

  it('throws 404 when the milestone is missing', async () => {
    findById.mockResolvedValue(null)
    await expect(
      milestoneService.getSprintCoverage('nope', 'mem-1')
    ).rejects.toMatchObject({
      status: 404,
    })
  })

  it('skips the sprint fetch when no tasks are sprinted', async () => {
    findById.mockResolvedValue({ id: 'm-1', projectId: 'p-1' })
    getProject.mockResolvedValue({ id: 'p-1', teamId: 'team-1' })
    counts.mockResolvedValue([{ sprintId: null, status: 'TODO', count: 2 }])
    findByIds.mockResolvedValue([])

    const result = await milestoneService.getSprintCoverage('m-1', 'mem-1')
    expect(findByIds).toHaveBeenCalledWith([], 'team-1')
    expect(result).toEqual({ sprints: [], unsprinted: 2 })
  })
})
