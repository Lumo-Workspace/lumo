/**
 * @jest-environment node
 */
import {
  fetchTenantAccessToken,
  fetchTenantInfo,
  isTenantTokenFresh,
  TENANT_TOKEN_REFRESH_MARGIN_MS,
} from '@/lib/integrations/feishu/tenant'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

const APP = { appId: 'cli_x', appSecret: 'sec', domain: 'feishu' as const }

describe('fetchTenantAccessToken', () => {
  it('posts app id + secret to the self-built (internal) endpoint', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        code: 0,
        msg: 'ok',
        tenant_access_token: 't-1',
        expire: 7200,
      })
    )
    await expect(fetchTenantAccessToken(APP, 5)).resolves.toEqual({
      token: 't-1',
      expiresAt: new Date(5 + 7_200_000),
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
    )
    expect(JSON.parse(init.body)).toEqual({
      app_id: 'cli_x',
      app_secret: 'sec',
    })
  })

  it('uses the Lark host for a Lark app', async () => {
    fetchMock.mockResolvedValue(
      json(200, { code: 0, tenant_access_token: 't', expire: 1 })
    )
    await fetchTenantAccessToken({ ...APP, domain: 'lark' })
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/open\.larksuite\.com\//
    )
  })

  it('throws on a Feishu error code (bad secret)', async () => {
    fetchMock.mockResolvedValue(
      json(200, { code: 10014, msg: 'app secret invalid' })
    )
    await expect(fetchTenantAccessToken(APP)).rejects.toMatchObject({
      code: 10014,
    })
  })
})

describe('fetchTenantInfo', () => {
  it('reads the tenant key and name', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        code: 0,
        data: { tenant: { tenant_key: 'tk', name: 'Acme' } },
      })
    )
    await expect(fetchTenantInfo(APP, 't-1')).resolves.toEqual({
      tenantKey: 'tk',
      name: 'Acme',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://open.feishu.cn/open-apis/tenant/v2/tenant/query')
    expect(init.headers.Authorization).toBe('Bearer t-1')
  })

  it('refuses a response without a tenant', async () => {
    fetchMock.mockResolvedValue(json(200, { code: 0, data: {} }))
    await expect(fetchTenantInfo(APP, 't')).rejects.toThrow(/tenant_key/)
  })
})

describe('isTenantTokenFresh', () => {
  it('is fresh only with more than the margin left', () => {
    const now = 1_000_000
    expect(isTenantTokenFresh(null, now)).toBe(false)
    expect(
      isTenantTokenFresh(
        new Date(now + TENANT_TOKEN_REFRESH_MARGIN_MS + 1),
        now
      )
    ).toBe(true)
    expect(
      isTenantTokenFresh(new Date(now + TENANT_TOKEN_REFRESH_MARGIN_MS), now)
    ).toBe(false)
  })
})
