import {
  criteriaSetItemSchema,
  criteriaSetBodySchema,
} from '../../../lib/validation/acceptance'

const base = {
  statement: 'x',
  verifierType: 'MACHINE' as const,
  checkpointer: 'npx jest x',
}

describe('referentKind is optional and derived (LUM-733)', () => {
  it('accepts a criteria item with no referentKind', () => {
    const r = criteriaSetItemSchema.safeParse(base)
    expect(r.success).toBe(true)
  })
  it('still accepts an advisory EXTERNAL_FACT / AGENT_CONSTRUCTED_STATE declaration', () => {
    for (const referentKind of ['EXTERNAL_FACT', 'AGENT_CONSTRUCTED_STATE']) {
      const r = criteriaSetItemSchema.safeParse({ ...base, referentKind })
      expect(r.success).toBe(true)
    }
  })
  it('rejects UNVERIFIED_ASSERTION as a declared value (falsifier-only)', () => {
    const r = criteriaSetItemSchema.safeParse({
      ...base,
      referentKind: 'UNVERIFIED_ASSERTION',
    })
    expect(r.success).toBe(false)
  })
  it('rejects PENDING_OUTCOME on a task criterion (no longer a task-criterion kind)', () => {
    const r = criteriaSetBodySchema.safeParse({
      source: 'AGENT_DRAFT',
      criteria: [
        {
          statement: 'later',
          verifierType: 'HUMAN',
          referentKind: 'PENDING_OUTCOME',
        },
      ],
    })
    expect(r.success).toBe(false)
  })
})
