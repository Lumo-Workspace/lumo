/**
 * @jest-environment node
 *
 * LUM-1343 — getBinary: a file body is returned with its content type; a
 * JSON error envelope throws FeishuApiError; a rejected token is refreshed
 * and retried once, like get.
 */
import { createFeishuUserClient } from '@/lib/integrations/feishu/client'
import { FeishuApiError } from '@/lib/integrations/feishu/http'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

const NOW = 10_000_000
const APP = { appId: 'cli_x', appSecret: 'sec', domain: 'feishu' as const }
const png = () =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  })
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

function client(onTokensRefreshed = jest.fn()) {
  return createFeishuUserClient({
    app: APP,
    tokens: {
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresAt: new Date(NOW + 3_600_000),
      refreshExpiresAt: new Date(NOW + 86_400_000),
    },
    onTokensRefreshed,
    now: () => NOW,
  })
}

it('returns the bytes and content type', async () => {
  fetchMock.mockResolvedValueOnce(png())
  const out = await client().getBinary('/open-apis/drive/v1/medias/t/download')
  expect(out.contentType).toBe('image/png')
  expect(new Uint8Array(out.body)).toEqual(new Uint8Array([1, 2, 3]))
  expect(fetchMock).toHaveBeenCalledWith(
    'https://open.feishu.cn/open-apis/drive/v1/medias/t/download',
    expect.objectContaining({ headers: { Authorization: 'Bearer a1' } })
  )
})

it('a JSON error body throws FeishuApiError with its code', async () => {
  fetchMock.mockResolvedValueOnce(
    json(403, { code: 1770032, msg: 'forbidden' })
  )
  const err = await client()
    .getBinary('/open-apis/drive/v1/medias/t/download')
    .catch(e => e)
  expect(err).toBeInstanceOf(FeishuApiError)
  expect(err).toMatchObject({ httpStatus: 403, code: 1770032 })
})

it('refreshes a rejected token and retries once', async () => {
  const onTokensRefreshed = jest.fn()
  fetchMock
    .mockResolvedValueOnce(json(401, { code: 99991677, msg: 'expired' }))
    .mockResolvedValueOnce(
      json(200, {
        code: 0,
        access_token: 'a2',
        expires_in: 7200,
        refresh_token: 'r2',
        refresh_token_expires_in: 604800,
      })
    )
    .mockResolvedValueOnce(png())
  const out = await client(onTokensRefreshed).getBinary(
    '/open-apis/drive/v1/medias/t/download'
  )
  expect(out.contentType).toBe('image/png')
  expect(onTokensRefreshed).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[2][1]).toMatchObject({
    headers: { Authorization: 'Bearer a2' },
  })
})
