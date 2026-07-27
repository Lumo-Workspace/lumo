import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))
jest.mock('@/lib/api-client', () => ({
  milestonesClient: { listByWorkspace: jest.fn() },
}))

import { milestonesClient } from '@/lib/api-client'
import { useWorkspaceMilestones } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceMilestones'

const mock = milestonesClient.listByWorkspace as jest.Mock

const wrapper = ({ children }: { children: ReactNode }) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>
}

beforeEach(() => jest.clearAllMocks())

describe('useWorkspaceMilestones', () => {
  it('fetches and returns milestones', async () => {
    mock.mockResolvedValueOnce({ milestones: [{ id: 'm1', name: 'M1' }] })
    const { result } = renderHook(() => useWorkspaceMilestones(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.milestones).toHaveLength(1)
  })

  it('returns empty array while loading', () => {
    mock.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useWorkspaceMilestones(), { wrapper })
    expect(result.current.milestones).toEqual([])
  })

  it('returns error message on failure', async () => {
    mock.mockRejectedValueOnce(new Error('Network error'))
    const { result } = renderHook(() => useWorkspaceMilestones(), { wrapper })
    await waitFor(() => expect(result.current.error).toBe('Network error'))
    expect(result.current.milestones).toEqual([])
  })
})
