'use client'

import { useEffect } from 'react'
import { useCurrentUser } from './useCurrentUser'
import { useNotifications } from './useNotifications'
import { usePusherEvent } from './usePusher'
import type { UserEvent } from '@/lib/integrations/pusher'

/**
 * Combines useNotifications + auto-fetch on mount + Pusher real-time updates.
 * Drop-in replacement for the repeated 3-step bootstrap pattern.
 */
export function useRealtimeNotifications() {
  const state = useNotifications()
  const { user } = useCurrentUser()

  useEffect(() => {
    state.fetchNotifications()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fetchNotifications])

  usePusherEvent<UserEvent>(
    user?.id ? `user-${user.id}` : null,
    'user-update',
    () => state.fetchNotifications()
  )

  return state
}
