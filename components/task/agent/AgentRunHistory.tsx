'use client'

import { useState } from 'react'
import {
  Loader2,
  GitPullRequest,
  ExternalLink,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Ban,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration, formatRelativeTime } from './utils'
import type { ApiAgentRun } from './types'

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

export function AgentRunHistory({ runs }: { runs: ApiAgentRun[] }) {
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
            const isOpen = expandedRunId === run.id

            return (
              <div key={run.id} className='space-y-1'>
                <button
                  onClick={() => setExpandedRunId(isOpen ? null : run.id)}
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

                {isOpen && (
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
