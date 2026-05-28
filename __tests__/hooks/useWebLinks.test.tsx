jest.mock('@/lib/api-client/task-web-links', () => ({
  webLinksClient: {
    list: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    refresh: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWebLinks } from '@/app/workspace/[workspaceUrl]/hooks/useWebLinks'
import { webLinksClient } from '@/lib/api-client/task-web-links'

const mockList = webLinksClient.list as jest.Mock
const mockAdd = webLinksClient.add as jest.Mock
const mockRemove = webLinksClient.remove as jest.Mock
const mockRefresh = webLinksClient.refresh as jest.Mock

function makeServerLink(over: Partial<{ id: string; url: string }> = {}) {
  return {
    id: over.id ?? 'wl_server',
    taskId: 'tsk_1',
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

describe('useWebLinks', () => {
  it('fetches web links on mount when enabled', async () => {
    mockList.mockResolvedValue({ webLinks: [makeServerLink()] })

    const { result } = renderHook(() => useWebLinks('tsk_1'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith('tsk_1')
    expect(result.current.webLinks).toHaveLength(1)
    expect(result.current.webLinks[0]?.url).toBe('https://example.com')
  })

  it('skips fetch when enabled=false', async () => {
    renderHook(() => useWebLinks('tsk_1', false), { wrapper: Wrapper })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
  })

  it('add inserts optimistic placeholder then replaces with server row', async () => {
    mockList.mockResolvedValue({ webLinks: [] })
    let resolveAdd!: (v: { webLink: ReturnType<typeof makeServerLink> }) => void
    mockAdd.mockReturnValue(
      new Promise(resolve => {
        resolveAdd = resolve
      })
    )

    const { result } = renderHook(() => useWebLinks('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let addPromise!: Promise<void>
    act(() => {
      addPromise = result.current.add({ url: 'https://foo.com' })
    })

    await waitFor(() => expect(result.current.webLinks).toHaveLength(1))
    const placeholder = result.current.webLinks[0]!
    expect(placeholder.loading).toBe(true)
    expect(placeholder.tempId).toBeDefined()
    expect(placeholder.url).toBe('https://foo.com')

    await act(async () => {
      resolveAdd({
        webLink: makeServerLink({ id: 'wl_new', url: 'https://foo.com' }),
      })
      await addPromise
    })

    await waitFor(() => expect(result.current.webLinks[0]?.id).toBe('wl_new'))
    expect(result.current.webLinks).toHaveLength(1)
    expect(result.current.webLinks[0]?.loading).toBeUndefined()
    expect(result.current.webLinks[0]?.tempId).toBeUndefined()
  })

  it('add marks placeholder with fetchError on failure', async () => {
    mockList.mockResolvedValue({ webLinks: [] })
    mockAdd.mockRejectedValue(new Error('bad url'))

    const { result } = renderHook(() => useWebLinks('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.add({ url: 'not-a-url' })).rejects.toThrow(
        'bad url'
      )
    })

    await waitFor(() => expect(result.current.webLinks).toHaveLength(1))
    expect(result.current.webLinks[0]?.fetchError).toBe('bad url')
    expect(result.current.webLinks[0]?.loading).toBe(false)
  })

  it('remove drops the row from cache on success', async () => {
    mockList.mockResolvedValue({
      webLinks: [
        makeServerLink({ id: 'wl_a' }),
        makeServerLink({ id: 'wl_b' }),
      ],
    })
    mockRemove.mockResolvedValue(undefined)

    const { result } = renderHook(() => useWebLinks('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.webLinks).toHaveLength(2))

    await act(async () => {
      await result.current.remove('wl_a')
    })

    await waitFor(() => expect(result.current.webLinks).toHaveLength(1))
    expect(result.current.webLinks[0]?.id).toBe('wl_b')
  })

  it('refreshOne replaces the matching row with the refreshed payload', async () => {
    mockList.mockResolvedValue({
      webLinks: [makeServerLink({ id: 'wl_a' })],
    })
    mockRefresh.mockResolvedValue({
      webLink: { ...makeServerLink({ id: 'wl_a' }), title: 'Updated' },
    })

    const { result } = renderHook(() => useWebLinks('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.webLinks).toHaveLength(1))

    await act(async () => {
      await result.current.refreshOne('wl_a')
    })

    await waitFor(() =>
      expect(result.current.webLinks[0]?.title).toBe('Updated')
    )
  })
})
