jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findByWorkspace: jest.fn() },
}))
jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: { findByIds: jest.fn() },
}))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: jest.fn() },
}))

import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneService } from '@/lib/services/milestone.service'
const mock = milestoneRepository.findByWorkspace as jest.Mock
beforeEach(() => jest.clearAllMocks())

describe('milestoneService.listByWorkspace', () => {
  it('delegates to the repository with workspaceId + filter', async () => {
    mock.mockResolvedValueOnce([{ id: 'm1' }])
    const res = await milestoneService.listByWorkspace('w1', 'active')
    expect(mock).toHaveBeenCalledWith('w1', 'active')
    expect(res).toEqual([{ id: 'm1' }])
  })
})
