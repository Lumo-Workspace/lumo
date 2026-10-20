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

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findForMemberWithBinding: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
  },
}))

import { taskCliService } from '@/lib/services/task-cli.service'
import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

const mockFindProjects = projectRepository.findByWorkspaceNonIdea as jest.Mock
const mockFindMember = memberRepository.findByWorkspaceAndClerkId as jest.Mock
const mockFindActor = memberRepository.findActorByMemberId as jest.Mock
const mockFindAllProfiles =
  memberRepository.findAllWithProfilesForCli as jest.Mock
const mockCreateTask = taskService.createTask as jest.Mock
const mockFindBinding = sessionRepository.findForMemberWithBinding as jest.Mock
const mockActivityCreate = activityRepository.create as jest.Mock
beforeEach(() => {
  jest.clearAllMocks()
  mockFindBinding.mockResolvedValue(null)
  mockActivityCreate.mockResolvedValue({ id: 'act-1' })
})

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
        teamId: 'team-1',
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
      'clerk-1',
      'mem-1'
    )
    expect(result).toEqual({
      id: 'task-1',
      identifier: 'LUM-44',
      title: 'Hello',
      url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44',
      teamId: 'team-1',
      taskTags: [],
      // LUM-686: an unbound session creating a task gets the attach suggestion.
      nextSteps: [
        {
          command: 'lumo session attach LUM-44',
          why: 'Bind this session to the task so its work is recorded against it',
        },
      ],
    })
  })

  it('records the calling member as creator, even inside a bound agent session (LUM-1283)', async () => {
    // The creator is always a user (ruling 2026-10-20): an agent-run
    // `lumo task create` is recorded as the member whose API key ran it.
    mockFindBinding.mockResolvedValue({
      task: {
        id: 'task-bound',
        number: 1,
        title: 'Bound',
        status: 'TODO',
        team: { identifier: 'LUM' },
      },
    })
    await taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      memberId: 'mem-1',
      sessionId: 'sess-agent',
      input: { title: 'Hello', priority: 'LOW', newScope: true },
    })
    expect(mockCreateTask).toHaveBeenCalledWith(
      'p-1',
      expect.any(Object),
      'actor-caller',
      'clerk-1',
      'mem-1'
    )
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
      'clerk-1',
      'mem-1'
    )
  })

  it('includes teamId in the returned shape', async () => {
    mockCreateTask.mockResolvedValue({
      task: {
        id: 'task-1',
        title: 'Hello',
        teamIdentifier: 'LUM',
        number: 44,
        teamId: 'team-abc',
      },
      taskTags: [],
    })
    const result = await taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      input: { title: 'Hello', priority: 'LOW' },
    })
    expect(result).toHaveProperty('teamId', 'team-abc')
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

describe('taskCliService.createFromCli — intent gating (Layer 1)', () => {
  beforeEach(() => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
    ])
    mockFindMember.mockResolvedValue({ id: 'mem-1' })
    mockFindActor.mockResolvedValue({ id: 'actor-caller' })
    mockCreateTask.mockResolvedValue({
      task: {
        id: 'task-1',
        title: 'x',
        teamIdentifier: 'LUM',
        teamId: 'team-1',
        number: 9,
      },
      taskTags: [],
    })
  })

  function boundTo(status: string) {
    return {
      id: 'sess-1',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      eventCount: 1,
      task: {
        id: 't-7',
        number: 7,
        title: 'Build widget',
        status,
        team: { identifier: 'LUM' },
      },
    }
  }

  it('throws a 409 redirect when --rework-of is given and creates nothing', async () => {
    await expect(
      taskCliService.createFromCli({
        workspaceId: 'ws-1',
        workspaceSlug: 'lumo',
        callerClerkId: 'clerk-1',
        memberId: 'mem-1',
        sessionId: 'sess-1',
        input: { title: 'fix color', priority: 'LOW', reworkOfRef: 'LUM-7' },
      })
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('LUM-7'),
    })
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('throws a 409 must-declare when bound to an in-flight task with no flag', async () => {
    mockFindBinding.mockResolvedValue(boundTo('IN_REVIEW'))
    await expect(
      taskCliService.createFromCli({
        workspaceId: 'ws-1',
        workspaceSlug: 'lumo',
        callerClerkId: 'clerk-1',
        memberId: 'mem-1',
        sessionId: 'sess-1',
        input: { title: 'other thing', priority: 'LOW' },
      })
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('LUM-7'),
    })
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('allows creation with --new-scope while bound to an in-flight task', async () => {
    mockFindBinding.mockResolvedValue(boundTo('IN_REVIEW'))
    const result = await taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      memberId: 'mem-1',
      sessionId: 'sess-1',
      input: { title: 'genuinely new', priority: 'LOW', newScope: true },
    })
    expect(result.identifier).toBe('LUM-9')
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })

  it('allows creation when bound to a non-in-flight (TODO) task', async () => {
    mockFindBinding.mockResolvedValue(boundTo('TODO'))
    const result = await taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      memberId: 'mem-1',
      sessionId: 'sess-1',
      input: { title: 'anything', priority: 'LOW' },
    })
    expect(result.identifier).toBe('LUM-9')
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })

  it('allows creation when no session is bound', async () => {
    mockFindBinding.mockResolvedValue(null)
    const result = await taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      memberId: 'mem-1',
      sessionId: null,
      input: { title: 'anything', priority: 'LOW' },
    })
    expect(result.identifier).toBe('LUM-9')
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })
})

describe('taskCliService.createFromCli — spinoff recording (Phase 3)', () => {
  beforeEach(() => {
    mockFindProjects.mockResolvedValue([
      { id: 'p-1', name: 'Lumo', description: null },
    ])
    mockFindMember.mockResolvedValue({ id: 'mem-1' })
    mockFindActor.mockResolvedValue({ id: 'actor-caller' })
    mockCreateTask.mockResolvedValue({
      task: {
        id: 'task-B',
        title: 'x',
        teamIdentifier: 'LUM',
        teamId: 'team-1',
        number: 9,
      },
      taskTags: [],
    })
  })

  function boundInProgress() {
    return {
      id: 'sess-1',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      eventCount: 1,
      task: {
        id: 't-7',
        number: 7,
        title: 'Parent',
        status: 'IN_PROGRESS',
        team: { identifier: 'LUM' },
      },
    }
  }

  function create(
    input: Record<string, unknown>,
    sessionId: string | null = 'sess-1'
  ) {
    return taskCliService.createFromCli({
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      callerClerkId: 'clerk-1',
      memberId: 'mem-1',
      sessionId,
      input: { title: 't', priority: 'LOW', ...input },
    } as Parameters<typeof taskCliService.createFromCli>[0])
  }

  it('records TASK_SPUN_OFF on the parent when --new-scope is used mid-flight', async () => {
    mockFindBinding.mockResolvedValue(boundInProgress())
    await create({ newScope: true })
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-7',
        type: 'TASK_SPUN_OFF',
        payload: expect.objectContaining({
          spunOffTaskId: 'task-B',
          spunOffIdentifier: 'LUM-9',
          sessionId: 'sess-1',
        }),
      })
    )
  })

  it('does NOT record a spinoff for an unbound create', async () => {
    mockFindBinding.mockResolvedValue(null)
    await create({}, null)
    expect(mockActivityCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TASK_SPUN_OFF' })
    )
  })

  it('does NOT record a spinoff when bound to a non-in-flight (TODO) task', async () => {
    const b = boundInProgress()
    mockFindBinding.mockResolvedValue({
      ...b,
      task: { ...b.task, status: 'TODO' },
    })
    await create({})
    expect(mockActivityCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TASK_SPUN_OFF' })
    )
  })

  it('a spinoff-recording failure does not break task creation', async () => {
    mockFindBinding.mockResolvedValue(boundInProgress())
    mockActivityCreate.mockRejectedValueOnce(new Error('db blip'))
    const result = await create({ newScope: true })
    expect(result.identifier).toBe('LUM-9')
  })
})
