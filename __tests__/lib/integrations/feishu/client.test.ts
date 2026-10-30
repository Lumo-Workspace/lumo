/**
 * @jest-environment node
 *
 * LUM-1341 — an expired access token is refreshed (and the rotated pair
 * persisted); a refresh that can never succeed throws FeishuNeedsReauthError;
 * a transient refresh failure does not.
 */
import {
  createFeishuUserClient,
  FEISHU_DEAD_REFRESH_CODES,
  FEISHU_RATE_LIMIT_CODES,
  FeishuNeedsReauthError,
  isDeadRefreshError,
  type FeishuClientTokens,
} from '@/lib/integrations/feishu/client'
import { FeishuApiError } from '@/lib/integrations/feishu/http'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

const APP = { appId: 'cli_x', appSecret: 'sec', domain: 'feishu' as const }
const NOW = 10_000_000
const TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token'

function tokens(over: Partial<FeishuClientTokens> = {}): FeishuClientTokens {
  return {
    accessToken: 'a1',
    refreshToken: 'r1',
    expiresAt: new Date(NOW + 3_600_000),
    refreshExpiresAt: new Date(NOW + 86_400_000),
    ...over,
  }
}

const refreshed = () =>
  json(200, {
    code: 0,
    access_token: 'a2',
    expires_in: 7200,
    refresh_token: 'r2',
    refresh_token_expires_in: 604800,
  })

function client(t: FeishuClientTokens, onTokensRefreshed = jest.fn()) {
  return {
    onTokensRefreshed,
    c: createFeishuUserClient({
      app: APP,
      tokens: t,
      onTokensRefreshed,
      now: () => NOW,
    }),
  }
}

describe('createFeishuUserClient', () => {
  it('uses a fresh token as is', async () => {
    fetchMock.mockResolvedValue(json(200, { code: 0, data: { ok: true } }))
    const { c, onTokensRefreshed } = client(tokens())
    await expect(c.get('/open-apis/x')).resolves.toEqual({
      code: 0,
      data: { ok: true },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer a1')
    expect(onTokensRefreshed).not.toHaveBeenCalled()
  })

  it('refreshes an expired token first and persists the rotated pair', async () => {
    fetchMock
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(json(200, { code: 0 }))
    const { c, onTokensRefreshed } = client(
      tokens({ expiresAt: new Date(NOW - 1) })
    )
    await c.get('/open-apis/x')
    expect(fetchMock.mock.calls[0][0]).toBe(TOKEN_URL)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).refresh_token).toBe('r1')
    expect(onTokensRefreshed).toHaveBeenCalledWith({
      accessToken: 'a2',
      refreshToken: 'r2',
      expiresAt: new Date(NOW + 7_200_000),
      refreshExpiresAt: new Date(NOW + 604_800_000),
    })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer a2')
  })

  it('refreshes once and retries when Feishu rejects the token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(400, { code: 99991677, msg: 'token expire' }))
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(json(200, { code: 0, data: 1 }))
    const { c, onTokensRefreshed } = client(tokens())
    await expect(c.get('/open-apis/x')).resolves.toEqual({ code: 0, data: 1 })
    expect(onTokensRefreshed).toHaveBeenCalledTimes(1)
  })

  it('throws FeishuNeedsReauthError when the refresh token is dead', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { code: 20073, error: 'invalid_grant' })
    )
    const { c, onTokensRefreshed } = client(
      tokens({ expiresAt: new Date(NOW - 1) })
    )
    await expect(c.get('/open-apis/x')).rejects.toBeInstanceOf(
      FeishuNeedsReauthError
    )
    expect(onTokensRefreshed).not.toHaveBeenCalled()
  })

  it('throws FeishuNeedsReauthError without calling Feishu once the refresh token expired', async () => {
    const { c } = client(
      tokens({
        expiresAt: new Date(NOW - 1),
        refreshExpiresAt: new Date(NOW - 1),
      })
    )
    await expect(c.get('/open-apis/x')).rejects.toBeInstanceOf(
      FeishuNeedsReauthError
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a transient refresh failure transient (no reauth)', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { code: 20072 }))
    const { c } = client(tokens({ expiresAt: new Date(NOW - 1) }))
    const err = await c.get('/open-apis/x').catch(e => e)
    expect(err).toBeInstanceOf(FeishuApiError)
    expect(err).not.toBeInstanceOf(FeishuNeedsReauthError)
  })

  it('needs reauth when a refresh no longer returns a refresh token', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { code: 0, access_token: 'a2', expires_in: 7200 })
    )
    const { c } = client(tokens({ expiresAt: new Date(NOW - 1) }))
    await expect(c.get('/open-apis/x')).rejects.toBeInstanceOf(
      FeishuNeedsReauthError
    )
  })

  it('needs reauth when even the refreshed token is rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 99991668 }))
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(json(401, { code: 99991668 }))
    const { c } = client(tokens())
    await expect(c.get('/open-apis/x')).rejects.toBeInstanceOf(
      FeishuNeedsReauthError
    )
  })

  it('passes other API errors through without refreshing', async () => {
    fetchMock.mockResolvedValueOnce(
      json(403, { code: 1770032, msg: 'forbidden' })
    )
    const { c, onTokensRefreshed } = client(tokens())
    await expect(c.get('/open-apis/x')).rejects.toMatchObject({ code: 1770032 })
    expect(onTokensRefreshed).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('isDeadRefreshError', () => {
  const err = (status: number, code: number | null) =>
    new FeishuApiError('oauth/token', status, code, '')

  it('keeps the known dead refresh codes dead', () => {
    for (const code of FEISHU_DEAD_REFRESH_CODES) {
      expect(isDeadRefreshError(err(400, code))).toBe(true)
    }
    // The code decides, whatever HTTP status it arrives with.
    expect(isDeadRefreshError(err(200, 20064))).toBe(true)
    expect(isDeadRefreshError(err(400, 20037))).toBe(true)
    expect(isDeadRefreshError(err(400, 20073))).toBe(true)
  })

  it('treats HTTP 429 and every Feishu rate-limit code as transient', () => {
    expect(isDeadRefreshError(err(429, null))).toBe(false)
    expect(isDeadRefreshError(err(429, 99991400))).toBe(false)
    for (const code of FEISHU_RATE_LIMIT_CODES) {
      expect(isDeadRefreshError(err(400, code))).toBe(false)
    }
  })

  it('does not make members reconnect for app-level or unknown 4xx', () => {
    // 20002 client secret, 20009 app not installed, 20048 app missing,
    // 20069 app disabled, 20074 refresh disabled: an operator fixes these.
    for (const code of [20002, 20009, 20048, 20069, 20074]) {
      expect(isDeadRefreshError(err(400, code))).toBe(false)
    }
    expect(isDeadRefreshError(err(400, null))).toBe(false)
    expect(isDeadRefreshError(err(400, 12345))).toBe(false)
  })

  it('treats 5xx, retry codes and non-API errors as transient', () => {
    expect(isDeadRefreshError(err(500, 20050))).toBe(false)
    expect(isDeadRefreshError(err(503, 20072))).toBe(false)
    expect(isDeadRefreshError(new Error('network'))).toBe(false)
  })
})

describe('refresh concurrency', () => {
  const expired = () => tokens({ expiresAt: new Date(NOW - 1) })
  const isRefresh = (url: string) => url === TOKEN_URL

  it('two concurrent get() on an expired token share exactly one refresh', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      isRefresh(url) ? refreshed() : json(200, { code: 0, data: url })
    )
    const { c, onTokensRefreshed } = client(expired())
    const [a, b] = await Promise.all([
      c.get('/open-apis/a'),
      c.get('/open-apis/b'),
    ])
    expect(a).toMatchObject({ code: 0 })
    expect(b).toMatchObject({ code: 0 })
    const refreshCalls = fetchMock.mock.calls.filter(([u]) => isRefresh(u))
    expect(refreshCalls).toHaveLength(1)
    expect(onTokensRefreshed).toHaveBeenCalledTimes(1)
    const apiAuth = fetchMock.mock.calls
      .filter(([u]) => !isRefresh(u))
      .map(([, init]) => init.headers.Authorization)
    expect(apiAuth).toEqual(['Bearer a2', 'Bearer a2'])
  })

  it('two concurrent get() both rejected share one refresh', async () => {
    let apiCalls = 0
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (isRefresh(url)) return refreshed()
      apiCalls++
      const auth = (init.headers as Record<string, string>).Authorization
      return auth === 'Bearer a1'
        ? json(400, { code: 99991677 })
        : json(200, { code: 0 })
    })
    const { c, onTokensRefreshed } = client(tokens())
    await Promise.all([c.get('/open-apis/a'), c.get('/open-apis/b')])
    expect(fetchMock.mock.calls.filter(([u]) => isRefresh(u))).toHaveLength(1)
    expect(onTokensRefreshed).toHaveBeenCalledTimes(1)
    expect(apiCalls).toBe(4)
  })

  it('a refresh that lost the race adopts the pair another client stored', async () => {
    fetchMock
      .mockResolvedValueOnce(json(400, { code: 20073, error: 'used' }))
      .mockResolvedValueOnce(json(200, { code: 0, data: 'ok' }))
    const reloadTokens = jest.fn().mockResolvedValue({
      accessToken: 'a-other',
      refreshToken: 'r-other',
      expiresAt: new Date(NOW + 7_200_000),
      refreshExpiresAt: new Date(NOW + 86_400_000),
    })
    const onTokensRefreshed = jest.fn()
    const c = createFeishuUserClient({
      app: APP,
      tokens: expired(),
      onTokensRefreshed,
      reloadTokens,
      now: () => NOW,
      sleep: async () => {},
    })
    await expect(c.get('/open-apis/x')).resolves.toEqual({
      code: 0,
      data: 'ok',
    })
    expect(reloadTokens).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer a-other'
    )
    expect(onTokensRefreshed).not.toHaveBeenCalled()
  })

  it('waits briefly for the winner to persist before giving up', async () => {
    fetchMock
      .mockResolvedValueOnce(json(400, { code: 20073 }))
      .mockResolvedValueOnce(json(200, { code: 0 }))
    const same = { ...expired() }
    const reloadTokens = jest
      .fn()
      .mockResolvedValueOnce(same) // winner has not written yet
      .mockResolvedValueOnce({
        ...same,
        accessToken: 'a-late',
        refreshToken: 'r-late',
        expiresAt: new Date(NOW + 7_200_000),
      })
    const sleep = jest.fn(async () => {})
    const c = createFeishuUserClient({
      app: APP,
      tokens: expired(),
      onTokensRefreshed: jest.fn(),
      reloadTokens,
      now: () => NOW,
      sleep,
    })
    await expect(c.get('/open-apis/x')).resolves.toEqual({ code: 0 })
    expect(reloadTokens).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('still needs reauth when nothing rotated the dead refresh token', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { code: 20073 }))
    const reloadTokens = jest.fn().mockResolvedValue(expired())
    const c = createFeishuUserClient({
      app: APP,
      tokens: expired(),
      onTokensRefreshed: jest.fn(),
      reloadTokens,
      now: () => NOW,
      sleep: async () => {},
    })
    await expect(c.get('/open-apis/x')).rejects.toBeInstanceOf(
      FeishuNeedsReauthError
    )
    expect(reloadTokens).toHaveBeenCalledTimes(3)
  })

  it('a rate-limited refresh neither reloads nor needs reauth', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { code: 99991400 }))
    const reloadTokens = jest.fn()
    const c = createFeishuUserClient({
      app: APP,
      tokens: expired(),
      onTokensRefreshed: jest.fn(),
      reloadTokens,
      now: () => NOW,
    })
    const error = await c.get('/open-apis/x').catch(e => e)
    expect(error).toBeInstanceOf(FeishuApiError)
    expect(error).not.toBeInstanceOf(FeishuNeedsReauthError)
    expect(reloadTokens).not.toHaveBeenCalled()
  })
})
