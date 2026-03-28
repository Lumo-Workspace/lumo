'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Pusher from 'pusher-js'
import { Loader2, X } from 'lucide-react'
import type { AgentEvent } from '@/lib/pusher/server'

interface AgentLog {
  id: string
  type: AgentEvent['type']
  message: string
}

interface AgentStatusProps {
  taskId: string
  initialStatus?: string | null
  initialPrUrl?: string | null
  onRetry?: () => void
}

const ICON: Record<AgentEvent['type'], string> = {
  'agent:started': '🚀',
  'agent:thinking': '💭',
  'agent:tool': '⚡',
  'agent:progress': '●',
  'agent:clarify': '❓',
  'agent:done': '✅',
  'agent:failed': '❌',
}

const TOOL_LABEL: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  Bash: 'Running',
}

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent:started':
      return 'Agent started'
    case 'agent:thinking':
      return event.message
    case 'agent:tool':
      return `${TOOL_LABEL[event.tool] ?? event.tool}${event.input ? `: ${event.input}` : ''}`
    case 'agent:progress':
      return event.message
    case 'agent:clarify':
      return `Needs clarification: ${event.question}`
    case 'agent:done':
      return 'Done — PR created'
    case 'agent:failed':
      return `Failed: ${event.error}`
  }
}

export function AgentStatus({
  taskId,
  initialStatus,
  initialPrUrl,
  onRetry,
}: AgentStatusProps) {
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [status, setStatus] = useState<string>(initialStatus ?? 'idle')
  const [prUrl, setPrUrl] = useState<string | null>(initialPrUrl ?? null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const handleCancel = useCallback(async () => {
    setCancelling(true)
    try {
      await fetch('/api/agent/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
    } finally {
      setCancelling(false)
    }
  }, [taskId])

  const handleRetry = useCallback(async () => {
    setRetrying(true)
    setLogs([])
    setErrorMsg(null)
    try {
      await fetch('/api/agent/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      setStatus('running')
      onRetry?.()
    } finally {
      setRetrying(false)
    }
  }, [taskId, onRetry])

  useEffect(() => {
    if (initialStatus && initialStatus !== 'idle') {
      setStatus(initialStatus)
      if (initialStatus === 'running') setLogs([])
    }
  }, [initialStatus])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    if (!pusherKey || !pusherCluster) return

    const pusher = new Pusher(pusherKey, { cluster: pusherCluster })
    const channel = pusher.subscribe(`task-${taskId}`)

    channel.bind('agent-update', (event: AgentEvent) => {
      setLogs(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: event.type,
          message: formatEvent(event),
        },
      ])

      if (event.type === 'agent:started') setStatus('running')
      if (event.type === 'agent:done') {
        setStatus('done')
        setPrUrl(event.prUrl)
      }
      if (event.type === 'agent:failed') {
        const isCancelled = event.error === 'Cancelled by user'
        setStatus(isCancelled ? 'cancelled' : 'failed')
        if (!isCancelled) setErrorMsg(event.error)
      }
      if (event.type === 'agent:clarify') setStatus('paused')
    })

    return () => {
      channel.unbind_all()
      pusher.unsubscribe(`task-${taskId}`)
    }
  }, [taskId])

  if (status === 'idle') return null

  return (
    <div className='rounded-lg border border-border bg-muted/30 p-4 space-y-3'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2 text-sm font-medium'>
          {status === 'running' && (
            <span className='h-2 w-2 rounded-full bg-blue-500 animate-pulse' />
          )}
          {status === 'done' && (
            <span className='h-2 w-2 rounded-full bg-green-500' />
          )}
          {(status === 'failed' || status === 'cancelled') && (
            <span className='h-2 w-2 rounded-full bg-red-500' />
          )}
          {status === 'paused' && (
            <span className='h-2 w-2 rounded-full bg-yellow-500' />
          )}
          <span className='text-muted-foreground'>
            {status === 'running' && 'Agent is working...'}
            {status === 'done' && 'Agent finished'}
            {status === 'failed' && 'Agent failed'}
            {status === 'cancelled' && 'Cancelled'}
            {status === 'paused' && 'Waiting for clarification'}
          </span>
        </div>
        {(status === 'running' || status === 'paused') && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className='flex items-center gap-1 text-xs text-zinc-400 hover:text-red-500 disabled:opacity-50 transition-colors'
            title='Cancel agent'
          >
            {cancelling ? (
              <Loader2 size={12} className='animate-spin' />
            ) : (
              <X size={12} />
            )}
            Cancel
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <div className='flex items-center gap-2 font-mono text-xs text-muted-foreground'>
          <span className='h-2 w-2 rounded-full bg-blue-400 animate-pulse shrink-0' />
          Starting agent…
        </div>
      ) : (
        <div className='max-h-64 overflow-y-auto space-y-1 font-mono text-xs'>
          {logs.map(log => (
            <div
              key={log.id}
              className='flex items-start gap-2 text-muted-foreground'
            >
              <span className='shrink-0 w-4'>{ICON[log.type]}</span>
              <span className='break-all'>{log.message}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {errorMsg && (status === 'failed' || status === 'cancelled') && (
        <div className='space-y-2'>
          <p className='text-xs text-muted-foreground'>{errorMsg}</p>
          <div className='flex items-center gap-2'>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className='flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors dark:bg-zinc-700 dark:hover:bg-zinc-600'
            >
              {retrying ? <Loader2 size={11} className='animate-spin' /> : null}
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
            <span className='text-xs text-muted-foreground'>
              or take over manually
            </span>
          </div>
        </div>
      )}

      {prUrl && (
        <a
          href={prUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-1 text-xs text-blue-500 hover:underline'
        >
          View Pull Request →
        </a>
      )}
    </div>
  )
}
