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

// constants pulls next/navigation transitively — stub so imports resolve.
jest.mock(
  '@/app/workspace/[workspaceUrl]/constants',
  () => ({
    API: {
      milestones: {
        listByProject: (projectId: string) =>
          `/api/projects/${projectId}/milestones`,
        byId: (id: string) => `/api/milestones/${id}`,
        byProjectAndSlug: (projectId: string, slug: string) =>
          `/api/projects/${projectId}/milestones/by-slug/${slug}`,
        reorder: (projectId: string) =>
          `/api/projects/${projectId}/milestones/reorder`,
        archive: (id: string) => `/api/milestones/${id}/archive`,
        unarchive: (id: string) => `/api/milestones/${id}/unarchive`,
      },
    },
  }),
  { virtual: true }
)

import { apiFetch } from '@/lib/api-client/base'
import { milestonesClient } from '@/lib/api-client/milestones'

const mockApiFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('milestonesClient.listByProject filter', () => {
  it('omits the filter param for the default (active) so the URL stays stable', async () => {
    mockApiFetch.mockResolvedValueOnce({ milestones: [] })
    await milestonesClient.listByProject('p-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/projects/p-1/milestones')
  })

  it('appends filter=archived', async () => {
    mockApiFetch.mockResolvedValueOnce({ milestones: [] })
    await milestonesClient.listByProject('p-1', 'archived')
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/p-1/milestones?filter=archived'
    )
  })

  it('appends filter=all', async () => {
    mockApiFetch.mockResolvedValueOnce({ milestones: [] })
    await milestonesClient.listByProject('p-1', 'all')
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/projects/p-1/milestones?filter=all'
    )
  })
})

describe('milestonesClient.archive / unarchive', () => {
  it('POSTs to the archive endpoint', async () => {
    mockApiFetch.mockResolvedValueOnce({ milestone: {} })
    await milestonesClient.archive('m-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/milestones/m-1/archive', {
      method: 'POST',
    })
  })

  it('POSTs to the unarchive endpoint', async () => {
    mockApiFetch.mockResolvedValueOnce({ milestone: {} })
    await milestonesClient.unarchive('m-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/milestones/m-1/unarchive', {
      method: 'POST',
    })
  })
})
