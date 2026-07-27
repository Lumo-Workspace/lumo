/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findByProject: jest.fn(),
    findSlugsByProject: jest.fn(),
    getMaxSortOrder: jest.fn(),
    create: jest.fn(),
    reorder: jest.fn(),
  },
}))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {},
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { projectService } from '@/lib/services/project.service'

const mockFindByProject = milestoneRepository.findByProject as jest.Mock
const mockGetMax = milestoneRepository.getMaxSortOrder as jest.Mock
const mockSlugs = milestoneRepository.findSlugsByProject as jest.Mock
const mockCreate = milestoneRepository.create as jest.Mock
const mockReorder = milestoneRepository.reorder as jest.Mock
const mockGetProject = projectService.getProject as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProject.mockResolvedValue({ id: 'p-1' })
})

function expectStatus(p: Promise<unknown>, status: number) {
  return p.then(
    () => {
      throw new Error('expected rejection')
    },
    (e: unknown) => {
      expect((e as { status?: number }).status).toBe(status)
    }
  )
}

describe('milestoneService.reorderMilestones', () => {
  beforeEach(() => {
    mockFindByProject.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  })

  it('rejects a duplicate id with 400', async () => {
    await expectStatus(
      milestoneService.reorderMilestones('p-1', 'mem-1', ['a', 'a', 'b']),
      400
    )
    expect(mockReorder).not.toHaveBeenCalled()
  })

  it('rejects an unknown id with 400', async () => {
    await expectStatus(
      milestoneService.reorderMilestones('p-1', 'mem-1', ['a', 'b', 'x']),
      400
    )
    expect(mockReorder).not.toHaveBeenCalled()
  })

  it('rejects an incomplete set with 400', async () => {
    await expectStatus(
      milestoneService.reorderMilestones('p-1', 'mem-1', ['a', 'b']),
      400
    )
    expect(mockReorder).not.toHaveBeenCalled()
  })

  it('reorders when the set is complete and valid', async () => {
    await milestoneService.reorderMilestones('p-1', 'mem-1', ['c', 'a', 'b'])
    expect(mockGetProject).toHaveBeenCalledWith('p-1', 'mem-1')
    expect(mockReorder).toHaveBeenCalledWith('p-1', ['c', 'a', 'b'])
  })
})

describe('milestoneService.createMilestone', () => {
  it('appends to the bottom (max + 1) when milestones exist', async () => {
    mockSlugs.mockResolvedValue([])
    mockGetMax.mockResolvedValue(2)
    mockCreate.mockResolvedValue({ id: 'new' })
    await milestoneService.createMilestone('p-1', 'mem-1', { name: 'New' })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 3 })
    )
  })

  it('uses sortOrder 0 for the first milestone in a project', async () => {
    mockSlugs.mockResolvedValue([])
    mockGetMax.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 'new' })
    await milestoneService.createMilestone('p-1', 'mem-1', { name: 'First' })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 0 })
    )
  })
})
