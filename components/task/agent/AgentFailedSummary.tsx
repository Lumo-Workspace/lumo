'use client'

import { useState } from 'react'
import {
  Loader2,
  RotateCcw,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration } from './utils'

function parseErrorParts(raw: string): {
  summary: string
  detail: string | null
} {
  const idx = raw.indexOf('\n\nDetail: ')
  if (idx === -1) return { summary: raw, detail: null }
  return {
    summary: raw.slice(0, idx),
    detail: raw.slice(idx + '\n\nDetail: '.length),
  }
}

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
  const [showDetail, setShowDetail] = useState(false)

  const raw =
    latestRun?.errorMessage ??
    latestRun?.summary ??
    'An error occurred during execution. Please retry.'
  const { summary: message, detail } = parseErrorParts(raw)

  return (
    <div className='rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 overflow-hidden'>
      {/* Header */}
      <div className='flex items-center gap-1.5 px-3 pt-2.5 pb-2 border-b border-red-200/60 dark:border-red-900/60'>
        <XCircle size={12} className='text-red-500 shrink-0' />
        <span className='text-xs font-semibold text-red-700 dark:text-red-400'>
          Failure reason
        </span>
      </div>

      <div className='p-3 space-y-3'>
        <p className='text-xs text-red-800 dark:text-red-200 leading-snug'>
          {message}
        </p>

        {detail && (
          <div>
            <button
              type='button'
              className='flex items-center gap-1 text-[11px] text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300'
              onClick={() => setShowDetail(v => !v)}
            >
              {showDetail ? (
                <ChevronDown size={10} />
              ) : (
                <ChevronRight size={10} />
              )}
              Error detail
            </button>
            {showDetail && (
              <pre className='mt-1.5 text-[11px] text-red-700 dark:text-red-300 bg-red-100/50 dark:bg-red-950/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed'>
                {detail}
              </pre>
            )}
          </div>
        )}

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
          Re-run
        </Button>
      </div>
    </div>
  )
}
