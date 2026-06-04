/**
 * LUM-202: PR search moved from a bare debounced `.then()` fetch to a cached
 * useQuery. These tests pin the enable-gating (closed popover / empty query /
 * URL case never hit the API) and the cache reuse (re-searching the same term
 * within staleTime serves from cache instead of re-fetching).
 */
jest.mock('@/lib/api-client', () => ({
  tasksClient: { searchPrs: jest.fn() },
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { tasksClient } from '@/lib/api-client'
import { usePrSearch } from '@/app/workspace/[workspaceUrl]/hooks/usePrSearch'

const mockSearchPrs = tasksClient.searchPrs as jest.Mock

const PR = {
  id: 'pr_1',
  repo: 'acme/web',
  number: 42,
  title: 'Fix thing',
  state: 'OPEN',
  task: null,
}

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  // staleTime 0 on the client so only the hook's own staleTime provides
  // freshness — otherwise the client default would mask a missing hook cache.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
})

/** Let any pending debounce + microtasks settle. */
const settle = () => new Promise(r => setTimeout(r, 400))

describe('usePrSearch', () => {
  it('does not search when disabled (popover closed / URL input)', async () => {
    renderHook(() => usePrSearch('ws_1', 'auth fix', false), {
      wrapper: Wrapper,
    })
    await settle()
    expect(mockSearchPrs).not.toHaveBeenCalled()
  })

  it('does not search when the query is empty', async () => {
    renderHook(() => usePrSearch('ws_1', '   ', true), { wrapper: Wrapper })
    await settle()
    expect(mockSearchPrs).not.toHaveBeenCalled()
  })

  it('searches and returns results when enabled with a query', async () => {
    mockSearchPrs.mockResolvedValue({ pullRequests: [PR] })

    const { result } = renderHook(() => usePrSearch('ws_1', 'auth', true), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(mockSearchPrs).toHaveBeenCalledWith('ws_1', 'auth', 10)
    expect(result.current.results[0]?.id).toBe('pr_1')
    expect(result.current.loading).toBe(false)
  })

  it('reuses the cache for the same term within staleTime (no refetch)', async () => {
    mockSearchPrs.mockResolvedValue({ pullRequests: [PR] })

    const first = renderHook(() => usePrSearch('ws_1', 'auth', true), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(first.result.current.results).toHaveLength(1))
    expect(mockSearchPrs).toHaveBeenCalledTimes(1)

    // A second consumer (e.g. reopening the popover) with the same term reads
    // the fresh cache entry instead of hitting the API again.
    const second = renderHook(() => usePrSearch('ws_1', 'auth', true), {
      wrapper: Wrapper,
    })
    await settle()
    expect(second.result.current.results).toHaveLength(1)
    expect(mockSearchPrs).toHaveBeenCalledTimes(1)
  })
})
