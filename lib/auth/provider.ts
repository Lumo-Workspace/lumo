/**
 * LUM-1027 — which auth provider this deployment runs.
 *
 * Better Auth is the only provider since Clerk was removed (LUM-1077), so
 * AUTH_PROVIDER is optional: unset and "better-auth" mean the same. Any other
 * value — a leftover AUTH_PROVIDER=clerk in particular — fails loudly rather
 * than silently signing users in against a different account store.
 *
 * No SDK imports here: this module is safe for proxy.ts, server and client.
 */
import { isPasswordSignInEnabled } from './better-auth/config'

export const AUTH_PROVIDER_ENV = 'AUTH_PROVIDER'

export const AUTH_PROVIDERS = ['better-auth'] as const
export type AuthProviderName = (typeof AUTH_PROVIDERS)[number]

type Env = Record<string, string | undefined>

/** Pure: the configured provider for `env`. Throws on an unknown value. */
export function resolveAuthProvider(env: Env = process.env): AuthProviderName {
  const raw = env[AUTH_PROVIDER_ENV]?.trim().toLowerCase()
  if (!raw) return 'better-auth'
  const known = AUTH_PROVIDERS.find(p => p === raw)
  if (!known) {
    const removed =
      raw === 'clerk' ? ' (Clerk support was removed, LUM-1077)' : ''
    throw new Error(
      `Unknown ${AUTH_PROVIDER_ENV} "${raw}"${removed} — expected one of: ${AUTH_PROVIDERS.join(', ')}, or unset`
    )
  }
  return known
}

/**
 * LUM-1082 — whether /reset-password exists: password sign-in is on
 * (AUTH_DISABLE_PASSWORD unset).
 */
export function hasPasswordReset(env: Env = process.env): boolean {
  return isPasswordSignInEnabled(env)
}
