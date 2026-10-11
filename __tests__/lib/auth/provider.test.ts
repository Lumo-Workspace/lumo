/**
 * @jest-environment node
 */
// LUM-1027 — AUTH_PROVIDER selects the auth implementation; Clerk stays the
// default so the SaaS deployment is unchanged.
import {
  hasPasswordReset,
  isBetterAuth,
  resolveAuthProvider,
} from '@/lib/auth/provider'

describe('resolveAuthProvider', () => {
  it('defaults to clerk when unset or blank', () => {
    expect(resolveAuthProvider({})).toBe('clerk')
    expect(resolveAuthProvider({ AUTH_PROVIDER: '' })).toBe('clerk')
    expect(resolveAuthProvider({ AUTH_PROVIDER: '  ' })).toBe('clerk')
  })

  it('accepts both providers, case- and whitespace-insensitively', () => {
    expect(resolveAuthProvider({ AUTH_PROVIDER: 'clerk' })).toBe('clerk')
    expect(resolveAuthProvider({ AUTH_PROVIDER: ' Better-Auth ' })).toBe(
      'better-auth'
    )
  })

  it('fails loudly on an unknown value instead of falling back', () => {
    expect(() => resolveAuthProvider({ AUTH_PROVIDER: 'authjs' })).toThrow(
      /Unknown AUTH_PROVIDER "authjs"/
    )
  })

  it('isBetterAuth reflects the resolved provider', () => {
    expect(isBetterAuth({ AUTH_PROVIDER: 'better-auth' })).toBe(true)
    expect(isBetterAuth({})).toBe(false)
  })
})

describe('hasPasswordReset (LUM-1082)', () => {
  it('only Better Auth with password sign-in on', () => {
    expect(hasPasswordReset({})).toBe(false) // Clerk
    expect(hasPasswordReset({ AUTH_PROVIDER: 'clerk' })).toBe(false)
    expect(hasPasswordReset({ AUTH_PROVIDER: 'better-auth' })).toBe(true)
    expect(
      hasPasswordReset({
        AUTH_PROVIDER: 'better-auth',
        AUTH_DISABLE_PASSWORD: 'true',
      })
    ).toBe(false)
  })
})
