'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { tasksClient } from '@/lib/api-client'
import type { WorkspaceTaskFilterArgs } from '@/lib/api-client/tasks'
import { queryKeys } from '@/lib/query/keys'
import type { ApiTask } from '../types'

interface WorkspaceTasksResponse {
  tasks: ApiTask[]
  truncated: boolean
}

/**
 * Live workspace-wide task list for the embedded task-view block. Scope is
 * enforced server-side by the viewer's identity; `filters` only narrows it.
 * The workspace slug (from the route) namespaces the cache.
 */
export function useWorkspaceTasks(filters: WorkspaceTaskFilterArgs) {
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const query = useQuery<WorkspaceTasksResponse>({
    queryKey: queryKeys.tasks.byWorkspace(workspaceUrl, JSON.stringify(filters)),
    queryFn: () =>
      tasksClient.listWorkspace<WorkspaceTasksResponse>(filters),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
  return {
    tasks: query.data?.tasks ?? [],
    truncated: query.data?.truncated ?? false,
    loading: query.isLoading,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load tasks.')
      : null,
    refetch: query.refetch,
  }
}
