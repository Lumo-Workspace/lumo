'use client'

import { useIntl } from 'react-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ApiPriority } from '../types'
import { PRIORITY_CONFIG, PRIORITY_LABEL_ID } from './fields'

export type PriorityBadgeVariant = 'icon' | 'bare' | 'dot'

/**
 * Semantic priority indicator (LUM-263).
 * - `bare` (default): icon only + tooltip — the historical behavior, kept for
 *   dense surfaces (board cards).
 * - `icon`: icon + visible localized label, for list/detail read-only cells.
 * - `dot`: a plain colour disc + tooltip, for scan-first rows (Signal tab)
 *   where a glyph per line would out-shout the content it sits beside.
 * Color comes from --priority-* tokens via PRIORITY_CONFIG.iconColor.
 */
export function PriorityBadge({
  priority,
  variant = 'bare',
  label,
}: {
  priority: ApiPriority
  variant?: PriorityBadgeVariant
  label?: string
}) {
  const intl = useIntl()
  const { Icon, iconColor } =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  const text = label ?? intl.formatMessage({ id: PRIORITY_LABEL_ID[priority] })

  if (variant === 'dot') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* `bg-current` paints the disc from the same --priority-* token the
              icon variants use, so the two can never drift apart. */}
          <span
            data-testid={`priority-dot-${priority.toLowerCase()}`}
            aria-label={text}
            className={cn(
              'inline-block size-2.5 shrink-0 rounded-full bg-current',
              iconColor
            )}
          />
        </TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    )
  }

  if (variant === 'bare') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(iconColor)}>
            <Icon className='size-4' />
          </span>
        </TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <span className='inline-flex items-center gap-1.5 text-caption'>
      <span className={cn(iconColor)}>
        <Icon className='size-4' />
      </span>
      {text}
    </span>
  )
}
