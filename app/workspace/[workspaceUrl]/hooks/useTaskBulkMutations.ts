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
  /** Current list, snapshotted in `onMutate` so a failed row can roll back. */
  tasks: MyTask[]
  selected: Set<string>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>
  /** Triggered when the server rejects any row so the page refetches its list. */
  onRetry: () => void
}

/** Snapshot of one detail-cache entry, kept so `onError` can restore it. */
interface DetailSnapshot {
  id: string
  data: TaskDetail | undefined
}

/** Context threaded from `onMutate` to `onSuccess`/`onError` for rollback. */
interface BulkUpdateContext {
  previousTasks: MyTask[]
  previousDetails: DetailSnapshot[]
}

interface BulkDeleteContext {
  previousTasks: MyTask[]
}

/** Spread only the fields present on `patch` onto `target`. */
function mergePatch<T extends BulkPatch>(target: T, patch: BulkPatch): T {
  return {
    ...target,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.assigneeActorId !== undefined
      ? { assigneeActorId: patch.assigneeActorId }
      : {}),
  }
}

/**
 * Bulk status/priority/assignee updates + bulk delete for any task-list page
 * (My Tasks, Sprint Tasks, etc.).
 *
 * Mutations run via `Promise.allSettled` so a per-row failure doesn't abort the
 * batch. Changes apply **optimistically** in `onMutate` — selected rows (and
 * any open detail cache) patch/remove immediately — and roll back from a
 * snapshot if any row is rejected, at which point we also ask the page to
 * `onRetry` (refetch) so the list reconciles to server truth.
 */
export function useTaskBulkMutations({
  tasks,
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
        prev ? mergePatch(prev, patch) : prev
      )
    }
  }

  const restoreDetails = (snapshots: DetailSnapshot[]) => {
    for (const { id, data } of snapshots) {
      // Untouched entries (no cached detail) were never written — skip them so
      // we don't materialize an `undefined` query.
      if (data !== undefined) {
        queryClient.setQueryData(queryKeys.tasks.detail(id), data)
      }
    }
  }

  const bulkUpdateMutation = useMutation<
    { ids: string[]; failed: number },
    Error,
    BulkPatch,
    BulkUpdateContext
  >({
    mutationFn: async patch => {
      const ids = Array.from(selected)
      const results = await Promise.allSettled(
        ids.map(id => tasksClient.update(id, patch))
      )
      const failed = results.filter(r => r.status === 'rejected').length
      return { ids, failed }
    },
    onMutate: patch => {
      const ids = Array.from(selected)
      const idSet = new Set(ids)
      const previousTasks = tasks
      const previousDetails: DetailSnapshot[] = ids.map(id => ({
        id,
        data: queryClient.getQueryData<TaskDetail>(queryKeys.tasks.detail(id)),
      }))
      setTasks(prev =>
        prev.map(t => (idSet.has(t.id) ? mergePatch(t, patch) : t))
      )
      writeDetailPatches(ids, patch)
      return { previousTasks, previousDetails }
    },
    onSuccess: ({ ids, failed }, _patch, context) => {
      if (failed > 0) {
        setTasks(context.previousTasks)
        restoreDetails(context.previousDetails)
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
    onError: (_err, _patch, context) => {
      if (context) {
        setTasks(context.previousTasks)
        restoreDetails(context.previousDetails)
      }
      setSelected(new Set())
      onRetry()
    },
  })

  const bulkDeleteMutation = useMutation<
    { ids: string[]; failed: number },
    Error,
    void,
    BulkDeleteContext
  >({
    mutationFn: async () => {
      const ids = Array.from(selected)
      const results = await Promise.allSettled(
        ids.map(id => tasksClient.delete(id))
      )
      const failed = results.filter(r => r.status === 'rejected').length
      return { ids, failed }
    },
    onMutate: () => {
      const idSet = new Set(selected)
      const previousTasks = tasks
      setTasks(prev => prev.filter(t => !idSet.has(t.id)))
      return { previousTasks }
    },
    onSuccess: ({ ids, failed }, _vars, context) => {
      if (failed > 0) {
        setTasks(context.previousTasks)
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
        // The rows are gone for good — drop their detail caches now that the
        // server has confirmed the delete.
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
    onError: (_err, _vars, context) => {
      if (context) {
        setTasks(context.previousTasks)
      }
      setSelected(new Set())
      onRetry()
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
