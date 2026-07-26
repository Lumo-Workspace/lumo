'use client'

import { useIntl } from 'react-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ApiPriority } from '../types'
import { PriorityDot, PRIORITY_LABEL_ID } from './fields'

export type PriorityBadgeVariant = 'dot' | 'label'

/**
 * Semantic priority indicator (LUM-263, dot-only since LUM-702).
 * - `dot` (default): the colour disc + tooltip, for dense scan-first surfaces
 *   (board cards, Signal rows) where a glyph per line out-shouts the content
 *   it sits beside.
 * - `label`: the same disc + a visible localized label, for read-only
 *   list/detail cells that need the priority spelled out.
 * The disc markup and its --priority-* colour live in PriorityDot.
 */
export function PriorityBadge({
  priority,
  variant = 'dot',
  label,
}: {
  priority: ApiPriority
  variant?: PriorityBadgeVariant
  label?: string
}) {
  const intl = useIntl()
  const text = label ?? intl.formatMessage({ id: PRIORITY_LABEL_ID[priority] })

  if (variant === 'label') {
    return (
      <span className='inline-flex items-center gap-1.5 text-caption'>
        <PriorityDot priority={priority} />
        {text}
      </span>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PriorityDot priority={priority} aria-label={text} />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}
