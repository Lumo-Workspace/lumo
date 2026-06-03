jest.mock('@/lib/api-client', () => ({
  milestonesClient: { listByProject: jest.fn() },
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMilestones } from '@/app/workspace/[workspaceUrl]/hooks/useMilestones'
import { milestonesClient } from '@/lib/api-client'

const mockList = milestonesClient.listByProject as jest.Mock

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

describe('useMilestones — enabled gating (LUM-190)', () => {
  it('fetches on mount when enabled defaults to true', async () => {
    mockList.mockResolvedValue({ milestones: [{ id: 'ms_1', name: 'M1' }] })

    const { result } = renderHook(() => useMilestones('proj_1'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith('proj_1', 'active')
    expect(result.current.milestones).toHaveLength(1)
  })

  it('skips the fetch when enabled=false (dropdown closed)', async () => {
    renderHook(() => useMilestones('proj_1', 'active', false), {
      wrapper: Wrapper,
    })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
  })

  it('fetches once enabled flips to true (dropdown opened)', async () => {
    mockList.mockResolvedValue({ milestones: [] })

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useMilestones('proj_1', 'active', open),
      { wrapper: Wrapper, initialProps: { open: false } }
    )

    expect(mockList).not.toHaveBeenCalled()

    rerender({ open: true })
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith('proj_1', 'active')
    )
  })

  it('stays disabled when projectId is null regardless of enabled', async () => {
    renderHook(() => useMilestones(null, 'active', true), { wrapper: Wrapper })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
  })
})
