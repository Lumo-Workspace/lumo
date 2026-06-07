'use client'

import {
  Loader2,
  RotateCcw,
  GitPullRequest,
  ExternalLink,
  Clock,
  MessageSquare,
  FileText,
  FilePlus2,
  FilePenLine,
  FileX2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatDuration } from './utils'
import type { AgentTask, AgentChangedFile } from './types'

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
    className: 'text-muted-foreground',
  },
  deleted: {
    icon: FileX2,
    label: 'Deleted',
    className: 'text-red-500 dark:text-red-400',
  },
}

export function AgentDoneSummary({
  task,
  latestRun,
  onRerun,
  running,
}: {
  task: AgentTask
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
          <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
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
                  className='inline-flex items-center gap-1 rounded-md border border-border bg-white dark:bg-muted px-1.5 py-0.5 text-[11px] font-mono text-foreground'
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
      <div className='flex items-center gap-4 text-[11px] text-muted-foreground'>
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
        className='w-full h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground'
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
