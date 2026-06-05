'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import {
  milestonesClient,
  type ApiMilestone,
  type MilestoneListFilter,
} from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/** Workspace-wide milestone list for the task-view config picker. */
export function useWorkspaceMilestones(filter: MilestoneListFilter = 'active') {
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const query = useQuery<ApiMilestone[]>({
    queryKey: [...queryKeys.milestones.byWorkspace(workspaceUrl), filter],
    queryFn: async () => {
      const data = await milestonesClient.listByWorkspace(filter)
      return data.milestones
    },
  })
  return {
    milestones: query.data ?? [],
    // `isLoading` (not `isPending`) so a disabled/deferred query doesn't
    // pin the skeleton — mirrors the pattern in useMilestones (LUM-191).
    loading: query.isLoading,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load milestones.')
      : null,
  }
}
