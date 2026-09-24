'use client'

import { useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { workspacesClient } from '@/lib/api-client'
import { clearCache } from '../cache'

/**
 * Leave the current workspace (LUM-830). A user belongs to a single
 * workspace, so leaving it ends their session here: we sign out of Clerk and
 * land on the public homepage. Signing out first matters — the proxy bounces
 * signed-in visitors of `/` back to `/workspace`.
 *
 * On failure nothing is signed out; the error is rethrown for the caller to
 * surface.
 */
export function useLeaveWorkspace() {
  const { signOut } = useClerk()
  const [leaving, setLeaving] = useState(false)

  const leave = async () => {
    setLeaving(true)
    try {
      await workspacesClient.leaveWorkspace()
    } catch (err) {
      setLeaving(false)
      throw err
    }
    clearCache()
    await signOut({ redirectUrl: '/' })
  }

  return { leave, leaving }
}
