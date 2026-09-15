'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { webLinksClient } from '@/lib/api-client/task-web-links'
import { queryKeys } from '@/lib/query/keys'
import type { TaskWebLink } from '@prisma/client'

export type OptimisticWebLink = TaskWebLink & {
  tempId?: string
  loading?: boolean
}

interface UseWebLinksResult {
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
  taskId: string
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
    taskId,
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
    // LUM-783: the server scans metadata/body on write; a placeholder is unscanned.
    contentSignals: null,
    createdById: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    loading: true,
  }
}

export function useWebLinks(taskId: string, enabled = true): UseWebLinksResult {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.taskWebLinks(taskId)

  const query = useQuery<OptimisticWebLink[], Error>({
    queryKey,
    queryFn: async () => {
      const { webLinks } = await webLinksClient.list(taskId)
      return webLinks
    },
    enabled,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const addMutation = useMutation<
    TaskWebLink,
    Error,
    { url: string },
    { tempId: string }
  >({
    mutationFn: async payload => {
      const { webLink } = await webLinksClient.add(taskId, payload)
      return webLink
    },
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey })
      const placeholder = makeOptimisticPlaceholder(payload, taskId)
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
    mutationFn: linkId => webLinksClient.remove(taskId, linkId),
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
    TaskWebLink,
    Error,
    string,
    { previous: OptimisticWebLink[] | undefined }
  >({
    mutationFn: async linkId => {
      const { webLink } = await webLinksClient.refresh(taskId, linkId)
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
