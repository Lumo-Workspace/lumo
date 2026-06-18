import { addDependencyBodySchema } from '@/lib/validation/schemas'

describe('addDependencyBodySchema direction', () => {
  it('defaults direction to BLOCKED_BY when omitted', () => {
    const parsed = addDependencyBodySchema.parse({ blockedBy: 'LUM-9' })
    expect(parsed.direction).toBe('BLOCKED_BY')
  })

  it('accepts BLOCKS', () => {
    const parsed = addDependencyBodySchema.parse({
      blockedBy: 'LUM-9',
      direction: 'BLOCKS',
    })
    expect(parsed.direction).toBe('BLOCKS')
  })

  it('rejects an unknown direction', () => {
    expect(() =>
      addDependencyBodySchema.parse({
        blockedBy: 'LUM-9',
        direction: 'SIDEWAYS',
      })
    ).toThrow()
  })
})
