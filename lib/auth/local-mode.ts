/**
 * LUM-1335 — `LUMO_MODE=local`: a self-hosted Lumo that opens without a
 * sign-in. The first page visit signs the browser in as the instance's one
 * user (created on that visit when there is none yet), so a try-out goes
 * straight from `scripts/self-host/setup.sh` to the app.
 *
 * Opt-in only: unset is the normal sign-in, and any other value fails loudly
 * rather than being guessed at — a typo must never open an instance.
 *
 * The local user is an ordinary Better Auth user with ordinary memberships,
 * so turning the mode off later keeps every workspace it made. It runs only
 * while the instance has at most one user: a team instance is never handed to
 * whoever opens it.
 *
 * No SDK imports here: this module is safe for proxy.ts, server and client.
 */

type Env = Record<string, string | undefined>

export const LUMO_MODE_ENV = 'LUMO_MODE'

export const LUMO_MODES = ['local'] as const
export type LumoMode = (typeof LUMO_MODES)[number] | 'standard'

/** Pure: the configured mode for `env`. Throws on an unknown value. */
export function resolveLumoMode(env: Env = process.env): LumoMode {
  const raw = env[LUMO_MODE_ENV]?.trim().toLowerCase()
  if (!raw) return 'standard'
  const known = LUMO_MODES.find(m => m === raw)
  if (!known) {
    throw new Error(
      `Unknown ${LUMO_MODE_ENV} "${raw}" — expected ${LUMO_MODES.join(', ')}, or unset for the normal sign-in`
    )
  }
  return known
}

/** Whether this instance opens without a sign-in. */
export function isLocalMode(env: Env = process.env): boolean {
  return resolveLumoMode(env) === 'local'
}

/** The Better Auth endpoint that signs the browser in as the local user. */
export const LOCAL_SIGN_IN_PATH = '/api/auth/lumo/local-sign-in'

/** The address the local user is created with (`.localhost` never routes). */
export const LOCAL_USER_EMAIL = 'local@lumo.localhost'

/** The display name the local user is created with. */
export const LOCAL_USER_NAME = 'Local user'

/** Pure: whether `host` (a URL hostname) is this machine only. */
export function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(host)
  )
}

/**
 * Pure: whether local mode is on while the app is published at a URL other
 * machines can reach — then anyone who opens it is signed in.
 */
export function isLocalModeOnPublicUrl(
  appUrl: string | undefined,
  env: Env = process.env
): boolean {
  if (!isLocalMode(env) || !appUrl) return false
  try {
    return !isLoopbackHost(new URL(appUrl).hostname)
  } catch {
    return false
  }
}
