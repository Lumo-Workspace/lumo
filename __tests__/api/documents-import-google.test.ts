import { importGoogleSchema } from '@/lib/validation/document'

describe('importGoogleSchema', () => {
  it('requires a non-empty url', () => {
    expect(importGoogleSchema.safeParse({ url: '' }).success).toBe(false)
  })
  it('accepts a url with optional visibility', () => {
    const r = importGoogleSchema.safeParse({
      url: 'https://docs.google.com/document/d/x/edit',
      visibility: 'WORKSPACE',
    })
    expect(r.success).toBe(true)
  })
  it('rejects an unknown visibility', () => {
    expect(
      importGoogleSchema.safeParse({ url: 'x', visibility: 'BOGUS' }).success
    ).toBe(false)
  })
})
