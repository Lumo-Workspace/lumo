import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))

jest.mock('@/lib/api-client', () => ({
  tasksClient: { listWorkspace: jest.fn() },
}))

import { tasksClient } from '@/lib/api-client'
import { useWorkspaceTasks } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks'

const mockList = tasksClient.listWorkspace as jest.Mock

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => jest.clearAllMocks())

describe('useWorkspaceTasks', () => {
  it('fetches via tasksClient.listWorkspace and returns tasks + truncated', async () => {
    mockList.mockResolvedValueOnce({
      tasks: [{ id: 't1', title: 'A', teamIdentifier: 'LUM', number: 1 }],
      truncated: false,
    })

    const { result } = renderHook(
      () => useWorkspaceTasks({ statuses: ['TODO'] }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith({ statuses: ['TODO'] })
    expect(result.current.tasks).toHaveLength(1)
    expect(result.current.truncated).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
