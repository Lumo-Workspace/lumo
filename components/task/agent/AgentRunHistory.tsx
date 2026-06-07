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
  initial: 'Initial run',
  retry: 'Retry',
  comment: 'Comment trigger',
  confirm_spec: 'Confirm spec',
  clarify_reply: 'Clarify reply',
  send_back: 'Sent back',
}

const RUN_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  COMPLETED: { label: 'Done', color: 'text-emerald-600', icon: CheckCircle2 },
  FAILED: { label: 'Failed', color: 'text-red-600', icon: XCircle },
  CANCELED: { label: 'Canceled', color: 'text-muted-foreground', icon: Ban },
  WORKING: { label: 'Working', color: 'text-blue-600', icon: Loader2 },
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
        className='flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full'
      >
        <ChevronDown
          size={12}
          className={cn(
            'transition-transform',
            expanded ? 'rotate-0' : '-rotate-90'
          )}
        />
        Run history ({runs.length} total)
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
                  className='flex items-center gap-2 w-full text-left text-[11px] rounded-sm px-1.5 py-1 hover:bg-muted transition-colors'
                >
                  <StatusIcon size={11} className={cn('shrink-0', cfg.color)} />
                  <span className='font-medium text-foreground'>
                    Session #{run.runNumber}
                  </span>
                  <span className={cn('font-medium', cfg.color)}>
                    {cfg.label}
                  </span>
                  <span className='text-muted-foreground ml-auto'>
                    {formatRelativeTime(run.startedAt)}
                  </span>
                  {run.prNumber && (
                    <span className='text-muted-foreground'>
                      PR #{run.prNumber}
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div className='ml-5 rounded-sm border border-border bg-muted p-2 space-y-1.5 text-[11px]'>
                    {run.trigger && (
                      <p className='text-muted-foreground'>
                        Trigger: {TRIGGER_LABELS[run.trigger] ?? run.trigger}
                      </p>
                    )}
                    {run.errorMessage && (
                      <pre className='text-red-600 dark:text-red-400 whitespace-pre-wrap break-all font-mono'>
                        {run.errorMessage}
                      </pre>
                    )}
                    {run.summary && (
                      <p className='text-foreground'>{run.summary}</p>
                    )}
                    {run.durationMs != null && (
                      <p className='text-muted-foreground'>
                        Duration: {formatDuration(run.durationMs)}
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
