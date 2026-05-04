'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { API } from '../constants'
import { queryKeys } from '@/lib/query/keys'
import type { ApiDraft } from '../types'

interface UseDraftsReturn {
  drafts: ApiDraft[]
  loading: boolean
  error: string | null
  draftCount: number
  fetchDrafts: () => Promise<void>
  /** Saves a draft. Throws on failure so callers can show error feedback. */
  saveDraft: (
    type: 'TASK' | 'PROJECT',
    data: Record<string, unknown>,
    id?: string | undefined
  ) => Promise<ApiDraft>
  deleteDraft: (id: string) => Promise<boolean>
}

export function useDrafts(): UseDraftsReturn {
  const queryClient = useQueryClient()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const queryKey = useMemo(
    () => [...queryKeys.drafts(), workspaceUrl] as const,
    [workspaceUrl]
  )

  const query = useQuery<ApiDraft[]>({
    queryKey,
    queryFn: async () => {
      const data = await apiFetch<{ drafts?: ApiDraft[] }>(
        `${API.drafts.list}?workspaceUrl=${encodeURIComponent(workspaceUrl)}`
      )
      return data.drafts ?? []
    },
    // Caller-driven (legacy fetchDrafts semantics).
    enabled: false,
  })

  const queryRef = useRef(query)
  queryRef.current = query

  const fetchDrafts = useCallback(async () => {
    await queryRef.current.refetch()
  }, [])

  const setDraftsLocal = useCallback(
    (updater: (prev: ApiDraft[]) => ApiDraft[]) => {
      queryClient.setQueryData<ApiDraft[]>(queryKey, prev =>
        updater(prev ?? [])
      )
    },
    [queryClient, queryKey]
  )

  const saveDraft = useCallback(
    async (
      type: 'TASK' | 'PROJECT',
      data: Record<string, unknown>,
      id?: string | undefined
    ): Promise<ApiDraft> => {
      const tempId = `temp-${Date.now()}`
      const now = new Date().toISOString()
      const optimisticDraft: ApiDraft = {
        id: id ?? tempId,
        type,
        data,
        createdAt: now,
        updatedAt: now,
      }

      setDraftsLocal(prev => [
        optimisticDraft,
        ...prev.filter(d => d.id !== optimisticDraft.id),
      ])

      let result: { draft: ApiDraft }
      try {
        result = await apiFetch<{ draft: ApiDraft }>(API.drafts.list, {
          method: 'POST',
          body: { id, workspaceUrl, type, data },
        })
      } catch (err) {
        setDraftsLocal(prev => prev.filter(d => d.id !== optimisticDraft.id))
        throw new Error(
          err instanceof Error ? err.message : 'Failed to save draft'
        )
      }

      const serverDraft: ApiDraft = result.draft
      setDraftsLocal(prev => [
        serverDraft,
        ...prev.filter(
          d => d.id !== optimisticDraft.id && d.id !== serverDraft.id
        ),
      ])

      return serverDraft
    },
    [workspaceUrl, setDraftsLocal]
  )

  const deleteDraft = useCallback(
    async (id: string): Promise<boolean> => {
      let removed: ApiDraft | undefined
      setDraftsLocal(prev => {
        removed = prev.find(d => d.id === id)
        return prev.filter(d => d.id !== id)
      })

      try {
        await apiFetch<void>(
          `${API.drafts.byId(id)}?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
          { method: 'DELETE' }
        )
        return true
      } catch (err) {
        if (removed) {
          setDraftsLocal(prev => [removed!, ...prev])
        }
        const message =
          err instanceof Error ? err.message : 'Failed to delete draft'
        toast.error(message)
        return false
      }
    },
    [workspaceUrl, setDraftsLocal]
  )

  const drafts = query.data ?? []

  return {
    drafts,
    loading: query.isFetching && !query.data,
    error: query.error
      ? ((query.error as Error).message ?? 'Failed to load drafts')
      : null,
    draftCount: drafts.length,
    fetchDrafts,
    saveDraft,
    deleteDraft,
  }
}
