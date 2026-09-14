jest.mock('@/lib/api-client', () => ({
  milestonesClient: {
    archive: jest.fn(),
    unarchive: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useMilestoneArchive,
  patchMilestoneArchivedAt,
} from '@/app/workspace/[workspaceUrl]/hooks/useMilestoneArchive'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

const mockArchive = milestonesClient.archive as jest.Mock
const mockUnarchive = milestonesClient.unarchive as jest.Mock

function makeMilestone(over: Partial<ApiMilestone> = {}): ApiMilestone {
  return {
    id: 'ms_1',
    projectId: 'proj_1',
    name: 'Beta',
    slug: 'beta',
    description: null,
    startDate: null,
    targetDate: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...over,
  }
}

const listKey = [...queryKeys.milestones.byProject('proj_1'), 'active']
const detailKey = queryKeys.milestones.detail('ms_1')

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  // gcTime: Infinity — the hook patches these caches via setQueriesData without
  // subscribing to them, so a 0 gcTime would garbage-collect the seeded data
  // (no observers) before onMutate runs.
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
})

describe('patchMilestoneArchivedAt', () => {
  it('flips archivedAt on the matching milestone in a list cache', () => {
    const list = [makeMilestone({ id: 'ms_1' }), makeMilestone({ id: 'ms_2' })]
    const next = patchMilestoneArchivedAt(list, 'ms_1', '2026-06-03T00:00:00Z')
    expect(Array.isArray(next) && next[0]?.archivedAt).toBe(
      '2026-06-03T00:00:00Z'
    )
    expect(Array.isArray(next) && next[1]?.archivedAt).toBeNull()
  })

  it('returns the same array reference when nothing matched', () => {
    const list = [makeMilestone({ id: 'ms_2' })]
    expect(patchMilestoneArchivedAt(list, 'ms_1', 'x')).toBe(list)
  })

  it('flips archivedAt on a single-milestone (detail) cache', () => {
    const one = makeMilestone({ id: 'ms_1' })
    const next = patchMilestoneArchivedAt(one, 'ms_1', 'x')
    expect((next as ApiMilestone).archivedAt).toBe('x')
  })

  it('passes null/undefined caches through untouched', () => {
    expect(patchMilestoneArchivedAt(null, 'ms_1', 'x')).toBeNull()
    expect(patchMilestoneArchivedAt(undefined, 'ms_1', 'x')).toBeUndefined()
  })
})

describe('useMilestoneArchive', () => {
  it('optimistically flips archivedAt across list and detail caches, then invalidates on success', async () => {
    queryClient.setQueryData(listKey, [makeMilestone({ id: 'ms_1' })])
    queryClient.setQueryData(detailKey, makeMilestone({ id: 'ms_1' }))

    let resolveArchive!: (_v: { milestone: ApiMilestone }) => void
    mockArchive.mockReturnValue(
      new Promise(resolve => {
        resolveArchive = resolve
      })
    )
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useMilestoneArchive(), {
      wrapper: Wrapper,
    })

    let mutatePromise!: Promise<unknown>
    act(() => {
      mutatePromise = result.current.archive.mutateAsync(
        makeMilestone({ id: 'ms_1' })
      )
    })

    // Optimistic write lands before the server responds.
    await waitFor(() => {
      const list = queryClient.getQueryData<ApiMilestone[]>(listKey)
      expect(list?.[0]?.archivedAt).toBeTruthy()
    })
    expect(
      queryClient.getQueryData<ApiMilestone>(detailKey)?.archivedAt
    ).toBeTruthy()
    expect(mockArchive).toHaveBeenCalledWith('ms_1')

    await act(async () => {
      resolveArchive({ milestone: makeMilestone({ id: 'ms_1' }) })
      await mutatePromise
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.milestones.byProject('proj_1'),
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.milestones.detail('ms_1'),
    })
  })

  it('rolls back the optimistic flip when the server rejects', async () => {
    queryClient.setQueryData(listKey, [makeMilestone({ id: 'ms_1' })])
    mockArchive.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useMilestoneArchive(), {
      wrapper: Wrapper,
    })

    await act(async () => {
      await expect(
        result.current.archive.mutateAsync(makeMilestone({ id: 'ms_1' }))
      ).rejects.toThrow('boom')
    })

    const list = queryClient.getQueryData<ApiMilestone[]>(listKey)
    expect(list?.[0]?.archivedAt).toBeNull()
  })

  it('unarchive optimistically clears archivedAt', async () => {
    queryClient.setQueryData(listKey, [
      makeMilestone({ id: 'ms_1', archivedAt: '2026-06-01T00:00:00Z' }),
    ])
    let resolveUnarchive!: (_v: { milestone: ApiMilestone }) => void
    mockUnarchive.mockReturnValue(
      new Promise(resolve => {
        resolveUnarchive = resolve
      })
    )

    const { result } = renderHook(() => useMilestoneArchive(), {
      wrapper: Wrapper,
    })

    let mutatePromise!: Promise<unknown>
    act(() => {
      mutatePromise = result.current.unarchive.mutateAsync(
        makeMilestone({ id: 'ms_1', archivedAt: '2026-06-01T00:00:00Z' })
      )
    })

    await waitFor(() => {
      const list = queryClient.getQueryData<ApiMilestone[]>(listKey)
      expect(list?.[0]?.archivedAt).toBeNull()
    })

    await act(async () => {
      resolveUnarchive({ milestone: makeMilestone({ id: 'ms_1' }) })
      await mutatePromise
    })
    expect(mockUnarchive).toHaveBeenCalledWith('ms_1')
  })
})
