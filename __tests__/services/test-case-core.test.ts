import { resolveRunFields } from '@/lib/services/test-case-core'

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
