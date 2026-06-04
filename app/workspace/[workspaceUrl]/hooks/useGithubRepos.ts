'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export interface GithubRepoOption {
  fullName: string
  private: boolean
}

interface UseGithubReposResult {
  repos: GithubRepoOption[]
  loading: boolean
  connected: boolean
}

/**
 * Available GitHub repos for the workspace, loaded on demand and cached.
 *
 * Shares the `githubRepos` cache key with the settings integration card, so
 * reopening the picker within `staleTime` serves from cache instead of
 * re-hitting GitHub. The repos endpoint returns 404 when GitHub isn't
 * connected, which surfaces here as `connected === false`.
 *
 * `enabled` gates the fetch on the picker being open.
 */
export function useGithubRepos(
  workspaceUrl: string,
  enabled: boolean
): UseGithubReposResult {
  const query = useQuery<GithubRepoOption[]>({
    queryKey: queryKeys.integrations.githubRepos(workspaceUrl),
    queryFn: async () => {
      const data = await apiFetch<{ repos?: GithubRepoOption[] }>(
        `/api/github/repos?workspaceUrl=${workspaceUrl}`
      )
      return data.repos ?? []
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  })

  return {
    repos: query.data ?? [],
    loading: query.isLoading,
    connected: !query.isError,
  }
}
