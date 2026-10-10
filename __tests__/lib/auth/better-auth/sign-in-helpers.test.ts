/**
 * @jest-environment node
 */
import {
  DEFAULT_AFTER_SIGN_IN,
  authErrorCode,
  changePasswordErrorMessageId,
  errorMessageId,
  safeRedirectTarget,
  socialErrorCallbackUrl,
  socialErrorMessageId,
} from '@/lib/auth/better-auth/sign-in-helpers'

describe('safeRedirectTarget (LUM-1027)', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(safeRedirectTarget('/workspace/acme/my-tasks?x=1#top')).toBe(
      '/workspace/acme/my-tasks?x=1#top'
    )
    expect(safeRedirectTarget('/invite/tok_1')).toBe('/invite/tok_1')
  })

  it.each([
    null,
    undefined,
    '',
    'https://evil.example/',
    '//evil.example/path',
    '/\\evil.example',
    'javascript:alert(1)',
    'workspace',
    '/signin?redirect_url=/x',
  ])('falls back to the default for %p', raw => {
    expect(safeRedirectTarget(raw)).toBe(DEFAULT_AFTER_SIGN_IN)
  })
})

describe('errorMessageId', () => {
  it('maps known Better Auth codes and falls back to generic', () => {
    expect(errorMessageId('INVALID_EMAIL_OR_PASSWORD')).toBe(
      'auth.error.invalidCredentials'
    )
    expect(errorMessageId('USER_ALREADY_EXISTS')).toBe('auth.error.userExists')
    expect(errorMessageId('EMAIL_PASSWORD_SIGN_UP_DISABLED')).toBe(
      'auth.error.signUpDisabled'
    )
    expect(errorMessageId('SOMETHING_NEW')).toBe('auth.error.generic')
    expect(errorMessageId(undefined)).toBe('auth.error.generic')
  })

  it('maps the admin plugin ban refusal to the suspended-account message (LUM-1071)', () => {
    expect(errorMessageId('BANNED_USER')).toBe('auth.error.accountSuspended')
  })
})

describe('LUM-1070 password + social error helpers', () => {
  it('maps the new Better Auth codes', () => {
    expect(errorMessageId('PASSWORD_TOO_LONG')).toBe(
      'auth.error.passwordTooLong'
    )
    expect(errorMessageId('INVALID_TOKEN')).toBe(
      'auth.resetPassword.invalidToken'
    )
    expect(errorMessageId('TOO_MANY_REQUESTS')).toBe(
      'auth.error.tooManyRequests'
    )
  })

  it('authErrorCode turns a code-less 429 into TOO_MANY_REQUESTS', () => {
    expect(authErrorCode({ status: 429 })).toBe('TOO_MANY_REQUESTS')
    expect(authErrorCode({ status: 401, code: 'INVALID_PASSWORD' })).toBe(
      'INVALID_PASSWORD'
    )
    expect(authErrorCode({ status: 500 })).toBe('')
  })

  it('socialErrorCallbackUrl returns to /signin with the same target', () => {
    expect(socialErrorCallbackUrl(DEFAULT_AFTER_SIGN_IN)).toBe('/signin')
    expect(socialErrorCallbackUrl('/invite/tok_1?x=1')).toBe(
      '/signin?redirect_url=%2Finvite%2Ftok_1%3Fx%3D1'
    )
  })

  it('socialErrorMessageId explains account_not_linked, else generic', () => {
    expect(socialErrorMessageId(null)).toBeNull()
    expect(socialErrorMessageId('')).toBeNull()
    expect(socialErrorMessageId('account_not_linked')).toBe(
      'auth.error.accountNotLinked'
    )
    expect(socialErrorMessageId('email_not_found')).toBe(
      'auth.error.socialSignInFailed'
    )
  })

  it('changePasswordErrorMessageId phrases change-password failures', () => {
    expect(changePasswordErrorMessageId('INVALID_PASSWORD')).toBe(
      'profile.password.currentIncorrect'
    )
    expect(changePasswordErrorMessageId('CREDENTIAL_ACCOUNT_NOT_FOUND')).toBe(
      'profile.password.noPassword'
    )
    expect(changePasswordErrorMessageId('PASSWORD_TOO_SHORT')).toBe(
      'auth.error.passwordTooShort'
    )
  })
})
