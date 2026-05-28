'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { taskFigmaLinksClient } from '@/lib/api-client/task-figma-links'
import type { FigmaLinkJson } from '@/lib/api-client/task-figma-links'
import { queryKeys } from '@/lib/query/keys'

// Optimistic placeholders share FigmaLinkJson's shape but carry a tempId +
// loading flag. Server rows never have these.
export type OptimisticFigmaLink = FigmaLinkJson & {
  tempId?: string
  loading?: boolean
}

interface UseFigmaLinksResult {
  figmaLinks: OptimisticFigmaLink[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (payload: { url: string }) => Promise<void>
  remove: (linkId: string) => Promise<void>
  refreshAll: () => Promise<void>
}

function makeOptimisticPlaceholder(payload: {
  url: string
}): OptimisticFigmaLink {
  const tempId = `tmp_${Math.random().toString(36).slice(2, 10)}`
  return {
    id: tempId,
    tempId,
    fileKey: '',
    nodeId: '',
    url: payload.url,
    fileName: '',
    frameName: null,
    thumbnailUrl: null,
    thumbnailFetchedAt: null,
    lastSyncedAt: new Date().toISOString(),
    lastSyncError: null,
    createdAt: new Date().toISOString(),
    loading: true,
  }
}

export function useFigmaLinks(
  taskId: string,
  enabled = true
): UseFigmaLinksResult {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.taskFigmaLinks(taskId)

  const query = useQuery<OptimisticFigmaLink[], Error>({
    queryKey,
    queryFn: async () => {
      const { links } = await taskFigmaLinksClient.list(taskId)
      return links
    },
    enabled,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const addMutation = useMutation<
    FigmaLinkJson,
    Error,
    { url: string },
    { tempId: string }
  >({
    mutationFn: async payload => {
      const { link } = await taskFigmaLinksClient.add(taskId, payload)
      return link
    },
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey })
      const placeholder = makeOptimisticPlaceholder(payload)
      queryClient.setQueryData<OptimisticFigmaLink[]>(queryKey, prev => [
        placeholder,
        ...(prev ?? []),
      ])
      return { tempId: placeholder.tempId! }
    },
    onSuccess: (link, _payload, context) => {
      queryClient.setQueryData<OptimisticFigmaLink[]>(queryKey, prev =>
        (prev ?? []).map(l => (l.tempId === context?.tempId ? link : l))
      )
    },
    onError: (_err, _payload, context) => {
      // Drop the placeholder on error — LinkFigmaPopover surfaces the failure
      // (figma_not_connected / figma_needs_reauth / network) inline, so a
      // ghost row in the section would just confuse the user.
      queryClient.setQueryData<OptimisticFigmaLink[]>(queryKey, prev =>
        (prev ?? []).filter(l => l.tempId !== context?.tempId)
      )
    },
  })

  const removeMutation = useMutation<void, Error, string>({
    mutationFn: linkId => taskFigmaLinksClient.remove(taskId, linkId),
    onSuccess: (_data, linkId) => {
      queryClient.setQueryData<OptimisticFigmaLink[]>(queryKey, prev =>
        (prev ?? []).filter(l => l.id !== linkId)
      )
    },
  })

  // Task-level fanout: server re-fetches every link's metadata in parallel.
  // Per-link failures don't fail the call; we re-fetch the list when at least
  // one link came back ok so the UI picks up the new thumbnails.
  const refreshAllMutation = useMutation<
    { results: Array<{ id: string; ok: boolean; error?: string }> },
    Error
  >({
    mutationFn: () => taskFigmaLinksClient.refreshAll(taskId),
    onSuccess: data => {
      if (data.results.some(r => r.ok)) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })

  const add = useCallback(
    async (payload: { url: string }) => {
      await addMutation.mutateAsync(payload)
    },
    [addMutation]
  )

  const remove = useCallback(
    async (linkId: string) => {
      await removeMutation.mutateAsync(linkId)
    },
    [removeMutation]
  )

  const refreshAll = useCallback(async () => {
    await refreshAllMutation.mutateAsync()
  }, [refreshAllMutation])

  return {
    figmaLinks: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
    add,
    remove,
    refreshAll,
  }
}
