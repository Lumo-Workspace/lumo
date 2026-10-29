/**
 * @jest-environment node
 */
// LUM-1027 / LUM-1077 — Better Auth is the only provider; AUTH_PROVIDER is
// optional, and a leftover value such as "clerk" fails loudly.
import { hasPasswordReset, resolveAuthProvider } from '@/lib/auth/provider'

describe('resolveAuthProvider', () => {
  it('defaults to better-auth when unset or blank', () => {
    expect(resolveAuthProvider({})).toBe('better-auth')
    expect(resolveAuthProvider({ AUTH_PROVIDER: '' })).toBe('better-auth')
    expect(resolveAuthProvider({ AUTH_PROVIDER: '  ' })).toBe('better-auth')
  })

  it('accepts better-auth, case- and whitespace-insensitively', () => {
    expect(resolveAuthProvider({ AUTH_PROVIDER: ' Better-Auth ' })).toBe(
      'better-auth'
    )
  })

  it('rejects clerk, saying its support was removed', () => {
    expect(() => resolveAuthProvider({ AUTH_PROVIDER: 'clerk' })).toThrow(
      /Unknown AUTH_PROVIDER "clerk" \(Clerk support was removed, LUM-1077\)/
    )
  })

  it('fails loudly on an unknown value instead of falling back', () => {
    expect(() => resolveAuthProvider({ AUTH_PROVIDER: 'authjs' })).toThrow(
      /Unknown AUTH_PROVIDER "authjs"/
    )
  })
})

describe('hasPasswordReset (LUM-1082)', () => {
  it('follows password sign-in', () => {
    expect(hasPasswordReset({})).toBe(true)
    expect(hasPasswordReset({ AUTH_PROVIDER: 'better-auth' })).toBe(true)
    expect(hasPasswordReset({ AUTH_DISABLE_PASSWORD: 'true' })).toBe(false)
  })
})
