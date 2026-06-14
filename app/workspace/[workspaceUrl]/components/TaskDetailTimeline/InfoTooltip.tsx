'use client'

import { Info } from 'lucide-react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A small, accessible `ⓘ` trigger that reveals an explanatory tooltip on
 * hover/focus. Used to move jargon explanations off the acceptance tab surface
 * and into hover text. `label` is both the visible tooltip content and the
 * trigger's accessible name.
 */
export function InfoTooltip({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          aria-label={label}
          className={cn(
            'inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className
          )}
        >
          <Info className='size-3' aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className='max-w-xs text-pretty'>{label}</TooltipContent>
    </Tooltip>
  )
}
