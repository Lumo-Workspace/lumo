'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'

/** LUM-1327 — the red-bordered card holding every irreversible action. */
export function DangerZoneCard({ children }: { children: ReactNode }) {
  const intl = useIntl()
  return (
    <div className='rounded-lg border border-danger-border overflow-hidden'>
      <div className='px-5 py-3 bg-danger-subtle border-b border-danger-border'>
        <p className='text-body-strong text-danger-text'>
          {intl.formatMessage({ id: 'workspaceSettings.dangerZone' })}
        </p>
      </div>
      {children}
    </div>
  )
}
