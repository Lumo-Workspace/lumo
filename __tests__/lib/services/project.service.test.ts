/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: {
      findUnique: jest.fn(),
    },
  },
}))

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByWorkspace: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))

jest.mock('@/lib/team', () => ({
  getDefaultTeam: jest.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { projectRepository } from '@/lib/repositories/project.repository'
import { getDefaultTeam } from '@/lib/team'
import { projectService } from '@/lib/services/project.service'

const mockFindByWorkspace = projectRepository.findByWorkspace as jest.Mock
const mockFindById = projectRepository.findById as jest.Mock
const mockCreate = projectRepository.create as jest.Mock
const mockUpdate = projectRepository.update as jest.Mock
const mockDelete = projectRepository.delete as jest.Mock
const mockGetDefaultTeam = getDefaultTeam as jest.Mock
const mockMemberFindUnique = prisma.workspaceMember.findUnique as jest.Mock

beforeEach(() => jest.clearAllMocks())

// ── listProjects ───────────────────────────────────────────────────────────

describe('listProjects', () => {
  it('returns projects with inProgressCount', async () => {
    mockFindByWorkspace.mockResolvedValue([
      {
        id: 'p1',
        name: 'Project A',
        _count: { tasks: 5 },
        tasks: [{ id: 't1' }, { id: 't2' }],
        repositories: [],
      },
      {
        id: 'p2',
        name: 'Project B',
        _count: { tasks: 3 },
        tasks: [],
        repositories: [],
      },
    ])

    const result = await projectService.listProjects('ws-1', 'member-1')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(
      expect.objectContaining({ id: 'p1', inProgressCount: 2 })
    )
    expect(result[1]).toEqual(
      expect.objectContaining({ id: 'p2', inProgressCount: 0 })
    )
    // tasks array should be removed
    expect(result[0]).not.toHaveProperty('tasks')
  })
})

// ── getProject ─────────────────────────────────────────────────────────────

describe('getProject', () => {
  it('returns project when found', async () => {
    const project = {
      id: 'p1',
      name: 'Test',
      isIdea: false,
      createdByMemberId: 'member-1',
      _count: { tasks: 3, views: 1 },
    }
    mockFindById.mockResolvedValue(project)

    const result = await projectService.getProject('p1', 'member-1')

    expect(result).toEqual(project)
  })

  it('throws 404 for non-existent project', async () => {
    mockFindById.mockResolvedValue(null)

    await expect(
      projectService.getProject('nonexistent', 'member-1')
    ).rejects.toMatchObject({ message: 'Project not found', status: 404 })
  })

  it('throws 404 for idea not owned by member', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: true,
      createdByMemberId: 'other-member',
    })

    await expect(
      projectService.getProject('p1', 'member-1')
    ).rejects.toMatchObject({ message: 'Project not found', status: 404 })
  })

  it('returns idea when owned by member', async () => {
    const project = {
      id: 'p1',
      isIdea: true,
      createdByMemberId: 'member-1',
      _count: { tasks: 0, views: 1 },
    }
    mockFindById.mockResolvedValue(project)

    const result = await projectService.getProject('p1', 'member-1')

    expect(result).toEqual(project)
  })
})

// ── createProject ──────────────────────────────────────────────────────────

describe('createProject', () => {
  it('creates project with default team', async () => {
    mockGetDefaultTeam.mockResolvedValue({ id: 'team-1' })
    mockCreate.mockResolvedValue({ id: 'new-project', name: 'New' })

    const result = await projectService.createProject('ws-1', 'member-1', {
      name: 'New',
    })

    expect(result).toEqual({ id: 'new-project', name: 'New' })
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      createdByMemberId: 'member-1',
      name: 'New',
      description: undefined,
      isIdea: undefined,
    })
  })
})

// ── updateProject ──────────────────────────────────────────────────────────

describe('updateProject', () => {
  it('throws 404 for non-existent project', async () => {
    mockFindById.mockResolvedValue(null)

    await expect(
      projectService.updateProject('nonexistent', 'member-1', { name: 'X' })
    ).rejects.toMatchObject({ message: 'Project not found', status: 404 })
  })

  it('throws 403 for idea not owned by member', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: true,
      createdByMemberId: 'other-member',
      workspaceId: 'ws-1',
    })

    await expect(
      projectService.updateProject('p1', 'member-1', { name: 'X' })
    ).rejects.toMatchObject({ message: 'Forbidden', status: 403 })
  })

  it('validates reviewer belongs to workspace', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockMemberFindUnique.mockResolvedValue({
      id: 'reviewer-1',
      workspaceId: 'ws-other',
    })

    await expect(
      projectService.updateProject('p1', 'member-1', {
        defaultReviewerId: 'reviewer-1',
      })
    ).rejects.toMatchObject({
      message: 'Reviewer is not a member of this workspace',
      status: 400,
    })
  })

  it('updates project fields', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockUpdate.mockResolvedValue({ id: 'p1', name: 'Updated' })

    const result = await projectService.updateProject('p1', 'member-1', {
      name: 'Updated',
    })

    expect(result).toEqual({ id: 'p1', name: 'Updated' })
    expect(mockUpdate).toHaveBeenCalledWith('p1', { name: 'Updated' })
  })
})

// ── deleteProject ──────────────────────────────────────────────────────────

describe('deleteProject', () => {
  it('throws 404 for non-existent project', async () => {
    mockFindById.mockResolvedValue(null)

    await expect(
      projectService.deleteProject('nonexistent', 'member-1')
    ).rejects.toMatchObject({ message: 'Project not found', status: 404 })
  })

  it('throws 403 for idea not owned by member', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: true,
      createdByMemberId: 'other-member',
    })

    await expect(
      projectService.deleteProject('p1', 'member-1')
    ).rejects.toMatchObject({ message: 'Forbidden', status: 403 })
  })

  it('deletes project when authorized', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
    })

    await projectService.deleteProject('p1', 'member-1')

    expect(mockDelete).toHaveBeenCalledWith('p1')
  })
})
