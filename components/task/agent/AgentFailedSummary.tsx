'use client'

import { Loader2, RotateCcw, XCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration } from './utils'

export function AgentFailedSummary({
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
        <p className='text-xs text-red-800 dark:text-red-200 leading-snug'>
          {message}
        </p>

        {latestRun?.durationMs != null && (
          <div className='flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400'>
            <span className='flex items-center gap-1'>
              <Clock size={10} />
              {formatDuration(latestRun.durationMs)}
            </span>
          </div>
        )}

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
