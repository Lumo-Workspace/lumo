'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import type { QuickDispatchResponse } from '@/lib/prompts/quick-dispatch'
import { apiFetch } from '../utils'

type DispatchPhase = 'input' | 'loading' | 'preview' | 'editing'

export function useQuickDispatch() {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [phase, setPhase] = useState<DispatchPhase>('input')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<QuickDispatchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const parse = useCallback(
    async (rawInput: string) => {
      const trimmed = rawInput.trim()
      if (!trimmed) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setError(null)
      setPhase('loading')

      try {
        const res = await apiFetch('/api/tasks/parse-quick-dispatch', {
          method: 'POST',
          body: { input: trimmed, workspaceUrl },
        })

        if (controller.signal.aborted) return

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? 'Failed to parse input')
        }

        const data: QuickDispatchResponse = await res.json()
        setResult(data)

        if (data.titleTooVague) {
          setPhase('input')
        } else {
          setPhase('preview')
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setPhase('input')
      }
    },
    [workspaceUrl]
  )

  const enterEditMode = useCallback(() => {
    setPhase('editing')
  }, [])

  const exitEditMode = useCallback(() => {
    setPhase('preview')
  }, [])

  const updateField = useCallback(
    <K extends keyof QuickDispatchResponse>(
      key: K,
      value: QuickDispatchResponse[K]
    ) => {
      setResult(prev => (prev ? { ...prev, [key]: value } : prev))
    },
    []
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setInput('')
    setResult(null)
    setError(null)
  }, [])

  const backToInput = useCallback(() => {
    setPhase('input')
  }, [])

  return {
    phase,
    input,
    setInput,
    result,
    error,
    parse,
    enterEditMode,
    exitEditMode,
    updateField,
    reset,
    backToInput,
  }
}
