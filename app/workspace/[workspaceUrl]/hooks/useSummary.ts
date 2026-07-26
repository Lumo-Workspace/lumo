'use client'

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
import { API } from '../constants'
import { queryKeys } from '@/lib/query/keys'
import type { ApiWorkspaceSummary } from '@/types/summary'

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

export function useWorkspaceSummary(): UseSummaryReturn<ApiWorkspaceSummary> {
  const query = useQuery<ApiWorkspaceSummary | null>({
    queryKey: queryKeys.summary.workspace(),
    queryFn: async () => {
      const data = await apiFetch<{
        summary?: ApiWorkspaceSummary
        summaries?: ApiWorkspaceSummary[]
      }>(API.summaries.workspace)
      const candidate = data.summary ?? data.summaries?.[0]
      return isValidSummary(candidate)
        ? (candidate as ApiWorkspaceSummary)
        : null
    },
  })

  const [history, setHistory] = useState<ApiWorkspaceSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

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

  return {
    summary: query.data ?? null,
    history,
    loading: query.isPending,
    error: query.error ? 'Failed to load summary' : null,
    loadHistory,
    historyLoading,
  }
}
