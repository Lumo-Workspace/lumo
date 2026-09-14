const mockProjectGet = jest.fn()
const mockRepoFindById = jest.fn()
const mockRepoFindByProject = jest.fn()
const mockRepoFindByProjectAndSlug = jest.fn()
const mockRepoFindSlugsByProject = jest.fn()
const mockRepoGetMaxSortOrder = jest.fn()
const mockRepoCreate = jest.fn()
const mockRepoUpdate = jest.fn()
const mockRepoDelete = jest.fn()
const mockRepoArchive = jest.fn()
const mockRepoUnarchive = jest.fn()

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
    getMaxSortOrder: (...a: any[]) => mockRepoGetMaxSortOrder(...a),
    create: (...a: any[]) => mockRepoCreate(...a),
    update: (...a: any[]) => mockRepoUpdate(...a),
    delete: (...a: any[]) => mockRepoDelete(...a),
    archive: (...a: any[]) => mockRepoArchive(...a),
    unarchive: (...a: any[]) => mockRepoUnarchive(...a),
  },
}))

// LUM-643: updateMilestone consults the exit-criteria close gate on a
// COMPLETED transition — default to an empty contract (gate open).
const mockListUnresolved = jest.fn().mockResolvedValue([])
jest.mock('@/lib/repositories/milestone-exit-criterion.repository', () => ({
  milestoneExitCriterionRepository: {
    listUnresolved: (...a: any[]) => mockListUnresolved(...a),
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
    expect(mockRepoFindByProject).toHaveBeenCalledWith(
      'p1',
      'active',
      undefined
    )
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
  // Default: empty project → new milestone appends at sortOrder 0.
  beforeEach(() => {
    mockRepoGetMaxSortOrder.mockResolvedValue(null)
  })

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
      sortOrder: 0,
    })
  })

  it('appends to the bottom (max sortOrder + 1) when the project has milestones', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindSlugsByProject.mockResolvedValue([])
    mockRepoGetMaxSortOrder.mockResolvedValue(5)
    mockRepoCreate.mockResolvedValue({ id: 'm-bottom' })
    await milestoneService.createMilestone('p1', 'mem1', { name: 'Next' })
    expect(mockRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 6 })
    )
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
      completedAt: null,
    })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
  })

  // LUM-714: updateMilestone is metadata-only. Completion is derived by the
  // rollup, so no caller-supplied field may ever move `completedAt` here —
  // that is what kept the old status enum load-bearing.
  it('never writes completedAt — completion is derived, not patched', async () => {
    mockRepoUpdate.mockResolvedValue({ id: 'm1' })
    await milestoneService.updateMilestone('m1', 'mem1', {
      name: 'Renamed',
      targetDate: new Date('2026-09-01'),
    })
    const [, payload] = mockRepoUpdate.mock.calls[0]
    expect(payload).not.toHaveProperty('completedAt')
    expect(payload).not.toHaveProperty('status')
    expect(payload.name).toBe('Renamed')
  })

  it('refuses to edit an archived milestone', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      completedAt: null,
      archivedAt: new Date('2026-06-01'),
    })
    await expect(
      milestoneService.updateMilestone('m1', 'mem1', { name: 'Renamed' })
    ).rejects.toMatchObject({ status: 409 })
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

describe('milestoneService.listMilestones filter', () => {
  it('passes the filter through to the repository', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindByProject.mockResolvedValue([])
    await milestoneService.listMilestones('p1', 'mem1', 'all')
    expect(mockRepoFindByProject).toHaveBeenCalledWith('p1', 'all', undefined)
  })

  it('forwards the search term to the repository', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindByProject.mockResolvedValue([])
    await milestoneService.listMilestones('p1', 'mem1', 'all', 'launch')
    expect(mockRepoFindByProject).toHaveBeenCalledWith('p1', 'all', 'launch')
  })
})

describe('milestoneService.archiveMilestone', () => {
  it('throws 404 when not found', async () => {
    mockRepoFindById.mockResolvedValue(null)
    await expect(
      milestoneService.archiveMilestone('m-x', 'mem1')
    ).rejects.toMatchObject({ message: 'Milestone not found', status: 404 })
  })

  it('archives after permission check when not already archived', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      archivedAt: null,
    })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoArchive.mockResolvedValue({ id: 'm1', archivedAt: new Date() })
    await milestoneService.archiveMilestone('m1', 'mem1')
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(mockRepoArchive).toHaveBeenCalledWith('m1', expect.any(Date))
  })

  it('is idempotent: returns existing without re-archiving', async () => {
    const existing = { id: 'm1', projectId: 'p1', archivedAt: new Date() }
    mockRepoFindById.mockResolvedValue(existing)
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    const result = await milestoneService.archiveMilestone('m1', 'mem1')
    expect(mockRepoArchive).not.toHaveBeenCalled()
    expect(result).toBe(existing)
  })
})

describe('milestoneService.unarchiveMilestone', () => {
  it('unarchives when currently archived', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      archivedAt: new Date(),
    })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoUnarchive.mockResolvedValue({ id: 'm1', archivedAt: null })
    await milestoneService.unarchiveMilestone('m1', 'mem1')
    expect(mockRepoUnarchive).toHaveBeenCalledWith('m1')
  })

  it('is idempotent: returns existing when not archived', async () => {
    const existing = { id: 'm1', projectId: 'p1', archivedAt: null }
    mockRepoFindById.mockResolvedValue(existing)
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    const result = await milestoneService.unarchiveMilestone('m1', 'mem1')
    expect(mockRepoUnarchive).not.toHaveBeenCalled()
    expect(result).toBe(existing)
  })
})

describe('milestoneService.updateMilestone archive freeze', () => {
  it('rejects updates on an archived milestone with 409', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      status: 'ACTIVE',
      completedAt: null,
      archivedAt: new Date(),
    })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    await expect(
      milestoneService.updateMilestone('m1', 'mem1', { name: 'x' })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockRepoUpdate).not.toHaveBeenCalled()
  })
})
