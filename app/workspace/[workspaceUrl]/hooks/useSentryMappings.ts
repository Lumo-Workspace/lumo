'use client'

import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sentryApi, type SentryMapping } from '@/lib/api-client/sentry'
import { queryKeys } from '@/lib/query/keys'

interface UseSentryMappingsResult {
  mappings: SentryMapping[]
  loading: boolean
  submitting: boolean
  addMapping: (data: {
    sentryProjectSlug: string
    projectId: string
  }) => Promise<void>
  removeMapping: (id: string) => Promise<void>
}

/**
 * Sentry project-mapping list backed by TanStack Query. Reopening the mappings
 * dialog within `staleTime` reads from cache instead of re-fetching, and the
 * add/remove mutations keep that cache in sync optimistically.
 *
 * `enabled` gates the read on the dialog being open.
 */
export function useSentryMappings(
  workspaceUrl: string,
  enabled: boolean
): UseSentryMappingsResult {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const queryKey = queryKeys.integrations.sentryMappings(workspaceUrl)

  const query = useQuery<SentryMapping[]>({
    queryKey,
    queryFn: () => sentryApi.listMappings(workspaceUrl),
    enabled,
    staleTime: 30_000,
  })

  const addMutation = useMutation<
    SentryMapping,
    Error,
    { sentryProjectSlug: string; projectId: string },
    { tempId: string }
  >({
    mutationFn: data => sentryApi.createMapping(workspaceUrl, data),
    onMutate: async data => {
      await queryClient.cancelQueries({ queryKey })
      const tempId = `tmp_${data.sentryProjectSlug}_${data.projectId}`
      const placeholder: SentryMapping = {
        id: tempId,
        sentryProjectSlug: data.sentryProjectSlug,
        projectId: data.projectId,
      }
      queryClient.setQueryData<SentryMapping[]>(queryKey, prev => [
        ...(prev ?? []),
        placeholder,
      ])
      return { tempId }
    },
    onSuccess: (created, _data, context) => {
      queryClient.setQueryData<SentryMapping[]>(queryKey, prev =>
        (prev ?? []).map(m => (m.id === context?.tempId ? created : m))
      )
      toast.success(intl.formatMessage({ id: 'sentry.mappingAdded' }))
    },
    onError: (err, _data, context) => {
      queryClient.setQueryData<SentryMapping[]>(queryKey, prev =>
        (prev ?? []).filter(m => m.id !== context?.tempId)
      )
      toast.error(
        err.message || intl.formatMessage({ id: 'sentry.mappingAddFailed' })
      )
    },
  })

  const removeMutation = useMutation<
    { success: true },
    Error,
    string,
    { previous: SentryMapping[] }
  >({
    mutationFn: id => sentryApi.deleteMapping(workspaceUrl, id),
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<SentryMapping[]>(queryKey) ?? []
      queryClient.setQueryData<SentryMapping[]>(queryKey, prev =>
        (prev ?? []).filter(m => m.id !== id)
      )
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context) {
        queryClient.setQueryData(queryKey, context.previous)
      }
      toast.error(intl.formatMessage({ id: 'sentry.mappingRemoveFailed' }))
    },
  })

  const addMapping = useCallback(
    async (data: { sentryProjectSlug: string; projectId: string }) => {
      await addMutation.mutateAsync(data)
    },
    [addMutation]
  )

  const removeMapping = useCallback(
    async (id: string) => {
      await removeMutation.mutateAsync(id)
    },
    [removeMutation]
  )

  return {
    mappings: query.data ?? [],
    loading: query.isLoading,
    submitting: addMutation.isPending,
    addMapping,
    removeMapping,
  }
}
