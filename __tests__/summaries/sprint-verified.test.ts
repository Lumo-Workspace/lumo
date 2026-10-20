import {
  isTaskVerified,
  verifiedAt,
  type VerifiedTaskInput,
} from '@/lib/summaries/sprint-verified'

const d = (s: string) => new Date(s)

function input(over: Partial<VerifiedTaskInput> = {}): VerifiedTaskInput {
  return {
    status: 'DONE',
    gateBlocking: 0,
    doneAt: d('2026-10-05T00:00:00Z'),
    testCases: [
      {
        verdict: 'PASS',
        freshness: 'fresh',
        latestRunAt: d('2026-10-06T00:00:00Z'),
      },
    ],
    ...over,
  }
}

describe('isTaskVerified', () => {
  it('is true for DONE + clear gate + every case fresh PASS', () => {
    expect(isTaskVerified(input())).toBe(true)
  })

  it.each([
    ['not DONE', { status: 'IN_REVIEW' }],
    ['gate blocked', { gateBlocking: 1 }],
    ['no test cases', { testCases: [] }],
  ])('is false when %s', (_label, over) => {
    expect(isTaskVerified(input(over as Partial<VerifiedTaskInput>))).toBe(
      false
    )
  })

  it.each([
    ['UNPROVEN', 'fresh'],
    ['NEVER_RUN', null],
    ['PASS', 'stale'],
    ['PASS', 'dirty'],
    ['PASS', 'unknown'],
  ] as const)(
    'is false for a case with verdict %s / %s',
    (verdict, freshness) => {
      expect(
        isTaskVerified(
          input({ testCases: [{ verdict, freshness, latestRunAt: null }] })
        )
      ).toBe(false)
    }
  )
})

describe('verifiedAt', () => {
  it('is the later of the DONE move and the newest latest run', () => {
    expect(verifiedAt(input())).toEqual(d('2026-10-06T00:00:00Z'))
    expect(verifiedAt(input({ doneAt: d('2026-10-09T00:00:00Z') }))).toEqual(
      d('2026-10-09T00:00:00Z')
    )
  })

  it('is null when the task is not verified', () => {
    expect(verifiedAt(input({ gateBlocking: 2 }))).toBeNull()
  })
})
