'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  slackContextsClient,
  type SlackContextResource,
} from '@/lib/api-client/slack-contexts'
import { queryKeys } from '@/lib/query/keys'

interface UseSlackContextsResult {
  contexts: SlackContextResource[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  link: (permalink: string) => Promise<void>
  refreshOne: (contextId: string) => Promise<void>
  unlink: (contextId: string) => Promise<void>
}

export function useSlackContexts(
  taskId: string,
  enabled = true
): UseSlackContextsResult {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => queryKeys.taskSlackContexts(taskId), [taskId])

  const query = useQuery<SlackContextResource[], Error>({
    queryKey,
    queryFn: async () => {
      const { contexts } = await slackContextsClient.list(taskId)
      return contexts
    },
    enabled,
  })

  // Writes patch the cached list with the server's row instead of refetching.
  const patch = useCallback(
    (fn: (prev: SlackContextResource[]) => SlackContextResource[]) => {
      queryClient.setQueryData<SlackContextResource[]>(queryKey, prev =>
        fn(prev ?? [])
      )
    },
    [queryClient, queryKey]
  )

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const link = useCallback(
    async (permalink: string) => {
      const { context } = await slackContextsClient.link(taskId, permalink)
      patch(prev => [context, ...prev])
    },
    [taskId, patch]
  )

  const refreshOne = useCallback(
    async (contextId: string) => {
      const { context } = await slackContextsClient.refresh(taskId, contextId)
      patch(prev => prev.map(c => (c.id === contextId ? context : c)))
    },
    [taskId, patch]
  )

  const unlink = useCallback(
    async (contextId: string) => {
      await slackContextsClient.unlink(taskId, contextId)
      patch(prev => prev.filter(c => c.id !== contextId))
    },
    [taskId, patch]
  )

  return {
    contexts: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
    link,
    refreshOne,
    unlink,
  }
}
