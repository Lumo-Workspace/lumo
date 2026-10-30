/**
 * @jest-environment node
 */
import { FeishuApiError, feishuRequest } from '@/lib/integrations/feishu/http'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

describe('feishuRequest', () => {
  it('sends JSON with a bearer token and returns the body on code 0', async () => {
    fetchMock.mockResolvedValue(json(200, { code: 0, data: { a: 1 } }))
    await expect(
      feishuRequest(
        'https://open.feishu.cn/open-apis/x',
        { method: 'POST', token: 'tok', json: { k: 'v' } },
        'x'
      )
    ).resolves.toEqual({ code: 0, data: { a: 1 } })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json; charset=utf-8',
    })
    expect(init.body).toBe('{"k":"v"}')
  })

  it('throws FeishuApiError on a non-zero code even with HTTP 200', async () => {
    fetchMock.mockResolvedValue(json(200, { code: 99991668, msg: 'invalid' }))
    const err = await feishuRequest(
      'https://open.feishu.cn/x',
      { method: 'GET', token: 't' },
      'x'
    ).catch(e => e)
    expect(err).toBeInstanceOf(FeishuApiError)
    expect(err.code).toBe(99991668)
    expect(err.httpStatus).toBe(200)
  })

  it('throws on HTTP errors and never puts the token in the message', async () => {
    fetchMock.mockResolvedValue(
      json(400, { code: 20037, error: 'invalid_grant' })
    )
    const err = await feishuRequest(
      'https://open.feishu.cn/x',
      { method: 'GET', token: 'secret-token-value' },
      'oauth/token'
    ).catch(e => e)
    expect(err).toBeInstanceOf(FeishuApiError)
    expect(err.httpStatus).toBe(400)
    expect(err.code).toBe(20037)
    expect(err.message).not.toContain('secret-token-value')
  })

  it('treats a non-JSON error body as code null', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 503 }))
    const err = await feishuRequest(
      'https://open.feishu.cn/x',
      { method: 'GET' },
      'x'
    ).catch(e => e)
    expect(err.code).toBeNull()
    expect(err.httpStatus).toBe(503)
  })
})
