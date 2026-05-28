import {
  getAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
} from '@/lib/integrations/figma/oauth'

describe('getAuthorizeUrl', () => {
  beforeAll(() => {
    process.env.FIGMA_OAUTH_CLIENT_ID = 'test-client-id'
    process.env.FIGMA_OAUTH_REDIRECT_URI =
      'https://lumo.test/api/figma/callback'
  })

  it('builds Figma authorize URL with required params', () => {
    const url = new URL(getAuthorizeUrl({ state: 'abc' }))
    expect(url.origin + url.pathname).toBe('https://www.figma.com/oauth')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://lumo.test/api/figma/callback'
    )
    expect(url.searchParams.get('scope')).toBe(
      'file_content:read file_metadata:read current_user:read'
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('abc')
  })
})

describe('exchangeCode', () => {
  beforeAll(() => {
    process.env.FIGMA_OAUTH_CLIENT_SECRET = 'test-secret'
  })

  it('POSTs form body and returns token response', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        user_id: 'u1',
      }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await exchangeCode('the-code')

    expect(result.access_token).toBe('at')
    const [, init] = fetchMock.mock.calls[0]
    const body = init.body as URLSearchParams
    expect(body.get('code')).toBe('the-code')
    expect(body.get('grant_type')).toBe('authorization_code')
  })

  it('throws on non-2xx', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
    }) as unknown as typeof fetch
    await expect(exchangeCode('bad')).rejects.toThrow(/400/)
  })
})

describe('refreshAccessToken', () => {
  it('POSTs refresh grant', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'at2',
        refresh_token: 'rt2',
        expires_in: 3600,
        user_id: 'u1',
      }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await refreshAccessToken('rt')
    expect(result.access_token).toBe('at2')
    const [, init] = fetchMock.mock.calls[0]
    const body = init.body as URLSearchParams
    expect(body.get('refresh_token')).toBe('rt')
    expect(body.get('grant_type')).toBe('refresh_token')
  })
})
