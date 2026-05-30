import {
  trapContentSchema,
  decisionContentSchema,
  conventionContentSchema,
  proceduralContentSchema,
  parseMemoryContent,
} from '@/lib/memory/schemas'

describe('trapContentSchema', () => {
  it('accepts trigger + outcome', () => {
    const result = trapContentSchema.safeParse({
      trigger: 'PostToolUse hook fires for both success and failure',
      outcome: 'Wasted half a day filtering server-side',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional workaround', () => {
    const result = trapContentSchema.safeParse({
      trigger: 'x',
      outcome: 'y',
      workaround: 'use PostToolUseFailure event instead',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing outcome', () => {
    const result = trapContentSchema.safeParse({ trigger: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects empty trigger', () => {
    const result = trapContentSchema.safeParse({ trigger: '', outcome: 'y' })
    expect(result.success).toBe(false)
  })

  it('accepts and retains optional summary', () => {
    const result = trapContentSchema.safeParse({
      trigger: 'x',
      outcome: 'y',
      summary: 'PostToolUse fires on failures too',
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.summary).toBe(
      'PostToolUse fires on failures too'
    )
  })

  it('rejects empty summary', () => {
    const result = trapContentSchema.safeParse({
      trigger: 'x',
      outcome: 'y',
      summary: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('decisionContentSchema', () => {
  it('accepts what + why', () => {
    const result = decisionContentSchema.safeParse({
      what: 'Use scope=PROJECT for cross-task conventions',
      why: 'Avoids replicating per-task; lives at the project scope',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing why', () => {
    const result = decisionContentSchema.safeParse({ what: 'x' })
    expect(result.success).toBe(false)
  })

  it('accepts and retains optional summary', () => {
    const result = decisionContentSchema.safeParse({
      what: 'x',
      why: 'y',
      summary: 'PROJECT scope for cross-task rules',
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.summary).toBe(
      'PROJECT scope for cross-task rules'
    )
  })
})

describe('conventionContentSchema', () => {
  it('accepts rule + scope', () => {
    const result = conventionContentSchema.safeParse({
      rule: 'Branch naming: lumo/{task-id}-{description}',
      scope: 'all repos',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty rule', () => {
    const result = conventionContentSchema.safeParse({ rule: '', scope: 's' })
    expect(result.success).toBe(false)
  })

  it('accepts and retains optional summary', () => {
    const result = conventionContentSchema.safeParse({
      rule: 'r',
      scope: 's',
      summary: 'Branch naming convention',
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.summary).toBe(
      'Branch naming convention'
    )
  })
})

describe('proceduralContentSchema', () => {
  it('accepts workflow + trigger', () => {
    const result = proceduralContentSchema.safeParse({
      workflow: 'verify plan against codebase',
      trigger: 'before executing-plans skill',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional steps array', () => {
    const result = proceduralContentSchema.safeParse({
      workflow: 'w',
      trigger: 't',
      steps: ['read schema', 'check enums', 'check relations'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty step in array', () => {
    const result = proceduralContentSchema.safeParse({
      workflow: 'w',
      trigger: 't',
      steps: ['ok', ''],
    })
    expect(result.success).toBe(false)
  })

  it('accepts and retains optional summary', () => {
    const result = proceduralContentSchema.safeParse({
      workflow: 'w',
      trigger: 't',
      summary: 'Add a Postgres enum value safely',
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.summary).toBe(
      'Add a Postgres enum value safely'
    )
  })
})

describe('parseMemoryContent', () => {
  it('routes TRAP to trap schema', () => {
    const out = parseMemoryContent('TRAP', { trigger: 't', outcome: 'o' })
    expect(out).toEqual({ trigger: 't', outcome: 'o' })
  })

  it('routes DECISION to decision schema', () => {
    const out = parseMemoryContent('DECISION', { what: 'w', why: 'y' })
    expect(out).toEqual({ what: 'w', why: 'y' })
  })

  it('throws on payload-category mismatch', () => {
    expect(() =>
      parseMemoryContent('CONVENTION', { what: 'w', why: 'y' })
    ).toThrow()
  })
})
