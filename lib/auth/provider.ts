/**
 * LUM-1027 — which auth provider this deployment runs.
 *
 *   AUTH_PROVIDER unset / "clerk" → Clerk (the hosted SaaS default, unchanged)
 *   AUTH_PROVIDER="better-auth"   → Better Auth (self-hosted, no CLERK_* vars)
 *
 * Read on the server at call time. Statically prerendered pages bake the value
 * in at build time, so a self-hosted image must be BUILT with the same
 * AUTH_PROVIDER it runs with. An unknown value fails loudly rather than
 * silently falling back to Clerk.
 *
 * No SDK imports here: this module is safe for proxy.ts, server and client.
 */
import { isPasswordSignInEnabled } from './better-auth/config'

export const AUTH_PROVIDER_ENV = 'AUTH_PROVIDER'

export const AUTH_PROVIDERS = ['clerk', 'better-auth'] as const
export type AuthProviderName = (typeof AUTH_PROVIDERS)[number]

type Env = Record<string, string | undefined>

/** Pure: the configured provider for `env`. Throws on an unknown value. */
export function resolveAuthProvider(env: Env = process.env): AuthProviderName {
  const raw = env[AUTH_PROVIDER_ENV]?.trim().toLowerCase()
  if (!raw) return 'clerk'
  const known = AUTH_PROVIDERS.find(p => p === raw)
  if (!known) {
    throw new Error(
      `Unknown ${AUTH_PROVIDER_ENV} "${raw}" — expected one of: ${AUTH_PROVIDERS.join(', ')}`
    )
  }
  return known
}

/** Whether this deployment authenticates with Better Auth. */
export function isBetterAuth(env: Env = process.env): boolean {
  return resolveAuthProvider(env) === 'better-auth'
}

/**
 * LUM-1082 — whether /reset-password exists: Better Auth with password
 * sign-in on (AUTH_DISABLE_PASSWORD unset). Clerk hosts its own reset flow.
 */
export function hasPasswordReset(env: Env = process.env): boolean {
  return isBetterAuth(env) && isPasswordSignInEnabled(env)
}
