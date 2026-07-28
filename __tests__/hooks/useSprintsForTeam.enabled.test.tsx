jest.mock('@/lib/api-client', () => ({
  sprintsClient: { listByTeam: jest.fn() },
  tasksClient: { listBySprint: jest.fn(), listByTeam: jest.fn() },
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSprintsForTeam } from '@/app/workspace/[workspaceUrl]/hooks/useSprints'
import { sprintsClient } from '@/lib/api-client'

const mockList = sprintsClient.listByTeam as jest.Mock

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  })
})

describe('useSprintsForTeam — enabled gating (LUM-190)', () => {
  it('fetches on mount when enabled defaults to true', async () => {
    mockList.mockResolvedValue({ sprints: [{ id: 'sp_1', name: 'Sprint 1' }] })

    const { result } = renderHook(() => useSprintsForTeam('team_1', 'ACTIVE'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockList).toHaveBeenCalledWith('team_1', { status: 'ACTIVE' })
    expect(result.current.sprints).toHaveLength(1)
  })

  it('skips the fetch when enabled=false (dropdown closed)', async () => {
    renderHook(() => useSprintsForTeam('team_1', 'ACTIVE', false), {
      wrapper: Wrapper,
    })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
  })

  // A deferred (disabled) query is `isPending` but not actually fetching;
  // `isLoading` must read false so the field skeleton (LUM-191) isn't pinned on.
  it('reports isLoading=false while deferred (enabled=false)', async () => {
    const { result } = renderHook(
      () => useSprintsForTeam('team_1', 'ACTIVE', false),
      { wrapper: Wrapper }
    )
    await new Promise(r => setTimeout(r, 0))
    expect(result.current.isLoading).toBe(false)
  })

  it('fetches once enabled flips to true (dropdown opened)', async () => {
    mockList.mockResolvedValue({ sprints: [] })

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useSprintsForTeam('team_1', 'DRAFT', open),
      { wrapper: Wrapper, initialProps: { open: false } }
    )

    expect(mockList).not.toHaveBeenCalled()

    rerender({ open: true })
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith('team_1', { status: 'DRAFT' })
    )
  })

  it('stays disabled when teamId is null regardless of enabled', async () => {
    renderHook(() => useSprintsForTeam(null, 'ACTIVE', true), {
      wrapper: Wrapper,
    })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
  })
})
