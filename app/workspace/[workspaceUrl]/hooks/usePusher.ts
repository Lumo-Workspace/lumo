'use client'

import { useEffect, useRef } from 'react'
import Pusher from 'pusher-js'

let _pusher: Pusher | null = null

function getPusherClient(): Pusher | null {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
  if (!key || !cluster) return null

  if (!_pusher) {
    _pusher = new Pusher(key, { cluster })
  }
  return _pusher
}

/**
 * Subscribe to a Pusher channel + event. Cleans up on unmount or when
 * channelName / eventName changes.
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
