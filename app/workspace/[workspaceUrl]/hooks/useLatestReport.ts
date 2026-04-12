'use client'

import { useState, useEffect, useCallback } from 'react'
import { summariesClient } from '@/lib/api-client/summaries'
import type { ApiProjectSummary, ApiWorkspaceSummary } from '@/types/summary'

interface LatestReport {
  tldr: string | null
  report: string | null
  generatedAt: string | null
}

interface UseLatestReportReturn extends LatestReport {
  loading: boolean
  refetch: () => void
}

const EMPTY: LatestReport = { tldr: null, report: null, generatedAt: null }

export function useProjectLatestReport(
  projectId: string
): UseLatestReportReturn {
  const [data, setData] = useState<LatestReport>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    summariesClient
      .getProjectSummaries<{ summaries?: ApiProjectSummary[] }>(projectId, 1)
      .then(result => {
        if (cancelled) return
        const latest = result.summaries?.[0]
        setData({
          tldr: latest?.tldr ?? null,
          report: latest?.report ?? null,
          generatedAt: latest?.generatedAt ?? null,
        })
      })
      .catch(() => {
        // Keep existing data on refetch failure
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const refetch = useCallback(() => setTick(t => t + 1), [])

  return { ...data, loading, refetch }
}

export function useWorkspaceLatestReport(): UseLatestReportReturn {
  const [data, setData] = useState<LatestReport>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    summariesClient
      .getWorkspaceSummaries<{ summaries?: ApiWorkspaceSummary[] }>(1)
      .then(result => {
        if (cancelled) return
        const latest = result.summaries?.[0]
        setData({
          tldr: latest?.tldr ?? null,
          report: latest?.report ?? null,
          generatedAt: latest?.generatedAt ?? null,
        })
      })
      .catch(() => {
        // Keep existing data on refetch failure
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  const refetch = useCallback(() => setTick(t => t + 1), [])

  return { ...data, loading, refetch }
}
