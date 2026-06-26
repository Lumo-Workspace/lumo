import {
  criteriaSetItemSchema,
  criteriaSetBodySchema,
} from '../../../lib/validation/acceptance'

const base = {
  statement: 'x',
  verifierType: 'MACHINE' as const,
  checkpointer: 'npx jest x',
}

describe('referentKind forced fill', () => {
  it('rejects a criteria item with no referentKind', () => {
    const r = criteriaSetItemSchema.safeParse(base)
    expect(r.success).toBe(false)
  })
  it('accepts a valid declarable referentKind', () => {
    const r = criteriaSetItemSchema.safeParse({
      ...base,
      referentKind: 'EXTERNAL_FACT',
    })
    expect(r.success).toBe(true)
  })
  it('rejects UNVERIFIED_ASSERTION as a declared value (falsifier-only)', () => {
    const r = criteriaSetItemSchema.safeParse({
      ...base,
      referentKind: 'UNVERIFIED_ASSERTION',
    })
    expect(r.success).toBe(false)
  })
  it('rejects a PENDING_OUTCOME criterion that still carries a MACHINE checkpointer', () => {
    const r = criteriaSetBodySchema.safeParse({
      source: 'AGENT_DRAFT',
      criteria: [
        {
          statement: 'later',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest x',
          referentKind: 'PENDING_OUTCOME',
        },
      ],
    })
    expect(r.success).toBe(false)
  })
})
