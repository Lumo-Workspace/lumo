/**
 * @jest-environment node
 *
 * LUM-1341 — Feishu and Lark are both supported; the API base domain is a
 * deployment setting (Decision 1).
 */
import {
  feishuAppCredentials,
  feishuHosts,
  feishuRedirectUri,
  requireAbsoluteAppUrl,
  resolveFeishuDomain,
} from '@/lib/integrations/feishu/config'

describe('resolveFeishuDomain', () => {
  it('defaults to Feishu when unset or blank', () => {
    expect(resolveFeishuDomain({})).toBe('feishu')
    expect(resolveFeishuDomain({ FEISHU_DOMAIN: '  ' })).toBe('feishu')
  })

  it('accepts lark and feishu, case-insensitively', () => {
    expect(resolveFeishuDomain({ FEISHU_DOMAIN: 'lark' })).toBe('lark')
    expect(resolveFeishuDomain({ FEISHU_DOMAIN: 'LARK ' })).toBe('lark')
    expect(resolveFeishuDomain({ FEISHU_DOMAIN: 'Feishu' })).toBe('feishu')
  })

  it('refuses anything else instead of silently falling back', () => {
    expect(() => resolveFeishuDomain({ FEISHU_DOMAIN: 'larksuite' })).toThrow(
      /FEISHU_DOMAIN must be one of feishu, lark/
    )
  })
})

describe('feishuHosts', () => {
  it('maps each domain to its OpenAPI and accounts hosts', () => {
    expect(feishuHosts('feishu')).toEqual({
      openBase: 'https://open.feishu.cn',
      accountsBase: 'https://accounts.feishu.cn',
    })
    expect(feishuHosts('lark')).toEqual({
      openBase: 'https://open.larksuite.com',
      accountsBase: 'https://accounts.larksuite.com',
    })
  })
})

describe('feishuAppCredentials', () => {
  it('reads the app id, secret and domain', () => {
    expect(
      feishuAppCredentials({
        FEISHU_APP_ID: 'cli_a',
        FEISHU_APP_SECRET: 's',
        FEISHU_DOMAIN: 'lark',
      })
    ).toEqual({ appId: 'cli_a', appSecret: 's', domain: 'lark' })
  })

  it('names the missing variable', () => {
    expect(() => feishuAppCredentials({ FEISHU_APP_SECRET: 's' })).toThrow(
      'FEISHU_APP_ID'
    )
    expect(() => feishuAppCredentials({ FEISHU_APP_ID: 'a' })).toThrow(
      'FEISHU_APP_SECRET'
    )
  })
})

describe('feishuRedirectUri', () => {
  it('builds one callback per leg under the app URL', () => {
    expect(feishuRedirectUri('install', 'https://lumo.test/')).toBe(
      'https://lumo.test/api/feishu/install/callback'
    )
    expect(feishuRedirectUri('account', 'https://lumo.test')).toBe(
      'https://lumo.test/api/feishu/account/callback'
    )
  })
})

describe('requireAbsoluteAppUrl (LUM-1341 review)', () => {
  it('returns an absolute http(s) URL without its trailing slash', () => {
    expect(requireAbsoluteAppUrl('https://lumo.test/')).toBe(
      'https://lumo.test'
    )
    expect(requireAbsoluteAppUrl(' http://localhost:3000 ')).toBe(
      'http://localhost:3000'
    )
  })

  it('fails clearly on a missing or relative app URL', () => {
    for (const bad of [undefined, '', '  ', '/', 'lumo.test', '/api']) {
      expect(() => requireAbsoluteAppUrl(bad)).toThrow(
        expect.objectContaining({ code: 'app_url_not_configured', status: 500 })
      )
    }
  })

  it('so a relative redirect_uri can never be built', () => {
    expect(() => feishuRedirectUri('install', '')).toThrow(
      expect.objectContaining({ code: 'app_url_not_configured' })
    )
  })
})
