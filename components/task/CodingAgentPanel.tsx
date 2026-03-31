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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgentEvent } from '@/lib/pusher/server'
import {
  AgentStatusBadge,
  AgentClarifyPanel,
  AgentStepsList,
  AgentFailedSummary,
  AgentDoneSummary,
  AgentRunHistory,
  formatEvent,
} from './agent'
import type {
  CodingAgentTask,
  AgentClarifyPending,
  AgentChangedFile,
  AgentStep,
  AgentLog,
} from './agent'

// Re-export types for consumers
export type { CodingAgentTask, AgentClarifyPending, AgentChangedFile }

// ── CodingAgentPanelInner (all hooks here, no early returns above) ──────────

function CodingAgentPanelInner({
  task,
  onTaskUpdate,
}: {
  task: CodingAgentTask
  onTaskUpdate?: (updates: Partial<CodingAgentTask>) => void
}) {
  const [status, setStatus] = useState(task.agentStatus ?? 'IDLE')
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [clarify, setClarify] = useState<AgentClarifyPending | null>(
    task.clarifies?.[0] ?? null
  )
  const [cancelling, setCancelling] = useState(false)
  const [running, setRunning] = useState(false)
  const [pausedAt, setPausedAt] = useState<Date | null>(null)

  // Real-time done metadata from Pusher (overrides agentRuns[0] until next page load)
  const [realtimeDoneMeta, setRealtimeDoneMeta] = useState<{
    summary?: string | null
    changedFiles?: AgentChangedFile[]
    durationMs?: number | null
  } | null>(null)

  const agentStartTimeRef = useRef<Date | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const isFirstRun = !task.branches?.length
  const isRunning = status === 'RUNNING'
  const isPaused = status === 'PAUSED'
  const isDone = status === 'DONE'
  const isFailed = status === 'FAILED' || status === 'ERROR'
  const activeBranch = task.branches?.[task.branches.length - 1]
  const latestRun = task.agentRuns?.[0]
  const currentRunNumber = latestRun?.runNumber ?? 0

  // Derive done metadata: real-time Pusher data takes priority, then agentRuns[0]
  const doneMeta = realtimeDoneMeta ?? {
    summary: latestRun?.summary ?? null,
    changedFiles: (latestRun?.changedFiles as AgentChangedFile[] | null) ?? [],
    durationMs: latestRun?.durationMs ?? null,
  }

  useEffect(() => {
    setStatus(task.agentStatus ?? 'IDLE')
    setRealtimeDoneMeta(null)
    setPausedAt(null)
    setSteps([])
  }, [task.agentStatus])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // ── Pusher subscription ─────────────────────────────────────────────────────

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

      const elapsed = () =>
        agentStartTimeRef.current
          ? Date.now() - agentStartTimeRef.current.getTime()
          : 0

      if (event.type === 'agent:started') {
        agentStartTimeRef.current = new Date()
        setSteps([])
        setPausedAt(null)
        setStatus('RUNNING')
        onTaskUpdate?.({ agentStatus: 'RUNNING' })
      }
      if (event.type === 'agent:progress') {
        setSteps(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            text: event.message,
            elapsedMs: elapsed(),
            status: 'done',
          },
        ])
      }
      if (event.type === 'agent:clarify') {
        setSteps(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            text: event.question,
            elapsedMs: elapsed(),
            status: 'paused',
          },
        ])
        setStatus('PAUSED')
        setPausedAt(new Date())
        setClarify({
          id: crypto.randomUUID(),
          question: event.question,
          context: event.context ?? null,
        })
        onTaskUpdate?.({ agentStatus: 'PAUSED' })
      }
      if (event.type === 'agent:done') {
        setStatus('DONE')
        setRealtimeDoneMeta({
          summary: event.summary ?? null,
          changedFiles: event.changedFiles ?? [],
          durationMs: event.durationMs ?? null,
        })
        onTaskUpdate?.({ agentStatus: 'DONE' })
      }
      if (event.type === 'agent:failed') {
        const isCancelled = event.error === 'Cancelled by user'
        const next = isCancelled ? 'CANCELLED' : 'FAILED'
        if (!isCancelled) {
          setSteps(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              text: `Aborted · ${event.error.slice(0, 40)}`,
              elapsedMs: elapsed(),
              status: 'failed',
            },
          ])
        }
        setStatus(next)
        onTaskUpdate?.({ agentStatus: next })
      }
    })

    return () => {
      channel.unbind_all()
      pusher.unsubscribe(`task-${task.id}`)
    }
  }, [task.id])

  // ── Action handlers ─────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    setRunning(true)
    setLogs([])
    setSteps([])
    setPausedAt(null)
    try {
      const res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        setStatus('ERROR')
        onTaskUpdate?.({ agentStatus: 'ERROR', agentError: data.error })
        setLogs(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: 'agent:failed',
            message: `Failed to start: ${data.error}`,
          },
        ])
        return
      }
      setStatus('RUNNING')
      onTaskUpdate?.({ agentStatus: 'RUNNING' })
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
    setStatus('RUNNING')
    setLogs([])
    onTaskUpdate?.({ agentStatus: 'RUNNING' })
  }, [onTaskUpdate])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className='space-y-2'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400'>
          <Bot size={13} />
          Coding Agent
          {currentRunNumber > 0 && (
            <span className='text-zinc-400 font-normal'>
              · Session #{currentRunNumber}
              {(isDone || isPaused || isFailed) && ' · Latest'}
            </span>
          )}
        </div>
        {status !== 'IDLE' && (
          <AgentStatusBadge
            status={status}
            error={task.agentError ?? null}
            pausedAt={pausedAt}
          />
        )}
      </div>

      {/* ── DONE state ── */}
      {isDone && (
        <AgentDoneSummary
          task={task}
          latestRun={doneMeta}
          onRerun={handleRun}
          running={running}
        />
      )}

      {/* ── FAILED state ── */}
      {isFailed && (
        <AgentFailedSummary
          latestRun={latestRun ?? null}
          onRerun={handleRun}
          running={running}
        />
      )}

      {/* ── PAUSED state ── */}
      {isPaused && clarify && task.project?.workspaceId && (
        <AgentClarifyPanel
          clarify={clarify}
          taskId={task.id}
          workspaceId={task.project.workspaceId}
          pausedAt={pausedAt}
          onReplied={handleClarifyReplied}
        />
      )}

      {/* ── Steps progress list ── */}
      {(isRunning || isPaused || isFailed) && steps.length > 0 && (
        <AgentStepsList steps={steps} />
      )}

      {/* ── Running: live log (shown when no structured steps yet) ── */}
      {isRunning && steps.length === 0 && logs.length > 0 && (
        <div className='rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 max-h-32 overflow-y-auto p-2 space-y-1'>
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

      {/* ── Run history ── */}
      {task.agentRuns && task.agentRuns.length > 1 && (
        <AgentRunHistory runs={task.agentRuns} />
      )}

      {/* Run / Re-run button */}
      {!isDone && !isRunning && !isPaused && !isFailed && (
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
          {running ? 'Starting...' : isFirstRun ? 'Run Agent' : 'Re-run Agent'}
        </Button>
      )}

      {/* Cancel button */}
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

      {/* Active branch */}
      {!isDone && !isPaused && activeBranch && (
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
      {!isDone && task.pullRequests?.find(pr => pr.state === 'open') && (
        <div className='space-y-1'>
          <p className='text-[10px] font-semibold uppercase tracking-wider text-zinc-400'>
            Pull Request
          </p>
          <a
            href={task.pullRequests.find(pr => pr.state === 'open')!.url}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline'
          >
            <GitPullRequest size={12} className='shrink-0' />
            <span className='truncate'>
              #{task.pullRequests.find(pr => pr.state === 'open')!.number}{' '}
              {task.pullRequests.find(pr => pr.state === 'open')!.title}
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
  if (task.assignee?.type !== 'AGENT') return null
  return (
    <CodingAgentPanelInner
      task={task}
      {...(onTaskUpdate && { onTaskUpdate })}
    />
  )
}
