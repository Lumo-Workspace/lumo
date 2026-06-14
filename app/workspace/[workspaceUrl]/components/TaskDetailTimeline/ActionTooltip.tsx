'use client'

import type { ReactNode } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * Wraps an already-interactive control (button/link) so hovering OR focusing it
 * reveals an explanatory tooltip. Unlike `InfoTooltip` — which renders its own
 * `ⓘ` button next to a text term — this attaches the explanation to the caller's
 * control: the control IS the trigger, so there is no extra focusable element
 * and no `<button>`-inside-`<button>` nesting. Use it for action buttons whose
 * meaning needs a hover hint; use `InfoTooltip` for non-interactive text terms.
 */
export function ActionTooltip({
  tip,
  children,
}: {
  tip: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className='max-w-xs text-pretty'>{tip}</TooltipContent>
    </Tooltip>
  )
}
