/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByWorkspaceNonIdea: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByWorkspaceAndClerkId: jest.fn(),
    findActorByMemberId: jest.fn(),
    findAllWithProfilesForCli: jest.fn(),
  },
}))

jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    createTask: jest.fn(),
  },
}))

import { taskCliService } from '@/lib/services/task-cli.service'
import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'

const mockFindProjects = projectRepository.findByWorkspaceNonIdea as jest.Mock
const mockFindMember = memberRepository.findByWorkspaceAndClerkId as jest.Mock
const mockFindActor = memberRepository.findActorByMemberId as jest.Mock
const mockFindAllProfiles =
  memberRepository.findAllWithProfilesForCli as jest.Mock
const mockCreateTask = taskService.createTask as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskCliService.resolveProjectId', () => {
  it('returns the single project when ref is omitted', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
    ])
    const id = await taskCliService.resolveProjectId('ws-1', undefined)
    expect(id).toBe('p-1')
  })

  it('throws 400 with candidates when ref is omitted and multiple projects exist', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'Agent Server', description: null },
    ])
    await expect(
      taskCliService.resolveProjectId('ws-1', undefined)
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Available: lumo, agent-server'),
    })
  })

  it('throws when workspace has no projects', async () => {
    mockFindProjects.mockResolvedValue([])
    await expect(
      taskCliService.resolveProjectId('ws-1', undefined)
    ).rejects.toMatchObject({ status: 400 })
  })

  it('matches a project by exact name (case-insensitive)', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'Agent Server', description: null },
    ])
    const id = await taskCliService.resolveProjectId('ws-1', 'lumo')
    expect(id).toBe('p-1')
  })

  it('matches a project by slugified name', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'Agent Server', description: null },
    ])
    const id = await taskCliService.resolveProjectId('ws-1', 'agent-server')
    expect(id).toBe('p-2')
  })

  it('throws 400 when ref matches no project, listing candidates', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
    ])
    await expect(
      taskCliService.resolveProjectId('ws-1', 'unknown')
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('no project matches "unknown"'),
    })
  })

  it('throws 400 when ref matches more than one project', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'lumo', description: null },
    ])
    await expect(
      taskCliService.resolveProjectId('ws-1', 'lumo')
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('multiple projects match "lumo"'),
    })
  })
})

describe('taskCliService.resolveAssigneeActorId', () => {
  it('resolves "me" via caller clerkId → member → actor', async () => {
    mockFindMember.mockResolvedValue({ id: 'mem-1' })
    mockFindActor.mockResolvedValue({ id: 'actor-1' })

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'clerk-1',
      assigneeRef: 'me',
    })

    expect(id).toBe('actor-1')
    expect(mockFindAllProfiles).not.toHaveBeenCalled()
  })

  it('treats omitted assigneeRef as "me"', async () => {
    mockFindMember.mockResolvedValue({ id: 'mem-1' })
    mockFindActor.mockResolvedValue({ id: 'actor-1' })

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'clerk-1',
      assigneeRef: undefined,
    })

    expect(id).toBe('actor-1')
  })

  it('throws when caller is not a member of the workspace', async () => {
    mockFindMember.mockResolvedValue(null)

    await expect(
      taskCliService.resolveAssigneeActorId({
        workspaceId: 'ws-1',
        callerClerkId: 'clerk-x',
        assigneeRef: 'me',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('matches assignee by email (case-insensitive)', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'ada@example.com',
        displayName: 'Ada',
      },
      {
        memberId: 'm-2',
        clerkId: 'c-2',
        actorId: 'a-2',
        email: 'bob@example.com',
        displayName: 'Bob',
      },
    ])

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'c-1',
      assigneeRef: 'ADA@example.com',
    })

    expect(id).toBe('a-1')
  })

  it('matches assignee by displayName (case-insensitive)', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
      },
    ])

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'c-1',
      assigneeRef: 'ada lovelace',
    })

    expect(id).toBe('a-1')
  })

  it('prefers email over name when both could match', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'alice@example.com',
        displayName: 'Different Name',
      },
      {
        memberId: 'm-2',
        clerkId: 'c-2',
        actorId: 'a-2',
        email: 'other@example.com',
        displayName: 'alice@example.com',
      },
    ])

    const id = await taskCliService.resolveAssigneeActorId({
      workspaceId: 'ws-1',
      callerClerkId: 'c-1',
      assigneeRef: 'alice@example.com',
    })

    expect(id).toBe('a-1')
  })

  it('throws 400 when no member matches', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'ada@example.com',
        displayName: 'Ada',
      },
    ])

    await expect(
      taskCliService.resolveAssigneeActorId({
        workspaceId: 'ws-1',
        callerClerkId: 'c-1',
        assigneeRef: 'zoe',
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('no member matches "zoe"'),
    })
  })

  it('throws 400 when multiple members share the same name', async () => {
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-1',
        clerkId: 'c-1',
        actorId: 'a-1',
        email: 'ada1@example.com',
        displayName: 'Ada',
      },
      {
        memberId: 'm-2',
        clerkId: 'c-2',
        actorId: 'a-2',
        email: 'ada2@example.com',
        displayName: 'Ada',
      },
    ])

    await expect(
      taskCliService.resolveAssigneeActorId({
        workspaceId: 'ws-1',
        callerClerkId: 'c-1',
        assigneeRef: 'Ada',
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('ada1@example.com, ada2@example.com'),
    })
  })
})

describe('taskCliService.createFromCli', () => {
  beforeEach(() => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
    ])
    mockFindMember.mockResolvedValue({ id: 'mem-1' })
    mockFindActor.mockResolvedValue({ id: 'actor-caller' })
    mockCreateTask.mockResolvedValue({
      task: {
        id: 'task-1',
        title: 'Hello',
        teamIdentifier: 'LUM',
        number: 44,
      },
      taskTags: [],
    })
  })

  it('delegates to taskService.createTask with resolved IDs and returns identifier + URL', async () => {
    const result = await taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      input: { title: 'Hello', priority: 'LOW' },
    })

    expect(mockCreateTask).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        title: 'Hello',
        priority: 'LOW',
        status: 'TODO',
        assigneeActorId: 'actor-caller',
      }),
      'actor-caller',
      'clerk-1'
    )
    expect(result).toEqual({
      id: 'task-1',
      identifier: 'LUM-44',
      title: 'Hello',
      url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44',
      taskTags: [],
    })
  })

  it('respects an explicit projectRef and assigneeRef', async () => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
      { id: 'p-2', name: 'Agent Server', description: null },
    ])
    mockFindAllProfiles.mockResolvedValue([
      {
        memberId: 'm-2',
        clerkId: 'c-2',
        actorId: 'actor-ada',
        email: 'ada@example.com',
        displayName: 'Ada',
      },
    ])

    await taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      input: {
        title: 'Hello',
        priority: 'HIGH',
        projectRef: 'agent-server',
        assigneeRef: 'ada@example.com',
      },
    })

    expect(mockCreateTask).toHaveBeenCalledWith(
      'p-2',
      expect.objectContaining({
        title: 'Hello',
        priority: 'HIGH',
        assigneeActorId: 'actor-ada',
      }),
      'actor-caller',
      'clerk-1'
    )
  })

  it('uses LUMO_PUBLIC_URL when set', async () => {
    const original = process.env.LUMO_PUBLIC_URL
    process.env.LUMO_PUBLIC_URL = 'https://staging.uselumo.ai'
    try {
      const result = await taskCliService.createFromCli({
        workspaceId: 'ws-1',
        workspaceSlug: 'lumo',
        callerClerkId: 'clerk-1',
        input: { title: 'Hello', priority: 'LOW' },
      })
      expect(result.url).toBe(
        'https://staging.uselumo.ai/workspace/lumo/my-tasks/LUM-44'
      )
    } finally {
      process.env.LUMO_PUBLIC_URL = original
    }
  })
})
