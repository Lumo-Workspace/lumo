/**
 * @jest-environment node
 *
 * Tests for taskCliService.showFromCli — specifically verifying that the
 * response shape includes sprintId and teamId (added for LUM-88).
 */
jest.mock('turndown', () => {
  return jest.fn().mockImplementation(() => ({
    turndown: (html: string) => html.replace(/<p>(.*?)<\/p>/g, '$1'),
  }))
})

jest.mock('marked', () => ({
  marked: { parse: jest.fn((md: string) => `<p>${md}</p>`) },
}))

jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
    getTaskDetail: jest.fn(),
  },
}))
jest.mock('@/lib/services/auth.service', () => ({
  authService: {
    fetchUserProfile: jest.fn(),
  },
}))

jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: { listPossibleDuplicates: jest.fn() },
}))

import { taskService } from '@/lib/services/task.service'
import { taskCliService } from '@/lib/services/task-cli.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'

const mockResolveIdentifier = taskService.resolveIdentifier as jest.Mock
const mockGetDetail = taskService.getTaskDetail as jest.Mock

const mockPossibleDuplicates =
  taskDependencyService.listPossibleDuplicates as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockPossibleDuplicates.mockResolvedValue([])
  mockResolveIdentifier.mockResolvedValue({
    id: 'task_1',
    identifier: 'LUM-48',
  })
  mockGetDetail.mockResolvedValue({
    id: 'task_1',
    title: 'A task',
    status: 'TODO',
    priority: 'LOW',
    description: null,
    sprintId: 'sprint-abc',
    teamId: 'team-xyz',
    project: { id: 'proj-1', name: 'Lumo', workspaceId: 'ws_1' },
    assignee: null,
    pullRequests: [],
    tags: [],
    teamIdentifier: 'LUM',
    sprintsEnabled: true,
    parent: null,
  })
})

describe('taskCliService.showFromCli', () => {
  it('returns sprintId from the underlying task detail', async () => {
    const result = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
    expect(result).toHaveProperty('sprintId', 'sprint-abc')
  })

  it('returns teamId from the underlying task detail', async () => {
    const result = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
    expect(result).toHaveProperty('teamId', 'team-xyz')
  })

  it('returns sprintId as null when task has no sprint binding', async () => {
    mockGetDetail.mockResolvedValueOnce({
      id: 'task_1',
      title: 'A task',
      status: 'TODO',
      priority: 'LOW',
      description: null,
      sprintId: null,
      teamId: 'team-xyz',
      project: { id: 'proj-1', name: 'Lumo', workspaceId: 'ws_1' },
      assignee: null,
      pullRequests: [],
      tags: [],
      teamIdentifier: 'LUM',
      sprintsEnabled: true,
      parent: null,
    })
    const result = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
    expect(result.sprintId).toBeNull()
  })

  it('returns sprintId as null when task detail has no sprintId field', async () => {
    // Edge case: detail row doesn't have sprintId (e.g. old data)
    mockGetDetail.mockResolvedValueOnce({
      id: 'task_1',
      title: 'A task',
      status: 'TODO',
      priority: 'LOW',
      description: null,
      // sprintId deliberately absent
      teamId: 'team-xyz',
      project: { id: 'proj-1', name: 'Lumo', workspaceId: 'ws_1' },
      assignee: null,
      pullRequests: [],
      tags: [],
      teamIdentifier: 'LUM',
      sprintsEnabled: true,
      parent: null,
    })
    const result = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
    expect(result.sprintId).toBeNull()
  })
})

describe('taskCliService.showFromCli — descriptionMarkdown', () => {
  it('includes descriptionMarkdown derived from stored HTML', async () => {
    mockResolveIdentifier.mockResolvedValue({
      id: 'task_1',
      identifier: 'LUM-1',
    })
    mockGetDetail.mockResolvedValue({
      id: 'task_1',
      title: 'A task',
      status: 'TODO',
      priority: 'LOW',
      description: '<p>hello world</p>',
      sprintId: null,
      teamId: 'team-xyz',
      project: { id: 'proj-1', name: 'Lumo', workspaceId: 'ws_1' },
      assignee: null,
      pullRequests: [],
      tags: [],
      teamIdentifier: 'LUM',
      sprintsEnabled: true,
      parent: null,
    })

    const result = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'lumo',
      identifier: 'LUM-1',
    })

    expect(result.description).toBe('<p>hello world</p>')
    expect(result.descriptionMarkdown).toBe('hello world')
  })

  it('emits null descriptionMarkdown when description is null', async () => {
    // default beforeEach mockGetDetail has description: null
    const result = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'lumo',
      identifier: 'LUM-48',
    })
    expect(result.description).toBeNull()
    expect(result.descriptionMarkdown).toBeNull()
  })
})

describe('taskCliService.showFromCli — linked pull requests (LUM-731)', () => {
  it('returns the linked PRs with number, title, url and state', async () => {
    mockGetDetail.mockResolvedValueOnce({
      id: 'task_1',
      title: 'A task',
      status: 'IN_REVIEW',
      priority: 'LOW',
      description: null,
      sprintId: null,
      teamId: 'team-xyz',
      project: { id: 'proj-1', name: 'Lumo', workspaceId: 'ws_1' },
      assignee: null,
      pullRequests: [
        {
          id: 'pr_1',
          number: 930,
          title: 'feat: wip',
          url: 'https://github.com/o/r/pull/930',
          state: 'open',
          authorLogin: 'a',
          headBranch: 'b',
          ciStatus: null,
          mergedAt: null,
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      ],
      tags: [],
      teamIdentifier: 'LUM',
      sprintsEnabled: true,
      parent: null,
    })
    const result = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
    expect(result.pullRequests).toEqual([
      {
        number: 930,
        title: 'feat: wip',
        url: 'https://github.com/o/r/pull/930',
        state: 'open',
        // LUM-825: the fixture row predates headSha → surfaced as null.
        headSha: null,
      },
    ])
  })

  it('returns an empty list when no PR is linked', async () => {
    const result = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
    expect(result.pullRequests).toEqual([])
  })
})

describe('taskCliService.showFromCli — createdBy (LUM-1283)', () => {
  const show = () =>
    taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      identifier: 'LUM-48',
    })
  // The beforeEach fixture plus a createdBy relation.
  const detailWith = async (createdBy: unknown) => {
    const fixture = (await mockGetDetail()) as object
    mockGetDetail.mockResolvedValueOnce({ ...fixture, createdBy })
  }

  it('returns the creating member as name and email', async () => {
    await detailWith({ id: 'mem-1', clerkId: 'user_1' })
    const { authService } = jest.requireMock('@/lib/services/auth.service') as {
      authService: { fetchUserProfile: jest.Mock }
    }
    authService.fetchUserProfile.mockResolvedValueOnce({
      name: 'Alice',
      email: 'alice@example.com',
    })
    expect((await show()).createdBy).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
    })
    expect(authService.fetchUserProfile).toHaveBeenCalledWith('user_1')
  })

  it('degrades to a placeholder name when the Clerk lookup fails', async () => {
    await detailWith({ id: 'mem-1', clerkId: 'user_gone' })
    const { authService } = jest.requireMock('@/lib/services/auth.service') as {
      authService: { fetchUserProfile: jest.Mock }
    }
    authService.fetchUserProfile.mockRejectedValueOnce(new Error('404'))
    expect((await show()).createdBy).toEqual({
      name: '(unknown member)',
      email: null,
    })
  })

  it('returns null when no creator is recorded', async () => {
    await detailWith(null)
    expect((await show()).createdBy).toBeNull()
  })
})

describe('taskCliService.showFromCli — possible duplicates (LUM-1286)', () => {
  it('includes the likely originals from the background duplicate check', async () => {
    mockPossibleDuplicates.mockResolvedValueOnce([
      {
        identifier: 'LUM-2',
        title: 'Export burndown',
        status: 'TODO',
        score: 0.95,
      },
    ])

    const out = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'lumo',
      identifier: 'LUM-48',
    })

    expect(mockPossibleDuplicates).toHaveBeenCalledWith('task_1')
    expect(out.possibleDuplicates).toEqual([
      {
        identifier: 'LUM-2',
        title: 'Export burndown',
        status: 'TODO',
        score: 0.95,
      },
    ])
  })

  it('still shows the task when the lookup fails', async () => {
    mockPossibleDuplicates.mockRejectedValueOnce(new Error('db down'))

    const out = await taskCliService.showFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'lumo',
      identifier: 'LUM-48',
    })

    expect(out.identifier).toBe('LUM-48')
    expect(out.possibleDuplicates).toEqual([])
  })
})
