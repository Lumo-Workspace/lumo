/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findByMilestone: jest.fn() },
}))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: jest.fn() },
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { projectService } from '@/lib/services/project.service'

const findById = milestoneRepository.findById as jest.Mock
const findByMilestone = taskRepository.findByMilestone as jest.Mock
const getProject = projectService.getProject as jest.Mock

beforeEach(() => {
  findById.mockReset()
  findByMilestone.mockReset()
  getProject.mockReset()
})

describe('milestoneService.listTasks', () => {
  it('throws 404 when milestone not found', async () => {
    findById.mockResolvedValue(null)
    await expect(
      milestoneService.listTasks('m-1', 'mem-1', {})
    ).rejects.toMatchObject({ status: 404 })
  })

  it('checks project membership and returns tasks', async () => {
    findById.mockResolvedValue({ id: 'm-1', projectId: 'p-1' })
    getProject.mockResolvedValue({ id: 'p-1' })
    findByMilestone.mockResolvedValue([{ id: 't-1' }])
    const tasks = await milestoneService.listTasks('m-1', 'mem-1', {})
    expect(getProject).toHaveBeenCalledWith('p-1', 'mem-1')
    expect(findByMilestone).toHaveBeenCalledWith({ milestoneId: 'm-1' })
    expect(tasks).toEqual([{ id: 't-1' }])
  })

  it('passes assigneeActorId through when provided', async () => {
    findById.mockResolvedValue({ id: 'm-1', projectId: 'p-1' })
    getProject.mockResolvedValue({ id: 'p-1' })
    findByMilestone.mockResolvedValue([])
    await milestoneService.listTasks('m-1', 'mem-1', {
      assigneeActorId: 'actor-1',
    })
    expect(findByMilestone).toHaveBeenCalledWith({
      milestoneId: 'm-1',
      assigneeActorId: 'actor-1',
    })
  })
})
