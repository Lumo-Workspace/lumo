'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { tasksClient } from '@/lib/api-client'
import type { QuickAction, Mention } from '@/lib/quick-dispatch/types'

type DispatchPhase = 'input' | 'loading' | 'preview' | 'executing'

interface ParseResponse {
  actions: QuickAction[]
  needsConfirmation: boolean
}

interface ActionResult {
  type: 'updated' | 'created' | 'error'
  taskId?: string
  taskIdentifier?: string
  success: boolean
  message?: string
  index: number
}

interface ExecuteResponse {
  results: ActionResult[]
}

export function useQuickDispatch() {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [phase, setPhase] = useState<DispatchPhase>('input')
  const [input, setInput] = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])
  const [actions, setActions] = useState<QuickAction[]>([])
  const [results, setResults] = useState<ActionResult[]>([])
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
        const data = await tasksClient.parseQuickDispatch<ParseResponse>(
          { input: trimmed, workspaceUrl, mentions },
          controller.signal
        )

        if (controller.signal.aborted) return

        if (data.actions.length === 0) {
          setError('Could not parse any actions from the input')
          setPhase('input')
          return
        }

        setActions(data.actions)
        setPhase('preview')
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setPhase('input')
      }
    },
    [workspaceUrl, mentions]
  )

  const execute = useCallback(async () => {
    if (actions.length === 0) return

    setPhase('executing')
    setError(null)

    try {
      const executeActions = actions.map(a => {
        if (a.type === 'update') {
          return { type: 'update' as const, taskId: a.taskId, fields: a.fields }
        }
        return {
          type: 'create' as const,
          title: a.title,
          status: a.status,
          priority: a.priority,
          projectId: a.projectId!,
          assigneeActorId: a.assigneeActorId,
          description: a.description,
          dueDate: a.dueDate,
        }
      })

      const data = await tasksClient.executeQuickDispatch<ExecuteResponse>({
        actions: executeActions,
        workspaceUrl,
      })

      setResults(data.results)
      return data.results
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed')
      setPhase('preview')
      return undefined
    }
  }, [actions, workspaceUrl])

  const removeAction = useCallback((index: number) => {
    setActions(prev => prev.filter((_, i) => i !== index))
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setPhase('input')
    setInput('')
    setMentions([])
    setActions([])
    setResults([])
    setError(null)
  }, [])

  const backToInput = useCallback(() => {
    setPhase('input')
    setActions([])
  }, [])

  return {
    phase,
    input,
    setInput,
    mentions,
    setMentions,
    actions,
    results,
    error,
    parse,
    execute,
    removeAction,
    reset,
    backToInput,
  }
}
