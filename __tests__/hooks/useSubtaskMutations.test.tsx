jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSubtaskMutations } from '@/app/workspace/[workspaceUrl]/hooks/useSubtaskMutations'
import { apiFetch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskDetail } from '@/app/workspace/[workspaceUrl]/types'

const mockApiFetch = apiFetch as jest.Mock

const PARENT_ID = 'tsk_parent'
const detailKey = queryKeys.tasks.detail(PARENT_ID)

type Child = NonNullable<TaskDetail['children']>[number]

function makeChild(over: Partial<Child> = {}): Child {
  return {
    id: over.id ?? 'tsk_a',
    title: over.title ?? 'Original',
    number: over.number ?? 1,
    status: over.status ?? 'TODO',
  }
}

function seedDetail(children: Child[]): TaskDetail {
  return { id: PARENT_ID, children } as unknown as TaskDetail
}

function readChildren(qc: QueryClient): Child[] {
  return qc.getQueryData<TaskDetail>(detailKey)?.children ?? []
}

let queryClient: QueryClient
let onReconcile: jest.Mock

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderSubject(initialChildren: Child[]) {
  queryClient.setQueryData(detailKey, seedDetail(initialChildren))
  return renderHook(
    () => useSubtaskMutations({ parentTaskId: PARENT_ID, onReconcile }),
    { wrapper: Wrapper }
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  onReconcile = jest.fn()
  queryClient = new QueryClient({
    defaultOptions: {
      // gcTime: Infinity — nothing in the test subscribes to the detail query
      // (in production the panel's useQuery keeps it alive), so without this the
      // setQueryData'd entry is garbage-collected before assertions read it.
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
})

describe('useSubtaskMutations', () => {
  describe('editSubtask', () => {
    it('editSubtask optimistically updates the cached subtask title before the request resolves', async () => {
      mockApiFetch.mockReturnValue(new Promise(() => {})) // never resolves
      const { result } = renderSubject([
        makeChild({ id: 'tsk_a', title: 'Original' }),
        makeChild({ id: 'tsk_b', title: 'Other', number: 2 }),
      ])

      act(() => {
        void result.current.editSubtask('tsk_a', 'Renamed')
      })

      await waitFor(() =>
        expect(
          readChildren(queryClient).find(c => c.id === 'tsk_a')?.title
        ).toBe('Renamed')
      )
      // Sibling row untouched.
      expect(readChildren(queryClient).find(c => c.id === 'tsk_b')?.title).toBe(
        'Other'
      )
      expect(mockApiFetch).toHaveBeenCalledWith('/api/tasks/tsk_a', {
        method: 'PATCH',
        body: { title: 'Renamed' },
      })
    })

    it('editSubtask restores the previous title when the request fails', async () => {
      mockApiFetch.mockRejectedValue(new Error('patch failed'))
      const { result } = renderSubject([
        makeChild({ id: 'tsk_a', title: 'Original' }),
      ])

      await act(async () => {
        await expect(
          result.current.editSubtask('tsk_a', 'Renamed')
        ).rejects.toThrow('patch failed')
      })

      await waitFor(() =>
        expect(readChildren(queryClient)[0]?.title).toBe('Original')
      )
    })

    it('editSubtask calls onReconcile after a successful update', async () => {
      mockApiFetch.mockResolvedValue(undefined)
      const { result } = renderSubject([makeChild({ id: 'tsk_a' })])

      await act(async () => {
        await result.current.editSubtask('tsk_a', 'Renamed')
      })

      expect(onReconcile).toHaveBeenCalledTimes(1)
    })
  })

  describe('deleteSubtask', () => {
    it('deleteSubtask optimistically removes the subtask before the request resolves', async () => {
      mockApiFetch.mockReturnValue(new Promise(() => {})) // never resolves
      const { result } = renderSubject([
        makeChild({ id: 'tsk_a' }),
        makeChild({ id: 'tsk_b', number: 2 }),
      ])

      act(() => {
        void result.current.deleteSubtask('tsk_a')
      })

      await waitFor(() => expect(readChildren(queryClient)).toHaveLength(1))
      expect(readChildren(queryClient)[0]?.id).toBe('tsk_b')
      expect(mockApiFetch).toHaveBeenCalledWith('/api/tasks/tsk_a', {
        method: 'DELETE',
      })
    })

    it('deleteSubtask restores the subtask when the request fails', async () => {
      mockApiFetch.mockRejectedValue(new Error('delete failed'))
      const { result } = renderSubject([
        makeChild({ id: 'tsk_a' }),
        makeChild({ id: 'tsk_b', number: 2 }),
      ])

      await act(async () => {
        await expect(result.current.deleteSubtask('tsk_a')).rejects.toThrow(
          'delete failed'
        )
      })

      await waitFor(() => expect(readChildren(queryClient)).toHaveLength(2))
      expect(readChildren(queryClient).map(c => c.id)).toEqual([
        'tsk_a',
        'tsk_b',
      ])
    })

    it('deleteSubtask calls onReconcile after a successful delete', async () => {
      mockApiFetch.mockResolvedValue(undefined)
      const { result } = renderSubject([makeChild({ id: 'tsk_a' })])

      await act(async () => {
        await result.current.deleteSubtask('tsk_a')
      })

      expect(onReconcile).toHaveBeenCalledTimes(1)
    })
  })
})
