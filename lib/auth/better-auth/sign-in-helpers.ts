/**
 * LUM-1027 — pure helpers for the Better Auth sign-in form (no React, no SDK).
 */

/** Query parameter carrying the page to return to (same name as Clerk's). */
export const REDIRECT_PARAM_NAME = 'redirect_url'

/** Where a signed-in user lands when no (valid) redirect was requested. */
export const DEFAULT_AFTER_SIGN_IN = '/workspace'

/** The sign-in page. */
export const SIGN_IN_PAGE_PATH = '/signin'

/**
 * LUM-1070 — the forgot / reset password page (request a link, then set the
 * new password). Public; Better Auth deployments only.
 */
export const RESET_PASSWORD_PATH = '/reset-password'

/** Better Auth's default password length bounds (sign-up, reset, change). */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

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
  PASSWORD_TOO_LONG: 'auth.error.passwordTooLong',
  EMAIL_PASSWORD_SIGN_UP_DISABLED: 'auth.error.signUpDisabled',
  INVALID_TOKEN: 'auth.resetPassword.invalidToken',
  TOO_MANY_REQUESTS: 'auth.error.tooManyRequests',
  // LUM-1071: the admin plugin refuses a session for a banned user.
  BANNED_USER: 'auth.error.accountSuspended',
  // LUM-1082: email one-time-code sign-in (better-auth emailOTP).
  INVALID_OTP: 'auth.error.invalidCode',
  OTP_EXPIRED: 'auth.error.codeExpired',
  TOO_MANY_ATTEMPTS: 'auth.error.tooManyCodeAttempts',
  INVALID_EMAIL: 'auth.error.invalidEmail',
}

/** LUM-1082: a sign-in code is this many digits (./email-otp). */
export const EMAIL_CODE_LENGTH = 6

/** LUM-1082: what the user typed as the code, digits only. */
export function normalizeEmailCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, EMAIL_CODE_LENGTH)
}

export function errorMessageId(code: string | null | undefined): string {
  return (code && ERROR_MESSAGE_IDS[code]) || 'auth.error.generic'
}

/**
 * LUM-1070 — the error code of a failed Better Auth client call. The rate
 * limiter answers 429 with no code, so that status gets its own.
 */
export function authErrorCode(error: {
  code?: string | undefined
  status?: number | undefined
}): string {
  if (error.status === 429) return 'TOO_MANY_REQUESTS'
  return error.code ?? ''
}

/**
 * LUM-1070 — where a failed social sign-in returns: this sign-in page (with
 * the same post-sign-in target), which reads Better Auth's `?error=` code.
 * Without it Better Auth would show its bare /api/auth/error page.
 */
export function socialErrorCallbackUrl(target: string): string {
  if (target === DEFAULT_AFTER_SIGN_IN) return SIGN_IN_PAGE_PATH
  const params = new URLSearchParams({ [REDIRECT_PARAM_NAME]: target })
  return `${SIGN_IN_PAGE_PATH}?${params.toString()}`
}

/**
 * LUM-1070 — message for an OAuth callback `?error=` code. The one users can
 * act on is `account_not_linked`: a Lumo account already has this email but
 * has not verified it, so the social identity is not linked (see
 * ./account-linking). Every other code is a generic social sign-in failure.
 */
export function socialErrorMessageId(
  code: string | null | undefined
): string | null {
  if (!code) return null
  if (code === 'account_not_linked') return 'auth.error.accountNotLinked'
  return 'auth.error.socialSignInFailed'
}

/** LUM-1070 — change-password failures, phrased for the profile form. */
const CHANGE_PASSWORD_MESSAGE_IDS: Record<string, string> = {
  INVALID_PASSWORD: 'profile.password.currentIncorrect',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'profile.password.noPassword',
}

export function changePasswordErrorMessageId(code: string): string {
  return CHANGE_PASSWORD_MESSAGE_IDS[code] ?? errorMessageId(code)
}
