'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../utils'
import { API, CACHE_KEY } from '../constants'
import { readCache, writeCache } from '../cache'
import type { ApiProjectSummary, ApiWorkspaceSummary } from '@/types/summary'

interface UseSummaryReturn<T> {
  summary: T | null
  history: T[]
  loading: boolean
  error: string | null
  loadHistory: () => void
  historyLoading: boolean
}

function isValidSummary(v: unknown): boolean {
  return (
    v != null &&
    typeof v === 'object' &&
    'generatedAt' in v &&
    'tldr' in v &&
    typeof (v as Record<string, unknown>).generatedAt === 'string' &&
    !isNaN(Date.parse((v as Record<string, unknown>).generatedAt as string))
  )
}

export function useProjectSummary(
  projectId: string
): UseSummaryReturn<ApiProjectSummary> {
  const cacheKey = CACHE_KEY.projectSummary(projectId)

  const [summary, setSummary] = useState<ApiProjectSummary | null>(() => {
    const cached = readCache<ApiProjectSummary>(cacheKey)
    return isValidSummary(cached) ? cached : null
  })
  const [history, setHistory] = useState<ApiProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetch(API.summaries.project(projectId))
      .then(async res => {
        if (res.ok) {
          const data = await res.json()
          const fetched: ApiProjectSummary = data.summary
          setSummary(fetched)
          writeCache(cacheKey, fetched)
        } else {
          setError('Failed to load summary')
        }
      })
      .catch(() => setError('Failed to load summary'))
      .finally(() => setLoading(false))
  }, [projectId, cacheKey])

  const loadHistory = useCallback(() => {
    setHistoryLoading(true)
    apiFetch(`${API.summaries.project(projectId)}?limit=30`)
      .then(async res => {
        if (res.ok) {
          const data = await res.json()
          setHistory(data.summaries ?? [])
        }
      })
      .catch(() => {
        // silently ignore history load failure
      })
      .finally(() => setHistoryLoading(false))
  }, [projectId])

  return { summary, history, loading, error, loadHistory, historyLoading }
}

export function useWorkspaceSummary(): UseSummaryReturn<ApiWorkspaceSummary> {
  const cacheKey = CACHE_KEY.workspaceSummary

  const [summary, setSummary] = useState<ApiWorkspaceSummary | null>(() => {
    const cached = readCache<ApiWorkspaceSummary>(cacheKey)
    return isValidSummary(cached) ? cached : null
  })
  const [history, setHistory] = useState<ApiWorkspaceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetch(API.summaries.workspace)
      .then(async res => {
        if (res.ok) {
          const data = await res.json()
          const candidate = data.summary ?? data.summaries?.[0]
          const fetched = isValidSummary(candidate)
            ? (candidate as ApiWorkspaceSummary)
            : null
          setSummary(fetched)
          if (fetched) writeCache(cacheKey, fetched)
        } else {
          setError('Failed to load summary')
        }
      })
      .catch(() => setError('Failed to load summary'))
      .finally(() => setLoading(false))
  }, [cacheKey])

  const loadHistory = useCallback(() => {
    setHistoryLoading(true)
    apiFetch(`${API.summaries.workspace}?limit=30`)
      .then(async res => {
        if (res.ok) {
          const data = await res.json()
          setHistory(data.summaries ?? [])
        }
      })
      .catch(() => {
        // silently ignore history load failure
      })
      .finally(() => setHistoryLoading(false))
  }, [])

  return { summary, history, loading, error, loadHistory, historyLoading }
}
