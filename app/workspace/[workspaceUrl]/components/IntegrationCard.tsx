'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface IntegrationCardProps {
  /** Brand glyph, already sized (typically `h-[18px] w-[18px]`). */
  icon: ReactNode
  title: ReactNode
  description: ReactNode
  /** Right-aligned slot in header — connect button, status dot, or loader. */
  headerAction?: ReactNode
  /** Body rendered below a divider; typically shown when connected. */
  children?: ReactNode
  /**
   * When true and `children` exist, the body collapses and starts collapsed.
   * A chevron toggle appears in the header right cluster.
   */
  collapsible?: boolean
  /**
   * When provided, adds a "Reauthorize" item to the header overflow (⋯) menu.
   * Re-runs the integration's connect/OAuth flow.
   */
  onReconnect?: (() => void) | undefined
  /** Label for the reauthorize menu item. */
  reconnectLabel?: string
  /**
   * When provided, adds a destructive "Disconnect" item to the header
   * overflow (⋯) menu.
   */
  onDisconnect?: (() => void) | undefined
  /** Label for the disconnect menu item. */
  disconnectLabel?: string
  /** Accessible label for the overflow (⋯) menu trigger. */
  menuLabel?: string
}

/**
 * Green status dot shown in a connected integration card's header (replaces the
 * older "✓ Connected" text badge). Carries an accessible label for SR users.
 */
export function ConnectedDot({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='flex items-center'>
          <span
            className='size-2 rounded-full bg-success-text'
            aria-hidden='true'
          />
          <span className='sr-only'>{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
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
  onReconnect,
  reconnectLabel,
  onDisconnect,
  disconnectLabel,
  menuLabel,
}: IntegrationCardProps) {
  const [expanded, setExpanded] = useState(false)

  const canCollapse = Boolean(collapsible && children)
  const hasMenu = Boolean(onReconnect || onDisconnect)

  return (
    <Collapsible
      open={!canCollapse || expanded}
      onOpenChange={setExpanded}
      className='rounded-xl border border-border overflow-hidden'
    >
      <div className='flex items-center justify-between px-6 py-5 bg-card'>
        <div className='flex items-center gap-3 min-w-0'>
          <div className='size-9 rounded-lg bg-muted flex items-center justify-center shrink-0 text-foreground'>
            {icon}
          </div>
          <div className='min-w-0'>
            <p className='text-body-strong text-foreground'>{title}</p>
            <p className='text-caption text-muted-foreground'>{description}</p>
          </div>
        </div>
        <div className='flex items-center gap-2 shrink-0 whitespace-nowrap'>
          {headerAction}
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  aria-label={menuLabel}
                  className='text-muted-foreground hover:text-foreground transition-colors'
                >
                  <MoreHorizontal size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {onReconnect ? (
                  <DropdownMenuItem onSelect={onReconnect}>
                    {reconnectLabel}
                  </DropdownMenuItem>
                ) : null}
                {onReconnect && onDisconnect ? <DropdownMenuSeparator /> : null}
                {onDisconnect ? (
                  <DropdownMenuItem
                    onSelect={onDisconnect}
                    className='text-danger-text focus:text-danger-text'
                  >
                    {disconnectLabel}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {canCollapse ? (
            <CollapsibleTrigger className='text-muted-foreground hover:text-foreground transition-colors'>
              <ChevronRight
                size={16}
                className='transition-transform group-data-[state=open]/collapsible:rotate-90'
              />
            </CollapsibleTrigger>
          ) : null}
        </div>
      </div>
      {children ? (
        <CollapsibleContent>
          <div className='border-t border-border px-6 py-5 bg-muted/50 space-y-4'>
            {children}
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}
