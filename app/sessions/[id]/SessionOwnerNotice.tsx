'use client'

import { useIntl } from 'react-intl'
import { Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SESSION_MESSAGES as M } from '../messages'

/**
 * LUM-946: shown when a workspace OWNER opens another member's session, so
 * the access is visible on the page rather than silent.
 */
export function SessionOwnerNotice({
  ownerName,
}: {
  ownerName: string | null
}) {
  const intl = useIntl()
  return (
    <Alert variant='info' role='note' className='mb-8'>
      <Info />
      <AlertDescription>
        {ownerName
          ? intl.formatMessage(M['detail.otherMember'], { name: ownerName })
          : intl.formatMessage(M['detail.otherMemberUnknown'])}
      </AlertDescription>
    </Alert>
  )
}
