/** @jest-environment node */
import { getClientIp } from '@/lib/api/client-ip'

function h(init: Record<string, string>): Headers {
  return new Headers(init)
}

describe('getClientIp (LUM-983)', () => {
  it('takes the first x-forwarded-for hop, trimmed', () => {
    expect(
      getClientIp(h({ 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1' }))
    ).toBe('203.0.113.9')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent or empty', () => {
    expect(getClientIp(h({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(
      getClientIp(h({ 'x-forwarded-for': ' ', 'x-real-ip': '198.51.100.5' }))
    ).toBe('198.51.100.5')
  })

  it('returns "unknown" when neither header is present', () => {
    expect(getClientIp(h({}))).toBe('unknown')
  })
})
