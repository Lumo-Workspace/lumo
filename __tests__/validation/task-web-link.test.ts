import { createWebLinkBodySchema } from '@/lib/validation/task-web-link'

describe('createWebLinkBodySchema', () => {
  it('accepts a bare url', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'https://example.com',
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown `note` field', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'https://example.com',
      note: 'should not be accepted',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid http URL', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'http://example.com/',
    })
    expect(result.success).toBe(true)
  })

  it('rejects javascript: scheme', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'javascript:alert(1)',
    })
    expect(result.success).toBe(false)
  })

  it('rejects data: scheme', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'data:text/plain,abc',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-http/https urls', () => {
    const result = createWebLinkBodySchema.safeParse({
      url: 'ftp://example.com',
    })
    expect(result.success).toBe(false)
  })

  it('rejects malformed URL', () => {
    const result = createWebLinkBodySchema.safeParse({ url: 'not-a-url' })
    expect(result.success).toBe(false)
  })

  it('rejects URLs longer than 2048', () => {
    const long = 'https://example.com/' + 'a'.repeat(2100)
    const result = createWebLinkBodySchema.safeParse({ url: long })
    expect(result.success).toBe(false)
  })
})
