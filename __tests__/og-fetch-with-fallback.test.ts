/** @jest-environment node */
jest.mock('@/lib/integrations/og-metadata/fetch', () => ({
  fetchOpenGraph: jest.fn(),
}))
jest.mock('@/lib/integrations/og-metadata/fetch-chromium', () => ({
  fetchOpenGraphChromium: jest.fn(),
}))

import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'
import { fetchOpenGraphChromium } from '@/lib/integrations/og-metadata/fetch-chromium'
import {
  normalizeUrl,
  fetchWithFallback,
} from '@/lib/integrations/og-metadata/fetch-with-fallback'

const ogMock = fetchOpenGraph as jest.Mock
const chromiumMock = fetchOpenGraphChromium as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('normalizeUrl', () => {
  it('trims and lower-cases the scheme/host, preserves path', () => {
    expect(normalizeUrl('  HTTPS://Example.com/Path  ')).toEqual({
      url: 'https://example.com/Path',
      domain: 'example.com',
    })
  })

  it('strips the fragment', () => {
    expect(normalizeUrl('https://example.com/path?x=1#frag')).toEqual({
      url: 'https://example.com/path?x=1',
      domain: 'example.com',
    })
  })
})

describe('fetchWithFallback', () => {
  it('returns the fast result when it succeeds', async () => {
    ogMock.mockResolvedValue({
      ok: true,
      data: { title: 't' },
      finalUrl: 'https://example.com/',
    })
    const result = await fetchWithFallback('https://example.com/')
    expect(result).toEqual({
      ok: true,
      data: { title: 't' },
      finalUrl: 'https://example.com/',
    })
    expect(chromiumMock).not.toHaveBeenCalled()
  })

  it('escalates to chromium on a block signal', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'http 403' })
    chromiumMock.mockResolvedValue({ ok: true, data: {}, finalUrl: 'x' })
    const result = await fetchWithFallback('https://example.com/')
    expect(chromiumMock).toHaveBeenCalledWith('https://example.com/')
    expect(result).toEqual({ ok: true, data: {}, finalUrl: 'x' })
  })

  it('does not escalate on a non-block-signal failure', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'http 404' })
    const result = await fetchWithFallback('https://example.com/')
    expect(chromiumMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'http 404' })
  })
})

describe('LUM-1025 fetchWithFallback without Chromium', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('keeps the plain fetch result instead of launching a browser', async () => {
    process.env.LUMO_OG_CHROMIUM = 'off'
    ogMock.mockResolvedValue({ ok: false, error: 'http 403' })
    const result = await fetchWithFallback('https://example.com/')
    expect(chromiumMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'http 403' })
  })
})
