/**
 * @jest-environment node
 *
 * LUM-1044 — pure helpers of the MCP OAuth consent page / sign-in continuation.
 */
import {
  oauthRedirectUrl,
  parseConsentRequest,
  scopeMessageId,
} from '@/lib/auth/better-auth/consent-helpers'

const signed =
  'client_id=abc&redirect_uri=http%3A%2F%2Flocalhost%3A6274%2Foauth%2Fcallback' +
  '&scope=mcp+offline_access+mcp&exp=1&sig=xyz'

describe('parseConsentRequest', () => {
  it('reads client, de-duplicated scopes and the redirect host', () => {
    expect(parseConsentRequest(signed)).toEqual({
      clientId: 'abc',
      scopes: ['mcp', 'offline_access'],
      redirectHost: 'localhost:6274',
    })
  })

  it.each([
    ['an unsigned request', signed.replace('&sig=xyz', '')],
    ['no client', signed.replace('client_id=abc&', '')],
    ['no redirect_uri', 'client_id=abc&sig=x'],
    ['a malformed redirect_uri', 'client_id=abc&redirect_uri=nope&sig=x'],
    ['nothing', ''],
  ])('is null for %s', (_n, search) => {
    expect(parseConsentRequest(search)).toBeNull()
  })
})

describe('scopeMessageId', () => {
  it('describes known scopes and leaves unknown ones raw', () => {
    expect(scopeMessageId('mcp')).toBe('oauth.consent.scope.mcp')
    expect(scopeMessageId('offline_access')).toBe(
      'oauth.consent.scope.offlineAccess'
    )
    expect(scopeMessageId('profile')).toBeNull()
  })
})

describe('oauthRedirectUrl', () => {
  it('returns the URL of a { redirect: true, url } answer', () => {
    expect(
      oauthRedirectUrl({
        redirect: true,
        url: 'http://localhost:6274/oauth/callback?code=c&state=s',
      })
    ).toBe('http://localhost:6274/oauth/callback?code=c&state=s')
    expect(
      oauthRedirectUrl({ redirect: true, url: '/oauth/consent?x=1' })
    ).toBe('/oauth/consent?x=1')
  })

  it.each([
    ['a plain sign-in answer', { token: 't', user: {} }],
    ['redirect false', { redirect: false, url: 'https://a.example.com' }],
    ['a javascript: URL', { redirect: true, url: 'javascript:alert(1)' }],
    ['a data: URL', { redirect: true, url: 'data:text/html,x' }],
    ['null', null],
  ])('is null for %s', (_n, data) => {
    expect(oauthRedirectUrl(data)).toBeNull()
  })
})
