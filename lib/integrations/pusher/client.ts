'use client'

import Pusher from 'pusher-js'
import {
  readClientPusherEnv,
  resolveClientPusherConfig,
  type PusherClientConfig,
} from './config'

/**
 * Browser-side wrapper around pusher-js (LUM-1018). Components and hooks use
 * this instead of importing the SDK directly.
 *
 * Returns null when realtime is not configured — callers then skip
 * subscribing, and no socket is ever opened.
 */

// `undefined` = not resolved yet; `null` = realtime not configured.
let _client: Pusher | null | undefined

export function toPusherJsOptions(
  config: PusherClientConfig
): ConstructorParameters<typeof Pusher>[1] {
  if (config.mode === 'custom') {
    const port = config.wsPort
    return {
      // pusher-js requires a cluster string; it is unused once wsHost is set.
      cluster: 'mt1',
      wsHost: config.wsHost,
      ...(port ? { wsPort: port, wssPort: port } : {}),
      forceTLS: config.forceTLS,
      enabledTransports: ['ws', 'wss'],
    }
  }
  return { cluster: config.cluster, forceTLS: config.forceTLS }
}

export function getPusherClient(): Pusher | null {
  if (_client !== undefined) return _client
  const config = resolveClientPusherConfig(readClientPusherEnv())
  _client = config ? new Pusher(config.key, toPusherJsOptions(config)) : null
  return _client
}
