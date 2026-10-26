/** @jest-environment node */
/**
 * LUM-1025 — the deployment-level "is this integration configured?" helper.
 */
import {
  configuredRegistryIntegrations,
  integrationConfigStatus,
  isIntegrationConfigured,
} from '@/lib/integrations/configured'

const KEY = 'a'.repeat(64)

const FULL: Record<string, string> = {
  ENCRYPTION_KEY: KEY,
  SLACK_CLIENT_ID: 'x',
  SLACK_CLIENT_SECRET: 'x',
  SLACK_SIGNING_SECRET: 'x',
  GITHUB_APP_SLUG: 'x',
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: 'x',
  GITHUB_APP_CLIENT_ID: 'x',
  GITHUB_APP_CLIENT_SECRET: 'x',
  GITHUB_APP_WEBHOOK_SECRET: 'x',
  GITHUB_CLIENT_ID: 'x',
  GITHUB_CLIENT_SECRET: 'x',
  FIGMA_OAUTH_CLIENT_ID: 'x',
  FIGMA_OAUTH_CLIENT_SECRET: 'x',
  FIGMA_OAUTH_REDIRECT_URI: 'x',
  GOOGLE_CLIENT_ID: 'x',
  GOOGLE_CLIENT_SECRET: 'x',
  GOOGLE_DRIVE_OAUTH_REDIRECT_URI: 'x',
}

describe('integrationConfigStatus — registry integrations', () => {
  const ids = [
    'slack',
    'github',
    'githubAccount',
    'sentry',
    'codeup',
    'figma',
    'googleDrive',
  ] as const

  it.each(ids)('%s is not configured with only DATABASE_URL + Clerk', id => {
    const env = {
      DATABASE_URL: 'postgres://x',
      CLERK_SECRET_KEY: 'x',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'x',
    }
    const status = integrationConfigStatus(id, env)
    expect(status.configured).toBe(false)
    expect(status.missing).toContain('ENCRYPTION_KEY')
  })

  it.each(ids)('%s is configured when every variable it needs is set', id => {
    expect(integrationConfigStatus(id, FULL)).toEqual({
      configured: true,
      missing: [],
    })
  })

  it('treats a blank value as missing and names it', () => {
    expect(
      integrationConfigStatus('slack', { ...FULL, SLACK_SIGNING_SECRET: '  ' })
    ).toEqual({ configured: false, missing: ['SLACK_SIGNING_SECRET'] })
  })

  it('the GitHub App needs its own credentials, not the OAuth ones', () => {
    const { GITHUB_APP_PRIVATE_KEY: _k, ...noKey } = FULL
    expect(isIntegrationConfigured('github', noKey)).toBe(false)
    expect(isIntegrationConfigured('githubAccount', noKey)).toBe(true)
  })

  it('configuredRegistryIntegrations maps every registry id', () => {
    expect(configuredRegistryIntegrations({ ENCRYPTION_KEY: KEY })).toEqual({
      slack: false,
      github: false,
      githubAccount: false,
      sentry: true,
      codeup: true,
      figma: false,
      googleDrive: false,
    })
    expect(
      Object.values(configuredRegistryIntegrations(FULL)).every(Boolean)
    ).toBe(true)
  })
})

describe('integrationConfigStatus — vercelSandbox', () => {
  it('is not configured off Vercel without an OIDC token', () => {
    expect(integrationConfigStatus('vercelSandbox', {})).toEqual({
      configured: false,
      missing: ['VERCEL_OIDC_TOKEN'],
    })
  })

  it('is configured inside a Vercel Function', () => {
    expect(isIntegrationConfigured('vercelSandbox', { VERCEL: '1' })).toBe(true)
  })

  it('is configured with a pulled OIDC token', () => {
    expect(
      isIntegrationConfigured('vercelSandbox', { VERCEL_OIDC_TOKEN: 'jwt' })
    ).toBe(true)
  })
})

describe('integrationConfigStatus — chromium', () => {
  const status = (env: Record<string, string>, platform = 'linux') =>
    integrationConfigStatus('chromium', env, platform).configured

  it('is off on a self-hosted Linux box by default', () => {
    expect(status({ NODE_ENV: 'production' })).toBe(false)
  })

  it('is on with CHROME_PATH, on Vercel, or forced on', () => {
    expect(status({ CHROME_PATH: '/usr/bin/chromium' })).toBe(true)
    expect(status({ VERCEL: '1' })).toBe(true)
    expect(status({ LUMO_OG_CHROMIUM: 'on' })).toBe(true)
  })

  it('keeps the local-dev default on macOS / Windows', () => {
    expect(status({ NODE_ENV: 'development' }, 'darwin')).toBe(true)
    expect(status({ NODE_ENV: 'development' }, 'win32')).toBe(true)
    expect(status({ NODE_ENV: 'development' }, 'linux')).toBe(false)
  })

  it('LUMO_OG_CHROMIUM=off wins over everything', () => {
    expect(status({ LUMO_OG_CHROMIUM: 'off', VERCEL: '1' })).toBe(false)
  })
})
