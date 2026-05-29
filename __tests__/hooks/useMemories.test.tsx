jest.mock('@/lib/api-client/memories', () => ({
  memoriesClient: {
    listForTask: jest.fn(),
    listForProject: jest.fn(),
    createForTask: jest.fn(),
    createForProject: jest.fn(),
    editContent: jest.fn(),
    promoteToProject: jest.fn(),
    remove: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemories } from '@/app/workspace/[workspaceUrl]/hooks/useMemories'
import { memoriesClient } from '@/lib/api-client/memories'

const mockListForTask = memoriesClient.listForTask as jest.Mock
const mockListForProject = memoriesClient.listForProject as jest.Mock
const mockCreateForTask = memoriesClient.createForTask as jest.Mock
const mockCreateForProject = memoriesClient.createForProject as jest.Mock
const mockEditContent = memoriesClient.editContent as jest.Mock
const mockPromoteToProject = memoriesClient.promoteToProject as jest.Mock
const mockRemove = memoriesClient.remove as jest.Mock

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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

describe('useMemories', () => {
  it('loads task memories via listForTask', async () => {
    mockListForTask.mockResolvedValue({ memories: [{ id: 'm1' }] })

    const { result } = renderHook(() => useMemories({ scope: 'task', parentId: 't1' }), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockListForTask).toHaveBeenCalledWith('t1')
    expect(result.current.memories).toEqual([{ id: 'm1' }])
  })

  it('loads project memories via listForProject', async () => {
    mockListForProject.mockResolvedValue({ memories: [{ id: 'pm1' }, { id: 'pm2' }] })

    const { result } = renderHook(
      () => useMemories({ scope: 'project', parentId: 'p1' }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockListForProject).toHaveBeenCalledWith('p1')
    expect(mockListForTask).not.toHaveBeenCalled()
    expect(result.current.memories).toHaveLength(2)
  })

  it('returns empty array before data resolves', () => {
    // Never resolves during this test
    mockListForTask.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useMemories({ scope: 'task', parentId: 't1' }), {
      wrapper: Wrapper,
    })

    expect(result.current.memories).toEqual([])
    expect(result.current.loading).toBe(true)
  })

  it('skips fetch when enabled=false', async () => {
    mockListForTask.mockResolvedValue({ memories: [] })

    renderHook(() => useMemories({ scope: 'task', parentId: 't1', enabled: false }), {
      wrapper: Wrapper,
    })

    await new Promise(r => setTimeout(r, 0))
    expect(mockListForTask).not.toHaveBeenCalled()
  })

  it('surfaces a query error message', async () => {
    mockListForProject.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(
      () => useMemories({ scope: 'project', parentId: 'p1' }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.memories).toEqual([])
  })

  it('create calls createForTask and invalidates the list', async () => {
    mockListForTask.mockResolvedValue({ memories: [] })
    mockCreateForTask.mockResolvedValue({ memory: { id: 'new' } })

    const { result } = renderHook(() => useMemories({ scope: 'task', parentId: 't1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // After create resolves, listForTask is re-called (invalidation)
    mockListForTask.mockResolvedValue({ memories: [{ id: 'new' }] })

    await act(async () => {
      await result.current.create({ category: 'TRAP', content: { trigger: 'x', outcome: 'y' } })
    })

    expect(mockCreateForTask).toHaveBeenCalledWith('t1', {
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
    })
    await waitFor(() => expect(result.current.memories).toEqual([{ id: 'new' }]))
  })

  it('create calls createForProject when scope is project', async () => {
    mockListForProject.mockResolvedValue({ memories: [] })
    mockCreateForProject.mockResolvedValue({ memory: { id: 'proj-new' } })

    const { result } = renderHook(
      () => useMemories({ scope: 'project', parentId: 'p1' }),
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.create({ category: 'DECISION', content: { summary: 'use postgres' } })
    })

    expect(mockCreateForProject).toHaveBeenCalledWith('p1', {
      category: 'DECISION',
      content: { summary: 'use postgres' },
    })
    expect(mockCreateForTask).not.toHaveBeenCalled()
  })

  it('edit calls editContent and invalidates the list', async () => {
    mockListForTask.mockResolvedValue({ memories: [{ id: 'm1', content: { old: true } }] })
    mockEditContent.mockResolvedValue({ memory: { id: 'm1', content: { new: true } } })

    const { result } = renderHook(() => useMemories({ scope: 'task', parentId: 't1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockListForTask.mockResolvedValue({ memories: [{ id: 'm1', content: { new: true } }] })

    await act(async () => {
      await result.current.edit('m1', { new: true })
    })

    expect(mockEditContent).toHaveBeenCalledWith('m1', { new: true })
    await waitFor(() =>
      expect(result.current.memories[0]).toMatchObject({ id: 'm1', content: { new: true } })
    )
  })

  it('promote calls promoteToProject and invalidates both lists', async () => {
    mockListForTask.mockResolvedValue({ memories: [{ id: 'm1' }] })
    mockPromoteToProject.mockResolvedValue({ memory: { id: 'm1' } })

    const queryInvalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useMemories({ scope: 'task', parentId: 't1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockListForTask.mockResolvedValue({ memories: [] })

    await act(async () => {
      await result.current.promote('m1')
    })

    expect(mockPromoteToProject).toHaveBeenCalledWith('m1')

    // Should invalidate the task list AND the project memories list
    const keys = queryInvalidateSpy.mock.calls.map(c => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toContainEqual(['memories', 'task', 't1'])
    expect(keys).toContainEqual(['memories', 'project'])
  })

  it('remove calls the remove client and invalidates the list', async () => {
    mockListForTask.mockResolvedValue({ memories: [{ id: 'm1' }, { id: 'm2' }] })
    mockRemove.mockResolvedValue(undefined)

    const { result } = renderHook(() => useMemories({ scope: 'task', parentId: 't1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.memories).toHaveLength(2))

    mockListForTask.mockResolvedValue({ memories: [{ id: 'm2' }] })

    await act(async () => {
      await result.current.remove('m1')
    })

    expect(mockRemove).toHaveBeenCalledWith('m1')
    await waitFor(() => expect(result.current.memories).toHaveLength(1))
    expect(result.current.memories[0]).toMatchObject({ id: 'm2' })
  })

  it('mutating is true while a mutation is in-flight', async () => {
    mockListForTask.mockResolvedValue({ memories: [] })

    let resolveMutation!: (v: { memory: { id: string } }) => void
    mockCreateForTask.mockReturnValue(
      new Promise(resolve => {
        resolveMutation = resolve
      })
    )

    const { result } = renderHook(() => useMemories({ scope: 'task', parentId: 't1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let createPromise!: Promise<unknown>
    act(() => {
      createPromise = result.current.create({ category: 'TRAP', content: {} })
    })

    await waitFor(() => expect(result.current.mutating).toBe(true))

    await act(async () => {
      resolveMutation({ memory: { id: 'done' } })
      await createPromise
    })

    await waitFor(() => expect(result.current.mutating).toBe(false))
  })
})
