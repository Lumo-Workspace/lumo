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
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { agentClient, ApiClientError } from '@/lib/api-client'
import type { AgentEvent } from '@/lib/integrations/pusher'
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
  AgentTask,
  AgentClarifyPending,
  AgentChangedFile,
  AgentStep,
  AgentLog,
} from './agent'

// Re-export types for consumers
export type { AgentTask, AgentClarifyPending, AgentChangedFile }

// ── AgentPanelInner (all hooks here, no early returns above) ─────────────────

function AgentPanelInner({
  task,
  onTaskUpdate,
}: {
  task: AgentTask
  onTaskUpdate?: (updates: Partial<AgentTask>) => void
}) {
  const projectWorkspaceId = task.project?.workspaceId

  const [status, setStatus] = useState(task.agentStatus ?? 'SUBMITTED')
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [steps, setSteps] = useState<AgentStep[]>(() => {
    // Restore persisted steps from the latest agentRun (survives page refresh)
    const persisted = task.agentRuns?.[0]?.steps
    if (!Array.isArray(persisted) || persisted.length === 0) return []
    return persisted.map(s => ({
      id: crypto.randomUUID(),
      key: s.key,
      text: s.text,
      elapsedMs: s.elapsedMs,
      status: (s.status as AgentStep['status']) ?? 'done',
    }))
  })
  const [clarify, setClarify] = useState<AgentClarifyPending | null>(
    task.clarifies?.[0] ?? null
  )
  const [cancelling, setCancelling] = useState(false)
  const [running, setRunning] = useState(false)
  const [confirmingSpec, setConfirmingSpec] = useState(false)
  const [pausedAt, setPausedAt] = useState<Date | null>(null)

  // Real-time done metadata from Pusher (overrides agentRuns[0] until next page load)
  const [realtimeDoneMeta, setRealtimeDoneMeta] = useState<{
    summary?: string | null
    changedFiles?: AgentChangedFile[]
    durationMs?: number | null
  } | null>(null)
  const [realtimeErrorMessage, setRealtimeErrorMessage] = useState<
    string | null
  >(null)

  const agentStartTimeRef = useRef<Date | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const [localRunNumber, setLocalRunNumber] = useState<number | null>(null)

  const isFirstRun = !task.branches?.length
  const isRunning = status === 'WORKING'
  const isPaused = status === 'INPUT_REQUIRED'
  const isDone = status === 'COMPLETED'
  const isFailed = status === 'FAILED'
  const activeBranch = task.branches?.[task.branches.length - 1]
  const latestRun = task.agentRuns?.[0]
  const currentRunNumber = localRunNumber ?? latestRun?.runNumber ?? 0

  // Derive done metadata: real-time Pusher data takes priority, then agentRuns[0]
  const doneMeta = realtimeDoneMeta ?? {
    summary: latestRun?.summary ?? null,
    changedFiles: (latestRun?.changedFiles as AgentChangedFile[] | null) ?? [],
    durationMs: latestRun?.durationMs ?? null,
  }

  useEffect(() => {
    setStatus(task.agentStatus ?? 'SUBMITTED')
    setRealtimeDoneMeta(null)
    setRealtimeErrorMessage(null)
    setLocalRunNumber(null)
    setPausedAt(null)
    // Restore persisted steps from server data (e.g. after prop refresh)
    const persisted = task.agentRuns?.[0]?.steps
    if (Array.isArray(persisted) && persisted.length > 0) {
      setSteps(
        persisted.map(s => ({
          id: crypto.randomUUID(),
          key: s.key,
          text: s.text,
          elapsedMs: s.elapsedMs,
          status: (s.status as AgentStep['status']) ?? 'done',
        }))
      )
    } else {
      setSteps([])
    }
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
        // Initialize pipeline steps from the event (all pending)
        setSteps(
          (event.steps ?? []).map(s => ({
            id: crypto.randomUUID(),
            key: s.key,
            text: s.text,
            elapsedMs: 0,
            status: 'pending' as const,
          }))
        )
        setPausedAt(null)
        setRealtimeDoneMeta(null)
        setRealtimeErrorMessage(null)
        setLocalRunNumber(event.runNumber)
        setStatus('WORKING')
        onTaskUpdate?.({ agentStatus: 'WORKING' })
      }
      if (event.type === 'agent:progress') {
        setSteps(prev => {
          if (event.key) {
            // Update the matching pipeline step by key
            const idx = prev.findIndex(s => s.key === event.key)
            if (idx !== -1) {
              const updated = [...prev]
              updated[idx] = {
                ...updated[idx]!,
                text: event.message,
                elapsedMs: elapsed(),
                status: 'done',
              }
              return updated
            }
          }
          // Fallback: append (for events without key)
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              text: event.message,
              elapsedMs: elapsed(),
              status: 'done',
            },
          ]
        })
      }
      // agent:tool events are NOT added to steps — pipeline stages are sufficient.
      // Tool activity is shown only in the raw log fallback.
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
        setStatus('INPUT_REQUIRED')
        setPausedAt(new Date())
        setClarify({
          id: crypto.randomUUID(),
          question: event.question,
          context: event.context ?? null,
        })
        onTaskUpdate?.({ agentStatus: 'INPUT_REQUIRED' })
      }
      if (event.type === 'agent:spec_draft') {
        setSteps(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            text: 'Spec draft ready for review',
            elapsedMs: elapsed(),
            status: 'paused',
          },
        ])
        setStatus('INPUT_REQUIRED')
        setPausedAt(new Date())
        onTaskUpdate?.({
          agentStatus: 'INPUT_REQUIRED',
          inputReason: 'spec_review',
        })
      }
      if (event.type === 'agent:done') {
        setStatus('COMPLETED')
        setRealtimeDoneMeta({
          summary: event.summary ?? null,
          changedFiles: event.changedFiles ?? [],
          durationMs: event.durationMs ?? null,
        })
        onTaskUpdate?.({ agentStatus: 'COMPLETED' })
      }
      if (event.type === 'agent:failed') {
        const isCancelled = event.error === 'Cancelled by user'
        const next = isCancelled ? 'CANCELED' : 'FAILED'
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
        if (!isCancelled) setRealtimeErrorMessage(event.error)
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
      await agentClient.execute(task.id)
      setStatus('WORKING')
      onTaskUpdate?.({ agentStatus: 'WORKING' })
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.message : 'Request failed'
      setStatus('FAILED')
      onTaskUpdate?.({ agentStatus: 'FAILED', agentError: message })
      setLogs(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: 'agent:failed',
          message: `Failed to start: ${message}`,
        },
      ])
    } finally {
      setRunning(false)
    }
  }, [task.id, onTaskUpdate])

  const handleCancel = useCallback(async () => {
    setCancelling(true)
    try {
      await agentClient.cancel(task.id)
    } finally {
      setCancelling(false)
    }
  }, [task.id])

  const handleConfirmSpec = useCallback(async () => {
    setConfirmingSpec(true)
    try {
      await agentClient.confirmSpec(task.id, task.spec ?? '')
      setStatus('WORKING')
      setLogs([])
      setSteps([])
      onTaskUpdate?.({ agentStatus: 'WORKING' })
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : `Failed to confirm spec`
      )
    } finally {
      setConfirmingSpec(false)
    }
  }, [task.id, task.spec, onTaskUpdate])

  const handleClarifyReplied = useCallback(() => {
    setClarify(null)
    setStatus('WORKING')
    setLogs([])
    onTaskUpdate?.({ agentStatus: 'WORKING' })
  }, [onTaskUpdate])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className='space-y-2'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
          <Bot size={13} />
          {task.assignee?.agent?.name ?? 'Agent'}
          {currentRunNumber > 0 && (
            <span className='text-muted-foreground font-normal'>
              · Session #{currentRunNumber}
              {(isDone || isPaused || isFailed) && ' · Latest'}
            </span>
          )}
        </div>
        {status !== 'SUBMITTED' && (
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
          latestRun={
            realtimeErrorMessage
              ? {
                  errorMessage: realtimeErrorMessage,
                  durationMs: latestRun?.durationMs ?? null,
                }
              : (latestRun ?? null)
          }
          onRerun={handleRun}
          running={running}
        />
      )}

      {/* ── PAUSED: clarify question ── */}
      {isPaused && clarify && projectWorkspaceId && (
        <AgentClarifyPanel
          clarify={clarify}
          taskId={task.id}
          workspaceId={projectWorkspaceId}
          pausedAt={pausedAt}
          onReplied={handleClarifyReplied}
        />
      )}

      {/* ── PAUSED: spec review — confirm to start coding ── */}
      {isPaused && !clarify && task.inputReason === 'spec_review' && (
        <div className='rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-3 space-y-2'>
          <p className='text-xs text-indigo-700 dark:text-indigo-300 font-medium'>
            Spec ready — review it above and confirm to start coding.
          </p>
          <Button
            size='sm'
            className='w-full h-7 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white'
            disabled={confirmingSpec || !task.spec}
            onClick={handleConfirmSpec}
          >
            {confirmingSpec ? (
              <Loader2 size={12} className='animate-spin' />
            ) : (
              <CheckCircle2 size={12} />
            )}
            {confirmingSpec ? 'Starting…' : 'Confirm Spec & Start Coding'}
          </Button>
        </div>
      )}

      {/* ── Steps progress list ── */}
      {(isRunning || isPaused || isFailed) && steps.length > 0 && (
        <AgentStepsList steps={steps} />
      )}

      {/* ── Running: live log (shown when no structured steps yet) ── */}
      {isRunning && steps.length === 0 && logs.length > 0 && (
        <div className='rounded-md bg-muted border border-border max-h-32 overflow-y-auto p-2 space-y-1'>
          {logs.map(log => (
            <div
              key={log.id}
              className='text-[11px] text-muted-foreground font-mono leading-tight'
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
          className='w-full h-7 text-xs gap-1.5 text-muted-foreground hover:text-red-500'
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
          <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
            Branch
          </p>
          <div className='flex items-center gap-1.5 text-xs text-foreground'>
            <GitBranch size={12} className='shrink-0 text-muted-foreground' />
            <span className='font-mono truncate'>
              {activeBranch.branchName}
            </span>
          </div>
        </div>
      )}

      {/* Active PR */}
      {!isDone && task.pullRequests?.find(pr => pr.state === 'open') && (
        <div className='space-y-1'>
          <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
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

// ── AgentPanel (public export — renders inner only when agent-assigned) ──────

export function AgentPanel({
  task,
  onTaskUpdate,
}: {
  task: AgentTask
  onTaskUpdate?: (updates: Partial<AgentTask>) => void
}) {
  if (task.assignee?.type !== 'AGENT') return null
  return <AgentPanelInner task={task} {...(onTaskUpdate && { onTaskUpdate })} />
}
