'use client'

import { useQuery } from '@tanstack/react-query'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * Single-milestone detail. Returns `null` until the id resolves; downstream
 * components should null-guard while loading.
 */
export function useMilestone(milestoneId: string | null | undefined) {
  const query = useQuery<ApiMilestone | null>({
    queryKey: milestoneId
      ? queryKeys.milestones.detail(milestoneId)
      : ['milestones', 'detail', 'disabled'],
    queryFn: async () => {
      const data = await milestonesClient.getById(milestoneId as string)
      return data.milestone
    },
    enabled: !!milestoneId,
  })

  return {
    milestone: query.data ?? null,
    loading: query.isPending && !!milestoneId,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load milestone.')
      : null,
  }
}

/**
 * Resolve a milestone by `(projectId, slug)`. Used when the URL segment is a
 * human-readable slug rather than a cuid.
 */
export function useMilestoneByProjectAndSlug(
  projectId: string | null | undefined,
  slug: string | null | undefined
) {
  const enabled = !!projectId && !!slug
  const query = useQuery<ApiMilestone | null>({
    queryKey: enabled
      ? queryKeys.milestones.byProjectAndSlug(
          projectId as string,
          slug as string
        )
      : ['milestones', 'byProjectAndSlug', 'disabled'],
    queryFn: async () => {
      const data = await milestonesClient.getByProjectAndSlug(
        projectId as string,
        slug as string
      )
      return data.milestone
    },
    enabled,
  })

  return {
    milestone: query.data ?? null,
    loading: query.isPending && enabled,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load milestone.')
      : null,
  }
}
