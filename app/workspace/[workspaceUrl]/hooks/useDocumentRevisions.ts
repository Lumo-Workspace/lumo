'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { documentRevisionsApi } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export interface RevisionListItem {
  id: string
  label: string | null
  isManual: boolean
  title: string
  emoji: string | null
  wordCount: number | null
  createdAt: string
  updatedAt: string
  author: { id: string; name: string; imageUrl: string | null }
}

export interface RevisionDetail {
  id: string
  content: string | null
  title: string
  emoji: string | null
  label: string | null
  isManual: boolean
  createdAt: string
}

export function useDocumentRevisions(documentId: string, enabled: boolean) {
  const queryClient = useQueryClient()
  const key = queryKeys.documentRevisions(documentId)

  const query = useQuery<RevisionListItem[]>({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const data = await documentRevisionsApi.list<{
        revisions: RevisionListItem[]
      }>(documentId)
      return data.revisions
    },
  })

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient, key]
  )

  const getRevision = useCallback(
    async (revId: string): Promise<RevisionDetail> => {
      const data = await documentRevisionsApi.get<{ revision: RevisionDetail }>(
        documentId,
        revId
      )
      return data.revision
    },
    [documentId]
  )

  const createManual = useCallback(
    async (label: string) => {
      await documentRevisionsApi.createManual(documentId, { label })
      await refresh()
    },
    [documentId, refresh]
  )

  const restore = useCallback(
    async (revId: string) => {
      const data = await documentRevisionsApi.restore<{ document: unknown }>(
        documentId,
        revId
      )
      await refresh()
      return data.document
    },
    [documentId, refresh]
  )

  return {
    revisions: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    getRevision,
    createManual,
    restore,
    refresh,
  }
}
