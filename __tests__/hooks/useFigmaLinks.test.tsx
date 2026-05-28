jest.mock('@/lib/api-client/task-figma-links', () => ({
  taskFigmaLinksClient: {
    list: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    refreshAll: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFigmaLinks } from '@/app/workspace/[workspaceUrl]/hooks/useFigmaLinks'
import {
  taskFigmaLinksClient,
  type FigmaLinkJson,
} from '@/lib/api-client/task-figma-links'

const mockList = taskFigmaLinksClient.list as jest.Mock
const mockAdd = taskFigmaLinksClient.add as jest.Mock
const mockRemove = taskFigmaLinksClient.remove as jest.Mock
const mockRefreshAll = taskFigmaLinksClient.refreshAll as jest.Mock

function makeServerLink(over: Partial<FigmaLinkJson> = {}): FigmaLinkJson {
  return {
    id: over.id ?? 'cfl_server',
    fileKey: over.fileKey ?? 'abc',
    nodeId: over.nodeId ?? '1:2',
    url: over.url ?? 'https://www.figma.com/file/abc/F?node-id=1-2',
    fileName: over.fileName ?? 'Onboarding',
    frameName: over.frameName ?? 'Welcome',
    thumbnailUrl: over.thumbnailUrl ?? 'https://thumb.example/a.png',
    thumbnailFetchedAt: over.thumbnailFetchedAt ?? '2026-05-28T00:00:00.000Z',
    lastSyncedAt: over.lastSyncedAt ?? '2026-05-28T00:00:00.000Z',
    lastSyncError: over.lastSyncError ?? null,
    createdAt: over.createdAt ?? '2026-05-20T00:00:00.000Z',
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

describe('useFigmaLinks', () => {
  it('fetches figma links on mount when enabled', async () => {
    mockList.mockResolvedValue({ links: [makeServerLink()] })

    const { result } = renderHook(() => useFigmaLinks('tsk_1'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith('tsk_1')
    expect(result.current.figmaLinks).toHaveLength(1)
    expect(result.current.figmaLinks[0]?.fileName).toBe('Onboarding')
  })

  it('skips fetch when enabled=false', async () => {
    renderHook(() => useFigmaLinks('tsk_1', false), { wrapper: Wrapper })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
  })

  it('add inserts optimistic placeholder then swaps in the server row', async () => {
    mockList.mockResolvedValue({ links: [] })
    let resolveAdd!: (v: { link: FigmaLinkJson }) => void
    mockAdd.mockReturnValue(
      new Promise(resolve => {
        resolveAdd = resolve
      })
    )

    const { result } = renderHook(() => useFigmaLinks('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let addPromise!: Promise<void>
    act(() => {
      addPromise = result.current.add({
        url: 'https://www.figma.com/file/abc/F?node-id=1-2',
      })
    })

    await waitFor(() => expect(result.current.figmaLinks).toHaveLength(1))
    const placeholder = result.current.figmaLinks[0]!
    expect(placeholder.loading).toBe(true)
    expect(placeholder.tempId).toBeDefined()

    await act(async () => {
      resolveAdd({
        link: makeServerLink({
          id: 'cfl_new',
          url: 'https://www.figma.com/file/abc/F?node-id=1-2',
        }),
      })
      await addPromise
    })

    await waitFor(() =>
      expect(result.current.figmaLinks[0]?.id).toBe('cfl_new')
    )
    expect(result.current.figmaLinks).toHaveLength(1)
    expect(result.current.figmaLinks[0]?.loading).toBeUndefined()
    expect(result.current.figmaLinks[0]?.tempId).toBeUndefined()
  })

  it('add drops the placeholder on failure and rethrows', async () => {
    mockList.mockResolvedValue({ links: [] })
    mockAdd.mockRejectedValue(
      Object.assign(new Error('Figma not connected'), {
        code: 'figma_not_connected',
      })
    )

    const { result } = renderHook(() => useFigmaLinks('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(
        result.current.add({ url: 'https://www.figma.com/file/abc/F' })
      ).rejects.toThrow('Figma not connected')
    })

    // Placeholder removed entirely; no ghost row left behind.
    await waitFor(() => expect(result.current.figmaLinks).toHaveLength(0))
  })

  it('remove drops the row from cache on success', async () => {
    mockList.mockResolvedValue({
      links: [makeServerLink({ id: 'cfl_a' }), makeServerLink({ id: 'cfl_b' })],
    })
    mockRemove.mockResolvedValue(undefined)

    const { result } = renderHook(() => useFigmaLinks('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.figmaLinks).toHaveLength(2))

    await act(async () => {
      await result.current.remove('cfl_a')
    })

    await waitFor(() => expect(result.current.figmaLinks).toHaveLength(1))
    expect(result.current.figmaLinks[0]?.id).toBe('cfl_b')
  })

  it('refreshAll re-fetches the list when at least one link succeeded', async () => {
    mockList
      .mockResolvedValueOnce({ links: [makeServerLink({ id: 'cfl_a' })] })
      .mockResolvedValueOnce({
        links: [makeServerLink({ id: 'cfl_a', fileName: 'Updated' })],
      })
    mockRefreshAll.mockResolvedValue({
      results: [{ id: 'cfl_a', ok: true }],
    })

    const { result } = renderHook(() => useFigmaLinks('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.figmaLinks).toHaveLength(1))

    await act(async () => {
      await result.current.refreshAll()
    })

    await waitFor(() =>
      expect(result.current.figmaLinks[0]?.fileName).toBe('Updated')
    )
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('refreshAll does NOT re-fetch when all results failed', async () => {
    mockList.mockResolvedValue({ links: [makeServerLink({ id: 'cfl_a' })] })
    mockRefreshAll.mockResolvedValue({
      results: [{ id: 'cfl_a', ok: false, error: 'figma_needs_reauth' }],
    })

    const { result } = renderHook(() => useFigmaLinks('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.figmaLinks).toHaveLength(1))

    await act(async () => {
      await result.current.refreshAll()
    })

    expect(mockList).toHaveBeenCalledTimes(1)
  })
})
