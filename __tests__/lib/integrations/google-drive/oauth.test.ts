import {
  getAuthorizeUrl,
  GOOGLE_DRIVE_OAUTH_SCOPES,
} from '@/lib/integrations/google-drive/oauth'

describe('google-drive oauth', () => {
  const ENV = process.env
  beforeEach(() => {
    process.env = {
      ...ENV,
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_DRIVE_OAUTH_REDIRECT_URI:
        'https://app.test/api/google-drive/callback',
    }
  })
  afterEach(() => {
    process.env = ENV
  })

  it('builds an authorize URL requesting offline access + consent + readonly scope', () => {
    const url = new URL(getAuthorizeUrl({ state: 'abc' }))
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    )
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.test/api/google-drive/callback'
    )
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('abc')
    expect(url.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/drive.readonly'
    )
    expect(GOOGLE_DRIVE_OAUTH_SCOPES.length).toBeGreaterThan(0)
  })

  it('throws a clear error when an env var is missing', () => {
    delete process.env.GOOGLE_CLIENT_ID
    expect(() => getAuthorizeUrl({ state: 'abc' })).toThrow('GOOGLE_CLIENT_ID')
  })
})
