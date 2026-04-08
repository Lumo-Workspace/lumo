'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
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
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await apiFetch<{ summary: ApiProjectSummary }>(
          API.summaries.project(projectId)
        )
        if (cancelled) return
        setSummary(data.summary)
        writeCache(cacheKey, data.summary)
      } catch {
        if (!cancelled) setError('Failed to load summary')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, cacheKey])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const data = await apiFetch<{ summaries?: ApiProjectSummary[] }>(
        `${API.summaries.project(projectId)}?limit=30`
      )
      setHistory(data.summaries ?? [])
    } catch {
      // silently ignore history load failure
    } finally {
      setHistoryLoading(false)
    }
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
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await apiFetch<{
          summary?: ApiWorkspaceSummary
          summaries?: ApiWorkspaceSummary[]
        }>(API.summaries.workspace)
        if (cancelled) return
        const candidate = data.summary ?? data.summaries?.[0]
        const fetched = isValidSummary(candidate)
          ? (candidate as ApiWorkspaceSummary)
          : null
        setSummary(fetched)
        if (fetched) writeCache(cacheKey, fetched)
      } catch {
        if (!cancelled) setError('Failed to load summary')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [cacheKey])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const data = await apiFetch<{ summaries?: ApiWorkspaceSummary[] }>(
        `${API.summaries.workspace}?limit=30`
      )
      setHistory(data.summaries ?? [])
    } catch {
      // silently ignore history load failure
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  return { summary, history, loading, error, loadHistory, historyLoading }
}
