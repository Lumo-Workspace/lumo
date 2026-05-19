import { cliUpdateTaskSchema } from '@/lib/validation/schemas'

describe('cliUpdateTaskSchema', () => {
  it('accepts an empty patch (server enforces at-least-one-field elsewhere)', () => {
    const r = cliUpdateTaskSchema.safeParse({})
    expect(r.success).toBe(true)
  })

  it('accepts every supported field together', () => {
    const r = cliUpdateTaskSchema.safeParse({
      title: 'New title',
      description: 'Body',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assigneeRef: 'me',
    })
    expect(r.success).toBe(true)
  })

  it('accepts null for description and assigneeRef (clear)', () => {
    const r = cliUpdateTaskSchema.safeParse({
      description: null,
      assigneeRef: null,
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty title (server min(1))', () => {
    const r = cliUpdateTaskSchema.safeParse({ title: '   ' })
    expect(r.success).toBe(false)
  })

  it('rejects unknown status value', () => {
    const r = cliUpdateTaskSchema.safeParse({ status: 'DEFERRED' })
    expect(r.success).toBe(false)
  })

  it('rejects unknown priority value', () => {
    const r = cliUpdateTaskSchema.safeParse({ priority: 'P0' })
    expect(r.success).toBe(false)
  })

  it('rejects title over 500 chars', () => {
    const r = cliUpdateTaskSchema.safeParse({ title: 'x'.repeat(501) })
    expect(r.success).toBe(false)
  })
})
