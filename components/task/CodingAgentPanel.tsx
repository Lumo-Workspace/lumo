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
  Clock,
  MessageSquare,
  FileText,
  FilePlus2,
  FilePenLine,
  FileX2,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Ban,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { AgentEvent } from '@/lib/pusher/server'
import type {
  ApiPullRequest,
  ApiTaskBranch,
  ApiAgentClarify,
  ApiAgentRun,
} from '@/app/workspace/[workspaceUrl]/types'

/** Minimal clarify shape used in local panel state (also matches API shape subset) */
export interface AgentClarifyPending {
  id: string
  question: string
  context: string | null
}

interface AgentStep {
  id: string
  text: string
  subText?: string
  elapsedMs: number
  status: 'done' | 'paused' | 'failed'
}

export interface AgentChangedFile {
  path: string
  status: 'added' | 'modified' | 'deleted'
}

export interface CodingAgentTask {
  id: string
  assignee?: { type: 'HUMAN' | 'AGENT' } | null
  agentStatus?: string | null
  agentError?: string | null
  branches?: ApiTaskBranch[]
  pullRequests?: ApiPullRequest[]
  /** Full clarify records from API — panel only reads id/question/context */
  clarifies?: ApiAgentClarify[]
  agentRuns?: ApiAgentRun[]
  project?: { workspaceId?: string }
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

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

// ── AgentStatusBadge ──────────────────────────────────────────────────────────

function AgentStatusBadge({
  status,
  pausedAt,
}: {
  status: string
  error?: string | null
  pausedAt?: Date | null
}) {
  // Elapsed pause time (updates every 30s)
  const [pausedMins, setPausedMins] = useState<number | null>(null)
  useEffect(() => {
    if (status !== 'PAUSED' || !pausedAt) {
      setPausedMins(null)
      return
    }
    const update = () =>
      setPausedMins(Math.floor((Date.now() - pausedAt.getTime()) / 60000))
    update()
    const timer = setInterval(update, 30000)
    return () => clearInterval(timer)
  }, [status, pausedAt])

  const configs: Record<string, { label: string; dot: string; text: string }> =
    {
      IDLE: {
        label: 'Idle',
        dot: 'bg-zinc-400',
        text: 'text-zinc-500',
      },
      RUNNING: {
        label: 'Running',
        dot: 'bg-blue-500 animate-pulse',
        text: 'text-blue-600 dark:text-blue-400',
      },
      PAUSED: {
        label:
          pausedMins != null && pausedMins > 0
            ? `等待回复 · 暂停 ${pausedMins}m`
            : '等待回复 · 暂停中',
        dot: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
      },
      SPEC_REVIEW: {
        label: 'Spec review',
        dot: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
      },
      DONE: {
        label: 'Done',
        dot: 'bg-emerald-500',
        text: 'text-emerald-600 dark:text-emerald-400',
      },
      FAILED: {
        label: '执行失败',
        dot: 'bg-red-500',
        text: 'text-red-600 dark:text-red-400',
      },
      ERROR: {
        label: '执行出错',
        dot: 'bg-orange-500',
        text: 'text-orange-600 dark:text-orange-400',
      },
      CANCELLED: {
        label: 'Cancelled',
        dot: 'bg-zinc-400',
        text: 'text-zinc-500',
      },
    }
  const cfg = configs[status] ?? configs['IDLE']!
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
  workspaceId,
  pausedAt,
  onReplied,
}: {
  clarify: AgentClarifyPending
  taskId: string
  workspaceId: string
  pausedAt: Date | null
  onReplied: () => void
}) {
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState('')

  // Update elapsed time every 30s
  useEffect(() => {
    if (!pausedAt) return
    const update = () => {
      const mins = Math.floor((Date.now() - pausedAt.getTime()) / 60000)
      setElapsed(mins < 1 ? '< 1 分钟' : `${mins} 分钟`)
    }
    update()
    const timer = setInterval(update, 30000)
    return () => clearInterval(timer)
  }, [pausedAt])

  const handleSubmit = useCallback(async () => {
    if (!reply.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/agent/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, workspaceId, reply: reply.trim() }),
      })
      onReplied()
    } finally {
      setSubmitting(false)
    }
  }, [taskId, workspaceId, reply, onReplied])

  return (
    <div className='rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden'>
      {/* Header */}
      <div className='flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-amber-200/60 dark:border-amber-800/60'>
        <div className='flex items-center gap-1.5'>
          <HelpCircle size={12} className='text-amber-500 shrink-0' />
          <span className='text-xs font-semibold text-amber-800 dark:text-amber-200'>
            Agent 需要确认
          </span>
        </div>
        {elapsed && (
          <span className='text-[10px] text-amber-600 dark:text-amber-400'>
            已停待等 · {elapsed}
          </span>
        )}
      </div>

      <div className='p-3 space-y-2.5'>
        {/* Question */}
        <p className='text-xs text-amber-800 dark:text-amber-200 leading-snug'>
          {clarify.question}
        </p>
        {clarify.context && (
          <p className='text-[11px] text-amber-700/80 dark:text-amber-300/80 leading-snug'>
            {clarify.context}
          </p>
        )}

        {/* Reply input */}
        <Textarea
          value={reply}
          onChange={e => setReply(e.target.value)}
          placeholder='回复后 Agent 立即继续...'
          className='min-h-[56px] text-xs resize-none bg-white/70 dark:bg-zinc-900/50 border-amber-200 dark:border-amber-800 focus-visible:ring-amber-400'
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
          }}
        />
        <Button
          size='sm'
          className='w-full h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white border-0'
          disabled={!reply.trim() || submitting}
          onClick={handleSubmit}
        >
          {submitting ? (
            <Loader2 size={12} className='animate-spin mr-1' />
          ) : null}
          发送
        </Button>
      </div>
    </div>
  )
}

// ── AgentStepsList ───────────────────────────────────────────────────────────

function formatStepElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function AgentStepsList({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null

  return (
    <div className='space-y-0.5'>
      {steps.map((step, i) => {
        const isFailed = step.status === 'failed'
        const isPausedStep = step.status === 'paused'

        return (
          <div key={step.id} className='flex items-start gap-2 py-0.5'>
            {/* Indicator */}
            <div className='mt-1 shrink-0 flex flex-col items-center'>
              <div
                className={cn(
                  'size-2 rounded-full',
                  isFailed
                    ? 'bg-red-500'
                    : isPausedStep
                      ? 'bg-amber-400'
                      : 'bg-blue-500'
                )}
              />
              {i < steps.length - 1 && (
                <div className='w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mt-0.5' />
              )}
            </div>

            {/* Text + sub-text */}
            <div className='flex-1 min-w-0 flex items-start justify-between gap-2'>
              <div className='min-w-0'>
                <span
                  className={cn(
                    'text-[11px] leading-snug block',
                    isFailed
                      ? 'text-red-600 dark:text-red-400 font-medium'
                      : isPausedStep
                        ? 'text-amber-700 dark:text-amber-300 font-medium'
                        : 'text-zinc-500 dark:text-zinc-400'
                  )}
                >
                  {isPausedStep
                    ? `等待澄清 · ${step.text.slice(0, 40)}`
                    : step.text}
                </span>
                {step.subText && (
                  <span className='text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight block mt-0.5'>
                    {step.subText}
                  </span>
                )}
              </div>
              {isPausedStep ? (
                <span className='shrink-0 text-[10px] text-amber-500 font-medium mt-0.5'>
                  暂停中
                </span>
              ) : (
                <span className='shrink-0 text-[10px] text-zinc-400 font-mono mt-0.5'>
                  {formatStepElapsed(step.elapsedMs)}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── AgentFailedSummary ───────────────────────────────────────────────────────

function AgentFailedSummary({
  latestRun,
  onRerun,
  running,
}: {
  latestRun: {
    errorMessage?: string | null
    summary?: string | null
    durationMs?: number | null
  } | null
  onRerun: () => void
  running: boolean
}) {
  const message =
    latestRun?.errorMessage ??
    latestRun?.summary ??
    '执行过程中发生错误，请重试。'

  return (
    <div className='rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 overflow-hidden'>
      {/* Header */}
      <div className='flex items-center gap-1.5 px-3 pt-2.5 pb-2 border-b border-red-200/60 dark:border-red-900/60'>
        <XCircle size={12} className='text-red-500 shrink-0' />
        <span className='text-xs font-semibold text-red-700 dark:text-red-400'>
          失败原因
        </span>
      </div>

      <div className='p-3 space-y-3'>
        {/* Error message */}
        <p className='text-xs text-red-800 dark:text-red-200 leading-snug'>
          {message}
        </p>

        {/* Metrics row */}
        {latestRun?.durationMs != null && (
          <div className='flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400'>
            <span className='flex items-center gap-1'>
              <Clock size={10} />
              {formatDuration(latestRun.durationMs)}
            </span>
          </div>
        )}

        {/* Re-run button */}
        <Button
          size='sm'
          variant='outline'
          className='h-7 text-xs gap-1.5 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700'
          disabled={running}
          onClick={onRerun}
        >
          {running ? (
            <Loader2 size={12} className='animate-spin' />
          ) : (
            <RotateCcw size={12} />
          )}
          重新运行
        </Button>
      </div>
    </div>
  )
}

// ── AgentDoneSummary ────────────────────────────────────────────────────────

const FILE_STATUS_ICON: Record<
  string,
  { icon: typeof FilePlus2; label: string; className: string }
> = {
  added: {
    icon: FilePlus2,
    label: 'New',
    className: 'text-emerald-600 dark:text-emerald-400',
  },
  modified: {
    icon: FilePenLine,
    label: '',
    className: 'text-zinc-400',
  },
  deleted: {
    icon: FileX2,
    label: 'Deleted',
    className: 'text-red-500 dark:text-red-400',
  },
}

function AgentDoneSummary({
  task,
  latestRun,
  onRerun,
  running,
}: {
  task: CodingAgentTask
  latestRun: {
    summary?: string | null
    changedFiles?: AgentChangedFile[]
    durationMs?: number | null
  }
  onRerun: () => void
  running: boolean
}) {
  const activePr = task.pullRequests?.find(pr => pr.state === 'open')
  const changedFiles = latestRun.changedFiles ?? []
  const clarifyCount = task.clarifies?.length ?? 0

  return (
    <div className='rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-3'>
      {/* Summary text */}
      {latestRun.summary && (
        <p className='text-xs text-emerald-800 dark:text-emerald-200 leading-snug'>
          {latestRun.summary}
        </p>
      )}

      {/* PR link */}
      {activePr && (
        <a
          href={activePr.url}
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline'
        >
          <GitPullRequest size={12} className='shrink-0' />
          <span className='truncate'>PR #{activePr.number}</span>
          <span className='font-mono text-[11px] text-muted-foreground truncate'>
            {activePr.headBranch}
          </span>
          <ExternalLink size={10} className='shrink-0 opacity-60' />
        </a>
      )}

      {/* Changed files */}
      {changedFiles.length > 0 && (
        <div className='space-y-1'>
          <p className='text-[10px] font-semibold uppercase tracking-wider text-zinc-400'>
            Changed files
          </p>
          <div className='flex flex-wrap gap-1'>
            {changedFiles.map(f => {
              const cfg =
                FILE_STATUS_ICON[f.status] ?? FILE_STATUS_ICON['modified']!
              const Icon = cfg.icon
              const fileName = f.path.split('/').pop() ?? f.path
              return (
                <span
                  key={f.path}
                  title={f.path}
                  className='inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1.5 py-0.5 text-[11px] font-mono text-zinc-600 dark:text-zinc-300'
                >
                  <Icon size={10} className={cn('shrink-0', cfg.className)} />
                  {fileName}
                  {cfg.label && (
                    <span
                      className={cn(
                        'text-[9px] font-sans font-medium',
                        cfg.className
                      )}
                    >
                      {cfg.label}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Metrics row */}
      <div className='flex items-center gap-4 text-[11px] text-zinc-500 dark:text-zinc-400'>
        {latestRun.durationMs != null && (
          <span className='flex items-center gap-1'>
            <Clock size={10} />
            {formatDuration(latestRun.durationMs)}
          </span>
        )}
        <span className='flex items-center gap-1'>
          <MessageSquare size={10} />
          Clarify {clarifyCount}
        </span>
        {changedFiles.length > 0 && (
          <span className='flex items-center gap-1'>
            <FileText size={10} />
            {changedFiles.length} file{changedFiles.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Re-run button (subdued) */}
      <Button
        size='sm'
        variant='ghost'
        className='w-full h-7 text-xs gap-1.5 text-zinc-400 hover:text-zinc-600'
        disabled={running}
        onClick={onRerun}
      >
        {running ? (
          <Loader2 size={12} className='animate-spin' />
        ) : (
          <RotateCcw size={12} />
        )}
        Re-run
      </Button>
    </div>
  )
}

// ── AgentRunHistory (collapsible past sessions) ─────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  initial: '首次执行',
  retry: '重试',
  comment: '评论触发',
  confirm_spec: '确认 Spec',
  clarify_reply: '回复澄清',
  send_back: '打回重做',
}

const RUN_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  DONE: { label: '成功', color: 'text-emerald-600', icon: CheckCircle2 },
  FAILED: { label: '失败', color: 'text-red-600', icon: XCircle },
  CANCELLED: { label: '取消', color: 'text-zinc-500', icon: Ban },
  RUNNING: { label: '执行中', color: 'text-blue-600', icon: Loader2 },
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function AgentRunHistory({ runs }: { runs: ApiAgentRun[] }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  // Exclude the latest run (shown in the main summary card)
  const pastRuns = runs.slice(1)
  if (pastRuns.length === 0) return null

  return (
    <div className='space-y-1'>
      <button
        onClick={() => setExpanded(!expanded)}
        className='flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors w-full'
      >
        <ChevronDown
          size={12}
          className={cn(
            'transition-transform',
            expanded ? 'rotate-0' : '-rotate-90'
          )}
        />
        历史执行记录 (共 {runs.length} 次)
      </button>

      {expanded && (
        <div className='space-y-1 pl-1'>
          {pastRuns.map(run => {
            const cfg =
              RUN_STATUS_CONFIG[run.status] ?? RUN_STATUS_CONFIG['FAILED']!
            const StatusIcon = cfg.icon
            const isExpanded = expandedRunId === run.id

            return (
              <div key={run.id} className='space-y-1'>
                <button
                  onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                  className='flex items-center gap-2 w-full text-left text-[11px] rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors'
                >
                  <StatusIcon size={11} className={cn('shrink-0', cfg.color)} />
                  <span className='font-medium text-zinc-600 dark:text-zinc-300'>
                    Session #{run.runNumber}
                  </span>
                  <span className={cn('font-medium', cfg.color)}>
                    {cfg.label}
                  </span>
                  <span className='text-zinc-400 ml-auto'>
                    {formatRelativeTime(run.startedAt)}
                  </span>
                  {run.prNumber && (
                    <span className='text-zinc-400'>PR #{run.prNumber}</span>
                  )}
                </button>

                {isExpanded && (
                  <div className='ml-5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-2 space-y-1.5 text-[11px]'>
                    {run.trigger && (
                      <p className='text-zinc-500'>
                        触发：{TRIGGER_LABELS[run.trigger] ?? run.trigger}
                      </p>
                    )}
                    {run.errorMessage && (
                      <p className='text-red-600 dark:text-red-400'>
                        {run.errorMessage}
                      </p>
                    )}
                    {run.summary && (
                      <p className='text-zinc-600 dark:text-zinc-300'>
                        {run.summary}
                      </p>
                    )}
                    {run.durationMs != null && (
                      <p className='text-zinc-400'>
                        耗时 {formatDuration(run.durationMs)}
                      </p>
                    )}
                    {run.prUrl && (
                      <a
                        href={run.prUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline'
                      >
                        <GitPullRequest size={10} />
                        PR #{run.prNumber}
                        <ExternalLink size={9} className='opacity-60' />
                      </a>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
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
    setRealtimeDoneMeta(null) // Reset when task props change (page load)
    setPausedAt(null)
    setSteps([])
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
        agentStartTimeRef.current = new Date()
        setSteps([])
        setPausedAt(null)
        setStatus('RUNNING')
        onTaskUpdate?.({ agentStatus: 'RUNNING' })
      }
      if (event.type === 'agent:progress') {
        const elapsedMs = agentStartTimeRef.current
          ? Date.now() - agentStartTimeRef.current.getTime()
          : 0
        setSteps(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            text: event.message,
            elapsedMs,
            status: 'done',
          },
        ])
      }
      if (event.type === 'agent:clarify') {
        const elapsedMs = agentStartTimeRef.current
          ? Date.now() - agentStartTimeRef.current.getTime()
          : 0
        setSteps(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            text: event.question,
            elapsedMs,
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
          const elapsedMs = agentStartTimeRef.current
            ? Date.now() - agentStartTimeRef.current.getTime()
            : 0
          setSteps(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              text: `中止 · ${event.error.slice(0, 40)}`,
              elapsedMs,
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
              {(isDone || isPaused || isFailed) && ' · 最新'}
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

      {/* ── DONE state: rich summary card ── */}
      {isDone && (
        <AgentDoneSummary
          task={task}
          latestRun={doneMeta}
          onRerun={handleRun}
          running={running}
        />
      )}

      {/* ── FAILED state: error card ── */}
      {isFailed && (
        <AgentFailedSummary
          latestRun={latestRun ?? null}
          onRerun={handleRun}
          running={running}
        />
      )}

      {/* ── PAUSED state: clarify card ── */}
      {isPaused && clarify && task.project?.workspaceId && (
        <ClarifyPanel
          clarify={clarify}
          taskId={task.id}
          workspaceId={task.project.workspaceId}
          pausedAt={pausedAt}
          onReplied={handleClarifyReplied}
        />
      )}

      {/* ── Steps progress list (running, paused, or failed) ── */}
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

      {/* ── Run history (collapsible, shown when multiple runs exist) ── */}
      {task.agentRuns && task.agentRuns.length > 1 && (
        <AgentRunHistory runs={task.agentRuns} />
      )}

      {/* Run / Re-run button (shown for non-DONE, non-running, non-paused, non-failed states) */}
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

      {/* Active branch (shown when NOT done and NOT paused) */}
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

      {/* Active PR (shown when NOT done) */}
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
