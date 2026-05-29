jest.mock('@/lib/api-client/task-artifacts', () => ({
  artifactsClient: {
    list: jest.fn(),
    add: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useArtifacts } from '@/app/workspace/[workspaceUrl]/hooks/useArtifacts'
import { artifactsClient } from '@/lib/api-client/task-artifacts'
import type { TaskArtifact } from '@prisma/client'

const mockList = artifactsClient.list as jest.Mock

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
    createdById: over.createdById ?? null,
    createdAt: over.createdAt ?? new Date('2026-05-20T00:00:00.000Z'),
    updatedAt: over.updatedAt ?? new Date('2026-05-20T00:00:00.000Z'),
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
})
