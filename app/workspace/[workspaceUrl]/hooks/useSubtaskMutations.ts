'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TaskDetail } from '../types'

interface UseSubtaskMutationsOptions {
  /** The parent task whose `children` list is being edited. */
  parentTaskId: string
  /**
   * Pull authoritative state after a successful write (re-fetch the detail and
   * sync sibling list views). Called on success only — failures roll back.
   */
  onReconcile: () => void
}

type DetailCtx = { previous: TaskDetail | undefined }

/**
 * Optimistic edit/delete for a task's subtasks. Subtasks live inside the parent
 * task's detail cache (`queryKeys.tasks.detail(parentTaskId).children`), which is
 * what the detail panel renders — so each mutation patches that cache via
 * setQueryData before the request resolves and rolls back to the snapshot on
 * error. onReconcile refreshes the authoritative state after a success.
 */
export function useSubtaskMutations({
  parentTaskId,
  onReconcile,
}: UseSubtaskMutationsOptions) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.tasks.detail(parentTaskId)

  const patchChildren = (
    map: (
      children: NonNullable<TaskDetail['children']>
    ) => NonNullable<TaskDetail['children']>
  ) => {
    queryClient.setQueryData<TaskDetail>(queryKey, prev =>
      prev ? { ...prev, children: map(prev.children ?? []) } : prev
    )
  }

  const editMutation = useMutation<
    void,
    Error,
    { childId: string; title: string },
    DetailCtx
  >({
    mutationFn: ({ childId, title }) =>
      apiFetch(`/api/tasks/${childId}`, {
        method: 'PATCH',
        body: { title },
      }),
    onMutate: async ({ childId, title }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<TaskDetail>(queryKey)
      patchChildren(children =>
        children.map(c => (c.id === childId ? { ...c, title } : c))
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous)
    },
    onSuccess: () => onReconcile(),
  })

  const deleteMutation = useMutation<void, Error, string, DetailCtx>({
    mutationFn: childId =>
      apiFetch(`/api/tasks/${childId}`, { method: 'DELETE' }),
    onMutate: async childId => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<TaskDetail>(queryKey)
      patchChildren(children => children.filter(c => c.id !== childId))
      return { previous }
    },
    onError: (_err, _childId, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous)
    },
    onSuccess: () => onReconcile(),
  })

  return {
    editSubtask: (childId: string, title: string) =>
      editMutation.mutateAsync({ childId, title }),
    deleteSubtask: (childId: string) => deleteMutation.mutateAsync(childId),
  }
}
