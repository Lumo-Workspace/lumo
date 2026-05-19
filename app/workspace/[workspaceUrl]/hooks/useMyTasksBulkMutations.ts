import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { tasksClient } from '@/lib/api-client'
import type { MyTask, ApiStatus, ApiPriority } from '../types'

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
 * Bulk status/priority/assignee updates + bulk delete for the My Tasks page.
 *
 * Mutations run via `Promise.allSettled` so a per-row failure doesn't abort the
 * batch. On any failure the toast surfaces the count and we ask the page to
 * `onRetry` (refetch); on full success we apply the patch optimistically and
 * clear the selection.
 */
export function useMyTasksBulkMutations({
  selected,
  setSelected,
  setTasks,
  onRetry,
}: Options) {
  const intl = useIntl()
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const runBulkUpdate = async (patch: BulkPatch) => {
    const ids = Array.from(selected)
    const results = await Promise.allSettled(
      ids.map(id => tasksClient.update(id, patch))
    )
    const failed = results.filter(r => r.status === 'rejected').length
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
                ...(patch.status !== undefined ? { status: patch.status } : {}),
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
  }

  const runBulkDelete = async () => {
    setDeleting(true)
    const ids = Array.from(selected)
    try {
      const results = await Promise.allSettled(
        ids.map(id => tasksClient.delete(id))
      )
      const failed = results.filter(r => r.status === 'rejected').length
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
    } finally {
      setDeleting(false)
      setConfirmDeleteOpen(false)
    }
  }

  return {
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    deleting,
    runBulkUpdate,
    runBulkDelete,
  }
}
