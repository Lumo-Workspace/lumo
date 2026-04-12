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

export function useProjectLatestReport(
  projectId: string
): UseLatestReportReturn {
  const [data, setData] = useState<LatestReport>({
    tldr: null,
    report: null,
    generatedAt: null,
  })
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const result = await summariesClient.getProjectSummaries<{
        summaries?: ApiProjectSummary[]
      }>(projectId, 1)
      const latest = result.summaries?.[0]
      setData({
        tldr: latest?.tldr ?? null,
        report: latest?.report ?? null,
        generatedAt: latest?.generatedAt ?? null,
      })
    } catch {
      // Keep existing data on refetch failure
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    fetch().then(() => {
      if (cancelled) setData({ tldr: null, report: null, generatedAt: null })
    })
    return () => {
      cancelled = true
    }
  }, [fetch])

  return { ...data, loading, refetch: fetch }
}

export function useWorkspaceLatestReport(): UseLatestReportReturn {
  const [data, setData] = useState<LatestReport>({
    tldr: null,
    report: null,
    generatedAt: null,
  })
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const result = await summariesClient.getWorkspaceSummaries<{
        summaries?: ApiWorkspaceSummary[]
      }>(1)
      const latest = result.summaries?.[0]
      setData({
        tldr: latest?.tldr ?? null,
        report: latest?.report ?? null,
        generatedAt: latest?.generatedAt ?? null,
      })
    } catch {
      // Keep existing data on refetch failure
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch().then(() => {
      if (cancelled) setData({ tldr: null, report: null, generatedAt: null })
    })
    return () => {
      cancelled = true
    }
  }, [fetch])

  return { ...data, loading, refetch: fetch }
}
