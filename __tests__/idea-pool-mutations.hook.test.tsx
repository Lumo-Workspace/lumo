/** @jest-environment jsdom */

// LUM-708: the two pool-level mutation hooks behind the Ideas page's inline
// capture and its row status badge. Both patch the pool cache in place rather
// than refetching, so the assertions here are about the request they send AND
// the cache they leave behind — the second half is what the page's rows read.

jest.mock('@/lib/api-client', () => ({
  ideasClient: {
    capture: jest.fn(),
    updateStatus: jest.fn(),
  },
}))

import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCaptureIdea } from '@/app/workspace/[workspaceUrl]/hooks/useCaptureIdea'
import { useUpdateIdeaStatus } from '@/app/workspace/[workspaceUrl]/hooks/useUpdateIdeaStatus'
import { ideasClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { ApiIdea } from '@/app/workspace/[workspaceUrl]/types'

const mockCapture = ideasClient.capture as jest.Mock
const mockUpdateStatus = ideasClient.updateStatus as jest.Mock

const idea = (over: Partial<ApiIdea> = {}): ApiIdea => ({
  id: 'i1',
  number: 1,
  identifier: 'LUM-I1',
  statement: 'faster search',
  status: 'CAPTURED',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
  createdAt: '2026-07-04T10:00:00.000Z',
  planRunId: null,
  initiative: null,
  ...over,
})

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const pool = () =>
  queryClient.getQueryData<ApiIdea[]>(queryKeys.ideas.all()) ?? []

beforeEach(() => {
  jest.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: {
      // gcTime must not be 0 here: these hooks are mutations, so nothing
      // observes the pool query, and a 0 gcTime collects the seeded cache out
      // from under the assertions the moment a mutation doesn't rewrite it.
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
})

describe('useCaptureIdea', () => {
  it('POSTs the statement and prepends the created idea to the pool cache', async () => {
    queryClient.setQueryData(queryKeys.ideas.all(), [idea()])
    const created = idea({ id: 'i2', identifier: 'LUM-I2', statement: 'new' })
    mockCapture.mockResolvedValue({ idea: created })

    const { result } = renderHook(() => useCaptureIdea(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.capture('new')
    })

    expect(mockCapture).toHaveBeenCalledWith({ statement: 'new' })
    // Newest-first, matching the order the API returns the pool in.
    expect(pool().map(i => i.id)).toEqual(['i2', 'i1'])
  })

  it('leaves an unpopulated cache alone rather than seeding a partial pool', async () => {
    mockCapture.mockResolvedValue({ idea: idea({ id: 'i2' }) })

    const { result } = renderHook(() => useCaptureIdea(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.capture('new')
    })

    expect(queryClient.getQueryData(queryKeys.ideas.all())).toBeUndefined()
  })

  it('surfaces a failed capture instead of swallowing it', async () => {
    mockCapture.mockRejectedValue(new Error('nope'))

    const { result } = renderHook(() => useCaptureIdea(), { wrapper: Wrapper })
    await act(async () => {
      await expect(result.current.capture('new')).rejects.toThrow('nope')
    })

    await waitFor(() => expect(result.current.error).toBe('nope'))
  })
})

describe('useUpdateIdeaStatus', () => {
  it('PATCHes the new status and replaces that idea in the pool cache', async () => {
    queryClient.setQueryData(queryKeys.ideas.all(), [
      idea(),
      idea({ id: 'i2', identifier: 'LUM-I2', status: 'PLANNED' }),
    ])
    mockUpdateStatus.mockResolvedValue({
      idea: idea({ status: 'DEVELOPING' }),
    })

    const { result } = renderHook(() => useUpdateIdeaStatus(), {
      wrapper: Wrapper,
    })
    await act(async () => {
      await result.current.updateStatus('i1', 'DEVELOPING')
    })

    expect(mockUpdateStatus).toHaveBeenCalledWith('i1', {
      status: 'DEVELOPING',
    })
    // Only the moved idea changes; its position and its neighbours don't.
    expect(pool().map(i => [i.id, i.status])).toEqual([
      ['i1', 'DEVELOPING'],
      ['i2', 'PLANNED'],
    ])
  })

  it('reports a rejected transition rather than leaving the row looking moved', async () => {
    queryClient.setQueryData(queryKeys.ideas.all(), [
      idea({ status: 'DROPPED' }),
    ])
    mockUpdateStatus.mockRejectedValue(new Error('illegal transition'))

    const { result } = renderHook(() => useUpdateIdeaStatus(), {
      wrapper: Wrapper,
    })
    await act(async () => {
      await expect(
        result.current.updateStatus('i1', 'CAPTURED')
      ).rejects.toThrow('illegal transition')
    })

    // The cache is untouched — there is no optimistic write to roll back.
    expect(pool().map(i => i.status)).toEqual(['DROPPED'])
    await waitFor(() => expect(result.current.error).toBe('illegal transition'))
  })
})
