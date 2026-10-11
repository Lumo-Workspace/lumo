/**
 * LUM-1027 — environment configuration of the Better Auth implementation.
 * Pure functions over an env record so they are testable without a server.
 *
 *   BETTER_AUTH_SECRET        required; ≥ 32 chars (signs cookies / tokens)
 *   BETTER_AUTH_URL           public base URL (falls back to NEXT_PUBLIC_APP_URL)
 *   AUTH_GITHUB_CLIENT_ID     + AUTH_GITHUB_CLIENT_SECRET → "Continue with GitHub"
 *   AUTH_GOOGLE_CLIENT_ID     + AUTH_GOOGLE_CLIENT_SECRET → "Continue with Google"
 *   AUTH_DISABLE_SIGNUP=true  only existing accounts may sign in
 *   AUTH_DISABLE_PASSWORD=true  no password sign-in / sign-up (LUM-1082);
 *                             the hosted SaaS sets it, self-hosting keeps
 *                             passwords unless it opts out
 *
 * Email one-time codes (LUM-1082) are on whenever email can go out (SMTP or
 * the Resend relay), and in development, where the code is logged instead.
 *
 * The OAuth variables are deliberately not GITHUB_CLIENT_ID & co.: those
 * already belong to Lumo's GitHub integration — and the Google sign-in client
 * must not be the Google Drive import's GOOGLE_CLIENT_ID either (see
 * googleSignInSharesDriveClient).
 */
import { resolveEmailTransport } from '@/lib/integrations/email/transport'

type Env = Record<string, string | undefined>

export const BETTER_AUTH_SECRET_ENV = 'BETTER_AUTH_SECRET'
export const BETTER_AUTH_URL_ENV = 'BETTER_AUTH_URL'
export const AUTH_DISABLE_SIGNUP_ENV = 'AUTH_DISABLE_SIGNUP'
export const AUTH_DISABLE_PASSWORD_ENV = 'AUTH_DISABLE_PASSWORD'
/** The Google Drive import's OAuth client (lib/integrations/google-drive). */
export const DRIVE_GOOGLE_CLIENT_ID_ENV = 'GOOGLE_CLIENT_ID'
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

const isTruthyFlag = (raw: string | undefined): boolean => {
  const v = raw?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** `true` / `1` / `yes` (any case) disable self-service sign-up. */
export function isSignUpDisabled(env: Env = process.env): boolean {
  return isTruthyFlag(env[AUTH_DISABLE_SIGNUP_ENV])
}

/**
 * LUM-1082 — email + password sign-in (and sign-up, reset, change). On unless
 * AUTH_DISABLE_PASSWORD is `true` / `1` / `yes`: an existing self-hosted
 * instance — possibly without email set up — keeps working as before.
 */
export function isPasswordSignInEnabled(env: Env = process.env): boolean {
  return !isTruthyFlag(env[AUTH_DISABLE_PASSWORD_ENV])
}

/**
 * LUM-1082 — email one-time-code sign-in. Needs a way to deliver the code:
 * an email transport, or NODE_ENV=development (`next dev`), where the code
 * goes to the server log.
 */
export function isEmailCodeSignInEnabled(env: Env = process.env): boolean {
  return resolveEmailTransport(env) !== 'none' || env.NODE_ENV === 'development'
}

/**
 * LUM-1082 — true when Google sign-in reuses the Google Drive import's OAuth
 * client. Google then shows the Drive permission that client was granted
 * (the Drive flow asks with include_granted_scopes) on the sign-in consent
 * screen, although sign-in never requests it. Not blocking: a warning.
 */
export function googleSignInSharesDriveClient(env: Env = process.env): boolean {
  const signIn = env[socialEnvName('google', 'ID')]?.trim()
  const drive = env[DRIVE_GOOGLE_CLIENT_ID_ENV]?.trim()
  return Boolean(signIn) && signIn === drive
}

/** What the sign-in UI may know about this instance (no secrets). */
export interface PublicAuthConfig {
  socialProviders: SocialProviderId[]
  signUpEnabled: boolean
  /** LUM-1082: show the password form (sign-in, sign-up, forgot password). */
  passwordEnabled: boolean
  /** LUM-1082: show "email me a code" sign-in. */
  emailCodeEnabled: boolean
}

export function resolvePublicAuthConfig(
  env: Env = process.env
): PublicAuthConfig {
  return {
    socialProviders: SOCIAL_PROVIDERS.filter(
      p => resolveSocialProviders(env)[p] !== undefined
    ),
    signUpEnabled: !isSignUpDisabled(env),
    passwordEnabled: isPasswordSignInEnabled(env),
    emailCodeEnabled: isEmailCodeSignInEnabled(env),
  }
}
