/**
 * LUM-1027 — pure helpers for the Better Auth sign-in form (no React, no SDK).
 */

/** Query parameter carrying the page to return to (same name as Clerk's). */
export const REDIRECT_PARAM_NAME = 'redirect_url'

/** Where a signed-in user lands when no (valid) redirect was requested. */
export const DEFAULT_AFTER_SIGN_IN = '/workspace'

/**
 * The post-sign-in destination from `?redirect_url=`, restricted to a path on
 * this origin. Anything else — an absolute URL to another host, a
 * protocol-relative `//evil`, a backslash trick — falls back to the default,
 * so the parameter can never become an open redirect.
 */
export function safeRedirectTarget(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_SIGN_IN
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return DEFAULT_AFTER_SIGN_IN
  }
  try {
    const url = new URL(raw, 'http://lumo.invalid')
    if (url.origin !== 'http://lumo.invalid') return DEFAULT_AFTER_SIGN_IN
    if (url.pathname.startsWith('/signin')) return DEFAULT_AFTER_SIGN_IN
    return url.pathname + url.search + url.hash
  } catch {
    return DEFAULT_AFTER_SIGN_IN
  }
}

/** Better Auth error code → react-intl message id shown under the form. */
const ERROR_MESSAGE_IDS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth.error.invalidCredentials',
  INVALID_PASSWORD: 'auth.error.invalidCredentials',
  USER_ALREADY_EXISTS: 'auth.error.userExists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.error.userExists',
  PASSWORD_TOO_SHORT: 'auth.error.passwordTooShort',
  EMAIL_PASSWORD_SIGN_UP_DISABLED: 'auth.error.signUpDisabled',
  // LUM-1071: the admin plugin refuses a session for a banned user.
  BANNED_USER: 'auth.error.accountSuspended',
}

export function errorMessageId(code: string | null | undefined): string {
  return (code && ERROR_MESSAGE_IDS[code]) || 'auth.error.generic'
}
