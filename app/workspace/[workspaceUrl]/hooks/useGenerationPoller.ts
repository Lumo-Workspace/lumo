'use client'

import { useState, useEffect, useRef } from 'react'
import { summariesClient } from '@/lib/api-client/summaries'

interface UseGenerationPollerReturn {
  status: 'idle' | 'pending' | 'completed' | 'failed'
  summaryId: string | null
}

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 20

export function useGenerationPoller(
  jobId: string | null
): UseGenerationPollerReturn {
  const [status, setStatus] = useState<UseGenerationPollerReturn['status']>(
    jobId ? 'pending' : 'idle'
  )
  const [summaryId, setSummaryId] = useState<string | null>(null)
  const pollCount = useRef(0)

  useEffect(() => {
    if (!jobId) {
      setStatus('idle')
      setSummaryId(null)
      return
    }

    setStatus('pending')
    pollCount.current = 0

    const interval = setInterval(async () => {
      pollCount.current++

      if (pollCount.current > MAX_POLLS) {
        setStatus('failed')
        clearInterval(interval)
        return
      }

      try {
        const result = await summariesClient.getJobStatus(jobId)
        if (result.status === 'completed') {
          setStatus('completed')
          setSummaryId(result.summaryId)
          clearInterval(interval)
        } else if (result.status === 'failed') {
          setStatus('failed')
          clearInterval(interval)
        }
      } catch {
        setStatus('failed')
        clearInterval(interval)
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [jobId])

  return { status, summaryId }
}
