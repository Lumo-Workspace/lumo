'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ideaFigmaLinksClient } from '@/lib/api-client/idea-figma-links'
import type { IdeaFigmaLinkJson } from '@/lib/api-client/idea-figma-links'
import { queryKeys } from '@/lib/query/keys'

// Optimistic placeholders share IdeaFigmaLinkJson's shape but carry a tempId +
// loading flag. Server rows never have these.
export type OptimisticFigmaLink = IdeaFigmaLinkJson & {
  tempId?: string
  loading?: boolean
}

interface UseIdeaFigmaLinksResult {
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

export function useIdeaFigmaLinks(
  ideaId: string,
  enabled = true
): UseIdeaFigmaLinksResult {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.ideaFigmaLinks(ideaId)

  const query = useQuery<OptimisticFigmaLink[], Error>({
    queryKey,
    queryFn: async () => {
      const { links } = await ideaFigmaLinksClient.list(ideaId)
      return links
    },
    enabled,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const addMutation = useMutation<
    IdeaFigmaLinkJson,
    Error,
    { url: string },
    { tempId: string }
  >({
    mutationFn: async payload => {
      const { link } = await ideaFigmaLinksClient.add(ideaId, payload)
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

  const removeMutation = useMutation<
    void,
    Error,
    string,
    { previous: OptimisticFigmaLink[] }
  >({
    mutationFn: linkId => ideaFigmaLinksClient.remove(ideaId, linkId),
    onMutate: async linkId => {
      await queryClient.cancelQueries({ queryKey })
      const previous =
        queryClient.getQueryData<OptimisticFigmaLink[]>(queryKey) ?? []
      queryClient.setQueryData<OptimisticFigmaLink[]>(queryKey, prev =>
        (prev ?? []).filter(l => l.id !== linkId)
      )
      return { previous }
    },
    onError: (_err, _linkId, context) => {
      // Server rejected the delete — put the row back exactly as it was.
      if (context) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
  })

  // Idea-level fanout: server re-fetches every link's metadata in parallel.
  // Per-link failures don't fail the call; we re-fetch the list when at least
  // one link came back ok so the UI picks up the new thumbnails.
  const refreshAllMutation = useMutation<
    { results: Array<{ id: string; ok: boolean; error?: string }> },
    Error,
    void,
    { previous: OptimisticFigmaLink[] }
  >({
    mutationFn: () => ideaFigmaLinksClient.refreshAll(ideaId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
      const previous =
        queryClient.getQueryData<OptimisticFigmaLink[]>(queryKey) ?? []
      // Flip every row to loading so the section shows spinners during the
      // fanout; the invalidate (or rollback) below clears the flags.
      queryClient.setQueryData<OptimisticFigmaLink[]>(queryKey, prev =>
        (prev ?? []).map(l => ({ ...l, loading: true }))
      )
      return { previous }
    },
    onSuccess: (data, _vars, context) => {
      if (data.results.some(r => r.ok)) {
        void queryClient.invalidateQueries({ queryKey })
      } else if (context) {
        // Nothing changed server-side; just drop the optimistic loading flags.
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onError: (_err, _vars, context) => {
      if (context) {
        queryClient.setQueryData(queryKey, context.previous)
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
