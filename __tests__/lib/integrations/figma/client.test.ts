import {
  createFigmaClient,
  FigmaNeedsReauthError,
} from '@/lib/integrations/figma/client'

interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

function makeTokens(overrides: Partial<Tokens> = {}): Tokens {
  return {
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  }
}

describe('FigmaClient.getFile', () => {
  it('calls /v1/files/:key with Bearer token', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ name: 'My File', document: { children: [] } }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const client = createFigmaClient({
      tokens: makeTokens(),
      onTokensRefreshed: jest.fn(),
    })
    const file = await client.getFile('abc123')

    expect(file.name).toBe('My File')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.figma.com/v1/files/abc123?depth=1')
    expect(init.headers.Authorization).toBe('Bearer at')
  })
})

describe('FigmaClient refresh behavior', () => {
  it('refreshes token preemptively when expired', async () => {
    const refreshFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'at2',
        refresh_token: 'rt2',
        expires_in: 3600,
        user_id: 'u1',
      }),
    })
    const apiFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ name: 'F', document: { children: [] } }),
    })
    global.fetch = jest
      .fn()
      .mockImplementationOnce(refreshFetch)
      .mockImplementationOnce(apiFetch) as unknown as typeof fetch
    process.env.FIGMA_OAUTH_CLIENT_ID = 'cid'
    process.env.FIGMA_OAUTH_CLIENT_SECRET = 'sec'

    const onRefreshed = jest.fn()
    const client = createFigmaClient({
      tokens: makeTokens({ expiresAt: new Date(Date.now() - 1000) }),
      onTokensRefreshed: onRefreshed,
    })
    await client.getFile('abc')
    expect(onRefreshed).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'at2' })
    )
  })

  it('throws FigmaNeedsReauthError after refresh+retry both 401', async () => {
    process.env.FIGMA_OAUTH_CLIENT_ID = 'cid'
    process.env.FIGMA_OAUTH_CLIENT_SECRET = 'sec'
    global.fetch = jest
      .fn()
      // first call: 401
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => '' })
      // refresh call: 200
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'at2',
          refresh_token: 'rt2',
          expires_in: 3600,
          user_id: 'u1',
        }),
      })
      // retry call: still 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '',
      }) as unknown as typeof fetch

    const client = createFigmaClient({
      tokens: makeTokens(),
      onTokensRefreshed: jest.fn(),
    })
    await expect(client.getFile('abc')).rejects.toBeInstanceOf(
      FigmaNeedsReauthError
    )
  })
})
