/** @jest-environment node */
import {
  assertSafeApiUrl,
  hostMismatchWarning,
  resolveAuthedApiUrl,
  resolveApiUrl,
} from '@/cli/src/lib/api'

const ORIGINAL_ENV = process.env.LUMO_API_URL

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.LUMO_API_URL
  else process.env.LUMO_API_URL = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('assertSafeApiUrl', () => {
  it('allows https URLs', () => {
    expect(() => assertSafeApiUrl('https://www.uselumo.ai')).not.toThrow()
  })

  it('allows http for localhost', () => {
    expect(() => assertSafeApiUrl('http://localhost:3000')).not.toThrow()
  })

  it('allows http for 127.0.0.1', () => {
    expect(() => assertSafeApiUrl('http://127.0.0.1:3000')).not.toThrow()
  })

  it('allows http for IPv6 loopback [::1]', () => {
    expect(() => assertSafeApiUrl('http://[::1]:3000')).not.toThrow()
  })

  it('rejects http to a remote host', () => {
    expect(() => assertSafeApiUrl('http://evil.com')).toThrow(/https/)
  })

  it('rejects non-http(s) schemes like ftp', () => {
    expect(() => assertSafeApiUrl('ftp://evil.com')).toThrow()
  })

  it('rejects an unparseable URL', () => {
    expect(() => assertSafeApiUrl('not a url')).toThrow(/Invalid LUMO_API_URL/)
  })
})

describe('hostMismatchWarning', () => {
  it('returns null when hosts match', () => {
    expect(
      hostMismatchWarning('https://www.uselumo.ai/x', 'https://www.uselumo.ai')
    ).toBeNull()
  })

  it('is case-insensitive on hostname', () => {
    expect(
      hostMismatchWarning('https://WWW.Uselumo.AI', 'https://www.uselumo.ai')
    ).toBeNull()
  })

  it('returns a warning naming both hosts when they differ', () => {
    const msg = hostMismatchWarning('https://evil.com', 'https://www.uselumo.ai')
    expect(msg).toContain('evil.com')
    expect(msg).toContain('www.uselumo.ai')
  })
})

describe('resolveAuthedApiUrl', () => {
  it('falls back to creds.apiUrl when LUMO_API_URL is unset', () => {
    delete process.env.LUMO_API_URL
    expect(resolveAuthedApiUrl('https://www.uselumo.ai')).toBe(
      'https://www.uselumo.ai'
    )
  })

  it('prefers a valid LUMO_API_URL override over creds', () => {
    process.env.LUMO_API_URL = 'https://staging.uselumo.ai'
    expect(resolveAuthedApiUrl('https://www.uselumo.ai')).toBe(
      'https://staging.uselumo.ai'
    )
  })

  it('throws on an insecure LUMO_API_URL override', () => {
    process.env.LUMO_API_URL = 'http://evil.com'
    expect(() => resolveAuthedApiUrl('https://www.uselumo.ai')).toThrow(/https/)
  })

  it('routes the host-mismatch warning to a custom warn sink', () => {
    process.env.LUMO_API_URL = 'https://staging.uselumo.ai'
    const warn = jest.fn()
    resolveAuthedApiUrl('https://www.uselumo.ai', { warn })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('staging.uselumo.ai')
  })

  it('does not warn when the override host matches creds', () => {
    process.env.LUMO_API_URL = 'https://www.uselumo.ai/sub'
    const warn = jest.fn()
    resolveAuthedApiUrl('https://www.uselumo.ai', { warn })
    expect(warn).not.toHaveBeenCalled()
  })

  it('defaults the warn sink to console.error', () => {
    process.env.LUMO_API_URL = 'https://staging.uselumo.ai'
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    resolveAuthedApiUrl('https://www.uselumo.ai')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('resolveApiUrl', () => {
  it('returns the default when LUMO_API_URL is unset', () => {
    delete process.env.LUMO_API_URL
    expect(resolveApiUrl()).toBe('https://www.uselumo.ai')
  })

  it('returns a valid LUMO_API_URL override', () => {
    process.env.LUMO_API_URL = 'https://staging.uselumo.ai'
    expect(resolveApiUrl()).toBe('https://staging.uselumo.ai')
  })

  it('throws on an insecure LUMO_API_URL', () => {
    process.env.LUMO_API_URL = 'http://evil.com'
    expect(() => resolveApiUrl()).toThrow(/https/)
  })
})
