import {
  criteriaSetBodySchema,
  criteriaSetItemSchema,
  CRITERIA_SET_HARD_MAX,
} from '@/lib/validation/acceptance'

const machineItem = {
  statement: 'all new endpoints have route tests',
  verifierType: 'MACHINE',
  checkpointer: 'npx jest __tests__/api.tasks.criteria.route.test.ts',
  referentKind: 'AGENT_CONSTRUCTED_STATE',
}
const humanItem = {
  statement: 'the criteria section reads as part of the task statement',
  verifierType: 'HUMAN',
  referentKind: 'AGENT_CONSTRUCTED_STATE',
}

describe('criteriaSetItemSchema', () => {
  it('accepts MACHINE with checkpointer and HUMAN without', () => {
    expect(criteriaSetItemSchema.safeParse(machineItem).success).toBe(true)
    expect(criteriaSetItemSchema.safeParse(humanItem).success).toBe(true)
  })

  it('rejects a MACHINE criterion without a checkpointer (no silent demotion)', () => {
    const result = criteriaSetItemSchema.safeParse({
      statement: 's',
      verifierType: 'MACHINE',
      referentKind: 'AGENT_CONSTRUCTED_STATE',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]!.path).toEqual(['checkpointer'])
    }
  })

  it('rejects server-decided fields (source / addedAtRound) — strict shape', () => {
    expect(
      criteriaSetItemSchema.safeParse({ ...humanItem, source: 'HUMAN_EDIT' })
        .success
    ).toBe(false)
    expect(
      criteriaSetItemSchema.safeParse({ ...humanItem, addedAtRound: 1 }).success
    ).toBe(false)
  })
})

describe('criteriaSetBodySchema', () => {
  it('accepts an AGENT_DRAFT batch without ids', () => {
    const result = criteriaSetBodySchema.safeParse({
      source: 'AGENT_DRAFT',
      criteria: [machineItem, humanItem],
    })
    expect(result.success).toBe(true)
  })

  it('accepts AGENT_DRAFT items with an id (LUM-437: after-start edits use ids for identity-preserving diff)', () => {
    const result = criteriaSetBodySchema.safeParse({
      source: 'AGENT_DRAFT',
      criteria: [{ ...humanItem, id: 'c-1' }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts HUMAN_EDIT items with and without ids', () => {
    const result = criteriaSetBodySchema.safeParse({
      source: 'HUMAN_EDIT',
      criteria: [{ ...humanItem, id: 'c-1' }, machineItem],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty list and anything beyond the hard sanity ceiling', () => {
    expect(
      criteriaSetBodySchema.safeParse({ source: 'AGENT_DRAFT', criteria: [] })
        .success
    ).toBe(false)
    expect(
      criteriaSetBodySchema.safeParse({
        source: 'AGENT_DRAFT',
        criteria: Array.from(
          { length: CRITERIA_SET_HARD_MAX + 1 },
          () => humanItem
        ),
      }).success
    ).toBe(false)
  })

  it('rejects sources outside AGENT_DRAFT | HUMAN_EDIT (REVIEW_ADDED comes via the verify loop)', () => {
    expect(
      criteriaSetBodySchema.safeParse({
        source: 'REVIEW_ADDED',
        criteria: [humanItem],
      }).success
    ).toBe(false)
  })
})

describe('criteriaSetBodySchema AGENT_DRAFT ids (LUM-437)', () => {
  it('AGENT_DRAFT items may carry an id', () => {
    const r = criteriaSetBodySchema.safeParse({
      source: 'AGENT_DRAFT',
      criteria: [
        {
          id: 'abc',
          statement: 'x',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE',
        },
      ],
    })
    expect(r.success).toBe(true)
  })
  it('AGENT_DRAFT still rejects causeTag', () => {
    const r = criteriaSetBodySchema.safeParse({
      source: 'AGENT_DRAFT',
      criteria: [
        {
          statement: 'x',
          verifierType: 'HUMAN',
          referentKind: 'AGENT_CONSTRUCTED_STATE',
        },
      ],
      causeTag: 'NEW_INFO',
    })
    expect(r.success).toBe(false)
  })
})
