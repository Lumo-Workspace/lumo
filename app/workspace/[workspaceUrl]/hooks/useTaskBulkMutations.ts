import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { tasksClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { MyTask, TaskDetail, ApiStatus, ApiPriority } from '../types'

interface BulkPatch {
  status?: ApiStatus
  priority?: ApiPriority
  assigneeActorId?: string | null
}

interface Options {
  selected: Set<string>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>
  /** Triggered when the server rejects any row so the page refetches its list. */
  onRetry: () => void
}

/**
 * Bulk status/priority/assignee updates + bulk delete for any task-list page
 * (My Tasks, Sprint Tasks, etc.).
 *
 * Mutations run via `Promise.allSettled` so a per-row failure doesn't abort the
 * batch. On any failure the toast surfaces the count and we ask the page to
 * `onRetry` (refetch); on full success we apply the patch optimistically and
 * clear the selection.
 */
export function useTaskBulkMutations({
  selected,
  setSelected,
  setTasks,
  onRetry,
}: Options) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // Mirror bulk patches into the per-task detail cache so any open detail
  // view reflects the change without a refetch. `setTasks` still drives the
  // list-level state for now — the list shape refactor lands in a follow-up
  // PR, at which point setTasks goes away in favor of pure cache writes.
  const writeDetailPatches = (ids: string[], patch: BulkPatch) => {
    for (const id of ids) {
      queryClient.setQueryData<TaskDetail>(queryKeys.tasks.detail(id), prev =>
        prev
          ? {
              ...prev,
              ...(patch.status !== undefined ? { status: patch.status } : {}),
              ...(patch.priority !== undefined
                ? { priority: patch.priority }
                : {}),
              ...(patch.assigneeActorId !== undefined
                ? { assigneeActorId: patch.assigneeActorId }
                : {}),
            }
          : prev
      )
    }
  }

  const bulkUpdateMutation = useMutation<
    { ids: string[]; failed: number },
    Error,
    BulkPatch
  >({
    mutationFn: async patch => {
      const ids = Array.from(selected)
      const results = await Promise.allSettled(
        ids.map(id => tasksClient.update(id, patch))
      )
      const failed = results.filter(r => r.status === 'rejected').length
      return { ids, failed }
    },
    onSuccess: ({ ids, failed }, patch) => {
      if (failed > 0) {
        toast.error(
          intl.formatMessage(
            {
              id: 'task.bulkUpdateFailure',
              defaultMessage: 'Failed to update {failed} of {total} tasks',
            },
            { failed, total: ids.length }
          )
        )
        onRetry()
      } else {
        const idSet = new Set(ids)
        setTasks(prev =>
          prev.map(t =>
            idSet.has(t.id)
              ? {
                  ...t,
                  ...(patch.status !== undefined
                    ? { status: patch.status }
                    : {}),
                  ...(patch.priority !== undefined
                    ? { priority: patch.priority }
                    : {}),
                  ...(patch.assigneeActorId !== undefined
                    ? { assigneeActorId: patch.assigneeActorId }
                    : {}),
                }
              : t
          )
        )
        writeDetailPatches(ids, patch)
        toast.success(
          intl.formatMessage(
            {
              id: 'task.bulkUpdateSuccess',
              defaultMessage:
                'Updated {count, plural, one {# task} other {# tasks}}',
            },
            { count: ids.length }
          )
        )
      }
      setSelected(new Set())
    },
  })

  const bulkDeleteMutation = useMutation<
    { ids: string[]; failed: number },
    Error
  >({
    mutationFn: async () => {
      const ids = Array.from(selected)
      const results = await Promise.allSettled(
        ids.map(id => tasksClient.delete(id))
      )
      const failed = results.filter(r => r.status === 'rejected').length
      return { ids, failed }
    },
    onSuccess: ({ ids, failed }) => {
      if (failed > 0) {
        toast.error(
          intl.formatMessage(
            {
              id: 'task.bulkDeleteFailure',
              defaultMessage: 'Failed to delete {failed} of {total} tasks',
            },
            { failed, total: ids.length }
          )
        )
        onRetry()
      } else {
        const idSet = new Set(ids)
        setTasks(prev => prev.filter(t => !idSet.has(t.id)))
        for (const id of ids) {
          queryClient.removeQueries({
            queryKey: queryKeys.tasks.detail(id),
            exact: true,
          })
        }
        toast.success(
          intl.formatMessage(
            {
              id: 'task.bulkDeleteSuccess',
              defaultMessage:
                'Deleted {count, plural, one {# task} other {# tasks}}',
            },
            { count: ids.length }
          )
        )
      }
      setSelected(new Set())
    },
    onSettled: () => {
      setConfirmDeleteOpen(false)
    },
  })

  const runBulkUpdate = async (patch: BulkPatch) => {
    await bulkUpdateMutation.mutateAsync(patch)
  }

  const runBulkDelete = async () => {
    await bulkDeleteMutation.mutateAsync()
  }

  return {
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    deleting: bulkDeleteMutation.isPending,
    runBulkUpdate,
    runBulkDelete,
  }
}
