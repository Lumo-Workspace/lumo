const mockProjectGet = jest.fn()
const mockRepoFindById = jest.fn()
const mockRepoFindByProject = jest.fn()
const mockRepoFindByProjectAndSlug = jest.fn()
const mockRepoFindSlugsByProject = jest.fn()
const mockRepoCreate = jest.fn()
const mockRepoUpdate = jest.fn()
const mockRepoDelete = jest.fn()

jest.mock('@/lib/services/project.service', () => ({
  projectService: {
    getProject: (...a: any[]) => mockProjectGet(...a),
  },
}))

jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: any[]) => mockRepoFindById(...a),
    findByProject: (...a: any[]) => mockRepoFindByProject(...a),
    findByProjectAndSlug: (...a: any[]) => mockRepoFindByProjectAndSlug(...a),
    findSlugsByProject: (...a: any[]) => mockRepoFindSlugsByProject(...a),
    create: (...a: any[]) => mockRepoCreate(...a),
    update: (...a: any[]) => mockRepoUpdate(...a),
    delete: (...a: any[]) => mockRepoDelete(...a),
  },
}))

import { milestoneService } from '@/lib/services/milestone.service'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('milestoneService.listMilestones', () => {
  it('delegates permission check to projectService.getProject and returns the list', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindByProject.mockResolvedValue([{ id: 'm1' }])
    const result = await milestoneService.listMilestones('p1', 'mem1')
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(mockRepoFindByProject).toHaveBeenCalledWith('p1')
    expect(result).toEqual([{ id: 'm1' }])
  })

  it('propagates the project not-found error', async () => {
    mockProjectGet.mockRejectedValue(
      Object.assign(new Error('Project not found'), { status: 404 })
    )
    await expect(
      milestoneService.listMilestones('p1', 'mem1')
    ).rejects.toMatchObject({
      message: 'Project not found',
      status: 404,
    })
  })
})

describe('milestoneService.getMilestone', () => {
  it('throws 404 when the milestone does not exist', async () => {
    mockRepoFindById.mockResolvedValue(null)
    await expect(
      milestoneService.getMilestone('m-missing', 'mem1')
    ).rejects.toMatchObject({
      message: 'Milestone not found',
      status: 404,
    })
    expect(mockProjectGet).not.toHaveBeenCalled()
  })

  it('delegates the project permission check after finding the milestone', async () => {
    mockRepoFindById.mockResolvedValue({ id: 'm1', projectId: 'p1' })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    const result = await milestoneService.getMilestone('m1', 'mem1')
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(result).toEqual({ id: 'm1', projectId: 'p1' })
  })
})

describe('milestoneService.createMilestone', () => {
  it('writes through to repository after permission check and generates slug', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindSlugsByProject.mockResolvedValue([])
    mockRepoCreate.mockResolvedValue({ id: 'm1' })
    await milestoneService.createMilestone('p1', 'mem1', {
      name: 'v1.0',
      description: 'first release',
    })
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(mockRepoCreate).toHaveBeenCalledWith({
      projectId: 'p1',
      name: 'v1.0',
      slug: 'v1-0',
      description: 'first release',
    })
  })

  it('appends a numeric suffix when the slug already exists in the project', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindSlugsByProject.mockResolvedValue(['q3-launch', 'q3-launch-2'])
    mockRepoCreate.mockResolvedValue({ id: 'm-new' })
    await milestoneService.createMilestone('p1', 'mem1', { name: 'Q3 Launch' })
    expect(mockRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'q3-launch-3' })
    )
  })

  it('falls back to the "milestone" base when the name has no ascii letters', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindSlugsByProject.mockResolvedValue([])
    mockRepoCreate.mockResolvedValue({ id: 'm-cn' })
    await milestoneService.createMilestone('p1', 'mem1', { name: '里程碑' })
    expect(mockRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'milestone' })
    )
  })
})

describe('milestoneService.getMilestoneBySlug', () => {
  it('throws 404 when slug not found in project', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindByProjectAndSlug.mockResolvedValue(null)
    await expect(
      milestoneService.getMilestoneBySlug('p1', 'q3-launch', 'mem1')
    ).rejects.toMatchObject({ message: 'Milestone not found', status: 404 })
  })

  it('returns the milestone when slug resolves', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindByProjectAndSlug.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      slug: 'q3-launch',
    })
    const result = await milestoneService.getMilestoneBySlug(
      'p1',
      'q3-launch',
      'mem1'
    )
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(mockRepoFindByProjectAndSlug).toHaveBeenCalledWith('p1', 'q3-launch')
    expect(result).toEqual({ id: 'm1', projectId: 'p1', slug: 'q3-launch' })
  })
})

describe('milestoneService.updateMilestone status transitions', () => {
  beforeEach(() => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      status: 'PLANNED',
      completedAt: null,
    })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
  })

  it('writes completedAt when transitioning to COMPLETED', async () => {
    mockRepoUpdate.mockResolvedValue({ id: 'm1' })
    await milestoneService.updateMilestone('m1', 'mem1', {
      status: 'COMPLETED',
    })
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        status: 'COMPLETED',
        completedAt: expect.any(Date),
      })
    )
  })

  it('clears completedAt when leaving COMPLETED', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      status: 'COMPLETED',
      completedAt: new Date(),
    })
    mockRepoUpdate.mockResolvedValue({ id: 'm1' })
    await milestoneService.updateMilestone('m1', 'mem1', { status: 'ACTIVE' })
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: 'ACTIVE', completedAt: null })
    )
  })

  it('does not touch completedAt when transitioning to CANCELLED', async () => {
    mockRepoUpdate.mockResolvedValue({ id: 'm1' })
    await milestoneService.updateMilestone('m1', 'mem1', {
      status: 'CANCELLED',
    })
    const [, payload] = mockRepoUpdate.mock.calls[0]
    expect(payload.status).toBe('CANCELLED')
    expect(payload).not.toHaveProperty('completedAt')
  })
})

describe('milestoneService.deleteMilestone', () => {
  it('throws 404 when not found', async () => {
    mockRepoFindById.mockResolvedValue(null)
    await expect(
      milestoneService.deleteMilestone('m-missing', 'mem1')
    ).rejects.toMatchObject({
      message: 'Milestone not found',
      status: 404,
    })
  })

  it('deletes after permission check', async () => {
    mockRepoFindById.mockResolvedValue({ id: 'm1', projectId: 'p1' })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoDelete.mockResolvedValue({ id: 'm1' })
    await milestoneService.deleteMilestone('m1', 'mem1')
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(mockRepoDelete).toHaveBeenCalledWith('m1')
  })
})
