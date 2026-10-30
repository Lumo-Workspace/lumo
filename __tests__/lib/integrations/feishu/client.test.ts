/**
 * @jest-environment node
 *
 * LUM-1341 — an expired access token is refreshed (and the rotated pair
 * persisted); a refresh that can never succeed throws FeishuNeedsReauthError;
 * a transient refresh failure does not.
 */
import {
  createFeishuUserClient,
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
  it('classifies dead codes and 4xx as dead, 5xx as transient', () => {
    expect(isDeadRefreshError(new FeishuApiError('t', 400, 20037, ''))).toBe(
      true
    )
    expect(isDeadRefreshError(new FeishuApiError('t', 200, 20064, ''))).toBe(
      true
    )
    expect(isDeadRefreshError(new FeishuApiError('t', 400, 20002, ''))).toBe(
      true
    )
    expect(isDeadRefreshError(new FeishuApiError('t', 500, 20050, ''))).toBe(
      false
    )
    expect(isDeadRefreshError(new Error('network'))).toBe(false)
  })
})
