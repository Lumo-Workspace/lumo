import { ceilingOf, resolveRunFields } from '@/lib/services/test-case-core'
import { allPass, passUntilFail } from '../helpers/step-results'

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
      stepResults: passUntilFail(testCase, { phase: 'STEPS', index: 1 }),
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
        stepResults: passUntilFail(testCase, { phase: 'STEPS', index: 0 }),
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

describe('per-step coverage (LUM-1211)', () => {
  const pass = (over: Record<string, unknown> = {}) =>
    resolveRunFields(testCase, {
      result: 'PASS',
      environment: 'LOCAL',
      evidence: [],
      ...over,
    } as never)

  it('rejects a PASS that reports no steps, listing what is missing', () => {
    expect(() => pass()).toThrow(/Missing per-step results: s1, s2, v1/)
  })

  it('lists missing items and a copyable fix', () => {
    expect(() =>
      pass({ stepResults: [{ phase: 'STEPS', index: 0, status: 'PASS' }] })
    ).toThrow(
      /s2, v1[\s\S]*--step s2=pass --step v1=pass[\s\S]*update the lumo CLI/
    )
  })

  it('accepts a fully reported PASS', () => {
    expect(pass({ stepResults: allPass(testCase) }).stepResults).toHaveLength(3)
  })

  it('accepts SKIP with a reason and snapshots it', () => {
    const out = pass({
      stepResults: [
        { phase: 'STEPS', index: 0, status: 'PASS' },
        {
          phase: 'STEPS',
          index: 1,
          status: 'SKIP',
          reason: 'no reviewer bot locally',
        },
        { phase: 'VERIFICATION', index: 0, status: 'PASS' },
      ],
    })
    expect(out.stepResults[1]).toMatchObject({
      status: 'SKIP',
      reason: 'no reviewer bot locally',
      text: 'wait for review',
    })
  })

  it('rejects SKIP without a reason', () => {
    expect(() =>
      pass({
        stepResults: [
          { phase: 'STEPS', index: 0, status: 'PASS' },
          { phase: 'STEPS', index: 1, status: 'SKIP' },
          { phase: 'VERIFICATION', index: 0, status: 'PASS' },
        ],
      })
    ).toThrow(/SKIP needs a reason/)
  })

  it('rejects a reason on a non-SKIP step', () => {
    expect(() =>
      pass({
        stepResults: allPass(testCase).map(e =>
          e.index === 0 && e.phase === 'STEPS' ? { ...e, reason: 'x' } : e
        ),
      })
    ).toThrow(/Only a SKIP step carries a reason/)
  })

  it('unprovenVerification counts as reported', () => {
    expect(
      pass({
        unprovenVerification: [0],
        stepResults: allPass({ steps: testCase.steps, verification: [] }),
      }).stepResults
    ).toHaveLength(2)
  })

  it('a case with no steps needs no step results', () => {
    const empty = { ...testCase, steps: [], verification: [] }
    expect(
      resolveRunFields(empty, {
        result: 'PASS',
        environment: 'LOCAL',
        evidence: [],
      } as never).stepResults
    ).toEqual([])
  })

  it('FAIL must report every item before the break', () => {
    expect(() =>
      resolveRunFields(testCase, {
        result: 'FAIL',
        environment: 'LOCAL',
        failureAttribution: 'UNKNOWN',
        failedPhase: 'VERIFICATION',
        failedIndex: 0,
      } as never)
    ).toThrow(/Missing per-step results: s1, s2/)
  })

  it('FAIL must name a failing step', () => {
    expect(() =>
      resolveRunFields(testCase, {
        result: 'FAIL',
        environment: 'LOCAL',
        failureAttribution: 'UNKNOWN',
        stepResults: [{ phase: 'STEPS', index: 0, status: 'PASS' }],
      } as never)
    ).toThrow(/A FAIL run must report the step it broke at/)
  })

  it('accepts a FAIL reported up to the break', () => {
    const out = resolveRunFields(testCase, {
      result: 'FAIL',
      environment: 'LOCAL',
      failureAttribution: 'UNKNOWN',
      stepResults: passUntilFail(testCase, { phase: 'STEPS', index: 1 }),
    } as never)
    expect(out).toMatchObject({ failedPhase: 'STEPS', failedIndex: 1 })
  })

  it('BLOCKED still needs no step results', () => {
    expect(
      resolveRunFields(testCase, {
        result: 'BLOCKED',
        environment: 'LOCAL',
      } as never).stepResults
    ).toEqual([])
  })
})
