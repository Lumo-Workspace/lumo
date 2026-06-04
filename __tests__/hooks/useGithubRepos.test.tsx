/**
 * LUM-202: the project-overview repo picker moved from a bare on-open
 * `apiFetch` in the component to a cached useQuery hook. These tests pin the
 * enable-gating, the connected/not-connected mapping (the repos endpoint 404s
 * when GitHub isn't connected), and cache reuse across reopen.
 */
jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
import { useGithubRepos } from '@/app/workspace/[workspaceUrl]/hooks/useGithubRepos'

const mockApiFetch = apiFetch as jest.Mock

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
})

describe('useGithubRepos', () => {
  it('does not fetch when disabled (picker closed)', async () => {
    renderHook(() => useGithubRepos('acme', false), { wrapper: Wrapper })
    await new Promise(r => setTimeout(r, 50))
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('loads repos and reports connected when enabled', async () => {
    mockApiFetch.mockResolvedValue({
      repos: [{ fullName: 'acme/web', private: false }],
    })

    const { result } = renderHook(() => useGithubRepos('acme', true), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/github/repos?workspaceUrl=acme'
    )
    expect(result.current.repos).toHaveLength(1)
    expect(result.current.connected).toBe(true)
  })

  it('reports not connected when the endpoint errors (404)', async () => {
    mockApiFetch.mockRejectedValue(new Error('GitHub not connected'))

    const { result } = renderHook(() => useGithubRepos('acme', true), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.connected).toBe(false))
    expect(result.current.repos).toHaveLength(0)
  })

  it('reuses the cache on reopen within staleTime (no refetch)', async () => {
    mockApiFetch.mockResolvedValue({ repos: [] })

    const first = renderHook(() => useGithubRepos('acme', true), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(mockApiFetch).toHaveBeenCalledTimes(1)

    const second = renderHook(() => useGithubRepos('acme', true), {
      wrapper: Wrapper,
    })
    await new Promise(r => setTimeout(r, 50))
    expect(second.result.current.connected).toBe(true)
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })
})
