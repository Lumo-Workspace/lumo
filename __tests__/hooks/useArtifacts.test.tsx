jest.mock('@/lib/api-client/task-artifacts', () => ({
  artifactsClient: {
    list: jest.fn(),
    add: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useArtifacts } from '@/app/workspace/[workspaceUrl]/hooks/useArtifacts'
import { artifactsClient } from '@/lib/api-client/task-artifacts'
import type { TaskArtifact } from '@prisma/client'

const mockList = artifactsClient.list as jest.Mock
const mockAdd = artifactsClient.add as jest.Mock
const mockUpdate = artifactsClient.update as jest.Mock
const mockRemove = artifactsClient.remove as jest.Mock

function makeArtifact(over: Partial<TaskArtifact> = {}): TaskArtifact {
  return {
    id: over.id ?? 'art_1',
    taskId: over.taskId ?? 'tsk_1',
    workspaceId: over.workspaceId ?? 'ws_1',
    kind: over.kind ?? 'spec',
    title: over.title ?? 'Spec',
    content: over.content ?? '# Spec',
    source: over.source ?? 'manual',
    agent: over.agent ?? 'CLAUDE_CODE',
    order: over.order ?? 0,
    summary: over.summary ?? null,
    contentSignals: over.contentSignals ?? null,
    createdById: over.createdById ?? null,
    createdAt: over.createdAt ?? new Date('2026-05-20T00:00:00.000Z'),
    updatedAt: over.updatedAt ?? new Date('2026-05-20T00:00:00.000Z'),
  }
}

const addPayload = {
  kind: 'plan',
  title: 'Implementation plan',
  content: '## Plan',
  source: 'manual',
  agent: 'CLAUDE_CODE' as const,
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

describe('useArtifacts', () => {
  it('fetches artifacts on mount when enabled', async () => {
    mockList.mockResolvedValue({ artifacts: [makeArtifact()] })

    const { result } = renderHook(() => useArtifacts('tsk_1'), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockList).toHaveBeenCalledWith('tsk_1')
    expect(result.current.artifacts).toHaveLength(1)
    expect(result.current.artifacts[0]?.title).toBe('Spec')
  })

  it('skips fetch when enabled=false', async () => {
    renderHook(() => useArtifacts('tsk_1', false), { wrapper: Wrapper })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
  })

  it('refresh re-fetches the list', async () => {
    mockList
      .mockResolvedValueOnce({ artifacts: [makeArtifact({ title: 'Spec' })] })
      .mockResolvedValueOnce({
        artifacts: [makeArtifact({ title: 'Updated' })],
      })

    const { result } = renderHook(() => useArtifacts('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.artifacts).toHaveLength(1))

    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() =>
      expect(result.current.artifacts[0]?.title).toBe('Updated')
    )
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('add inserts an optimistic placeholder then swaps in the server row', async () => {
    mockList.mockResolvedValue({ artifacts: [] })
    let resolveAdd!: (v: { artifact: TaskArtifact }) => void
    mockAdd.mockReturnValue(
      new Promise(resolve => {
        resolveAdd = resolve
      })
    )

    const { result } = renderHook(() => useArtifacts('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let addPromise!: Promise<void>
    act(() => {
      addPromise = result.current.add(addPayload)
    })

    await waitFor(() => expect(result.current.artifacts).toHaveLength(1))
    const placeholder = result.current.artifacts[0]!
    expect(placeholder.loading).toBe(true)
    expect(placeholder.tempId).toBeDefined()
    expect(placeholder.title).toBe('Implementation plan')

    await act(async () => {
      resolveAdd({ artifact: makeArtifact({ id: 'art_new', title: 'Plan' }) })
      await addPromise
    })

    await waitFor(() => expect(result.current.artifacts[0]?.id).toBe('art_new'))
    expect(result.current.artifacts).toHaveLength(1)
    expect(result.current.artifacts[0]?.loading).toBeUndefined()
    expect(result.current.artifacts[0]?.tempId).toBeUndefined()
  })

  it('add drops the placeholder on failure and rethrows', async () => {
    mockList.mockResolvedValue({ artifacts: [] })
    mockAdd.mockRejectedValue(new Error('Server error'))

    const { result } = renderHook(() => useArtifacts('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.add(addPayload)).rejects.toThrow(
        'Server error'
      )
    })

    await waitFor(() => expect(result.current.artifacts).toHaveLength(0))
  })

  it('update optimistically patches the row and keeps the server row on success', async () => {
    mockList.mockResolvedValue({
      artifacts: [makeArtifact({ id: 'art_1', title: 'Spec', kind: 'spec' })],
    })
    let resolveUpdate!: (v: { artifact: TaskArtifact }) => void
    mockUpdate.mockReturnValue(
      new Promise(resolve => {
        resolveUpdate = resolve
      })
    )

    const { result } = renderHook(() => useArtifacts('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.artifacts).toHaveLength(1))

    let updatePromise!: Promise<void>
    act(() => {
      updatePromise = result.current.update('art_1', { kind: 'plan' })
    })

    // Optimistic patch is visible immediately, before the server resolves.
    await waitFor(() => expect(result.current.artifacts[0]?.kind).toBe('plan'))

    await act(async () => {
      resolveUpdate({
        artifact: makeArtifact({ id: 'art_1', title: 'Spec', kind: 'plan' }),
      })
      await updatePromise
    })

    expect(result.current.artifacts[0]?.kind).toBe('plan')
    expect(mockUpdate).toHaveBeenCalledWith('tsk_1', 'art_1', { kind: 'plan' })
  })

  it('update reverts the row on failure and rethrows', async () => {
    mockList.mockResolvedValue({
      artifacts: [makeArtifact({ id: 'art_1', kind: 'spec' })],
    })
    mockUpdate.mockRejectedValue(new Error('Patch failed'))

    const { result } = renderHook(() => useArtifacts('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.artifacts).toHaveLength(1))

    await act(async () => {
      await expect(
        result.current.update('art_1', { kind: 'plan' })
      ).rejects.toThrow('Patch failed')
    })

    await waitFor(() => expect(result.current.artifacts[0]?.kind).toBe('spec'))
  })

  it('remove optimistically drops the row', async () => {
    mockList.mockResolvedValue({
      artifacts: [makeArtifact({ id: 'art_a' }), makeArtifact({ id: 'art_b' })],
    })
    mockRemove.mockResolvedValue(undefined)

    const { result } = renderHook(() => useArtifacts('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.artifacts).toHaveLength(2))

    await act(async () => {
      await result.current.remove('art_a')
    })

    await waitFor(() => expect(result.current.artifacts).toHaveLength(1))
    expect(result.current.artifacts[0]?.id).toBe('art_b')
    expect(mockRemove).toHaveBeenCalledWith('tsk_1', 'art_a')
  })

  it('remove restores the row on failure and rethrows', async () => {
    mockList.mockResolvedValue({
      artifacts: [makeArtifact({ id: 'art_a' }), makeArtifact({ id: 'art_b' })],
    })
    mockRemove.mockRejectedValue(new Error('Delete failed'))

    const { result } = renderHook(() => useArtifacts('tsk_1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.artifacts).toHaveLength(2))

    await act(async () => {
      await expect(result.current.remove('art_a')).rejects.toThrow(
        'Delete failed'
      )
    })

    await waitFor(() => expect(result.current.artifacts).toHaveLength(2))
  })
})
