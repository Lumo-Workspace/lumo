/**
 * @jest-environment node
 */
import {
  exchangeCode,
  fetchUserInfo,
  FEISHU_ACCOUNT_SCOPES,
  getAuthorizeUrl,
  refreshUserToken,
} from '@/lib/integrations/feishu/oauth'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

const APP = { appId: 'cli_x', appSecret: 'sec' }

describe('getAuthorizeUrl', () => {
  it('points Feishu at accounts.feishu.cn with the scopes and state', () => {
    const url = new URL(
      getAuthorizeUrl({
        domain: 'feishu',
        appId: 'cli_x',
        redirectUri: 'https://lumo.test/api/feishu/account/callback',
        scopes: FEISHU_ACCOUNT_SCOPES,
        state: 'st',
      })
    )
    expect(url.origin + url.pathname).toBe(
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize'
    )
    expect(url.searchParams.get('client_id')).toBe('cli_x')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://lumo.test/api/feishu/account/callback'
    )
    expect(url.searchParams.get('scope')).toBe(
      'offline_access docx:document:readonly wiki:wiki:readonly'
    )
    expect(url.searchParams.get('state')).toBe('st')
  })

  it('points Lark at accounts.larksuite.com and omits an empty scope', () => {
    const url = new URL(
      getAuthorizeUrl({
        domain: 'lark',
        appId: 'cli_x',
        redirectUri: 'https://lumo.test/cb',
        scopes: [],
        state: 'st',
      })
    )
    expect(url.host).toBe('accounts.larksuite.com')
    expect(url.searchParams.has('scope')).toBe(false)
  })
})

describe('exchangeCode', () => {
  it('posts the v2 authorization_code grant and returns absolute expiries', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        code: 0,
        access_token: 'u-at',
        expires_in: 7200,
        refresh_token: 'u-rt',
        refresh_token_expires_in: 604800,
        scope: 'offline_access docx:document:readonly',
        token_type: 'Bearer',
      })
    )
    const t = await exchangeCode({
      domain: 'lark',
      ...APP,
      code: 'c1',
      redirectUri: 'https://lumo.test/cb',
      now: 1_000,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://open.larksuite.com/open-apis/authen/v2/oauth/token'
    )
    expect(JSON.parse(init.body)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'cli_x',
      client_secret: 'sec',
      code: 'c1',
      redirect_uri: 'https://lumo.test/cb',
    })
    expect(t).toEqual({
      accessToken: 'u-at',
      expiresAt: new Date(1_000 + 7_200_000),
      refreshToken: 'u-rt',
      refreshExpiresAt: new Date(1_000 + 604_800_000),
      scopes: ['offline_access', 'docx:document:readonly'],
    })
  })

  it('returns a null refresh token when offline_access was not granted', async () => {
    fetchMock.mockResolvedValue(
      json(200, { code: 0, access_token: 'a', expires_in: 10, scope: '' })
    )
    const t = await exchangeCode({
      domain: 'feishu',
      ...APP,
      code: 'c',
      redirectUri: 'r',
    })
    expect(t.refreshToken).toBeNull()
    expect(t.refreshExpiresAt).toBeNull()
  })

  it('throws on a Feishu error code', async () => {
    fetchMock.mockResolvedValue(
      json(400, { code: 20003, error: 'invalid_grant' })
    )
    await expect(
      exchangeCode({ domain: 'feishu', ...APP, code: 'c', redirectUri: 'r' })
    ).rejects.toMatchObject({ code: 20003 })
  })
})

describe('refreshUserToken', () => {
  it('posts the refresh_token grant to the v2 token endpoint', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        code: 0,
        access_token: 'a2',
        expires_in: 7200,
        refresh_token: 'r2',
        refresh_token_expires_in: 100,
      })
    )
    const t = await refreshUserToken({
      domain: 'feishu',
      ...APP,
      refreshToken: 'r1',
      now: 0,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://open.feishu.cn/open-apis/authen/v2/oauth/token')
    expect(JSON.parse(init.body)).toEqual({
      grant_type: 'refresh_token',
      client_id: 'cli_x',
      client_secret: 'sec',
      refresh_token: 'r1',
    })
    expect(t.refreshToken).toBe('r2')
  })
})

describe('fetchUserInfo', () => {
  it('reads open_id, tenant_key and name with the user token', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        code: 0,
        data: { open_id: 'ou_1', tenant_key: 'tk', name: 'Chao' },
      })
    )
    await expect(fetchUserInfo('feishu', 'u-at')).resolves.toEqual({
      openId: 'ou_1',
      tenantKey: 'tk',
      name: 'Chao',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://open.feishu.cn/open-apis/authen/v1/user_info')
    expect(init.headers.Authorization).toBe('Bearer u-at')
  })

  it('refuses a response without tenant_key', async () => {
    fetchMock.mockResolvedValue(json(200, { code: 0, data: { open_id: 'x' } }))
    await expect(fetchUserInfo('feishu', 't')).rejects.toThrow(/tenant_key/)
  })
})
