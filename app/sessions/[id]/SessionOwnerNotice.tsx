'use client'

import { useIntl } from 'react-intl'
import { SESSION_MESSAGES as M } from '../messages'

/**
 * LUM-946: shown when a workspace OWNER opens another member's session, so
 * the access is visible on the page rather than silent.
 */
export function SessionOwnerNotice({ ownerName }: { ownerName: string | null }) {
  const intl = useIntl()
  return (
    <p
      role='note'
      className='mb-8 rounded-md border border-info-border bg-info-subtle px-4 py-3 text-sm text-foreground'
    >
      {ownerName
        ? intl.formatMessage(M['detail.otherMember'], { name: ownerName })
        : intl.formatMessage(M['detail.otherMemberUnknown'])}
    </p>
  )
}
