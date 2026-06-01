'use client'

import type { ReactNode } from 'react'

interface IntegrationCardProps {
  /** Brand glyph, already sized (typically `h-[18px] w-[18px]`). */
  icon: ReactNode
  title: ReactNode
  description: ReactNode
  /** Right-aligned slot in header — connect button, status badge, or loader. */
  headerAction?: ReactNode
  /** Body rendered below a divider; typically shown when connected. */
  children?: ReactNode
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
}: IntegrationCardProps) {
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
        {headerAction ? (
          <div className='shrink-0 whitespace-nowrap'>{headerAction}</div>
        ) : null}
      </div>
      {children ? (
        <div className='border-t border-zinc-100 dark:border-zinc-800 px-6 py-5 bg-zinc-50 dark:bg-zinc-900/50 space-y-4'>
          {children}
        </div>
      ) : null}
    </div>
  )
}
