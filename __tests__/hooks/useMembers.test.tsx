/** @jest-environment jsdom */

// LUM-594: useMembers is a shared workspace-global React Query cache. These
// tests pin the two invariants the refactor depends on: (1) N consumers +
// remounts within staleTime share a single listMembers fetch (no flicker, no
// duplicate concurrent requests), and (2) a membership mutation can invalidate
// the shared cache so active observers reconcile.

jest.mock('@/lib/api-client', () => ({
  workspacesClient: {
    listMembers: jest.fn(),
  },
}))

import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { workspacesClient } from '@/lib/api-client'
import { useMembers } from '@/app/workspace/[workspaceUrl]/hooks/useMembers'

const mockListMembers = workspacesClient.listMembers as jest.Mock

function membersResponse() {
  return {
    members: [
      {
        id: 'wm_1',
        actorId: 'act_1',
        clerkId: 'usr_1',
        name: 'Ada',
        email: 'ada@example.com',
        imageUrl: null,
        role: 'OWNER',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    agentActors: [
      { actorId: 'agent_1', name: 'Agent', avatarColor: '#000', type: 'AGENT' },
    ],
  }
}

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  mockListMembers.mockReset()
  mockListMembers.mockResolvedValue(membersResponse())
  // gcTime high so an unmounted query's cache survives a remount within the
  // test; retries off so a single rejection doesn't inflate the call count.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
})

describe('useMembers shared cache', () => {
  it('shares a single fetch across consumers and does not refetch within staleTime', async () => {
    // Three concurrent consumers under one client → React Query dedupes to a
    // single in-flight request for the shared ['members'] key.
    const first = renderHook(
      () => {
        useMembers()
        useMembers()
        return useMembers()
      },
      { wrapper: Wrapper }
    )

    await waitFor(() => {
      expect(first.result.current.members).toHaveLength(1)
    })
    expect(mockListMembers).toHaveBeenCalledTimes(1)

    // A later consumer mounting within staleTime reads the cache — no refetch.
    const second = renderHook(() => useMembers(), { wrapper: Wrapper })
    expect(second.result.current.members).toHaveLength(1)

    // Give any (incorrect) refetch a chance to fire, then confirm it didn't.
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockListMembers).toHaveBeenCalledTimes(1)
  })

  it('invalidates the shared members cache and refetches active observers', async () => {
    const { result } = renderHook(() => useMembers(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.members).toHaveLength(1)
    })
    expect(mockListMembers).toHaveBeenCalledTimes(1)

    // A membership mutation invalidates the shared cache; the active observer
    // refetches and stays populated (no empty flash).
    await act(async () => {
      await result.current.invalidateMembers()
    })

    await waitFor(() => {
      expect(mockListMembers).toHaveBeenCalledTimes(2)
    })
    expect(result.current.members).toHaveLength(1)
  })
})
