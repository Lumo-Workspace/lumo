/**
 * LUM-202: Sentry mappings moved from a bare on-open Promise.all fetch to a
 * cached useQuery + optimistic add/remove mutations. These tests pin the
 * enable-gating, the cached read, and the optimistic cache updates with
 * rollback on failure.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/api-client/sentry', () => ({
  sentryApi: {
    listMappings: jest.fn(),
    createMapping: jest.fn(),
    deleteMapping: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sentryApi } from '@/lib/api-client/sentry'
import { useSentryMappings } from '@/app/workspace/[workspaceUrl]/hooks/useSentryMappings'

const mockList = sentryApi.listMappings as jest.Mock
const mockCreate = sentryApi.createMapping as jest.Mock
const mockDelete = sentryApi.deleteMapping as jest.Mock

const mapping = (
  over: Partial<{ id: string; slug: string; pid: string }> = {}
) => ({
  id: over.id ?? 'map_1',
  sentryProjectSlug: over.slug ?? 'frontend',
  projectId: over.pid ?? 'proj_1',
})

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
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
})

describe('useSentryMappings', () => {
  it('does not fetch when disabled (dialog closed)', async () => {
    renderHook(() => useSentryMappings('acme', false), { wrapper: Wrapper })
    await new Promise(r => setTimeout(r, 50))
    expect(mockList).not.toHaveBeenCalled()
  })

  it('loads mappings when enabled', async () => {
    mockList.mockResolvedValue([mapping()])

    const { result } = renderHook(() => useSentryMappings('acme', true), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith('acme')
    expect(result.current.mappings).toHaveLength(1)
    expect(result.current.mappings[0]?.id).toBe('map_1')
  })

  it('optimistically appends on add, then swaps in the server row', async () => {
    mockList.mockResolvedValue([])
    mockCreate.mockResolvedValue(mapping({ id: 'map_server', slug: 'api' }))

    const { result } = renderHook(() => useSentryMappings('acme', true), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.addMapping({
        sentryProjectSlug: 'api',
        projectId: 'proj_1',
      })
    })

    expect(mockCreate).toHaveBeenCalledWith('acme', {
      sentryProjectSlug: 'api',
      projectId: 'proj_1',
    })
    await waitFor(() =>
      expect(result.current.mappings[0]?.id).toBe('map_server')
    )
    expect(result.current.mappings).toHaveLength(1)
    expect(toast.success).toHaveBeenCalled()
  })

  it('rolls back the optimistic add when the API fails', async () => {
    mockList.mockResolvedValue([])
    mockCreate.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useSentryMappings('acme', true), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current
        .addMapping({ sentryProjectSlug: 'api', projectId: 'proj_1' })
        .catch(() => {})
    })

    await waitFor(() => expect(result.current.mappings).toHaveLength(0))
    expect(toast.error).toHaveBeenCalled()
  })

  it('optimistically removes a mapping', async () => {
    mockList.mockResolvedValue([mapping(), mapping({ id: 'map_2' })])
    mockDelete.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useSentryMappings('acme', true), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.mappings).toHaveLength(2))

    await act(async () => {
      await result.current.removeMapping('map_1')
    })

    expect(mockDelete).toHaveBeenCalledWith('acme', 'map_1')
    await waitFor(() =>
      expect(result.current.mappings.map(m => m.id)).toEqual(['map_2'])
    )
  })

  it('rolls back the optimistic remove when the API fails', async () => {
    mockList.mockResolvedValue([mapping(), mapping({ id: 'map_2' })])
    mockDelete.mockRejectedValue(new Error('nope'))

    const { result } = renderHook(() => useSentryMappings('acme', true), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.mappings).toHaveLength(2))

    await act(async () => {
      await result.current.removeMapping('map_1').catch(() => {})
    })

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(result.current.mappings).toHaveLength(2)
  })
})
