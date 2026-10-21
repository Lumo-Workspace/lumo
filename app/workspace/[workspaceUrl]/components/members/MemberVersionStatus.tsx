'use client'

import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import {
  memberVersionStatus,
  type MemberVersionStatus as Status,
} from '@/lib/members/connection-status'
import type { MemberConnectionView } from '@/lib/services/member-connection.service'

const DOT: Record<Status, string> = {
  needsUpdate: 'bg-warning-text',
  upToDate: 'bg-success-text',
  unknown: 'bg-muted-foreground',
  stale: 'bg-muted-foreground',
  notConnected: 'bg-border',
}

const LABEL_ID: Record<Status, string> = {
  needsUpdate: 'members.status.needsUpdate',
  upToDate: 'members.status.upToDate',
  unknown: 'members.status.unknown',
  stale: 'members.status.stale',
  notConnected: 'members.connection.none',
}

/** Second line: what is behind, the version in use, or why it is unknown. */
function statusDetail(
  status: Status,
  connections: MemberConnectionView[],
  latestCliVersion: string | null,
  formatMessage: ReturnType<typeof useIntl>['formatMessage']
): string | null {
  if (status === 'needsUpdate') {
    const cli = connections.find(c => c.cliBehind && c.cliVersion)
    if (cli?.cliVersion && latestCliVersion)
      return formatMessage(
        { id: 'members.status.cliDetail' },
        { from: cli.cliVersion, to: latestCliVersion }
      )
    // Latest unknown: still say which CLI is behind.
    if (cli?.cliVersion)
      return formatMessage(
        { id: 'members.connection.cli' },
        { version: cli.cliVersion }
      )
    return null
  }
  if (status === 'unknown')
    return formatMessage({ id: 'members.status.unknownDetail' })
  if (status === 'stale') {
    const version = connections.find(c => c.cliVersion)?.cliVersion
    return version
      ? formatMessage({ id: 'members.status.staleDetail' }, { version })
      : null
  }
  if (status === 'upToDate') {
    const version = connections.find(c => !c.stale && c.cliVersion)?.cliVersion
    return version
      ? formatMessage({ id: 'members.connection.cli' }, { version })
      : null
  }
  return null
}

/** LUM-1136: one-line version status for a member (worst connection wins). */
export function MemberVersionStatus({
  connections,
  latestCliVersion,
  unknown,
}: {
  connections: MemberConnectionView[] | undefined
  latestCliVersion: string | null
  /** Still loading, or the request failed. */
  unknown: boolean
}) {
  const intl = useIntl()
  if (unknown) return <span className='text-body text-muted-foreground'>—</span>
  const status = memberVersionStatus(connections)
  const detail = statusDetail(
    status,
    connections ?? [],
    latestCliVersion,
    intl.formatMessage
  )
  return (
    <div className='flex min-w-0 flex-col gap-0.5' data-status={status}>
      <span className='inline-flex items-center gap-2 text-body-strong text-foreground'>
        <span
          aria-hidden
          className={cn('size-2 shrink-0 rounded-full', DOT[status])}
        />
        {intl.formatMessage({ id: LABEL_ID[status] })}
      </span>
      {detail && (
        <span
          title={detail}
          className='truncate pl-4 text-caption text-muted-foreground'
        >
          {detail}
        </span>
      )}
    </div>
  )
}
