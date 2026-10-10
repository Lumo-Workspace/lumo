/**
 * @jest-environment node
 */

jest.mock('@/lib/api-client/base', () => ({
  apiFetch: jest.fn(),
  ApiClientError: class ApiClientError extends Error {
    constructor(
      message: string,
      public status: number
    ) {
      super(message)
    }
  },
}))

// constants uses next/navigation internally — stub the module so imports resolve
jest.mock(
  '@/app/workspace/[workspaceUrl]/constants',
  () => ({
    API: {
      projects: { tasks: (id: string) => `/api/projects/${id}/tasks` },
      sprints: { tasks: (id: string) => `/api/sprints/${id}/tasks` },
      tasks: {
        me: '/api/tasks/me',
        byId: (id: string) => `/api/tasks/${id}`,
        comments: (id: string) => `/api/tasks/${id}/comments`,
        comment: (id: string, cId: string) =>
          `/api/tasks/${id}/comments/${cId}`,
        timeline: (id: string) => `/api/tasks/${id}/timeline`,
        quickDispatchParse: '/api/tasks/parse-quick-dispatch',
        quickDispatchExecute: '/api/tasks/quick-dispatch/execute',
      },
      teams: { tasks: (id: string) => `/api/teams/${id}/tasks` },
      pullRequests: {
        search: '/api/pull-requests/search',
        link: (id: string) => `/api/tasks/${id}/pull-requests/link`,
        unlink: (id: string, prId: string) =>
          `/api/tasks/${id}/pull-requests/${prId}/unlink`,
      },
    },
  }),
  { virtual: true }
)

import { apiFetch } from '@/lib/api-client/base'
import { tasksClient } from '@/lib/api-client/tasks'

const mockApiFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('tasksClient.listBySprint', () => {
  it('calls the sprint tasks endpoint', async () => {
    mockApiFetch.mockResolvedValueOnce({ tasks: [] })
    await tasksClient.listBySprint('sprint-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/sprints/sprint-1/tasks')
  })
})

describe('tasksClient.listByProject', () => {
  it('calls project tasks endpoint without query string when no opts', async () => {
    mockApiFetch.mockResolvedValueOnce({ tasks: [] })
    await tasksClient.listByProject('p-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/projects/p-1/tasks')
  })

  it('appends milestoneId filter', async () => {
    mockApiFetch.mockResolvedValueOnce({ tasks: [] })
    await tasksClient.listByProject('p-1', { milestoneId: 'm-9' })
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/p-1/tasks?milestoneId=m-9'
    )
  })
})

describe('tasksClient.listByTeam', () => {
  it('calls team tasks endpoint without query string when no opts', async () => {
    mockApiFetch.mockResolvedValueOnce({ tasks: [] })
    await tasksClient.listByTeam('team-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/teams/team-1/tasks')
  })

  it('appends sprintId=null for backlog filter', async () => {
    mockApiFetch.mockResolvedValueOnce({ tasks: [] })
    await tasksClient.listByTeam('team-1', { sprintId: null })
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/teams/team-1/tasks?sprintId=null'
    )
  })

  it('appends sprintId string for sprint filter', async () => {
    mockApiFetch.mockResolvedValueOnce({ tasks: [] })
    await tasksClient.listByTeam('team-1', { sprintId: 'sprint-99' })
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/teams/team-1/tasks?sprintId=sprint-99'
    )
  })
})
test('LUM-1056 review control sends a structured body through the shared workspace-aware API client', async () => {
  await tasksClient.reviewPullRequest(7, 'o/r', 'incremental')
  expect(apiFetch).toHaveBeenCalledWith(
    '/api/pull-requests/7/scans?repo=o%2Fr',
    {
      method: 'POST',
      body: { action: 'incremental' },
    }
  )
})
