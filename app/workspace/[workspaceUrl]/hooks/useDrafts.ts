'use client'

import { useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch } from '../utils'
import { API, CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
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
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()

  // Seed from cache so drafts are visible immediately
  const [drafts, setDrafts] = useState<ApiDraft[]>(
    () => readCache<ApiDraft[]>(CACHE_KEY.drafts) ?? []
  )
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
        const serverDrafts: ApiDraft[] = data.drafts ?? []
        setDrafts(serverDrafts)
        writeCache(CACHE_KEY.drafts, serverDrafts)
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
    ): Promise<ApiDraft> => {
      // Optimistic: create a temporary draft and write to cache immediately
      const tempId = `temp-${Date.now()}`
      const now = new Date().toISOString()
      const optimisticDraft: ApiDraft = {
        id: id ?? tempId,
        type,
        data,
        createdAt: now,
        updatedAt: now,
      }

      setDrafts(prev => {
        const filtered = prev.filter(d => d.id !== optimisticDraft.id)
        const next = [optimisticDraft, ...filtered]
        writeCache(CACHE_KEY.drafts, next)
        return next
      })

      // Then sync to server
      const res = await apiFetch(API.drafts.list, {
        method: 'POST',
        body: { id, workspaceUrl, type, data },
      })
      if (!res.ok) {
        // Rollback optimistic update
        setDrafts(prev => {
          const rolled = prev.filter(d => d.id !== optimisticDraft.id)
          writeCache(CACHE_KEY.drafts, rolled)
          return rolled
        })
        const err = await res.json().catch(() => ({}))
        throw new Error(
          (err as { error?: string }).error ?? 'Failed to save draft'
        )
      }

      const result = await res.json()
      const serverDraft: ApiDraft = result.draft

      // Replace optimistic draft with server version (real id, timestamps)
      setDrafts(prev => {
        const filtered = prev.filter(
          d => d.id !== optimisticDraft.id && d.id !== serverDraft.id
        )
        const next = [serverDraft, ...filtered]
        writeCache(CACHE_KEY.drafts, next)
        return next
      })

      return serverDraft
    },
    [workspaceUrl]
  )

  const deleteDraft = useCallback(
    async (id: string): Promise<boolean> => {
      // Optimistic: remove from state + cache immediately
      let removed: ApiDraft | undefined
      setDrafts(prev => {
        removed = prev.find(d => d.id === id)
        const next = prev.filter(d => d.id !== id)
        writeCache(CACHE_KEY.drafts, next)
        return next
      })

      try {
        const res = await apiFetch(
          `${API.drafts.byId(id)}?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
          { method: 'DELETE' }
        )
        if (!res.ok) {
          // Rollback: re-add draft
          if (removed) {
            setDrafts(prev => {
              const next = [removed!, ...prev]
              writeCache(CACHE_KEY.drafts, next)
              return next
            })
          }
          return false
        }
        return true
      } catch {
        // Rollback on network error
        if (removed) {
          setDrafts(prev => {
            const next = [removed!, ...prev]
            writeCache(CACHE_KEY.drafts, next)
            return next
          })
        }
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
