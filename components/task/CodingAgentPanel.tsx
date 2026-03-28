'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Pusher from 'pusher-js'
import {
  Bot,
  Play,
  RotateCcw,
  X,
  Loader2,
  GitBranch,
  GitPullRequest,
  ExternalLink,
  HelpCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AgentEvent } from '@/lib/pusher/server'
import type {
  ApiPullRequest,
  ApiTaskBranch,
  ApiAgentClarify,
} from '@/app/workspace/[workspaceUrl]/types'

/** Minimal clarify shape used in local panel state (also matches API shape subset) */
export interface AgentClarifyPending {
  id: string
  question: string
  context: string | null
}

export interface CodingAgentTask {
  id: string
  assigneeType?: string | null
  agentStatus?: string | null
  agentError?: string | null
  sandboxId?: string | null
  branches?: ApiTaskBranch[]
  pullRequests?: ApiPullRequest[]
  /** Full clarify records from API — panel only reads id/question/context */
  clarifies?: ApiAgentClarify[]
}

interface AgentLog {
  id: string
  type: AgentEvent['type']
  message: string
}

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent:started':
      return 'Agent started'
    case 'agent:thinking':
      return event.message
    case 'agent:tool': {
      const labels: Record<string, string> = {
        Read: 'Reading',
        Write: 'Writing',
        Edit: 'Editing',
        Bash: 'Running',
      }
      return `${labels[event.tool] ?? event.tool}${event.input ? `: ${event.input}` : ''}`
    }
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

// ── AgentStatusBadge ──────────────────────────────────────────────────────────

function AgentStatusBadge({
  status,
  error,
}: {
  status: string
  error?: string | null
}) {
  const configs: Record<string, { label: string; dot: string; text: string }> =
    {
      idle: {
        label: 'Idle',
        dot: 'bg-zinc-400',
        text: 'text-zinc-500',
      },
      running: {
        label: 'Running',
        dot: 'bg-blue-500 animate-pulse',
        text: 'text-blue-600 dark:text-blue-400',
      },
      paused: {
        label: 'Waiting',
        dot: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
      },
      spec_review: {
        label: 'Spec review',
        dot: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
      },
      done: {
        label: 'Done',
        dot: 'bg-emerald-500',
        text: 'text-emerald-600 dark:text-emerald-400',
      },
      failed: {
        label: error ?? 'Failed',
        dot: 'bg-red-500',
        text: 'text-red-600 dark:text-red-400',
      },
      cancelled: {
        label: 'Cancelled',
        dot: 'bg-zinc-400',
        text: 'text-zinc-500',
      },
    }
  const cfg = configs[status] ?? configs['idle']!
  return (
    <div
      className={`flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}
    >
      <span className={`inline-block size-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </div>
  )
}

// ── ClarifyPanel ─────────────────────────────────────────────────────────────

function ClarifyPanel({
  clarify,
  taskId,
  sandboxId,
  onReplied,
}: {
  clarify: AgentClarifyPending
  taskId: string
  sandboxId: string | null
  onReplied: () => void
}) {
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!reply.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/agent/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, sandboxId, reply: reply.trim() }),
      })
      onReplied()
    } finally {
      setSubmitting(false)
    }
  }, [taskId, sandboxId, reply, onReplied])

  return (
    <div className='rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2'>
      <div className='flex items-start gap-2'>
        <HelpCircle size={13} className='text-amber-500 mt-0.5 shrink-0' />
        <p className='text-xs text-amber-800 dark:text-amber-200 font-medium leading-snug'>
          {clarify.question}
        </p>
      </div>
      {clarify.context && (
        <p className='text-xs text-amber-700 dark:text-amber-300 pl-5'>
          {clarify.context}
        </p>
      )}
      <Textarea
        value={reply}
        onChange={e => setReply(e.target.value)}
        placeholder='Type your answer...'
        className='min-h-[60px] text-xs resize-none'
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
        }}
      />
      <Button
        size='sm'
        className='w-full h-7 text-xs'
        disabled={!reply.trim() || submitting}
        onClick={handleSubmit}
      >
        {submitting ? (
          <Loader2 size={12} className='animate-spin mr-1' />
        ) : null}
        Send reply
      </Button>
    </div>
  )
}

// ── CodingAgentPanelInner (all hooks here, no early returns above) ────────────

function CodingAgentPanelInner({
  task,
  onTaskUpdate,
}: {
  task: CodingAgentTask
  onTaskUpdate?: (updates: Partial<CodingAgentTask>) => void
}) {
  const [status, setStatus] = useState(task.agentStatus ?? 'idle')
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [clarify, setClarify] = useState<AgentClarifyPending | null>(
    task.clarifies?.[0] ?? null
  )
  const [cancelling, setCancelling] = useState(false)
  const [running, setRunning] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const isFirstRun = !task.branches?.length
  const isRunning = status === 'running'
  const isPaused = status === 'paused'
  const activePr = task.pullRequests?.find(pr => pr.state === 'open')
  const activeBranch = task.branches?.[task.branches.length - 1]

  useEffect(() => {
    setStatus(task.agentStatus ?? 'idle')
  }, [task.agentStatus])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Pusher subscription
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    if (!key || !cluster) return

    const pusher = new Pusher(key, { cluster })
    const channel = pusher.subscribe(`task-${task.id}`)

    channel.bind('agent-update', (event: AgentEvent) => {
      setLogs(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: event.type,
          message: formatEvent(event),
        },
      ])

      if (event.type === 'agent:started') {
        setStatus('running')
        onTaskUpdate?.({ agentStatus: 'running' })
      }
      if (event.type === 'agent:clarify') {
        setStatus('paused')
        setClarify({
          id: crypto.randomUUID(),
          question: event.question,
          context: event.context ?? null,
        })
        onTaskUpdate?.({ agentStatus: 'paused' })
      }
      if (event.type === 'agent:done') {
        setStatus('done')
        onTaskUpdate?.({ agentStatus: 'done' })
      }
      if (event.type === 'agent:failed') {
        const isCancelled = event.error === 'Cancelled by user'
        const next = isCancelled ? 'cancelled' : 'failed'
        setStatus(next)
        onTaskUpdate?.({ agentStatus: next })
      }
    })

    return () => {
      channel.unbind_all()
      pusher.unsubscribe(`task-${task.id}`)
    }
  }, [task.id])

  const handleRun = useCallback(async () => {
    setRunning(true)
    setLogs([])
    try {
      await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
      setStatus('running')
      onTaskUpdate?.({ agentStatus: 'running' })
    } finally {
      setRunning(false)
    }
  }, [task.id, onTaskUpdate])

  const handleCancel = useCallback(async () => {
    setCancelling(true)
    try {
      await fetch('/api/agent/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
    } finally {
      setCancelling(false)
    }
  }, [task.id])

  const handleClarifyReplied = useCallback(() => {
    setClarify(null)
    setStatus('running')
    setLogs([])
    onTaskUpdate?.({ agentStatus: 'running' })
  }, [onTaskUpdate])

  return (
    <div className='space-y-2'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400'>
          <Bot size={13} />
          Coding Agent
        </div>
        {status !== 'idle' && (
          <AgentStatusBadge status={status} error={task.agentError ?? null} />
        )}
      </div>

      {/* Run / Re-run button */}
      {!isRunning && !isPaused && (
        <Button
          size='sm'
          variant={isFirstRun ? 'default' : 'outline'}
          className='w-full h-7 text-xs gap-1.5'
          disabled={running}
          onClick={handleRun}
        >
          {running ? (
            <Loader2 size={12} className='animate-spin' />
          ) : isFirstRun ? (
            <Play size={12} />
          ) : (
            <RotateCcw size={12} />
          )}
          {running ? 'Starting…' : isFirstRun ? 'Run Agent' : 'Re-run Agent'}
        </Button>
      )}

      {/* Cancel button when running */}
      {isRunning && (
        <Button
          size='sm'
          variant='ghost'
          className='w-full h-7 text-xs gap-1.5 text-zinc-400 hover:text-red-500'
          disabled={cancelling}
          onClick={handleCancel}
        >
          {cancelling ? (
            <Loader2 size={12} className='animate-spin' />
          ) : (
            <X size={12} />
          )}
          Cancel
        </Button>
      )}

      {/* Live logs */}
      {isRunning && logs.length > 0 && (
        <div className='rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 max-h-40 overflow-y-auto p-2 space-y-1'>
          {logs.map(log => (
            <div
              key={log.id}
              className='text-[11px] text-zinc-500 dark:text-zinc-400 font-mono leading-tight'
            >
              {log.message}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Clarify */}
      {isPaused && clarify && (
        <ClarifyPanel
          clarify={clarify}
          taskId={task.id}
          sandboxId={task.sandboxId ?? null}
          onReplied={handleClarifyReplied}
        />
      )}

      {/* Active branch */}
      {activeBranch && (
        <div className='space-y-1'>
          <p className='text-[10px] font-semibold uppercase tracking-wider text-zinc-400'>
            Branch
          </p>
          <div className='flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300'>
            <GitBranch size={12} className='shrink-0 text-zinc-400' />
            <span className='font-mono truncate'>
              {activeBranch.branchName}
            </span>
          </div>
        </div>
      )}

      {/* Active PR */}
      {activePr && (
        <div className='space-y-1'>
          <p className='text-[10px] font-semibold uppercase tracking-wider text-zinc-400'>
            Pull Request
          </p>
          <a
            href={activePr.url}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline'
          >
            <GitPullRequest size={12} className='shrink-0' />
            <span className='truncate'>
              #{activePr.number} {activePr.title}
            </span>
            <ExternalLink size={10} className='shrink-0 opacity-60' />
          </a>
        </div>
      )}
    </div>
  )
}

// ── CodingAgentPanel (public export — renders inner only when agent-assigned) ─

export function CodingAgentPanel({
  task,
  onTaskUpdate,
}: {
  task: CodingAgentTask
  onTaskUpdate?: (updates: Partial<CodingAgentTask>) => void
}) {
  if (task.assigneeType !== 'agent') return null
  return <CodingAgentPanelInner task={task} onTaskUpdate={onTaskUpdate} />
}
