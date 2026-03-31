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
