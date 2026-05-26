import { extractTasksSchema } from '@/lib/validation/extract-tasks.schema'

describe('extractTasksSchema', () => {
  it('accepts marked selector', () => {
    const r = extractTasksSchema.safeParse({
      content: '<p>hi</p>',
      selector: { type: 'marked' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts all_unchecked selector', () => {
    const r = extractTasksSchema.safeParse({
      content: '<p>hi</p>',
      selector: { type: 'all_unchecked' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown selector', () => {
    const r = extractTasksSchema.safeParse({
      content: '<p>hi</p>',
      selector: { type: 'bogus' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty content', () => {
    const r = extractTasksSchema.safeParse({
      content: '',
      selector: { type: 'marked' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects content over 1MB', () => {
    const r = extractTasksSchema.safeParse({
      content: 'x'.repeat(1_048_577),
      selector: { type: 'marked' },
    })
    expect(r.success).toBe(false)
  })
})
