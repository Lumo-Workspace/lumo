/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByWorkspace: jest.fn(),
    countTasksByStatus: jest.fn(),
    findById: jest.fn(),
    findByIdSimple: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    reorder: jest.fn(),
    maxOrderInWorkspace: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByActorId: jest.fn(),
    findById: jest.fn(),
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: { getUserList: jest.fn() },
  }),
}))

// LUM-916: project deletion sweeps its tasks' evidence blobs.
jest.mock('@/lib/repositories/private-file.repository', () => ({
  privateFileRepository: {
    findTaskIdsWithTestCasesInProject: jest.fn().mockResolvedValue([]),
  },
}))

jest.mock('@/lib/team', () => ({
  getDefaultTeam: jest.fn(),
}))

jest.mock('@/lib/integrations/pusher/server', () => ({
  pushWorkspaceEvent: jest.fn().mockResolvedValue(undefined),
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
const mockMemberFindById = memberRepository.findById as jest.Mock

let mockClerkGetUserList: jest.Mock
beforeEach(async () => {
  jest.clearAllMocks()
  const c = await (clerkClient as unknown as jest.Mock)()
  mockClerkGetUserList = c.users.getUserList as jest.Mock
  // Default: caller's member is in workspace 'ws-1'. Tests that need a
  // cross-workspace scenario override this explicitly.
  mockMemberFindById.mockResolvedValue({
    id: 'member-1',
    workspaceId: 'ws-1',
    role: 'MEMBER',
  })
})

// ── listProjects ───────────────────────────────────────────────────────────

describe('listProjects', () => {
  it('returns projects with all 4 status counts and flattened owner (name resolved from Clerk)', async () => {
    mockFindByWorkspace.mockResolvedValue([
      {
        id: 'p1',
        name: 'Project A',
        _count: { tasks: 6 },
        owner: {
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
        owner: null,
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
        // Owner ids exposed to the API are actor ids — both the FK field
        // and the flattened object use actor.id, not WorkspaceMember.id.
        ownerId: 'actor_alice',
        todoCount: 2,
        inProgressCount: 3,
        inReviewCount: 1,
        doneCount: 0,
        owner: { id: 'actor_alice', name: 'Alice Liddell' },
      })
    )
    expect(result[1]).toEqual(
      expect.objectContaining({
        id: 'p2',
        ownerId: null,
        todoCount: 0,
        inProgressCount: 0,
        inReviewCount: 0,
        doneCount: 0,
        owner: null,
      })
    )
    expect(mockClerkGetUserList).toHaveBeenCalledWith({
      userId: ['user_alice'],
      limit: 1,
    })
  })

  it('skips Clerk lookup when no project has an owner', async () => {
    mockFindByWorkspace.mockResolvedValue([
      {
        id: 'p1',
        name: 'X',
        _count: { tasks: 0 },
        owner: null,
        repositories: [],
      },
    ])
    mockCountTasksByStatus.mockResolvedValue(new Map())

    const result = await projectService.listProjects('ws-1', 'member-1')

    expect(result[0]!.owner).toBeNull()
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
      workspaceId: 'ws-1',
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
      workspaceId: 'ws-1',
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
      workspaceId: 'ws-1',
      _count: { tasks: 0, views: 1 },
    }
    mockFindById.mockResolvedValue(project)

    const result = await projectService.getProject('p1', 'member-1')

    expect(result).toEqual(project)
  })

  it('throws 404 when caller is in a different workspace than the project', async () => {
    // Cross-workspace access attempt: caller's member belongs to ws-B but
    // the project lives in ws-A. Must return 404 (not 403) to avoid
    // leaking the existence of the foreign project.
    mockFindById.mockResolvedValue({
      id: 'p1',
      name: 'Foreign',
      isIdea: false,
      createdByMemberId: 'someone-in-ws-a',
      workspaceId: 'ws-A',
      _count: { tasks: 5, views: 1 },
    })
    mockMemberFindById.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'ws-B',
      role: 'MEMBER',
    })

    await expect(
      projectService.getProject('p1', 'member-1')
    ).rejects.toMatchObject({ message: 'Project not found', status: 404 })
  })

  it('throws 404 when the calling member id does not exist', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'someone',
      workspaceId: 'ws-1',
    })
    mockMemberFindById.mockResolvedValue(null)

    await expect(
      projectService.getProject('p1', 'orphan-member')
    ).rejects.toMatchObject({ message: 'Project not found', status: 404 })
  })
})

// ── createProject ──────────────────────────────────────────────────────────

describe('createProject', () => {
  it('creates project with default team', async () => {
    mockGetDefaultTeam.mockResolvedValue({ id: 'team-1' })
    ;(projectRepository.maxOrderInWorkspace as jest.Mock).mockResolvedValue(0)
    mockCreate.mockResolvedValue({ id: 'new-project', name: 'New' })

    const result = await projectService.createProject(
      'ws-1',
      'ws-slug',
      'member-1',
      {
        name: 'New',
      }
    )

    expect(result).toEqual({ id: 'new-project', name: 'New' })
    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      createdByMemberId: 'member-1',
      name: 'New',
      description: undefined,
      isIdea: undefined,
      order: 1,
    })
  })

  it('passes order = maxOrder + 1 to the repository', async () => {
    mockGetDefaultTeam.mockResolvedValue({ id: 'team-1' })
    ;(projectRepository.maxOrderInWorkspace as jest.Mock).mockResolvedValue(4)
    mockCreate.mockResolvedValue({ id: 'p-new' })

    await projectService.createProject('ws-1', 'ws-slug', 'member-1', {
      name: 'New project',
    })

    expect(projectRepository.maxOrderInWorkspace).toHaveBeenCalledWith('ws-1')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        teamId: 'team-1',
        createdByMemberId: 'member-1',
        name: 'New project',
        order: 5,
      })
    )
  })

  it('defaults to order = 1 when the workspace has no projects', async () => {
    mockGetDefaultTeam.mockResolvedValue({ id: 'team-1' })
    ;(projectRepository.maxOrderInWorkspace as jest.Mock).mockResolvedValue(0)
    mockCreate.mockResolvedValue({ id: 'p-new' })

    await projectService.createProject('ws-1', 'ws-slug', 'member-1', {
      name: 'First',
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ order: 1 })
    )
  })

  it('broadcasts project-created to the workspace slug channel', async () => {
    const { pushWorkspaceEvent } = jest.requireMock(
      '@/lib/integrations/pusher/server'
    ) as { pushWorkspaceEvent: jest.Mock }
    pushWorkspaceEvent.mockClear()
    mockGetDefaultTeam.mockResolvedValue({ id: 'team-1' })
    ;(projectRepository.maxOrderInWorkspace as jest.Mock).mockResolvedValue(0)
    mockCreate.mockResolvedValue({ id: 'p-new', isIdea: false })

    await projectService.createProject('ws-1', 'acme', 'member-1', {
      name: 'Real project',
    })

    expect(pushWorkspaceEvent).toHaveBeenCalledWith('acme', {
      type: 'project-created',
      projectId: 'p-new',
    })
  })

  it('does not broadcast when creating an idea draft (private to creator)', async () => {
    const { pushWorkspaceEvent } = jest.requireMock(
      '@/lib/integrations/pusher/server'
    ) as { pushWorkspaceEvent: jest.Mock }
    pushWorkspaceEvent.mockClear()
    mockGetDefaultTeam.mockResolvedValue({ id: 'team-1' })
    ;(projectRepository.maxOrderInWorkspace as jest.Mock).mockResolvedValue(0)
    mockCreate.mockResolvedValue({ id: 'idea-1', isIdea: true })

    await projectService.createProject('ws-1', 'acme', 'member-1', {
      name: 'Private idea',
      isIdea: true,
    })

    expect(pushWorkspaceEvent).not.toHaveBeenCalled()
  })
})

// ── reorderProjects ────────────────────────────────────────────────────────

describe('reorderProjects', () => {
  const { pushWorkspaceEvent } = jest.requireMock(
    '@/lib/integrations/pusher/server'
  ) as { pushWorkspaceEvent: jest.Mock }

  beforeEach(() => {
    pushWorkspaceEvent.mockClear()
  })

  it('rejects when any id belongs to a different workspace', async () => {
    mockFindByWorkspace.mockResolvedValue([
      { id: 'p1', workspaceId: 'ws-1' },
      { id: 'p2', workspaceId: 'ws-1' },
    ])

    await expect(
      projectService.reorderProjects('ws-1', 'acme', 'member-1', [
        'p1',
        'p-other',
      ])
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects when orderedIds is empty', async () => {
    await expect(
      projectService.reorderProjects('ws-1', 'acme', 'member-1', [])
    ).rejects.toMatchObject({ status: 400 })
  })

  it('writes the new order and publishes the pusher event on success', async () => {
    mockFindByWorkspace.mockResolvedValue([
      { id: 'p1', workspaceId: 'ws-1' },
      { id: 'p2', workspaceId: 'ws-1' },
      { id: 'p3', workspaceId: 'ws-1' },
    ])
    ;(projectRepository.reorder as jest.Mock).mockResolvedValue(undefined)

    await projectService.reorderProjects('ws-1', 'acme', 'member-1', [
      'p2',
      'p1',
      'p3',
    ])

    expect(projectRepository.reorder).toHaveBeenCalledWith('ws-1', [
      'p2',
      'p1',
      'p3',
    ])
    expect(pushWorkspaceEvent).toHaveBeenCalledWith('acme', {
      type: 'projects-reordered',
      orderedIds: ['p2', 'p1', 'p3'],
    })
  })
})

// ── updateProject ──────────────────────────────────────────────────────────

describe('updateProject', () => {
  it('throws 404 for non-existent project', async () => {
    mockFindById.mockResolvedValue(null)

    await expect(
      projectService.updateProject('nonexistent', 'acme', 'member-1', {
        name: 'X',
      })
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
      projectService.updateProject('p1', 'acme', 'member-1', { name: 'X' })
    ).rejects.toMatchObject({ message: 'Forbidden', status: 403 })
  })

  it('throws 404 when caller is in a different workspace than the project', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'someone',
      workspaceId: 'ws-A',
    })
    mockMemberFindById.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'ws-B',
      role: 'MEMBER',
    })

    await expect(
      projectService.updateProject('p1', 'acme', 'member-1', { name: 'New' })
    ).rejects.toMatchObject({ message: 'Project not found', status: 404 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('throws 400 when owner actor belongs to a different workspace', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockMemberFindByActorId.mockResolvedValue({
      id: 'owner-member-1',
      workspaceId: 'ws-other',
    })

    await expect(
      projectService.updateProject('p1', 'acme', 'member-1', {
        ownerId: 'actor_someone',
      })
    ).rejects.toMatchObject({
      message: 'Owner is not a member of this workspace',
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
      projectService.updateProject('p1', 'acme', 'member-1', {
        ownerId: 'actor_unknown',
      })
    ).rejects.toMatchObject({
      message: 'Owner is not a member of this workspace',
      status: 400,
    })
  })

  it('translates actor id to member id when storing the owner FK', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockMemberFindByActorId.mockResolvedValue({
      id: 'owner-member-1',
      workspaceId: 'ws-1',
    })
    mockUpdate.mockResolvedValue({
      id: 'p1',
      name: 'P',
      owner: {
        id: 'owner-member-1',
        clerkId: 'user_x',
        actor: { id: 'actor_x' },
      },
    })

    const result = await projectService.updateProject(
      'p1',
      'acme',
      'member-1',
      {
        ownerId: 'actor_x',
      }
    )

    // Repository stores the resolved memberId
    expect(mockUpdate).toHaveBeenCalledWith('p1', {
      ownerId: 'owner-member-1',
    })
    // Response surfaces the actor id back to the UI
    expect(result).toEqual({
      id: 'p1',
      name: 'P',
      ownerId: 'actor_x',
    })
  })

  it('clears the owner when ownerId is null', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockUpdate.mockResolvedValue({
      id: 'p1',
      name: 'P',
      owner: null,
    })

    const result = await projectService.updateProject(
      'p1',
      'acme',
      'member-1',
      {
        ownerId: null,
      }
    )

    expect(mockUpdate).toHaveBeenCalledWith('p1', { ownerId: null })
    expect(mockMemberFindByActorId).not.toHaveBeenCalled()
    expect(result.ownerId).toBeNull()
  })

  it('updates non-owner fields without touching the owner FK', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockUpdate.mockResolvedValue({
      id: 'p1',
      name: 'Updated',
      owner: null,
    })

    const result = await projectService.updateProject(
      'p1',
      'acme',
      'member-1',
      {
        name: 'Updated',
      }
    )

    expect(mockUpdate).toHaveBeenCalledWith('p1', { name: 'Updated' })
    expect(result).toEqual({
      id: 'p1',
      name: 'Updated',
      ownerId: null,
    })
  })

  it('broadcasts project-updated on successful update', async () => {
    const { pushWorkspaceEvent } = jest.requireMock(
      '@/lib/integrations/pusher/server'
    ) as { pushWorkspaceEvent: jest.Mock }
    pushWorkspaceEvent.mockClear()
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockUpdate.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      name: 'Renamed',
      owner: null,
    })

    await projectService.updateProject('p1', 'acme', 'member-1', {
      name: 'Renamed',
    })

    expect(pushWorkspaceEvent).toHaveBeenCalledWith('acme', {
      type: 'project-updated',
      projectId: 'p1',
    })
  })

  it('does not broadcast when the updated project is an idea draft', async () => {
    const { pushWorkspaceEvent } = jest.requireMock(
      '@/lib/integrations/pusher/server'
    ) as { pushWorkspaceEvent: jest.Mock }
    pushWorkspaceEvent.mockClear()
    mockFindById.mockResolvedValue({
      id: 'idea-1',
      isIdea: true,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })
    mockUpdate.mockResolvedValue({
      id: 'idea-1',
      isIdea: true,
      name: 'Renamed idea',
      owner: null,
    })

    await projectService.updateProject('idea-1', 'acme', 'member-1', {
      name: 'Renamed idea',
    })

    expect(pushWorkspaceEvent).not.toHaveBeenCalled()
  })
})

// ── deleteProject ──────────────────────────────────────────────────────────

describe('deleteProject', () => {
  it('throws 404 for non-existent project', async () => {
    mockFindById.mockResolvedValue(null)

    await expect(
      projectService.deleteProject('nonexistent', 'acme', 'member-1')
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
      projectService.deleteProject('p1', 'acme', 'member-1')
    ).rejects.toMatchObject({ message: 'Forbidden', status: 403 })
  })

  it('throws 404 when caller is in a different workspace than the project', async () => {
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'someone',
      workspaceId: 'ws-A',
    })
    mockMemberFindById.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'ws-B',
      role: 'MEMBER',
    })

    await expect(
      projectService.deleteProject('p1', 'acme', 'member-1')
    ).rejects.toMatchObject({ message: 'Project not found', status: 404 })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('deletes and broadcasts project-deleted when authorized', async () => {
    const { pushWorkspaceEvent } = jest.requireMock(
      '@/lib/integrations/pusher/server'
    ) as { pushWorkspaceEvent: jest.Mock }
    pushWorkspaceEvent.mockClear()
    mockFindById.mockResolvedValue({
      id: 'p1',
      isIdea: false,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })

    await projectService.deleteProject('p1', 'acme', 'member-1')

    expect(mockDelete).toHaveBeenCalledWith('p1')
    expect(pushWorkspaceEvent).toHaveBeenCalledWith('acme', {
      type: 'project-deleted',
      projectId: 'p1',
    })
  })

  it('does not broadcast when deleting an idea draft', async () => {
    const { pushWorkspaceEvent } = jest.requireMock(
      '@/lib/integrations/pusher/server'
    ) as { pushWorkspaceEvent: jest.Mock }
    pushWorkspaceEvent.mockClear()
    mockFindById.mockResolvedValue({
      id: 'idea-1',
      isIdea: true,
      createdByMemberId: 'member-1',
      workspaceId: 'ws-1',
    })

    await projectService.deleteProject('idea-1', 'acme', 'member-1')

    expect(mockDelete).toHaveBeenCalledWith('idea-1')
    expect(pushWorkspaceEvent).not.toHaveBeenCalled()
  })
})
