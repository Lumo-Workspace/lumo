/** @jest-environment jsdom */

jest.mock('@/lib/api-client', () => ({
  tasksClient: { progress: jest.fn() },
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useTaskProgress } from '@/app/workspace/[workspaceUrl]/hooks/useTaskProgress'
import { tasksClient } from '@/lib/api-client'

const fetchProgress = tasksClient.progress as jest.Mock

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return Wrapper
}

beforeEach(() => fetchProgress.mockReset())

it('is disabled (no fetch) when taskId is null', () => {
  renderHook(() => useTaskProgress(null), { wrapper: wrapper() })
  expect(fetchProgress).not.toHaveBeenCalled()
})

it('fetches and returns progress when taskId is set', async () => {
  fetchProgress.mockResolvedValue({ progress: { sessionCount: 2 } })
  const { result } = renderHook(() => useTaskProgress('t1'), {
    wrapper: wrapper(),
  })
  await waitFor(() => expect(result.current.progress).toBeDefined())
  expect(result.current.progress?.sessionCount).toBe(2)
})
