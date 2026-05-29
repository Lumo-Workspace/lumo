import {
  createMemoryBodySchema,
  patchMemoryBodySchema,
} from '@/lib/validation/memory'

describe('createMemoryBodySchema', () => {
  it('accepts a valid category + arbitrary content', () => {
    const r = createMemoryBodySchema.safeParse({
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown category', () => {
    const r = createMemoryBodySchema.safeParse({
      category: 'NOPE',
      content: {},
    })
    expect(r.success).toBe(false)
  })

  it('rejects a missing content key', () => {
    const r = createMemoryBodySchema.safeParse({ category: 'TRAP' })
    expect(r.success).toBe(false)
  })
})

describe('patchMemoryBodySchema', () => {
  it('accepts content only', () => {
    expect(
      patchMemoryBodySchema.safeParse({ content: { rule: 'r', scope: 's' } })
        .success
    ).toBe(true)
  })

  it('accepts scope PROJECT only', () => {
    expect(patchMemoryBodySchema.safeParse({ scope: 'PROJECT' }).success).toBe(
      true
    )
  })

  it('accepts content + scope', () => {
    expect(
      patchMemoryBodySchema.safeParse({
        content: { rule: 'r', scope: 's' },
        scope: 'PROJECT',
      }).success
    ).toBe(true)
  })

  it('rejects an empty body (refine)', () => {
    expect(patchMemoryBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects scope TASK (only PROJECT promote allowed)', () => {
    expect(patchMemoryBodySchema.safeParse({ scope: 'TASK' }).success).toBe(
      false
    )
  })
})
