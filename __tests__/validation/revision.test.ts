import { createManualRevisionSchema } from '@/lib/validation/revision'

describe('createManualRevisionSchema', () => {
  it('accepts a trimmed non-empty label', () => {
    const r = createManualRevisionSchema.safeParse({ label: '  v1 review  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.label).toBe('v1 review')
  })

  it('rejects an empty label', () => {
    expect(createManualRevisionSchema.safeParse({ label: '   ' }).success).toBe(false)
  })

  it('rejects a label over 200 chars', () => {
    expect(
      createManualRevisionSchema.safeParse({ label: 'x'.repeat(201) }).success
    ).toBe(false)
  })
})
