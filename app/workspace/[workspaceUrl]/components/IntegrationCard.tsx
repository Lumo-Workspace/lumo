'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'

interface IntegrationCardProps {
  /** Brand glyph, already sized (typically `h-[18px] w-[18px]`). */
  icon: ReactNode
  title: ReactNode
  description: ReactNode
  /** Right-aligned slot in header — connect button, status badge, or loader. */
  headerAction?: ReactNode
  /** Body rendered below a divider; typically shown when connected. */
  children?: ReactNode
  /**
   * When true and `children` exist, the body collapses and starts collapsed.
   * A chevron toggle appears in the header right cluster.
   */
  collapsible?: boolean
  /** When provided, render an X icon button in the header that calls it. */
  onDisconnect?: (() => void) | undefined
  /** Accessible label for the disconnect (X) button. */
  disconnectLabel?: string
}

/**
 * Shared shell for workspace integration cards (Slack / GitHub / Sentry).
 * Owns the outer frame, the icon+title+description row, and the optional
 * connected-state body. Per-integration business logic, dialogs, and copy
 * stay in the individual card components.
 */
export function IntegrationCard({
  icon,
  title,
  description,
  headerAction,
  children,
  collapsible,
  onDisconnect,
  disconnectLabel,
}: IntegrationCardProps) {
  const [expanded, setExpanded] = useState(false)

  const canCollapse = Boolean(collapsible && children)
  const bodyVisible = children && (!canCollapse || expanded)

  return (
    <div className='rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
      <div className='flex items-center justify-between px-6 py-5 bg-white dark:bg-zinc-900'>
        <div className='flex items-center gap-3 min-w-0'>
          <div className='size-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 text-zinc-700 dark:text-zinc-300'>
            {icon}
          </div>
          <div className='min-w-0'>
            <p className='text-sm font-semibold text-zinc-900 dark:text-zinc-100'>
              {title}
            </p>
            <p className='text-xs text-zinc-500 dark:text-zinc-400'>
              {description}
            </p>
          </div>
        </div>
        <div className='flex items-center gap-2 shrink-0 whitespace-nowrap'>
          {headerAction}
          {canCollapse ? (
            <button
              type='button'
              onClick={() => setExpanded(prev => !prev)}
              aria-expanded={expanded}
              className='text-muted-foreground hover:text-foreground transition-colors'
            >
              <ChevronDown
                size={16}
                className={
                  expanded
                    ? 'rotate-180 transition-transform'
                    : 'transition-transform'
                }
              />
            </button>
          ) : null}
          {onDisconnect ? (
            <button
              type='button'
              onClick={onDisconnect}
              aria-label={disconnectLabel}
              className='text-muted-foreground hover:text-destructive transition-colors'
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>
      {bodyVisible ? (
        <div className='border-t border-zinc-100 dark:border-zinc-800 px-6 py-5 bg-zinc-50 dark:bg-zinc-900/50 space-y-4'>
          {children}
        </div>
      ) : null}
    </div>
  )
}
