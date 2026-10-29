'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { tasksClient, ApiClientError } from '@/lib/api-client'
import { isAiOffCode } from '@/lib/ai-features/registry'
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
  const intl = useIntl()
  const [phase, setPhase] = useState<DispatchPhase>('input')
  const [input, setInput] = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])
  // The parsed actions live in local state so removeAction() can edit the
  // preview list freely between parse and execute.
  const [actions, setActions] = useState<QuickAction[]>([])
  const [results, setResults] = useState<ActionResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const parseMutation = useMutation<
    ParseResponse,
    Error,
    { input: string; mentions: Mention[] }
  >({
    mutationFn: async ({ input: rawInput, mentions: mentionList }) => {
      // Cancel any in-flight parse so the latest call wins.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      return tasksClient.parseQuickDispatch<ParseResponse>(
        { input: rawInput.trim(), workspaceUrl, mentions: mentionList },
        controller.signal
      )
    },
    onMutate: () => {
      setError(null)
      setPhase('loading')
    },
    onSuccess: data => {
      if (abortRef.current?.signal.aborted) return
      if (data.actions.length === 0) {
        setError('Could not parse any actions from the input')
        setPhase('input')
        return
      }
      setActions(data.actions)
      setPhase('preview')
    },
    onError: err => {
      if (abortRef.current?.signal.aborted) return
      // LUM-1338: AI switched off or not configured — say so, not the raw error.
      setError(
        err instanceof ApiClientError && isAiOffCode(err.code)
          ? intl.formatMessage({ id: 'aiFeatures.error.unavailable' })
          : err instanceof Error
            ? err.message
            : 'Something went wrong'
      )
      setPhase('input')
    },
  })

  const parse = useCallback(
    async (rawInput: string) => {
      const trimmed = rawInput.trim()
      if (!trimmed) return
      parseMutation.mutate({ input: rawInput, mentions })
    },
    [parseMutation, mentions]
  )

  const executeMutation = useMutation<
    ExecuteResponse,
    Error,
    { actions: QuickAction[] }
  >({
    mutationFn: ({ actions: list }) => {
      const executeActions = list.map(a => {
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
      return tasksClient.executeQuickDispatch<ExecuteResponse>({
        actions: executeActions,
        workspaceUrl,
      })
    },
    onMutate: () => {
      setError(null)
      setPhase('executing')
    },
    onSuccess: data => {
      setResults(data.results)
    },
    onError: err => {
      setError(err instanceof Error ? err.message : 'Execution failed')
      setPhase('preview')
    },
  })

  const execute = useCallback(async () => {
    if (actions.length === 0) return
    const data = await executeMutation
      .mutateAsync({ actions })
      .catch(() => null)
    return data?.results
  }, [actions, executeMutation])

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
    parseMutation.reset()
    executeMutation.reset()
  }, [parseMutation, executeMutation])

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
