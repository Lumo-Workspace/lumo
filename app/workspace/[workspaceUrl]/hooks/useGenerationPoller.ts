'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { summariesClient } from '@/lib/api-client/summaries'
import { queryKeys } from '@/lib/query/keys'

interface JobStatusResult {
  status: string
  summaryId: string | null
}

interface UseGenerationPollerReturn {
  status: 'idle' | 'pending' | 'completed' | 'failed'
  summaryId: string | null
}

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 20

/**
 * Polls the summary generation job status until completion. Backed by
 * `useQuery({ refetchInterval })` — the polling loop, mount/unmount cleanup,
 * and request dedup are all handled by TanStack Query. Stops after
 * MAX_POLLS successful polls or when the job reports completed/failed.
 */
export function useGenerationPoller(
  jobId: string | null
): UseGenerationPollerReturn {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.summaries.generationJob(jobId ?? '__none__')

  const query = useQuery<JobStatusResult>({
    queryKey,
    queryFn: () => summariesClient.getJobStatus(jobId as string),
    enabled: !!jobId,
    refetchInterval: q => {
      const data = q.state.data
      if (data && (data.status === 'completed' || data.status === 'failed')) {
        return false
      }
      if (q.state.dataUpdateCount >= MAX_POLLS) return false
      return POLL_INTERVAL_MS
    },
    retry: false,
  })

  // Read the successful-fetch count from the query state (the public hook
  // result doesn't expose dataUpdateCount). The query observer keeps this
  // up to date and our component re-renders whenever the query data updates,
  // so reading here in render is consistent.
  const dataUpdateCount =
    queryClient.getQueryState<JobStatusResult>(queryKey)?.dataUpdateCount ?? 0
  const dataStatus = query.data?.status
  const timedOut = dataUpdateCount >= MAX_POLLS && dataStatus !== 'completed'

  const status: UseGenerationPollerReturn['status'] = !jobId
    ? 'idle'
    : query.isError || dataStatus === 'failed' || timedOut
      ? 'failed'
      : dataStatus === 'completed'
        ? 'completed'
        : 'pending'

  const summaryId =
    query.data?.status === 'completed' ? query.data.summaryId : null

  return { status, summaryId }
}
