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

import { projectRepository } from '@/lib/repositories/project.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
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
      'clerk-1'
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
      'clerk-1'
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
      'clerk-1'
    )

    expect(createMock.mock.calls[0][0].description).toBe(html)
  })

  it('persists null when no description provided', async () => {
    await createTask(
      'proj-1',
      { title: 'T', status: 'TODO', priority: 'LOW' },
      'actor-1',
      'clerk-1'
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
