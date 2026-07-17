'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ideaPullRequestsClient,
  type IdeaPullRequestCitation,
} from '@/lib/api-client/idea-pull-requests'
import { queryKeys } from '@/lib/query/keys'

interface UseIdeaPullRequestsResult {
  citations: IdeaPullRequestCitation[]
  loading: boolean
  error: string | null
  link: (payload: { prId?: string; url?: string }) => Promise<void>
  unlink: (citationId: string) => Promise<void>
}

/**
 * The PRs cited as evidence on an idea (LUM-684). Sibling of
 * `useIdeaWebLinks` / `useIdeaFigmaLinks`.
 *
 * No optimistic placeholder here, unlike `useIdeaWebLinks`: a citation's
 * payload is the server-resolved PR (title/state/CI can only come back from
 * the sync pipeline or GitHub), so there is nothing honest to render before
 * the round-trip — and it sidesteps the temp-id write race a placeholder id
 * invites (LUM-658).
 */
export function useIdeaPullRequests(
  ideaId: string,
  enabled = true
): UseIdeaPullRequestsResult {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.ideaPullRequests(ideaId)

  const query = useQuery<IdeaPullRequestCitation[], Error>({
    queryKey,
    queryFn: async () => {
      const { pullRequests } = await ideaPullRequestsClient.list(ideaId)
      return pullRequests
    },
    enabled,
  })

  const linkMutation = useMutation<
    void,
    Error,
    { prId?: string; url?: string }
  >({
    mutationFn: async payload => {
      await ideaPullRequestsClient.link(ideaId, payload)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const unlinkMutation = useMutation<void, Error, string>({
    mutationFn: citationId => ideaPullRequestsClient.unlink(ideaId, citationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const link = useCallback(
    async (payload: { prId?: string; url?: string }) => {
      await linkMutation.mutateAsync(payload)
    },
    [linkMutation]
  )

  const unlink = useCallback(
    async (citationId: string) => {
      await unlinkMutation.mutateAsync(citationId)
    },
    [unlinkMutation]
  )

  return {
    citations: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    link,
    unlink,
  }
}
