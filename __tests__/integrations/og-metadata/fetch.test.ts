/** @jest-environment node */

jest.mock('@/lib/integrations/og-metadata/ssrf', () => ({
  assertExternalHost: jest.fn().mockResolvedValue(undefined),
}))

import { assertExternalHost } from '@/lib/integrations/og-metadata/ssrf'
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'

const ssrfMock = assertExternalHost as jest.Mock
const fetchMock = jest.fn()
;(global as any).fetch = fetchMock

beforeEach(() => {
  jest.clearAllMocks()
  ssrfMock.mockResolvedValue(undefined)
})

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

describe('fetchOpenGraph', () => {
  it('returns ok with parsed OG meta', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(
        '<html><head><meta property="og:title" content="Hi"></head></html>'
      )
    )
    const result = await fetchOpenGraph('https://example.com/')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.title).toBe('Hi')
  })

  it('returns not-ok on non-html content-type', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const result = await fetchOpenGraph('https://example.com/data.json')
    expect(result).toEqual({ ok: false, error: 'non-html content' })
  })

  it('returns not-ok on http error status', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    const result = await fetchOpenGraph('https://example.com/missing')
    expect(result).toEqual({ ok: false, error: 'http 404' })
  })

  it('returns not-ok when SSRF guard rejects', async () => {
    ssrfMock.mockRejectedValueOnce(new Error('host not allowed'))
    const result = await fetchOpenGraph('http://127.0.0.1/')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/host not allowed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns not-ok on timeout (AbortError)', async () => {
    fetchMock.mockImplementation(() => {
      const e = new Error('aborted')
      ;(e as any).name = 'AbortError'
      return Promise.reject(e)
    })
    const result = await fetchOpenGraph('https://example.com/slow')
    expect(result).toEqual({ ok: false, error: 'timeout' })
  })

  it('returns not-ok when body exceeds MAX_BODY_BYTES', async () => {
    // Body just over the 10 MB cap (raised from 3 MB; see constants.ts).
    const big = 'x'.repeat(11 * 1024 * 1024)
    fetchMock.mockResolvedValue(htmlResponse(big))
    const result = await fetchOpenGraph('https://example.com/big')
    expect(result).toEqual({ ok: false, error: 'body too large' })
  })

  it('returns not-ok with "empty extraction" when no title is parseable', async () => {
    // 200 + valid HTML content-type, but the body has no <title> / og:title /
    // twitter:title — common pattern for CF challenge pages and JS-only SPAs.
    // The service layer escalates this to Chromium.
    fetchMock.mockResolvedValue(
      htmlResponse('<html><body>no head here</body></html>')
    )
    const result = await fetchOpenGraph('https://example.com/empty')
    expect(result).toEqual({ ok: false, error: 'empty extraction' })
  })

  it('re-checks SSRF on each redirect hop', async () => {
    // First call returns a 302 to a private host; fetch handles that
    // because we set redirect: 'manual'. The fetcher must call
    // assertExternalHost again on the redirect target and refuse.
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://10.0.0.1/' },
      })
    )
    ssrfMock
      .mockResolvedValueOnce(undefined) // initial URL ok
      .mockRejectedValueOnce(new Error('host not allowed')) // redirect blocked
    const result = await fetchOpenGraph('https://example.com/redirect')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/host not allowed/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows up to MAX_REDIRECTS hops', async () => {
    // 5 redirects then a real response — must succeed.
    for (let i = 0; i < 5; i++) {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://example.com/hop${i + 1}` },
        })
      )
    }
    fetchMock.mockResolvedValueOnce(
      htmlResponse('<html><head><title>Final</title></head></html>')
    )
    const result = await fetchOpenGraph('https://example.com/start')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.title).toBe('Final')
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('fails on too many redirects', async () => {
    for (let i = 0; i < 10; i++) {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://example.com/hop${i + 1}` },
        })
      )
    }
    const result = await fetchOpenGraph('https://example.com/loop')
    expect(result).toEqual({ ok: false, error: 'too many redirects' })
  })

  it('returns not-ok when redirect Location is malformed', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://[malformed' },
      })
    )
    const result = await fetchOpenGraph('https://example.com/redirect')
    expect(result).toEqual({ ok: false, error: 'invalid redirect url' })
  })
})
