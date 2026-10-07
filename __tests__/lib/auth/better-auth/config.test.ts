/**
 * @jest-environment node
 */
import {
  isSignUpDisabled,
  resolveBetterAuthBaseUrl,
  resolveBetterAuthSecret,
  resolvePublicAuthConfig,
  resolveSocialProviders,
} from '@/lib/auth/better-auth/config'

// Built at runtime so secret scanners do not flag a fixture.
const LONG = 'x'.repeat(40)

describe('Better Auth config (LUM-1027)', () => {
  it('requires a secret of at least 32 characters, without echoing it', () => {
    expect(resolveBetterAuthSecret({ BETTER_AUTH_SECRET: LONG })).toBe(LONG)
    for (const value of [undefined, '', 'short']) {
      const env = value === undefined ? {} : { BETTER_AUTH_SECRET: value }
      let caught: unknown
      try {
        resolveBetterAuthSecret(env)
      } catch (e) {
        caught = e
      }
      expect(caught).toMatchObject({ status: 500 })
      expect(String((caught as Error).message)).toMatch(/BETTER_AUTH_SECRET/)
      if (value) expect((caught as Error).message).not.toContain(value)
    }
  })

  it('base URL: BETTER_AUTH_URL, else NEXT_PUBLIC_APP_URL, trailing slash trimmed', () => {
    expect(
      resolveBetterAuthBaseUrl({
        BETTER_AUTH_URL: 'https://lumo.example.com/',
        NEXT_PUBLIC_APP_URL: 'https://other',
      })
    ).toBe('https://lumo.example.com')
    expect(
      resolveBetterAuthBaseUrl({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    ).toBe('http://localhost:3000')
    expect(resolveBetterAuthBaseUrl({})).toBeUndefined()
  })

  it('enables a social provider only when id AND secret are set', () => {
    const env = {
      AUTH_GITHUB_CLIENT_ID: 'gh-id',
      AUTH_GITHUB_CLIENT_SECRET: 'gh-value',
      AUTH_GOOGLE_CLIENT_ID: 'g-id',
      GITHUB_CLIENT_ID: 'integration-id-is-not-used',
    }
    expect(resolveSocialProviders(env)).toEqual({
      github: { clientId: 'gh-id', clientSecret: 'gh-value' },
    })
    expect(resolveSocialProviders({})).toEqual({})
  })

  it('AUTH_DISABLE_SIGNUP accepts true/1/yes', () => {
    for (const v of ['true', 'TRUE', '1', 'yes']) {
      expect(isSignUpDisabled({ AUTH_DISABLE_SIGNUP: v })).toBe(true)
    }
    for (const v of [undefined, '', 'false', '0', 'no']) {
      const env = v === undefined ? {} : { AUTH_DISABLE_SIGNUP: v }
      expect(isSignUpDisabled(env)).toBe(false)
    }
  })

  it('public config lists providers in a fixed order and never secrets', () => {
    const config = resolvePublicAuthConfig({
      AUTH_GOOGLE_CLIENT_ID: 'g',
      AUTH_GOOGLE_CLIENT_SECRET: 'g-value',
      AUTH_GITHUB_CLIENT_ID: 'h',
      AUTH_GITHUB_CLIENT_SECRET: 'h-value',
      AUTH_DISABLE_SIGNUP: 'true',
    })
    expect(config).toEqual({
      socialProviders: ['github', 'google'],
      signUpEnabled: false,
    })
    expect(JSON.stringify(config)).not.toContain('value')
  })
})
