jest.mock('@/lib/api-client/workspaces', () => ({
  workspacesClient: {
    getMe: jest.fn(),
  },
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWorkspace } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspace'
import { workspacesClient } from '@/lib/api-client/workspaces'
import { writeCache } from '@/app/workspace/[workspaceUrl]/cache'
import { CACHE_KEY } from '@/app/workspace/[workspaceUrl]/constants'

const mockGetMe = workspacesClient.getMe as jest.Mock

function makeWorkspace(over: Record<string, unknown> = {}) {
  return {
    workspace: {
      id: 'ws_1',
      name: 'Acme',
      slug: 'acme',
      logoUrl: 'https://cdn/logo.png',
      riskOverdueRatio: 0.42,
      ...over,
    },
    role: 'OWNER',
  }
}

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  // Default staleTime:0 / gcTime:Infinity so the hook's OWN staleTime is what
  // governs refetch behaviour, and cache survives unmount→remount.
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
    },
  })
})

describe('useWorkspace', () => {
  it('useWorkspace fetches workspace metadata once and shares it across consumers', async () => {
    mockGetMe.mockResolvedValue(makeWorkspace())

    // Two independent consumers under the same client (mirrors Sidebar +
    // ProjectDetailPage living on the same page).
    const a = renderHook(() => useWorkspace(), { wrapper: Wrapper })
    const b = renderHook(() => useWorkspace(), { wrapper: Wrapper })

    await waitFor(() => expect(a.result.current.workspace?.name).toBe('Acme'))
    await waitFor(() => expect(b.result.current.workspace?.name).toBe('Acme'))

    // React Query dedupes both consumers onto a single network request.
    expect(mockGetMe).toHaveBeenCalledTimes(1)
    expect(a.result.current.workspace?.riskOverdueRatio).toBe(0.42)
    expect(b.result.current.workspace?.logoUrl).toBe('https://cdn/logo.png')
  })

  it('useWorkspace does not refetch within the stale window', async () => {
    mockGetMe.mockResolvedValue(makeWorkspace())

    const first = renderHook(() => useWorkspace(), { wrapper: Wrapper })
    await waitFor(() =>
      expect(first.result.current.workspace?.name).toBe('Acme')
    )
    expect(mockGetMe).toHaveBeenCalledTimes(1)
    first.unmount()

    // Remount under the same client: the hook's ~10min staleTime keeps the
    // cached workspace fresh, so no second getMe() fires (the client default
    // staleTime is 0 — only the hook's own staleTime can suppress this).
    const second = renderHook(() => useWorkspace(), { wrapper: Wrapper })
    await waitFor(() =>
      expect(second.result.current.workspace?.name).toBe('Acme')
    )
    expect(mockGetMe).toHaveBeenCalledTimes(1)
  })

  it('useWorkspace serves cached workspace metadata as a first-paint placeholder', async () => {
    // Warm localStorage as a prior session/reload would have.
    writeCache(CACHE_KEY.workspace, {
      name: 'Cached Co',
      logoUrl: 'https://cdn/cached.png',
      slug: 'cached',
    })
    // Network hangs — the only data available is the localStorage placeholder.
    mockGetMe.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useWorkspace(), { wrapper: Wrapper })

    // Synchronously on first render — before any fetch resolves — the cached
    // name/logo are already there (no flicker for the Sidebar header).
    expect(result.current.workspace?.name).toBe('Cached Co')
    expect(result.current.workspace?.logoUrl).toBe('https://cdn/cached.png')
  })
})
