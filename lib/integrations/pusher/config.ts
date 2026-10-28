/**
 * Pusher-protocol connection config (LUM-1018).
 *
 * Three modes, resolved from env:
 *   - cloud:        PUSHER_CLUSTER set, no PUSHER_HOST — today's SaaS behaviour
 *                   (Pusher Channels, TLS on). Unchanged when the new vars are unset.
 *   - custom host:  PUSHER_HOST set — any Pusher-protocol server such as Soketi
 *                   for self-hosting. PUSHER_PORT / PUSHER_USE_TLS tune it.
 *   - unconfigured: credentials missing — realtime is off. Server triggers
 *                   no-op and the browser never opens a socket; the UI falls
 *                   back to react-query refetching (see lib/query/client.ts).
 *
 * "Configured" here only means the app has been given a server to talk to. It
 * says nothing about whether a socket is currently connected — don't use it as
 * a connection-health signal.
 *
 * The resolvers are pure (env passed in) so they can be tested without
 * touching process.env. The browser-side values come from the runtime public
 * config (lib/config/public-config.ts), not from build-time inlining.
 */
import { readPublicConfig } from '@/lib/config/public-config'

export interface PusherServerEnv {
  PUSHER_APP_ID?: string | undefined
  PUSHER_KEY?: string | undefined
  PUSHER_SECRET?: string | undefined
  PUSHER_CLUSTER?: string | undefined
  PUSHER_HOST?: string | undefined
  PUSHER_PORT?: string | undefined
  PUSHER_USE_TLS?: string | undefined
}

export interface PusherClientEnv {
  NEXT_PUBLIC_PUSHER_KEY?: string | undefined
  NEXT_PUBLIC_PUSHER_CLUSTER?: string | undefined
  NEXT_PUBLIC_PUSHER_HOST?: string | undefined
  NEXT_PUBLIC_PUSHER_PORT?: string | undefined
  NEXT_PUBLIC_PUSHER_USE_TLS?: string | undefined
}

/** Options for the `pusher` (server) constructor. */
export type PusherServerConfig =
  | {
      mode: 'cloud'
      appId: string
      key: string
      secret: string
      cluster: string
      useTLS: boolean
    }
  | {
      mode: 'custom'
      appId: string
      key: string
      secret: string
      host: string
      port?: string
      useTLS: boolean
    }

/** Options for the `pusher-js` (browser) constructor. */
export type PusherClientConfig =
  | { mode: 'cloud'; key: string; cluster: string; forceTLS: boolean }
  | {
      mode: 'custom'
      key: string
      wsHost: string
      wsPort?: number
      forceTLS: boolean
    }

function clean(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

/** Unset → fallback; only an explicit "false"/"0"/"no"/"off" turns TLS off. */
export function parseUseTLS(
  value: string | undefined,
  fallback = true
): boolean {
  const v = clean(value)?.toLowerCase()
  if (v === undefined) return fallback
  return !['false', '0', 'no', 'off'].includes(v)
}

function parsePort(value: string | undefined): number | undefined {
  const v = clean(value)
  if (!v) return undefined
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined
}

export function resolveServerPusherConfig(
  env: PusherServerEnv
): PusherServerConfig | null {
  const appId = clean(env.PUSHER_APP_ID)
  const key = clean(env.PUSHER_KEY)
  const secret = clean(env.PUSHER_SECRET)
  if (!appId || !key || !secret) return null

  const useTLS = parseUseTLS(env.PUSHER_USE_TLS)
  const host = clean(env.PUSHER_HOST)
  if (host) {
    const port = parsePort(env.PUSHER_PORT)
    return {
      mode: 'custom',
      appId,
      key,
      secret,
      host,
      ...(port ? { port: String(port) } : {}),
      useTLS,
    }
  }

  const cluster = clean(env.PUSHER_CLUSTER)
  if (!cluster) return null
  return { mode: 'cloud', appId, key, secret, cluster, useTLS }
}

export function resolveClientPusherConfig(
  env: PusherClientEnv
): PusherClientConfig | null {
  const key = clean(env.NEXT_PUBLIC_PUSHER_KEY)
  if (!key) return null

  const forceTLS = parseUseTLS(env.NEXT_PUBLIC_PUSHER_USE_TLS)
  const host = clean(env.NEXT_PUBLIC_PUSHER_HOST)
  if (host) {
    const wsPort = parsePort(env.NEXT_PUBLIC_PUSHER_PORT)
    return {
      mode: 'custom',
      key,
      wsHost: host,
      ...(wsPort ? { wsPort } : {}),
      forceTLS,
    }
  }

  const cluster = clean(env.NEXT_PUBLIC_PUSHER_CLUSTER)
  if (!cluster) return null
  return { mode: 'cloud', key, cluster, forceTLS }
}

/**
 * The browser's view of the NEXT_PUBLIC_PUSHER_* vars, read at runtime
 * (LUM-1325): the server's env on the server, `/api/public-config` in the
 * browser, the build-time values as a last resort.
 */
export function readClientPusherEnv(): PusherClientEnv {
  return readPublicConfig().pusher
}

/** Server-side env read (explicit fields, so the resolver stays pure). */
export function readServerPusherEnv(): PusherServerEnv {
  return {
    PUSHER_APP_ID: process.env.PUSHER_APP_ID,
    PUSHER_KEY: process.env.PUSHER_KEY,
    PUSHER_SECRET: process.env.PUSHER_SECRET,
    PUSHER_CLUSTER: process.env.PUSHER_CLUSTER,
    PUSHER_HOST: process.env.PUSHER_HOST,
    PUSHER_PORT: process.env.PUSHER_PORT,
    PUSHER_USE_TLS: process.env.PUSHER_USE_TLS,
  }
}

/** True when the browser has enough config to open a realtime socket. */
export function isClientRealtimeConfigured(
  env: PusherClientEnv = readClientPusherEnv()
): boolean {
  return resolveClientPusherConfig(env) !== null
}
