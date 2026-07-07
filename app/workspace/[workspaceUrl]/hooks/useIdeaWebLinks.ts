'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ideaWebLinksClient } from '@/lib/api-client/idea-web-links'
import { queryKeys } from '@/lib/query/keys'
import type { IdeaWebLink } from '@prisma/client'

export type OptimisticWebLink = IdeaWebLink & {
  tempId?: string
  loading?: boolean
}

interface UseIdeaWebLinksResult {
  webLinks: OptimisticWebLink[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (payload: { url: string }) => Promise<void>
  remove: (linkId: string) => Promise<void>
  refreshOne: (linkId: string) => Promise<void>
}

function makeOptimisticPlaceholder(
  payload: { url: string },
  ideaId: string
): OptimisticWebLink {
  let domain = ''
  try {
    domain = new URL(payload.url.trim()).hostname.toLowerCase()
  } catch {
    domain = payload.url
  }
  const tempId = `tmp_${Math.random().toString(36).slice(2, 10)}`
  return {
    id: tempId,
    tempId,
    ideaId,
    workspaceId: '',
    url: payload.url,
    domain,
    title: null,
    description: null,
    note: null,
    imageUrl: null,
    faviconUrl: null,
    fetchedAt: null,
    fetchError: null,
    body: null,
    bodyFetchedAt: null,
    createdById: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    loading: true,
  }
}

export function useIdeaWebLinks(
  ideaId: string,
  enabled = true
): UseIdeaWebLinksResult {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.ideaWebLinks(ideaId)

  const query = useQuery<OptimisticWebLink[], Error>({
    queryKey,
    queryFn: async () => {
      const { webLinks } = await ideaWebLinksClient.list(ideaId)
      return webLinks
    },
    enabled,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const addMutation = useMutation<
    IdeaWebLink,
    Error,
    { url: string },
    { tempId: string }
  >({
    mutationFn: async payload => {
      const { webLink } = await ideaWebLinksClient.add(ideaId, payload)
      return webLink
    },
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey })
      const placeholder = makeOptimisticPlaceholder(payload, ideaId)
      queryClient.setQueryData<OptimisticWebLink[]>(queryKey, prev => [
        placeholder,
        ...(prev ?? []),
      ])
      return { tempId: placeholder.tempId! }
    },
    onSuccess: (webLink, _payload, context) => {
      queryClient.setQueryData<OptimisticWebLink[]>(queryKey, prev =>
        (prev ?? []).map(l => (l.tempId === context?.tempId ? webLink : l))
      )
    },
    onError: (err, _payload, context) => {
      queryClient.setQueryData<OptimisticWebLink[]>(queryKey, prev =>
        (prev ?? []).map(l =>
          l.tempId === context?.tempId
            ? { ...l, loading: false, fetchError: err.message }
            : l
        )
      )
    },
  })

  const removeMutation = useMutation<
    void,
    Error,
    string,
    { previous: OptimisticWebLink[] | undefined }
  >({
    mutationFn: linkId => ideaWebLinksClient.remove(ideaId, linkId),
    onMutate: async linkId => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<OptimisticWebLink[]>(queryKey)
      queryClient.setQueryData<OptimisticWebLink[]>(queryKey, prev =>
        (prev ?? []).filter(l => l.id !== linkId)
      )
      return { previous }
    },
    onError: (_err, _linkId, context) => {
      if (context?.previous) {
        queryClient.setQueryData<OptimisticWebLink[]>(
          queryKey,
          context.previous
        )
      }
    },
  })

  const refreshOneMutation = useMutation<
    IdeaWebLink,
    Error,
    string,
    { previous: OptimisticWebLink[] | undefined }
  >({
    mutationFn: async linkId => {
      const { webLink } = await ideaWebLinksClient.refresh(ideaId, linkId)
      return webLink
    },
    onMutate: async linkId => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<OptimisticWebLink[]>(queryKey)
      queryClient.setQueryData<OptimisticWebLink[]>(queryKey, prev =>
        (prev ?? []).map(l => (l.id === linkId ? { ...l, loading: true } : l))
      )
      return { previous }
    },
    onSuccess: webLink => {
      queryClient.setQueryData<OptimisticWebLink[]>(queryKey, prev =>
        (prev ?? []).map(l => (l.id === webLink.id ? webLink : l))
      )
    },
    onError: (_err, _linkId, context) => {
      if (context?.previous) {
        queryClient.setQueryData<OptimisticWebLink[]>(
          queryKey,
          context.previous
        )
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

  const refreshOne = useCallback(
    async (linkId: string) => {
      await refreshOneMutation.mutateAsync(linkId)
    },
    [refreshOneMutation]
  )

  return {
    webLinks: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
    add,
    remove,
    refreshOne,
  }
}
