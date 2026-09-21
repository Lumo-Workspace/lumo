/**
 * LUM-801: test case 请求体的 Zod 校验。
 *
 * 这一层只管**字段级**约束（形状、长度、枚举成员）。跨字段一致性——非 FAIL 不得
 * 携带失败定位、failedIndex 必须落在该段数组范围内——依赖用例当前的数组长度，
 * 属业务规则，活在 task-test-case.service.ts。
 */
import {
  createTestCaseBodySchema,
  updateTestCaseBodySchema,
  recordRunBodySchema,
  MAX_STEPS,
  MAX_STEP_LEN,
} from '@/lib/validation/test-case'

const validCase = {
  title: 'Dashboard footer FDIC disclosure',
  setup: 'The user is on the Dashboard.',
  steps: ['scroll: to the bottom of the page'],
  verification: [],
  expected: 'The FDIC membership disclosure is visible.',
}

describe('createTestCaseBodySchema', () => {
  it('accepts a minimal valid case', () => {
    expect(createTestCaseBodySchema.safeParse(validCase).success).toBe(true)
  })

  it('rejects an empty steps array — a case with no steps is not a case', () => {
    expect(
      createTestCaseBodySchema.safeParse({ ...validCase, steps: [] }).success
    ).toBe(false)
  })

  it('accepts an empty verification array — not every case has a re-check', () => {
    expect(
      createTestCaseBodySchema.safeParse({ ...validCase, verification: [] })
        .success
    ).toBe(true)
  })

  it(`rejects more than ${MAX_STEPS} steps`, () => {
    const steps = Array.from({ length: MAX_STEPS + 1 }, (_, i) => `step ${i}`)
    expect(
      createTestCaseBodySchema.safeParse({ ...validCase, steps }).success
    ).toBe(false)
  })

  it(`rejects a step longer than ${MAX_STEP_LEN} chars`, () => {
    const steps = ['x'.repeat(MAX_STEP_LEN + 1)]
    expect(
      createTestCaseBodySchema.safeParse({ ...validCase, steps }).success
    ).toBe(false)
  })

  it('rejects a blank title', () => {
    expect(
      createTestCaseBodySchema.safeParse({ ...validCase, title: '   ' }).success
    ).toBe(false)
  })

  it('rejects a blank expected result', () => {
    expect(
      createTestCaseBodySchema.safeParse({ ...validCase, expected: '' }).success
    ).toBe(false)
  })
})

describe('updateTestCaseBodySchema', () => {
  it('accepts a single-field patch', () => {
    expect(updateTestCaseBodySchema.safeParse({ title: 'new' }).success).toBe(
      true
    )
  })

  it('rejects an empty patch', () => {
    expect(updateTestCaseBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('recordRunBodySchema', () => {
  it('rejects a run with no environment — there is no default', () => {
    expect(recordRunBodySchema.safeParse({ result: 'PASS' }).success).toBe(
      false
    )
  })

  it('accepts a PASS run with an environment', () => {
    expect(
      recordRunBodySchema.safeParse({ result: 'PASS', environment: 'LOCAL' })
        .success
    ).toBe(true)
  })

  it('rejects an unknown environment', () => {
    expect(
      recordRunBodySchema.safeParse({ result: 'PASS', environment: 'STAGING' })
        .success
    ).toBe(false)
  })

  it('does not silently default the environment when it is absent', () => {
    const parsed = recordRunBodySchema.safeParse({
      result: 'PASS',
      environment: 'PREVIEW',
    })
    expect(parsed.success && parsed.data.environment).toBe('PREVIEW')
  })

  it('accepts a FAIL run carrying a locator', () => {
    expect(
      recordRunBodySchema.safeParse({
        result: 'FAIL',
        environment: 'PRODUCTION',
        failedPhase: 'VERIFICATION',
        failedIndex: 0,
      }).success
    ).toBe(true)
  })

  it('rejects a negative failedIndex', () => {
    expect(
      recordRunBodySchema.safeParse({
        result: 'FAIL',
        environment: 'LOCAL',
        failedPhase: 'STEPS',
        failedIndex: -1,
      }).success
    ).toBe(false)
  })

  it('accepts a mixed evidence array of links and files', () => {
    expect(
      recordRunBodySchema.safeParse({
        result: 'FAIL',
        environment: 'LOCAL',
        evidence: [
          { type: 'link', url: 'https://example.com/run/1' },
          {
            type: 'file',
            url: 'https://blob.example/x.png',
            filename: 'x.png',
            contentType: 'image/png',
            size: 1234,
          },
        ],
      }).success
    ).toBe(true)
  })

  it('rejects a file evidence entry missing filename', () => {
    expect(
      recordRunBodySchema.safeParse({
        result: 'PASS',
        environment: 'LOCAL',
        evidence: [
          {
            type: 'file',
            url: 'https://blob.example/x.png',
            contentType: 'image/png',
            size: 1,
          },
        ],
      }).success
    ).toBe(false)
  })

  it('accepts a run carrying a PR number and commit sha', () => {
    expect(
      recordRunBodySchema.safeParse({
        result: 'PASS',
        environment: 'PREVIEW',
        pullRequestNumber: 123,
        commitSha: 'a1b2c3d',
        commitDirty: false,
      }).success
    ).toBe(true)
  })

  it('rejects a commitSha that is not hex', () => {
    expect(
      recordRunBodySchema.safeParse({
        result: 'PASS',
        environment: 'LOCAL',
        commitSha: 'not-a-sha',
      }).success
    ).toBe(false)
  })

  it('rejects a commitSha shorter than 7 chars', () => {
    expect(
      recordRunBodySchema.safeParse({
        result: 'PASS',
        environment: 'LOCAL',
        commitSha: 'a1b2',
      }).success
    ).toBe(false)
  })

  it('rejects a zero or negative PR number', () => {
    expect(
      recordRunBodySchema.safeParse({
        result: 'PASS',
        environment: 'LOCAL',
        pullRequestNumber: 0,
      }).success
    ).toBe(false)
  })
})
