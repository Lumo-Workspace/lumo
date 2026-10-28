/**
 * LUM-1325 — browser-visible deployment config, read at runtime.
 *
 * `next build` inlines every literal `process.env.NEXT_PUBLIC_*` reference, in
 * server bundles as well as client ones, so a prebuilt image would carry the
 * URL it was built with. This module reads the same variables at runtime
 * instead, so one image serves any domain:
 *
 *   - server: from the process environment, through an `env` parameter — a
 *     non-literal read the bundler leaves alone (same as resolveBetterAuthUrl).
 *   - browser: from `window.__LUMO_PUBLIC_CONFIG__`, set by the
 *     `/api/public-config` script the root layout loads before hydration;
 *     falls back to the build-time values when the script did not run.
 *
 * Only NEXT_PUBLIC_* values belong here — the script is served to anyone.
 */
import type { PusherClientEnv } from '@/lib/integrations/pusher/config'

export const PUBLIC_CONFIG_GLOBAL = '__LUMO_PUBLIC_CONFIG__'

export interface PublicConfig {
  /** This deployment's own origin, no trailing slash. */
  appUrl?: string | undefined
  pusher: PusherClientEnv
}

type Env = Record<string, string | undefined>

declare global {
  interface Window {
    [PUBLIC_CONFIG_GLOBAL]?: PublicConfig
  }
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

function cleanUrl(value: string | undefined): string | undefined {
  return clean(value)?.replace(/\/+$/, '')
}

/** Pure: the public config for `env`. Server-side runtime read. */
export function resolvePublicConfig(env: Env = process.env): PublicConfig {
  return {
    appUrl: cleanUrl(env.NEXT_PUBLIC_APP_URL),
    pusher: {
      NEXT_PUBLIC_PUSHER_KEY: clean(env.NEXT_PUBLIC_PUSHER_KEY),
      NEXT_PUBLIC_PUSHER_CLUSTER: clean(env.NEXT_PUBLIC_PUSHER_CLUSTER),
      NEXT_PUBLIC_PUSHER_HOST: clean(env.NEXT_PUBLIC_PUSHER_HOST),
      NEXT_PUBLIC_PUSHER_PORT: clean(env.NEXT_PUBLIC_PUSHER_PORT),
      NEXT_PUBLIC_PUSHER_USE_TLS: clean(env.NEXT_PUBLIC_PUSHER_USE_TLS),
    },
  }
}

/**
 * The values inlined by `next build`. Each var is referenced by its literal
 * name so the bundler can inline it — don't refactor into a loop or a spread.
 */
export function readBuildTimePublicConfig(): PublicConfig {
  return resolvePublicConfig({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_PUSHER_KEY: process.env.NEXT_PUBLIC_PUSHER_KEY,
    NEXT_PUBLIC_PUSHER_CLUSTER: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    NEXT_PUBLIC_PUSHER_HOST: process.env.NEXT_PUBLIC_PUSHER_HOST,
    NEXT_PUBLIC_PUSHER_PORT: process.env.NEXT_PUBLIC_PUSHER_PORT,
    NEXT_PUBLIC_PUSHER_USE_TLS: process.env.NEXT_PUBLIC_PUSHER_USE_TLS,
  })
}

/** The public config wherever this runs: server env, else the browser global. */
export function readPublicConfig(): PublicConfig {
  if (typeof window === 'undefined') return resolvePublicConfig()
  return window[PUBLIC_CONFIG_GLOBAL] ?? readBuildTimePublicConfig()
}

/** This deployment's origin (NEXT_PUBLIC_APP_URL at runtime), no trailing slash. */
export function resolveAppUrl(): string | undefined {
  return readPublicConfig().appUrl
}

/**
 * The `/api/public-config` script body. JSON is escaped so no value can close
 * the script element or break out of the string literal.
 */
export function renderPublicConfigScript(config: PublicConfig): string {
  const json = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `window.${PUBLIC_CONFIG_GLOBAL}=${json};\n`
}
