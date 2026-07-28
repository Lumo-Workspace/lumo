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
import { memoriesClient, type MemoryRow } from '@/lib/api-client/memories'

const mockListForTask = memoriesClient.listForTask as jest.Mock
const mockListForProject = memoriesClient.listForProject as jest.Mock
const mockCreateForTask = memoriesClient.createForTask as jest.Mock
const mockCreateForProject = memoriesClient.createForProject as jest.Mock
const mockEditContent = memoriesClient.editContent as jest.Mock
const mockPromoteToProject = memoriesClient.promoteToProject as jest.Mock
const mockRemove = memoriesClient.remove as jest.Mock

function makeMemory(over: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: over.id ?? 'm1',
    scope: over.scope ?? 'TASK',
    category: over.category ?? 'TRAP',
    agent: over.agent ?? 'CLAUDE_CODE',
    content: over.content ?? { trigger: 'x', outcome: 'y' },
    taskId: over.taskId ?? 't1',
    createdByMemberId: over.createdByMemberId ?? null,
    createdAt: over.createdAt ?? '2026-05-20T00:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-05-20T00:00:00.000Z',
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

describe('useMemories', () => {
  it('loads task memories via listForTask', async () => {
    mockListForTask.mockResolvedValue({ memories: [makeMemory({ id: 'm1' })] })

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockListForTask).toHaveBeenCalledWith('t1')
    expect(result.current.memories).toHaveLength(1)
    expect(result.current.memories[0]?.id).toBe('m1')
  })

  it('loads project memories via listForProject', async () => {
    mockListForProject.mockResolvedValue({
      memories: [makeMemory({ id: 'pm1' }), makeMemory({ id: 'pm2' })],
    })

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
    mockListForTask.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )

    expect(result.current.memories).toEqual([])
    expect(result.current.loading).toBe(true)
  })

  it('skips fetch when enabled=false', async () => {
    mockListForTask.mockResolvedValue({ memories: [] })

    renderHook(
      () => useMemories({ scope: 'task', parentId: 't1', enabled: false }),
      {
        wrapper: Wrapper,
      }
    )

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

  it('create inserts an optimistic placeholder then reconciles via refetch', async () => {
    mockListForTask.mockResolvedValue({ memories: [] })
    let resolveCreate!: (v: { memory: { id: string } }) => void
    mockCreateForTask.mockReturnValue(
      new Promise(resolve => {
        resolveCreate = resolve
      })
    )

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    let createPromise!: Promise<unknown>
    act(() => {
      createPromise = result.current.create({
        category: 'TRAP',
        content: { trigger: 'x', outcome: 'y' },
      })
    })

    // Placeholder shows immediately, before the server resolves.
    await waitFor(() => expect(result.current.memories).toHaveLength(1))
    const placeholder = result.current.memories[0]!
    expect(placeholder.loading).toBe(true)
    expect(placeholder.tempId).toBeDefined()
    expect(placeholder.category).toBe('TRAP')
    expect(placeholder.content).toEqual({ trigger: 'x', outcome: 'y' })

    // Server returns only the new id; the hook reconciles with a refetch that
    // carries the server-authored fields (agent, createdByMemberId, …).
    mockListForTask.mockResolvedValue({
      memories: [makeMemory({ id: 'new', createdByMemberId: 'mem_1' })],
    })

    await act(async () => {
      resolveCreate({ memory: { id: 'new' } })
      await createPromise
    })

    expect(mockCreateForTask).toHaveBeenCalledWith('t1', {
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
    })
    await waitFor(() => expect(result.current.memories[0]?.id).toBe('new'))
    expect(result.current.memories[0]?.loading).toBeUndefined()
    expect(result.current.memories[0]?.tempId).toBeUndefined()
    expect(result.current.memories[0]?.createdByMemberId).toBe('mem_1')
  })

  it('create drops the placeholder on failure and rethrows', async () => {
    mockListForTask.mockResolvedValue({ memories: [] })
    mockCreateForTask.mockRejectedValue(new Error('Server error'))

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(
        result.current.create({ category: 'TRAP', content: {} })
      ).rejects.toThrow('Server error')
    })

    await waitFor(() => expect(result.current.memories).toHaveLength(0))
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
      await result.current.create({
        category: 'DECISION',
        content: { summary: 'use postgres' },
      })
    })

    expect(mockCreateForProject).toHaveBeenCalledWith('p1', {
      category: 'DECISION',
      content: { summary: 'use postgres' },
    })
    expect(mockCreateForTask).not.toHaveBeenCalled()
  })

  it('edit optimistically patches content and keeps the server row on success', async () => {
    mockListForTask.mockResolvedValue({
      memories: [makeMemory({ id: 'm1', content: { old: true } })],
    })
    let resolveEdit!: (v: { memory: MemoryRow }) => void
    mockEditContent.mockReturnValue(
      new Promise(resolve => {
        resolveEdit = resolve
      })
    )

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )
    await waitFor(() => expect(result.current.memories).toHaveLength(1))

    let editPromise!: Promise<unknown>
    act(() => {
      editPromise = result.current.edit('m1', { new: true })
    })

    // Optimistic patch is visible before the server resolves.
    await waitFor(() =>
      expect(result.current.memories[0]?.content).toEqual({ new: true })
    )

    await act(async () => {
      resolveEdit({ memory: makeMemory({ id: 'm1', content: { new: true } }) })
      await editPromise
    })

    expect(mockEditContent).toHaveBeenCalledWith('m1', { new: true })
    expect(result.current.memories[0]?.content).toEqual({ new: true })
  })

  it('edit reverts the row on failure and rethrows', async () => {
    mockListForTask.mockResolvedValue({
      memories: [makeMemory({ id: 'm1', content: { old: true } })],
    })
    mockEditContent.mockRejectedValue(new Error('Patch failed'))

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )
    await waitFor(() => expect(result.current.memories).toHaveLength(1))

    await act(async () => {
      await expect(result.current.edit('m1', { new: true })).rejects.toThrow(
        'Patch failed'
      )
    })

    await waitFor(() =>
      expect(result.current.memories[0]?.content).toEqual({ old: true })
    )
  })

  it('promote optimistically removes the row and invalidates the project list', async () => {
    mockListForTask.mockResolvedValue({
      memories: [makeMemory({ id: 'm1', scope: 'TASK' })],
    })
    mockPromoteToProject.mockResolvedValue({
      memory: makeMemory({ id: 'm1', scope: 'PROJECT' }),
    })

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )
    await waitFor(() => expect(result.current.memories).toHaveLength(1))

    await act(async () => {
      await result.current.promote('m1')
    })

    expect(mockPromoteToProject).toHaveBeenCalledWith('m1')
    // Promote moves the row task→project, so it leaves the task list.
    await waitFor(() => expect(result.current.memories).toHaveLength(0))
    // The project list (different parentId) must refetch to show the new row.
    const keys = invalidateSpy.mock.calls.map(
      c => (c[0] as { queryKey: unknown }).queryKey
    )
    expect(keys).toContainEqual(['memories', 'project'])
  })

  it('promote restores the row on failure and rethrows', async () => {
    mockListForTask.mockResolvedValue({
      memories: [makeMemory({ id: 'm1', scope: 'TASK' })],
    })
    mockPromoteToProject.mockRejectedValue(new Error('Promote failed'))

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )
    await waitFor(() => expect(result.current.memories).toHaveLength(1))

    await act(async () => {
      await expect(result.current.promote('m1')).rejects.toThrow(
        'Promote failed'
      )
    })

    await waitFor(() => expect(result.current.memories).toHaveLength(1))
    expect(result.current.memories[0]?.id).toBe('m1')
  })

  it('remove optimistically drops the row', async () => {
    mockListForTask.mockResolvedValue({
      memories: [makeMemory({ id: 'm1' }), makeMemory({ id: 'm2' })],
    })
    mockRemove.mockResolvedValue(undefined)

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )
    await waitFor(() => expect(result.current.memories).toHaveLength(2))

    await act(async () => {
      await result.current.remove('m1')
    })

    await waitFor(() => expect(result.current.memories).toHaveLength(1))
    expect(result.current.memories[0]?.id).toBe('m2')
    expect(mockRemove).toHaveBeenCalledWith('m1')
  })

  it('remove restores the row on failure and rethrows', async () => {
    mockListForTask.mockResolvedValue({
      memories: [makeMemory({ id: 'm1' }), makeMemory({ id: 'm2' })],
    })
    mockRemove.mockRejectedValue(new Error('Delete failed'))

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )
    await waitFor(() => expect(result.current.memories).toHaveLength(2))

    await act(async () => {
      await expect(result.current.remove('m1')).rejects.toThrow('Delete failed')
    })

    await waitFor(() => expect(result.current.memories).toHaveLength(2))
  })

  it('mutating is true while a mutation is in-flight', async () => {
    mockListForTask.mockResolvedValue({ memories: [] })

    let resolveMutation!: (v: { memory: { id: string } }) => void
    mockCreateForTask.mockReturnValue(
      new Promise(resolve => {
        resolveMutation = resolve
      })
    )

    const { result } = renderHook(
      () => useMemories({ scope: 'task', parentId: 't1' }),
      {
        wrapper: Wrapper,
      }
    )
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
