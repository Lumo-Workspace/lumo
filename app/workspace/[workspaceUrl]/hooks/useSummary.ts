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

export function useProjectSummary(
  projectId: string
): UseSummaryReturn<ApiProjectSummary> {
  const cacheKey = CACHE_KEY.projectSummary(projectId)

  const [summary, setSummary] = useState<ApiProjectSummary | null>(() =>
    readCache<ApiProjectSummary>(cacheKey)
  )
  const [history, setHistory] = useState<ApiProjectSummary[]>([])
  const [loading, setLoading] = useState(false)
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

  const [summary, setSummary] = useState<ApiWorkspaceSummary | null>(() =>
    readCache<ApiWorkspaceSummary>(cacheKey)
  )
  const [history, setHistory] = useState<ApiWorkspaceSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetch(API.summaries.workspace)
      .then(async res => {
        if (res.ok) {
          const data = await res.json()
          const fetched: ApiWorkspaceSummary = data.summary
          setSummary(fetched)
          writeCache(cacheKey, fetched)
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
