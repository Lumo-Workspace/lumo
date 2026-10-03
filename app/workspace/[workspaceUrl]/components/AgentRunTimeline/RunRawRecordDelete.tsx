'use client'

import { useQueryClient } from '@tanstack/react-query'
import { SessionRawRecordDelete } from '@/components/session-record/SessionRawRecordDelete'

/**
 * LUM-944: the session raw record delete inside an expanded run card. After a
 * delete the cached agent-run timelines are re-read so the cleared rows show
 * "raw content deleted".
 */
export function RunRawRecordDelete({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient()
  return (
    <div className='mt-3'>
      <SessionRawRecordDelete
        sessionId={sessionId}
        onDeleted={() =>
          void queryClient.invalidateQueries({ queryKey: ['agentRuns'] })
        }
      />
    </div>
  )
}
