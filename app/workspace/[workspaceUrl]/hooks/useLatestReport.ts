'use client'

import { useQuery } from '@tanstack/react-query'
import { summariesClient } from '@/lib/api-client/summaries'
import type { ApiWorkspaceSummary } from '@/types/summary'

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

export function useWorkspaceLatestReport(): UseLatestReportReturn {
  const query = useQuery<LatestReport>({
    queryKey: ['summary', 'workspace', 'latest'] as const,
    queryFn: async () => {
      const result = await summariesClient.getWorkspaceSummaries<{
        summaries?: ApiWorkspaceSummary[]
      }>(1)
      const latest = result.summaries?.[0]
      return {
        tldr: latest?.tldr ?? null,
        report: latest?.report ?? null,
        generatedAt: latest?.generatedAt ?? null,
      }
    },
  })

  return {
    ...(query.data ?? EMPTY),
    loading: query.isPending,
    refetch: () => {
      query.refetch()
    },
  }
}
