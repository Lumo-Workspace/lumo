jest.mock('@/lib/api-client', () => ({
  tasksClient: { listByMilestone: jest.fn() },
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMilestoneTasks } from '@/app/workspace/[workspaceUrl]/hooks/useMilestoneTasks'
import { tasksClient } from '@/lib/api-client'

const mockList = tasksClient.listByMilestone as jest.Mock

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

describe('useMilestoneTasks (LUM-255)', () => {
  it('fetches the milestone tasks on mount and returns them', async () => {
    mockList.mockResolvedValue({
      tasks: [{ id: 't_1', title: 'A', status: 'TODO' }],
    })

    const { result } = renderHook(() => useMilestoneTasks('ms_1'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockList).toHaveBeenCalledWith('ms_1')
    expect(result.current.tasks).toHaveLength(1)
  })

  it('stays disabled when milestoneId is null (no fetch, not loading)', async () => {
    const { result } = renderHook(() => useMilestoneTasks(null), {
      wrapper: Wrapper,
    })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
  })
})
