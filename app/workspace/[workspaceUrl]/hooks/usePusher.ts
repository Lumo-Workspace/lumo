'use client'

import { useEffect, useRef } from 'react'
import { getPusherClient } from '@/lib/integrations/pusher/client'

/**
 * Subscribe to a Pusher channel + event. Cleans up on unmount or when
 * channelName / eventName changes. A no-op when realtime is not configured
 * (self-hosted without Pusher/Soketi) — the query client then refetches on
 * focus/interval instead (lib/query/client.ts).
 */
export function usePusherEvent<T = unknown>(
  channelName: string | null,
  eventName: string,
  callback: (data: T) => void
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!channelName) return

    const pusher = getPusherClient()
    if (!pusher) return

    const channel = pusher.subscribe(channelName)
    const handler = (data: T) => callbackRef.current(data)
    channel.bind(eventName, handler)

    return () => {
      channel.unbind(eventName, handler)
      pusher.unsubscribe(channelName)
    }
  }, [channelName, eventName])
}
