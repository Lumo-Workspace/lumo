'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { tasksClient } from '@/lib/api-client'
import type { WorkspaceTaskFilterArgs } from '@/lib/api-client/tasks'
import { queryKeys } from '@/lib/query/keys'
import type { ApiStatus, ApiTask, TaskDetail } from '../types'

interface WorkspaceTasksData {
  tasks: ApiTask[]
  truncated: boolean
}
interface Vars {
  id: string
  status: ApiStatus
}
interface Ctx {
  previous: WorkspaceTasksData | undefined
  previousDetail: TaskDetail | undefined
}

/**
 * Optimistic single-task status change for the kanban. Patches the workspace
 * list cache (same key as `useWorkspaceTasks`) + the per-task detail cache,
 * rolls back + toasts on failure, and invalidates on settle to reconcile.
 */
export function useWorkspaceTaskStatus(filters: WorkspaceTaskFilterArgs) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const listKey = queryKeys.tasks.byWorkspace(workspaceUrl, JSON.stringify(filters))

  const mutation = useMutation<unknown, Error, Vars, Ctx>({
    mutationFn: ({ id, status }) => tasksClient.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: listKey })
      const previous = queryClient.getQueryData<WorkspaceTasksData>(listKey)
      const previousDetail = queryClient.getQueryData<TaskDetail>(
        queryKeys.tasks.detail(id)
      )
      if (previous) {
        queryClient.setQueryData<WorkspaceTasksData>(listKey, {
          ...previous,
          tasks: previous.tasks.map(t =>
            t.id === id ? { ...t, status } : t
          ),
        })
      }
      if (previousDetail) {
        queryClient.setQueryData<TaskDetail>(queryKeys.tasks.detail(id), {
          ...previousDetail,
          status,
        })
      }
      return { previous, previousDetail }
    },
    onError: (_err, { id }, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous)
      if (context?.previousDetail) {
        queryClient.setQueryData(queryKeys.tasks.detail(id), context.previousDetail)
      }
      toast.error(
        intl.formatMessage({
          id: 'editor.taskView.statusUpdateError',
          defaultMessage: 'Could not move the task. Please try again.',
        })
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: listKey })
    },
  })

  return {
    updateStatus: (id: string, status: ApiStatus) =>
      mutation.mutateAsync({ id, status }),
  }
}
