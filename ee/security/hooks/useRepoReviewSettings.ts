'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { securityScanClient } from '@/ee/security/api-client'
import type {
  RepoReviewSettings,
  RepoReviewSettingsUpdate,
} from '@/ee/security/services/repo-review-settings.service'

/** LUM-1133: the workspace's repositories with their automatic review settings. */
export function useRepoReviewSettings() {
  const query = useQuery<RepoReviewSettings>({
    queryKey: queryKeys.workspaceRepoReviewSettings(),
    queryFn: () => securityScanClient.repoReviewSettings(),
    staleTime: 60 * 1000,
  })
  return {
    data: query.data,
    isLoading: query.isPending,
    isError: query.isError,
  }
}

/** LUM-1133: change one repository (OWNER); the list comes back fresh. */
export function useUpdateRepoReviewSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (update: RepoReviewSettingsUpdate) =>
      securityScanClient.updateRepoReviewSettings(update),
    onSuccess: data => {
      queryClient.setQueryData(queryKeys.workspaceRepoReviewSettings(), data)
    },
  })
}
