/**
 * @jest-environment node
 */
import {
  DEFAULT_AFTER_SIGN_IN,
  errorMessageId,
  safeRedirectTarget,
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
