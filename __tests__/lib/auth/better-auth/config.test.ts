/**
 * @jest-environment node
 */
import {
  googleSignInSharesDriveClient,
  isEmailCodeSignInEnabled,
  isPasswordSignInEnabled,
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
      passwordEnabled: true,
      emailCodeEnabled: true, // NODE_ENV unset → development
    })
    expect(JSON.stringify(config)).not.toContain('value')
  })

  describe('LUM-1082 sign-in options', () => {
    it('password sign-in is on unless AUTH_DISABLE_PASSWORD is true / 1 / yes', () => {
      expect(isPasswordSignInEnabled({})).toBe(true)
      for (const v of ['true', 'TRUE', '1', 'yes', ' yes ']) {
        expect(isPasswordSignInEnabled({ AUTH_DISABLE_PASSWORD: v })).toBe(
          false
        )
      }
      for (const v of ['', 'false', '0', 'no']) {
        expect(isPasswordSignInEnabled({ AUTH_DISABLE_PASSWORD: v })).toBe(true)
      }
    })

    it('email codes need a transport in production; development logs them', () => {
      const prod = { NODE_ENV: 'production' }
      expect(isEmailCodeSignInEnabled(prod)).toBe(false)
      expect(isEmailCodeSignInEnabled({ ...prod, SMTP_URL: 'smtp://m' })).toBe(
        true
      )
      expect(isEmailCodeSignInEnabled({ ...prod, SMTP_HOST: 'm' })).toBe(true)
      expect(isEmailCodeSignInEnabled({ ...prod, RESEND_API_KEY: 'k' })).toBe(
        true
      )
      expect(isEmailCodeSignInEnabled({ NODE_ENV: 'development' })).toBe(true)
    })

    it('the public config of the hosted SaaS: codes + social, no password', () => {
      expect(
        resolvePublicAuthConfig({
          NODE_ENV: 'production',
          RESEND_API_KEY: 'k',
          AUTH_DISABLE_PASSWORD: 'true',
        })
      ).toMatchObject({ passwordEnabled: false, emailCodeEnabled: true })
    })

    it('flags a Google sign-in client equal to the Drive client', () => {
      expect(
        googleSignInSharesDriveClient({
          AUTH_GOOGLE_CLIENT_ID: 'same.apps',
          GOOGLE_CLIENT_ID: ' same.apps ',
        })
      ).toBe(true)
      expect(
        googleSignInSharesDriveClient({
          AUTH_GOOGLE_CLIENT_ID: 'a.apps',
          GOOGLE_CLIENT_ID: 'b.apps',
        })
      ).toBe(false)
      expect(googleSignInSharesDriveClient({ GOOGLE_CLIENT_ID: 'b' })).toBe(
        false
      )
      expect(googleSignInSharesDriveClient({})).toBe(false)
    })
  })
})
