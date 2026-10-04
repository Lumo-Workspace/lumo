'use client'

import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { taskTemplatesClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

/**
 * LUM-970: system + workspace task templates, with the system templates'
 * guidance rendered in the viewer's UI locale.
 */
export function useTaskTemplates(enabled = true) {
  const { locale } = useIntl()
  const query = useQuery({
    queryKey: queryKeys.taskTemplates(locale),
    queryFn: () => taskTemplatesClient.list(locale),
    enabled,
    staleTime: 60_000,
  })
  return {
    templates: query.data?.templates ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  }
}
