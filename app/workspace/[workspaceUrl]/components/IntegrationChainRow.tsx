'use client'

import type { ReactNode } from 'react'
import { ConnectedDot } from './IntegrationCard'

interface IntegrationChainRowProps {
  /** What this grant is, e.g. "Authorized (OAuth)". */
  label: string
  /** One line on what it buys the workspace. */
  description: string
  /** True only when the grant is known to be in place. */
  connected: boolean
  /** Tooltip/screen-reader text for the status dot. */
  connectedLabel: string
  /** Right-aligned control — connect, install, uninstall, or nothing. */
  action?: ReactNode
  testId?: string
}

/**
 * One grant inside an integration card: a labelled row with its own status dot
 * and its own button. An integration whose capabilities come from more than one
 * grant (GitHub: OAuth authorization *and* App installation) renders one row
 * per grant, so a single green dot can never stand in for "everything works".
 */
export function IntegrationChainRow({
  label,
  description,
  connected,
  connectedLabel,
  action,
  testId,
}: IntegrationChainRowProps) {
  return (
    <div
      data-testid={testId}
      className='flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5'
    >
      <div className='min-w-0'>
        <p className='text-sm font-medium text-foreground'>{label}</p>
        <p className='text-xs text-muted-foreground'>{description}</p>
      </div>
      <div className='flex shrink-0 items-center gap-2 whitespace-nowrap'>
        {connected ? (
          <>
            <span className='text-xs text-muted-foreground'>
              {connectedLabel}
            </span>
            <ConnectedDot label={connectedLabel} />
          </>
        ) : null}
        {action}
      </div>
    </div>
  )
}
