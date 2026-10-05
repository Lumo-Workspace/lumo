'use client'

import { useState } from 'react'
import { workspacesClient } from '@/lib/api-client'
import { useMembers } from './useMembers'

/**
 * LUM-906: an OWNER removes another member (the server deactivates the
 * membership and revokes their API keys). Refreshes the shared members
 * cache on success; on failure the error is rethrown for the caller to
 * surface and nothing is refreshed.
 */
export function useRemoveMember() {
  const { invalidateMembers } = useMembers()
  const [removingId, setRemovingId] = useState<string | null>(null)

  const remove = async (memberId: string) => {
    setRemovingId(memberId)
    try {
      await workspacesClient.removeMember(memberId)
      await invalidateMembers()
    } finally {
      setRemovingId(null)
    }
  }

  return { remove, removingId }
}
