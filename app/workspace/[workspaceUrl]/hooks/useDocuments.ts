'use client'

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient, type Updater } from '@tanstack/react-query'
import { ApiDocument } from '../types'
import { documentsClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export function useDocuments() {
  const queryClient = useQueryClient()
  const [visibility, setVisibility] = useState<string | undefined>(undefined)

  const queryKey = [...queryKeys.documents.all(), visibility ?? 'all'] as const

  const query = useQuery<ApiDocument[]>({
    queryKey,
    queryFn: async () => {
      const data = await documentsClient.list<{ documents: ApiDocument[] }>(
        visibility
      )
      return data.documents
    },
    // Caller-driven (legacy fetchDocuments semantics).
    enabled: false,
  })

  const fetchDocuments = useCallback(
    async (nextVisibility?: string) => {
      setVisibility(nextVisibility)
      await queryClient.fetchQuery<ApiDocument[]>({
        queryKey: [
          ...queryKeys.documents.all(),
          nextVisibility ?? 'all',
        ] as const,
        queryFn: async () => {
          const data = await documentsClient.list<{
            documents: ApiDocument[]
          }>(nextVisibility)
          return data.documents
        },
      })
    },
    [queryClient]
  )

  const setDocuments = useCallback(
    (updater: Updater<ApiDocument[], ApiDocument[]>) => {
      queryClient.setQueryData<ApiDocument[]>(queryKey, prev => {
        const prevDocs = prev ?? []
        return typeof updater === 'function'
          ? (updater as (prev: ApiDocument[]) => ApiDocument[])(prevDocs)
          : updater
      })
    },
    [queryClient, queryKey]
  )

  return {
    documents: query.data ?? [],
    setDocuments,
    loading: query.isFetching && !query.data,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load documents.')
      : null,
    fetchDocuments,
  }
}
