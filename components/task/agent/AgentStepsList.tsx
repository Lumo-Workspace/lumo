'use client'

import { cn } from '@/lib/utils'
import { formatStepElapsed } from './utils'
import type { AgentStep } from './types'

export function AgentStepsList({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null

  return (
    <div className='space-y-0.5'>
      {steps.map((step, i) => {
        const isFailed = step.status === 'failed'
        const isPausedStep = step.status === 'paused'
        const isPending = step.status === 'pending'

        return (
          <div
            key={step.id}
            className={cn(
              'flex items-start gap-2 py-0.5',
              isPending && 'opacity-40'
            )}
          >
            {/* Indicator */}
            <div className='mt-1 shrink-0 flex flex-col items-center'>
              <div
                className={cn(
                  'size-2 rounded-full',
                  isFailed
                    ? 'bg-red-500'
                    : isPausedStep
                      ? 'bg-amber-400'
                      : isPending
                        ? 'bg-muted-foreground'
                        : 'bg-blue-500'
                )}
              />
              {i < steps.length - 1 && (
                <div className='w-px h-3.5 bg-border mt-0.5' />
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
                        : isPending
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground'
                  )}
                >
                  {isPausedStep
                    ? `Waiting · ${step.text.slice(0, 40)}`
                    : step.text}
                </span>
                {step.subText && (
                  <span className='text-[10px] text-muted-foreground leading-tight block mt-0.5'>
                    {step.subText}
                  </span>
                )}
              </div>
              {isPending ? (
                <span className='shrink-0 text-[10px] text-muted-foreground font-mono mt-0.5'>
                  —
                </span>
              ) : isPausedStep ? (
                <span className='shrink-0 text-[10px] text-amber-500 font-medium mt-0.5'>
                  Paused
                </span>
              ) : (
                <span className='shrink-0 text-[10px] text-muted-foreground font-mono mt-0.5'>
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
