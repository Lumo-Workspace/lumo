jest.mock('@/lib/api-client/idea-web-links', () => ({
  ideaWebLinksClient: {
    list: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    refresh: jest.fn(),
  },
}))

import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIdeaWebLinks } from '@/app/workspace/[workspaceUrl]/hooks/useIdeaWebLinks'
import { ideaWebLinksClient } from '@/lib/api-client/idea-web-links'

const mockList = ideaWebLinksClient.list as jest.Mock

function makeServerLink(over: Partial<{ id: string; url: string }> = {}) {
  return {
    id: over.id ?? 'wl_server',
    ideaId: 'idea1',
    workspaceId: 'ws_1',
    url: over.url ?? 'https://example.com',
    domain: 'example.com',
    title: 'Example',
    description: null,
    note: null,
    imageUrl: null,
    faviconUrl: null,
    fetchedAt: new Date('2026-05-01T00:00:00Z'),
    fetchError: null,
    body: null,
    bodyFetchedAt: null,
    createdById: 'u_1',
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
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
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
})

describe('useIdeaWebLinks', () => {
  it('fetches web links on mount and populates webLinks', async () => {
    mockList.mockResolvedValue({ webLinks: [makeServerLink()] })

    const { result } = renderHook(() => useIdeaWebLinks('idea1'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith('idea1')
    expect(result.current.webLinks).toHaveLength(1)
    expect(result.current.webLinks[0]?.url).toBe('https://example.com')
  })
})
