'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch } from '../utils'
import { API } from '../constants'
import type { ApiDraft } from '../types'

interface UseDraftsReturn {
  drafts: ApiDraft[]
  loading: boolean
  error: string | null
  draftCount: number
  fetchDrafts: () => Promise<void>
  saveDraft: (
    type: 'TASK' | 'PROJECT',
    data: Record<string, unknown>,
    id?: string | undefined
  ) => Promise<ApiDraft | null>
  deleteDraft: (id: string) => Promise<boolean>
}

export function useDrafts(): UseDraftsReturn {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [drafts, setDrafts] = useState<ApiDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDrafts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(
        `${API.drafts.list}?workspaceUrl=${encodeURIComponent(workspaceUrl)}`
      )
      if (res.ok) {
        const data = await res.json()
        setDrafts(data.drafts ?? [])
      } else {
        setError('Failed to load drafts')
      }
    } catch {
      setError('Failed to load drafts')
    } finally {
      setLoading(false)
    }
  }, [workspaceUrl])

  const saveDraft = useCallback(
    async (
      type: 'TASK' | 'PROJECT',
      data: Record<string, unknown>,
      id?: string | undefined
    ): Promise<ApiDraft | null> => {
      try {
        const res = await apiFetch(API.drafts.list, {
          method: 'POST',
          body: { id, workspaceUrl, type, data },
        })
        if (res.ok) {
          const result = await res.json()
          const draft: ApiDraft = result.draft
          // Update local list
          setDrafts(prev => {
            const filtered = prev.filter(d => d.id !== draft.id)
            return [draft, ...filtered]
          })
          return draft
        }
        return null
      } catch {
        return null
      }
    },
    [workspaceUrl]
  )

  const deleteDraft = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await apiFetch(
          `${API.drafts.byId(id)}?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
          { method: 'DELETE' }
        )
        if (res.ok) {
          setDrafts(prev => prev.filter(d => d.id !== id))
          return true
        }
        return false
      } catch {
        return false
      }
    },
    [workspaceUrl]
  )

  return {
    drafts,
    loading,
    error,
    draftCount: drafts.length,
    fetchDrafts,
    saveDraft,
    deleteDraft,
  }
}
