/**
 * LUM-1027 — environment configuration of the Better Auth implementation.
 * Pure functions over an env record so they are testable without a server.
 *
 *   BETTER_AUTH_SECRET        required; ≥ 32 chars (signs cookies / tokens)
 *   BETTER_AUTH_URL           public base URL (falls back to NEXT_PUBLIC_APP_URL)
 *   AUTH_GITHUB_CLIENT_ID     + AUTH_GITHUB_CLIENT_SECRET → "Continue with GitHub"
 *   AUTH_GOOGLE_CLIENT_ID     + AUTH_GOOGLE_CLIENT_SECRET → "Continue with Google"
 *   AUTH_DISABLE_SIGNUP=true  only existing accounts may sign in
 *
 * The OAuth variables are deliberately not GITHUB_CLIENT_ID & co.: those
 * already belong to Lumo's GitHub integration.
 */

type Env = Record<string, string | undefined>

export const BETTER_AUTH_SECRET_ENV = 'BETTER_AUTH_SECRET'
export const BETTER_AUTH_URL_ENV = 'BETTER_AUTH_URL'
export const AUTH_DISABLE_SIGNUP_ENV = 'AUTH_DISABLE_SIGNUP'
export const MIN_SECRET_LENGTH = 32

/** Mount point of the Better Auth handler (app/api/auth/[...all]). */
export const BETTER_AUTH_BASE_PATH = '/api/auth'

export const SOCIAL_PROVIDERS = ['github', 'google'] as const
export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number]

/** `github` + `ID` → the env var name `AUTH_GITHUB_CLIENT_ID`. */
const socialEnvName = (p: SocialProviderId, part: 'ID' | 'SECRET') =>
  `AUTH_${p.toUpperCase()}_CLIENT_${part}`

export interface SocialProviderCredentials {
  clientId: string
  clientSecret: string
}

/** The secret, or a 500-style error naming what is wrong (never the value). */
export function resolveBetterAuthSecret(env: Env = process.env): string {
  const secret = env[BETTER_AUTH_SECRET_ENV]
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw Object.assign(
      new Error(
        `${BETTER_AUTH_SECRET_ENV} must be set to at least ${MIN_SECRET_LENGTH} characters ` +
          '(e.g. `openssl rand -base64 32`) when AUTH_PROVIDER=better-auth'
      ),
      { status: 500 }
    )
  }
  return secret
}

/** Public base URL (no trailing slash), or undefined to infer per request. */
export function resolveBetterAuthBaseUrl(
  env: Env = process.env
): string | undefined {
  const raw = env[BETTER_AUTH_URL_ENV] || env.NEXT_PUBLIC_APP_URL
  return raw ? raw.replace(/\/+$/, '') : undefined
}

/** Social providers whose client id AND secret are both configured. */
export function resolveSocialProviders(
  env: Env = process.env
): Partial<Record<SocialProviderId, SocialProviderCredentials>> {
  const out: Partial<Record<SocialProviderId, SocialProviderCredentials>> = {}
  for (const provider of SOCIAL_PROVIDERS) {
    const clientId = env[socialEnvName(provider, 'ID')]
    const clientSecret = env[socialEnvName(provider, 'SECRET')]
    if (clientId && clientSecret) out[provider] = { clientId, clientSecret }
  }
  return out
}

/** `true` / `1` / `yes` (any case) disable self-service sign-up. */
export function isSignUpDisabled(env: Env = process.env): boolean {
  const raw = env[AUTH_DISABLE_SIGNUP_ENV]?.trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

/** What the sign-in UI may know about this instance (no secrets). */
export interface PublicAuthConfig {
  socialProviders: SocialProviderId[]
  signUpEnabled: boolean
}

export function resolvePublicAuthConfig(
  env: Env = process.env
): PublicAuthConfig {
  return {
    socialProviders: SOCIAL_PROVIDERS.filter(
      p => resolveSocialProviders(env)[p] !== undefined
    ),
    signUpEnabled: !isSignUpDisabled(env),
  }
}
