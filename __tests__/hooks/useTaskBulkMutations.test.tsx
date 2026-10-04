/** @jest-environment jsdom */

// formatMessage returns the message id so toast assertions can target ids.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    update: jest.fn(),
    delete: jest.fn(),
  },
}))

import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { useTaskBulkMutations } from '@/app/workspace/[workspaceUrl]/hooks/useTaskBulkMutations'
import type { MyTask, TaskDetail } from '@/app/workspace/[workspaceUrl]/types'

const mockUpdate = tasksClient.update as jest.Mock
const mockDelete = tasksClient.delete as jest.Mock
const mockToastSuccess = toast.success as jest.Mock
const mockToastError = toast.error as jest.Mock

function makeTask(over: Partial<MyTask> = {}): MyTask {
  return {
    id: over.id ?? 'tsk_1',
    title: over.title ?? 'Task',
    status: over.status ?? 'TODO',
    priority: over.priority ?? 'MEDIUM',
    projectId: over.projectId ?? 'prj_1',
    assigneeActorId: over.assigneeActorId ?? null,
    createdAt: over.createdAt ?? '2026-05-20T00:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-05-20T00:00:00.000Z',
    viewOrder: over.viewOrder ?? 0,
    number: over.number ?? 1,
    teamIdentifier: over.teamIdentifier ?? 'LUM',
    project: over.project ?? { id: 'prj_1', name: 'Lumo', ownerActorId: null },
  } as MyTask
}

const onRetry = jest.fn()
let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

/**
 * Drives the hook with real `tasks`/`selected` state so optimistic writes to
 * `setTasks` are observable via `result.current.tasks`.
 */
function useHarness(initialTasks: MyTask[], initialSelected: string[]) {
  const [tasks, setTasks] = useState<MyTask[]>(initialTasks)
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialSelected)
  )
  const bulk = useTaskBulkMutations({
    tasks,
    selected,
    setSelected,
    setTasks,
    onRetry,
  })
  return { tasks, selected, ...bulk }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  jest.clearAllMocks()
  // gcTime: Infinity — this hook writes detail-cache entries it never observes
  // (no useQuery for detail keys), so gcTime: 0 would collect them before the
  // assertions run. In production those entries are kept alive by open detail
  // views.
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
})

describe('useTaskBulkMutations — bulk update', () => {
  it('patches selected tasks optimistically before the server resolves', async () => {
    const d = deferred<unknown>()
    mockUpdate.mockReturnValue(d.promise)

    const { result } = renderHook(
      () => useHarness([makeTask({ id: 'a' }), makeTask({ id: 'b' })], ['a']),
      { wrapper: Wrapper }
    )

    act(() => {
      result.current.runBulkUpdate({ status: 'DONE' })
    })

    // Optimistic patch is visible immediately, while the request is in flight.
    await waitFor(() =>
      expect(result.current.tasks.find(t => t.id === 'a')?.status).toBe('DONE')
    )
    expect(result.current.tasks.find(t => t.id === 'b')?.status).toBe('TODO')

    await act(async () => {
      d.resolve({})
    })

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('task.bulkUpdateSuccess')
    )
    expect(result.current.selected.size).toBe(0)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('mirrors the patch into the per-task detail cache', async () => {
    mockUpdate.mockResolvedValue({})
    queryClient.setQueryData<TaskDetail>(queryKeys.tasks.detail('a'), {
      id: 'a',
      status: 'TODO',
      priority: 'MEDIUM',
    } as TaskDetail)

    const { result } = renderHook(
      () => useHarness([makeTask({ id: 'a' })], ['a']),
      { wrapper: Wrapper }
    )

    await act(async () => {
      await result.current.runBulkUpdate({ priority: 'URGENT' })
    })

    const detail = queryClient.getQueryData<TaskDetail>(
      queryKeys.tasks.detail('a')
    )
    expect(detail?.priority).toBe('URGENT')
  })

  it('rolls back the optimistic patch and refetches when a row fails', async () => {
    mockUpdate.mockRejectedValue(new Error('nope'))
    queryClient.setQueryData<TaskDetail>(queryKeys.tasks.detail('a'), {
      id: 'a',
      status: 'TODO',
      priority: 'MEDIUM',
    } as TaskDetail)

    const { result } = renderHook(
      () => useHarness([makeTask({ id: 'a', status: 'TODO' })], ['a']),
      { wrapper: Wrapper }
    )

    await act(async () => {
      await result.current.runBulkUpdate({ status: 'DONE' })
    })

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('task.bulkUpdateFailure')
    )
    // List + detail cache reverted to the pre-mutation values.
    expect(result.current.tasks.find(t => t.id === 'a')?.status).toBe('TODO')
    expect(
      queryClient.getQueryData<TaskDetail>(queryKeys.tasks.detail('a'))?.status
    ).toBe('TODO')
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('useTaskBulkMutations — bulk delete', () => {
  it('removes selected tasks optimistically before the server resolves', async () => {
    const d = deferred<unknown>()
    mockDelete.mockReturnValue(d.promise)

    const { result } = renderHook(
      () => useHarness([makeTask({ id: 'a' }), makeTask({ id: 'b' })], ['a']),
      { wrapper: Wrapper }
    )

    act(() => {
      result.current.runBulkDelete()
    })

    await waitFor(() => expect(result.current.tasks).toHaveLength(1))
    expect(result.current.tasks[0]?.id).toBe('b')

    await act(async () => {
      d.resolve(undefined)
    })

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('task.bulkDeleteSuccess')
    )
    expect(result.current.selected.size).toBe(0)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('restores removed tasks and refetches when a row fails', async () => {
    mockDelete.mockRejectedValue(new Error('nope'))

    const { result } = renderHook(
      () => useHarness([makeTask({ id: 'a' }), makeTask({ id: 'b' })], ['a']),
      { wrapper: Wrapper }
    )

    await act(async () => {
      await result.current.runBulkDelete()
    })

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('task.bulkDeleteFailure')
    )
    expect(result.current.tasks).toHaveLength(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('closes the confirm dialog after a delete settles', async () => {
    mockDelete.mockResolvedValue(undefined)

    const { result } = renderHook(
      () => useHarness([makeTask({ id: 'a' })], ['a']),
      { wrapper: Wrapper }
    )

    act(() => {
      result.current.setConfirmDeleteOpen(true)
    })
    await waitFor(() => expect(result.current.confirmDeleteOpen).toBe(true))

    await act(async () => {
      await result.current.runBulkDelete()
    })

    expect(result.current.confirmDeleteOpen).toBe(false)
  })
})
