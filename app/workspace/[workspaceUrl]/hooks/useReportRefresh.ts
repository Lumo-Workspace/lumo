'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { summariesClient } from '@/lib/api-client/summaries'
import { useGenerationPoller } from './useGenerationPoller'
import { ApiClientError } from '@/lib/api-client/base'

type RefreshState = 'idle' | 'generating' | 'cooldown'

interface UseReportRefreshReturn {
  state: RefreshState
  cooldownSeconds: number
  trigger: () => void
}

export function useReportRefresh(
  scope: { type: 'project'; projectId: string } | { type: 'workspace' },
  onComplete: () => void
): UseReportRefreshReturn {
  const [state, setState] = useState<RefreshState>('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)

  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const scopeType = scope.type
  const scopeProjectId = scope.type === 'project' ? scope.projectId : undefined

  const poller = useGenerationPoller(jobId)

  // React to poller completing/failing
  useEffect(() => {
    if (poller.status === 'completed') {
      setJobId(null)
      setState('idle')
      onCompleteRef.current()
    } else if (poller.status === 'failed') {
      setJobId(null)
      setState('idle')
    }
  }, [poller.status])

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldownSeconds <= 0) {
      if (state === 'cooldown') setState('idle')
      return
    }
    const timer = setTimeout(() => setCooldownSeconds(s => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldownSeconds, state])

  const trigger = useCallback(async () => {
    if (state !== 'idle') return

    setState('generating')
    try {
      const result =
        scopeType === 'project' && scopeProjectId
          ? await summariesClient.generateProject(scopeProjectId)
          : await summariesClient.generateWorkspace()

      setJobId(result.jobId)
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        // Parse retryAfter from response body
        try {
          const body = JSON.parse(err.message)
          const retryAfter = body.retryAfter ?? 300
          setCooldownSeconds(retryAfter)
          setState('cooldown')
        } catch {
          setCooldownSeconds(300)
          setState('cooldown')
        }
      } else {
        setState('idle')
      }
    }
  }, [state, scopeType, scopeProjectId])

  return { state, cooldownSeconds, trigger }
}
