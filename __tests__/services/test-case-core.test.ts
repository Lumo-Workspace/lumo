import { ceilingOf, resolveRunFields } from '@/lib/services/test-case-core'

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(),
    labelsByIds: jest.fn().mockResolvedValue(new Map()),
  },
}))

const testCase = {
  id: 'tc-1',
  taskId: null,
  milestoneId: 'm-1',
  number: 1,
  title: 'E2E',
  setup: null,
  steps: ['open PR', 'wait for review'],
  verification: ['comment posted'],
  expected: 'ok',
  requiredEnvironment: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}

describe('resolveRunFields (owner-agnostic)', () => {
  it('requires an environment', () => {
    expect(() =>
      resolveRunFields(testCase, { result: 'PASS' } as never)
    ).toThrow(/environment is required/)
  })
  it('snapshots the failing step text for a milestone case', () => {
    const out = resolveRunFields(testCase, {
      result: 'FAIL',
      environment: 'PRODUCTION',
      failedPhase: 'STEPS',
      failedIndex: 1,
      failureAttribution: 'UNKNOWN',
    } as never)
    expect(out).toMatchObject({
      failedPhase: 'STEPS',
      failedIndex: 1,
      failedStepText: 'wait for review',
      failureAttribution: 'UNKNOWN',
    })
  })
  it('demands evidence for IMPLEMENTATION_DEFECT', () => {
    expect(() =>
      resolveRunFields(testCase, {
        result: 'FAIL',
        environment: 'LOCAL',
        failureAttribution: 'IMPLEMENTATION_DEFECT',
        evidence: [],
      } as never)
    ).toThrow(/needs at least one evidence entry/)
  })
})

describe('ceilingOf (LUM-1135)', () => {
  const runRow = (over: Record<string, unknown> = {}) =>
    ({
      result: 'PASS',
      environment: 'PRODUCTION',
      evidence: [{ type: 'link', url: 'https://x' }],
      ...over,
    }) as never

  it('a PASS with evidence in the required environment stays PASS', () => {
    expect(
      ceilingOf(runRow(), [], { requiredEnvironment: 'PRODUCTION' })
    ).toEqual({ effective: 'PASS' })
  })

  it('caps a PASS in the wrong environment at UNPROVEN', () => {
    expect(
      ceilingOf(runRow({ environment: 'LOCAL' }), [], {
        requiredEnvironment: 'PRODUCTION',
      })
    ).toMatchObject({ effective: 'UNPROVEN', reason: 'environment' })
  })

  it('passes the unproven verification list through', () => {
    const unproven = [{ index: 0, text: 'comment posted' }]
    expect(
      ceilingOf(runRow(), unproven, { requiredEnvironment: null })
    ).toEqual({
      effective: 'UNPROVEN',
      reason: 'unobserved',
      unobserved: unproven,
    })
  })

  it('counts evidence from the Json column (non-array = none)', () => {
    expect(
      ceilingOf(runRow({ evidence: null }), [], { requiredEnvironment: null })
    ).toEqual({ effective: 'UNPROVEN', reason: 'no-evidence' })
  })

  it('a FAIL is never capped', () => {
    expect(
      ceilingOf(runRow({ result: 'FAIL', evidence: [] }), [], {
        requiredEnvironment: 'PRODUCTION',
      })
    ).toEqual({ effective: 'FAIL' })
  })
})
