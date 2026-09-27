'use client'

import { useIntl } from 'react-intl'
import { AlertTriangle, Info } from 'lucide-react'

interface GitHubAccessNoticesProps {
  /** `false` = no verifier login on record; `undefined` = not known yet. */
  accessRecheckEnabled: boolean | undefined
  accessRemovedCount: number | undefined
}

/**
 * LUM-882 — what the automatic access recheck did, or why it is not running.
 * Repositories the verifier lost read access to were removed (and their scan
 * code scrubbed) without anyone clicking anything, so the card says so; an
 * installation bound before the verifier's login was recorded is not rechecked
 * until an owner re-verifies once. Renders nothing when neither applies.
 */
export function GitHubAccessNotices({
  accessRecheckEnabled,
  accessRemovedCount,
}: GitHubAccessNoticesProps) {
  const intl = useIntl()
  const removed = accessRemovedCount ?? 0

  if (removed === 0 && accessRecheckEnabled !== false) return null

  return (
    <div className='space-y-2'>
      {removed > 0 && (
        <div className='flex items-start gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2'>
          <AlertTriangle size={14} className='mt-0.5 shrink-0 text-warning' />
          <p className='text-xs text-foreground'>
            {intl.formatMessage(
              { id: 'github.accessRemoved' },
              { count: removed }
            )}
          </p>
        </div>
      )}
      {accessRecheckEnabled === false && (
        <div className='flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2'>
          <Info size={14} className='mt-0.5 shrink-0 text-muted-foreground' />
          <p className='text-xs text-muted-foreground'>
            {intl.formatMessage({ id: 'github.accessRecheckOff' })}
          </p>
        </div>
      )}
    </div>
  )
}
