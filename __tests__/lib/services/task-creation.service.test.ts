/**
 * @jest-environment node
 */

jest.mock('marked', () => ({
  marked: { parse: jest.fn((md: string) => `<p>${md}</p>`) },
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    createWithSequence: jest.fn(),
    findWithProject: jest.fn(),
    findMaxOrder: jest.fn().mockResolvedValue({ order: 0 }),
    findActorById: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdWithDefaults: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    syncTaskTags: jest.fn().mockResolvedValue(undefined),
    findByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
}))
jest.mock('@/lib/services/task-embedding.service', () => ({
  stampTaskTitleEmbedding: jest.fn().mockResolvedValue(undefined),
}))
const waitUntilPromises: Array<Promise<unknown>> = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(p)
  },
}))

import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { stampTaskTitleEmbedding } from '@/lib/services/task-embedding.service'
import {
  createTask,
  createFromAutomation,
} from '@/lib/services/task-creation.service'

const projectMock = projectRepository.findByIdWithDefaults as jest.Mock
const createMock = taskRepository.createWithSequence as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  projectMock.mockResolvedValue({
    id: 'proj-1',
    teamId: 'team-1',
    workspaceId: 'ws-1',
    workspace: { slug: 'lumo' },
  })
  createMock.mockResolvedValue({
    id: 't-1',
    identifier: 'LUM-1',
    teamIdentifier: 'LUM',
    number: 1,
    title: 'T',
    teamId: 'team-1',
  })
})

describe('createTask — description normalization', () => {
  it('converts markdown description to HTML before persisting', async () => {
    await createTask(
      'proj-1',
      {
        title: 'T',
        description: '## Heading\n- item',
        status: 'TODO',
        priority: 'LOW',
      },
      'actor-1',
      'clerk-1',
      'member-1'
    )

    const passed = createMock.mock.calls[0][0]
    expect(passed.description).toBe('<p>## Heading\n- item</p>')
  })

  it('clears description when input is empty string', async () => {
    await createTask(
      'proj-1',
      {
        title: 'T',
        description: '',
        status: 'TODO',
        priority: 'LOW',
      },
      'actor-1',
      'clerk-1',
      'member-1'
    )

    expect(createMock.mock.calls[0][0].description).toBeNull()
  })

  it('passes through HTML descriptions unchanged', async () => {
    const html = '<p>already html</p>'
    await createTask(
      'proj-1',
      {
        title: 'T',
        description: html,
        status: 'TODO',
        priority: 'LOW',
      },
      'actor-1',
      'clerk-1',
      'member-1'
    )

    expect(createMock.mock.calls[0][0].description).toBe(html)
  })

  it('persists null when no description provided', async () => {
    await createTask(
      'proj-1',
      { title: 'T', status: 'TODO', priority: 'LOW' },
      'actor-1',
      'clerk-1',
      'member-1'
    )

    expect(createMock.mock.calls[0][0].description).toBeNull()
  })
})

describe('createFromAutomation — description normalization', () => {
  it('normalizes markdown description for automation-created tasks', async () => {
    await createFromAutomation('proj-1', {
      title: 'Sentry alert',
      description: '## Error\n- stack frame',
      priority: 'HIGH',
      assigneeActorId: null,
      tagIds: [],
    })

    const passed = createMock.mock.calls[0][0]
    expect(passed.description).toBe('<p>## Error\n- stack frame</p>')
  })

  it('handles null description on automation path', async () => {
    await createFromAutomation('proj-1', {
      title: 'Sentry alert',
      description: null,
      priority: 'HIGH',
      assigneeActorId: null,
      tagIds: [],
    })

    expect(createMock.mock.calls[0][0].description).toBeNull()
  })
})

describe('createTask — archived milestone bind guard', () => {
  it('rejects creating a task bound to an archived milestone with 409', async () => {
    ;(milestoneRepository.findById as jest.Mock).mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      archivedAt: new Date(),
    })
    await expect(
      createTask(
        'proj-1',
        {
          title: 'T',
          status: 'TODO',
          priority: 'LOW',
          milestoneId: 'm1',
        },
        'actor-1',
        'clerk-1',
        'member-1'
      )
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('createTask — workStartedAt on creation (LUM-437 / LUM-1057)', () => {
  const create = (status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS') =>
    createTask(
      'proj-1',
      { title: 'T', status, priority: 'LOW' },
      'actor-1',
      'clerk-1',
      'member-1'
    )

  it('does not stamp a task born in BACKLOG — unscheduled is not started', async () => {
    await create('BACKLOG')
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('workStartedAt')
  })

  it('does not stamp a task born in TODO', async () => {
    await create('TODO')
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('workStartedAt')
  })

  it('stamps a task born already in progress', async () => {
    await create('IN_PROGRESS')
    expect(createMock.mock.calls[0][0].workStartedAt).toBeInstanceOf(Date)
  })
})

describe('createdByMemberId (LUM-1283)', () => {
  it('createTask records the calling member as the creator', async () => {
    await createTask(
      'proj-1',
      { title: 'T', status: 'TODO', priority: 'LOW' },
      'actor-1',
      'clerk-1',
      'member-1'
    )
    expect(createMock.mock.calls[0][0].createdByMemberId).toBe('member-1')
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('createdByActorId')
  })

  it('createTask stores null when no member is known', async () => {
    await createTask(
      'proj-1',
      { title: 'T', status: 'TODO', priority: 'LOW' },
      '',
      'clerk-1',
      null
    )
    expect(createMock.mock.calls[0][0].createdByMemberId).toBeNull()
  })

  it('createTask keeps the creator (a member) separate from an agent assignee', async () => {
    ;(taskRepository.findActorById as jest.Mock).mockResolvedValue({
      type: 'AGENT',
      workspaceId: 'ws-1',
    })
    await createTask(
      'proj-1',
      {
        title: 'T',
        status: 'TODO',
        priority: 'LOW',
        assigneeActorId: 'agent-actor',
      },
      'actor-1',
      'clerk-1',
      'member-1'
    )
    expect(createMock.mock.calls[0][0]).toMatchObject({
      assigneeActorId: 'agent-actor',
      createdByMemberId: 'member-1',
    })
  })

  it('createFromAutomation (Sentry webhook) records no creator', async () => {
    await createFromAutomation('proj-1', {
      title: 'Sentry: boom',
      description: null,
      priority: 'HIGH',
      assigneeActorId: 'actor-owner',
      tagIds: [],
    })
    expect(createMock.mock.calls[0][0].createdByMemberId).toBeNull()
  })
})

describe('createFromAutomation — title embedding (LUM-1286)', () => {
  it('stamps the new task title after the response', async () => {
    waitUntilPromises.length = 0
    await createFromAutomation('proj-1', {
      title: 'Sentry alert',
      description: null,
      priority: 'HIGH',
      assigneeActorId: null,
      tagIds: [],
    })
    await Promise.all(waitUntilPromises)

    expect(stampTaskTitleEmbedding).toHaveBeenCalledWith('t-1', 'T')
  })
})
