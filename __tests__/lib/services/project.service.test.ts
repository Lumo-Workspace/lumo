/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByWorkspace: jest.fn(),
    countTasksByStatus: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByActorId: jest.fn(),
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: { getUserList: jest.fn() },
  }),
}))

jest.mock('@/lib/team', () => ({
  getDefaultTeam: jest.fn(),
}))

import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { getDefaultTeam } from '@/lib/team'
import { projectService } from '@/lib/services/project.service'
import { clerkClient } from '@clerk/nextjs/server'

const mockFindByWorkspace = projectRepository.findByWorkspace as jest.Mock
const mockCountTasksByStatus = projectRepository.countTasksByStatus as jest.Mock
const mockFindById = projectRepository.findById as jest.Mock
const mockCreate = projectRepository.create as jest.Mock
const mockUpdate = projectRepository.update as jest.Mock
const mockDelete = projectRepository.delete as jest.Mock
const mockGetDefaultTeam = getDefaultTeam as jest.Mock
const mockMemberFindByActorId = memberRepository.findByActorId as jest.Mock

let mockClerkGetUserList: jest.Mock
beforeEach(async () => {
  jest.clearAllMocks()
  const c = await (clerkClient as unknown as jest.Mock)()
  mockClerkGetUserList = c.users.getUserList as jest.Mock
})

// ── listProjects ───────────────────────────────────────────────────────────

describe('listProjects', () => {
  it('returns projects with all 4 status counts and flattened defaultReviewer (name resolved from Clerk)', async () => {
    mockFindByWorkspace.mockResolvedValue([
      {
        id: 'p1',
        name: 'Project A',
        _count: { tasks: 6 },
        defaultReviewer: {
          id: 'm1',
          clerkId: 'user_alice',
          actor: { id: 'actor_alice' },
        },
        repositories: [],
      },
      {
        id: 'p2',
        name: 'Project B',
        _count: { tasks: 0 },
        defaultReviewer: null,
        repositories: [],
      },
    ])
    mockCountTasksByStatus.mockResolvedValue(
      new Map([['p1', { TODO: 2, IN_PROGRESS: 3, IN_REVIEW: 1, DONE: 0 }]])
    )
    mockClerkGetUserList.mockResolvedValue({
      data: [
        {
          id: 'user_alice',
          firstName: 'Alice',
          lastName: 'Liddell',
          emailAddresses: [{ emailAddress: 'alice@example.com' }],
        },
      ],
    })

    const result = await projectService.listProjects('ws-1', 'member-1')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'p1',
        // Reviewer ids exposed to the API are actor ids — both the FK field
        // and the flattened object use actor.id, not WorkspaceMember.id.
        defaultReviewerId: 'actor_alice',
        todoCount: 2,
        inProgressCount: 3,
        inReviewCount: 1,
        doneCount: 0,
        defaultReviewer: { id: 'actor_alice', name: 'Alice Liddell' },
      })
    )
    expect(result[1]).toEqual(
      expect.objectContaining({
        id: 'p2',
        defaultReviewerId: null,
        todoCount: 0,
        inProgressCount: 0,
        inReviewCount: 0,
        doneCount: 0,
        defaultReviewer: null,
      })
    )
    expect(mockClerkGetUserList).toHaveBeenCalledWith({
      userId: ['user_alice'],
      limit: 1,
    })
  })

  it('skips Clerk lookup when no project has a reviewer', async () => {
    mockFindByWorkspace.mockResolvedValue([
      { id: 'p1', name: 'X', _count: { tasks: 0 }, defaultReviewer: null, repositories: [] },
    ])
    mockCountTasksByStatus.mockResolvedValue(new Map())

    const result = await projectService.listProjects('ws-1', 'member-1')

    expect(result[0]!.defaultReviewer).toBeNull()
    expect(mockClerkGetUserList).not.toHaveBeenCalled()
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

  it('throws 400 when reviewer actor belongs to a different workspace', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockMemberFindByActorId.mockResolvedValue({
      id: 'reviewer-member-1',
      workspaceId: 'ws-other',
    })

    await expect(
      projectService.updateProject('p1', 'member-1', {
        defaultReviewerId: 'actor_someone',
      })
    ).rejects.toMatchObject({
      message: 'Reviewer is not a member of this workspace',
      status: 400,
    })
    expect(mockMemberFindByActorId).toHaveBeenCalledWith('actor_someone')
  })

  it('throws 400 when actor id does not resolve to a workspace member', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockMemberFindByActorId.mockResolvedValue(null)

    await expect(
      projectService.updateProject('p1', 'member-1', {
        defaultReviewerId: 'actor_unknown',
      })
    ).rejects.toMatchObject({
      message: 'Reviewer is not a member of this workspace',
      status: 400,
    })
  })

  it('translates actor id to member id when storing the reviewer FK', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockMemberFindByActorId.mockResolvedValue({
      id: 'reviewer-member-1',
      workspaceId: 'ws-1',
    })
    mockUpdate.mockResolvedValue({
      id: 'p1',
      name: 'P',
      defaultReviewer: {
        id: 'reviewer-member-1',
        clerkId: 'user_x',
        actor: { id: 'actor_x' },
      },
    })

    const result = await projectService.updateProject('p1', 'member-1', {
      defaultReviewerId: 'actor_x',
    })

    // Repository stores the resolved memberId
    expect(mockUpdate).toHaveBeenCalledWith('p1', {
      defaultReviewerId: 'reviewer-member-1',
    })
    // Response surfaces the actor id back to the UI
    expect(result).toEqual({
      id: 'p1',
      name: 'P',
      defaultReviewerId: 'actor_x',
    })
  })

  it('clears the reviewer when defaultReviewerId is null', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockUpdate.mockResolvedValue({
      id: 'p1',
      name: 'P',
      defaultReviewer: null,
    })

    const result = await projectService.updateProject('p1', 'member-1', {
      defaultReviewerId: null,
    })

    expect(mockUpdate).toHaveBeenCalledWith('p1', { defaultReviewerId: null })
    expect(mockMemberFindByActorId).not.toHaveBeenCalled()
    expect(result.defaultReviewerId).toBeNull()
  })

  it('updates non-reviewer fields without touching the reviewer FK', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockUpdate.mockResolvedValue({
      id: 'p1',
      name: 'Updated',
      defaultReviewer: null,
    })

    const result = await projectService.updateProject('p1', 'member-1', {
      name: 'Updated',
    })

    expect(mockUpdate).toHaveBeenCalledWith('p1', { name: 'Updated' })
    expect(result).toEqual({
      id: 'p1',
      name: 'Updated',
      defaultReviewerId: null,
    })
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
