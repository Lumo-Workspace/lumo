'use client'

import { useIntl } from 'react-intl'
import { AlertTriangle, Info } from 'lucide-react'

interface GitHubAccessNoticesProps {
  /** `false` = no verifier login on record; `undefined` = not known yet. */
  accessRecheckEnabled: boolean | undefined
  accessRemovedCount: number | undefined
  /** LUM-888 — `account_gone` words the notice for an account GitHub cannot find. */
  accessRemovedReason?: string | null | undefined
  /** LUM-927 — ISO time no token could be minted since (past the threshold). */
  tokenFailingSince?: string | null | undefined
}

/**
 * LUM-882 — what the automatic access recheck did, or why it is not running.
 * Repositories the verifier lost read access to were removed (and their scan
 * code scrubbed) without anyone clicking anything, so the card says so; an
 * installation bound before the verifier's login was recorded is not rechecked
 * until an owner re-verifies once. Renders nothing when neither applies.
 * LUM-888 — when the verifying GitHub account itself is gone, the notice
 * says so and how to restore access, instead of blaming lost permissions.
 * LUM-927 — when Lumo has not been able to use the installation for days
 * while GitHub still lists it as active, the card says so: its access is
 * not rechecked until someone acts on GitHub.
 */
export function GitHubAccessNotices({
  accessRecheckEnabled,
  accessRemovedCount,
  accessRemovedReason,
  tokenFailingSince,
}: GitHubAccessNoticesProps) {
  const intl = useIntl()
  const removed = accessRemovedCount ?? 0

  if (removed === 0 && accessRecheckEnabled !== false && !tokenFailingSince)
    return null

  return (
    <div className='space-y-2'>
      {tokenFailingSince && (
        <div className='flex items-start gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2'>
          <AlertTriangle size={14} className='mt-0.5 shrink-0 text-warning' />
          <p className='text-xs text-foreground'>
            {intl.formatMessage(
              { id: 'github.tokenFailing' },
              {
                since: intl.formatDate(tokenFailingSince, {
                  dateStyle: 'medium',
                }),
              }
            )}
          </p>
        </div>
      )}
      {removed > 0 && (
        <div className='flex items-start gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2'>
          <AlertTriangle size={14} className='mt-0.5 shrink-0 text-warning' />
          <p className='text-xs text-foreground'>
            {intl.formatMessage(
              {
                id:
                  accessRemovedReason === 'account_gone'
                    ? 'github.accessRemovedAccountGone'
                    : 'github.accessRemoved',
              },
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
