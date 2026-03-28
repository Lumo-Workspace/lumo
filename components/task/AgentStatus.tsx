'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Pusher from 'pusher-js'
import { Loader2, X, Pencil, Check } from 'lucide-react'
import type { AgentEvent } from '@/lib/pusher/server'

interface AgentLog {
  id: string
  type: AgentEvent['type']
  message: string
}

interface AgentStatusProps {
  taskId: string
  initialStatus?: string | null
  initialSpec?: string | null
  initialPrUrl?: string | null
  onRetry?: () => void
  onSpecConfirmed?: () => void
  onStatusChange?: (status: string) => void
}

const ICON: Record<AgentEvent['type'], string> = {
  'agent:started': '🚀',
  'agent:thinking': '💭',
  'agent:tool': '⚡',
  'agent:progress': '●',
  'agent:clarify': '❓',
  'agent:spec_draft': '📋',
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
    case 'agent:spec_draft':
      return 'Spec draft ready for review'
    case 'agent:done':
      return 'Done — PR created'
    case 'agent:failed':
      return `Failed: ${event.error}`
  }
}

export function AgentStatus({
  taskId,
  initialStatus,
  initialSpec,
  initialPrUrl,
  onRetry,
  onSpecConfirmed,
  onStatusChange,
}: AgentStatusProps) {
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [status, setStatus] = useState<string>(initialStatus ?? 'idle')
  const [prUrl, setPrUrl] = useState<string | null>(initialPrUrl ?? null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // Spec review state
  const [specDraft, setSpecDraft] = useState<string | null>(
    initialStatus === 'spec_review' ? (initialSpec ?? null) : null
  )
  const [editingSpec, setEditingSpec] = useState(false)
  const [editedSpec, setEditedSpec] = useState('')
  const [confirming, setConfirming] = useState(false)
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

  const handleConfirmSpec = useCallback(async () => {
    const spec = editingSpec ? editedSpec.trim() : (specDraft ?? '')
    if (!spec) return
    setConfirming(true)
    try {
      const res = await fetch('/api/agent/confirm-spec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, spec }),
      })
      if (res.ok) {
        setStatus('running')
        setSpecDraft(null)
        setEditingSpec(false)
        setLogs([])
        onSpecConfirmed?.()
      }
    } finally {
      setConfirming(false)
    }
  }, [taskId, specDraft, editingSpec, editedSpec, onSpecConfirmed])

  useEffect(() => {
    if (initialStatus && initialStatus !== 'idle') {
      setStatus(initialStatus)
      if (initialStatus === 'running') setLogs([])
      if (initialStatus === 'spec_review' && initialSpec) {
        setSpecDraft(initialSpec)
      }
    }
  }, [initialStatus, initialSpec])

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
        onStatusChange?.('done')
      }
      if (event.type === 'agent:failed') {
        const isCancelled = event.error === 'Cancelled by user'
        const nextStatus = isCancelled ? 'cancelled' : 'failed'
        setStatus(nextStatus)
        if (!isCancelled) setErrorMsg(event.error)
        onStatusChange?.(nextStatus)
      }
      if (event.type === 'agent:clarify') setStatus('paused')
      if (event.type === 'agent:spec_draft') {
        setStatus('spec_review')
        setSpecDraft(event.spec)
        setLogs([]) // clear "generating..." logs, spec panel takes over
        onStatusChange?.('spec_review')
      }
    })

    return () => {
      channel.unbind_all()
      pusher.unsubscribe(`task-${taskId}`)
    }
  }, [taskId])

  if (status === 'idle') return null

  // ── Spec review panel ──────────────────────────────────────────────────────
  if (status === 'spec_review' && specDraft) {
    return (
      <div className='rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='h-2 w-2 rounded-full bg-amber-500' />
            <span className='text-sm font-medium text-amber-700 dark:text-amber-400'>
              Spec ready — review before running
            </span>
          </div>
          <button
            onClick={() => {
              setEditingSpec(v => {
                if (!v) setEditedSpec(specDraft)
                return !v
              })
            }}
            className='flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors'
          >
            {editingSpec ? <Check size={12} /> : <Pencil size={12} />}
            {editingSpec ? 'Preview' : 'Edit'}
          </button>
        </div>

        {editingSpec ? (
          <textarea
            className='w-full h-64 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring'
            value={editedSpec}
            onChange={e => setEditedSpec(e.target.value)}
          />
        ) : (
          <div className='rounded-md bg-background border border-border px-3 py-2 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-y-auto text-zinc-700 dark:text-zinc-300'>
            {specDraft}
          </div>
        )}

        <div className='flex items-center gap-2'>
          <button
            onClick={handleConfirmSpec}
            disabled={confirming || (editingSpec && !editedSpec.trim())}
            className='flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors'
          >
            {confirming ? <Loader2 size={11} className='animate-spin' /> : null}
            {confirming ? 'Starting…' : 'Confirm & Run Agent'}
          </button>
          <span className='text-xs text-muted-foreground'>
            or edit the spec above first
          </span>
        </div>
      </div>
    )
  }

  // ── Normal agent status panel ──────────────────────────────────────────────
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
