'use client'

import { useRouter } from 'next/navigation'
import { SessionRawRecordDelete } from '@/components/session-record/SessionRawRecordDelete'

/** LUM-944: the delete control on the session page; re-renders the timeline after a delete. */
export function SessionRawRecordSection({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  return (
    <div className='mb-8'>
      <SessionRawRecordDelete
        sessionId={sessionId}
        onDeleted={() => router.refresh()}
      />
    </div>
  )
}
