import {
  evaluateMilestoneGate,
  countHeld,
  type MilestoneGateCaseInput,
} from '@/lib/test-cases/milestone-gate'

const base = { number: 1, title: 'E2E' }
function run(over: Partial<NonNullable<MilestoneGateCaseInput['latestRun']>>) {
  return {
    result: 'PASS' as const,
    failureAttribution: null,
    evidenceCount: 1,
    disposition: null,
    ceiling: 'PASS' as const,
    ...over,
  }
}

describe('evaluateMilestoneGate (positive proof)', () => {
  it('holds a case that never ran', () => {
    const [c] = evaluateMilestoneGate([{ ...base, latestRun: null }])
    expect(c).toMatchObject({ state: 'held', reason: 'NOT_RUN' })
  })
  it('opens on PASS', () => {
    const [c] = evaluateMilestoneGate([{ ...base, latestRun: run({}) }])
    expect(c).toMatchObject({
      state: 'open',
      reason: null,
      unprovenPass: false,
    })
  })
  it('opens on an UNPROVEN pass but flags it', () => {
    const [c] = evaluateMilestoneGate([
      { ...base, latestRun: run({ ceiling: 'UNPROVEN', evidenceCount: 0 }) },
    ])
    expect(c).toMatchObject({ state: 'open', unprovenPass: true })
  })
  it('holds an undispositioned proven defect', () => {
    const [c] = evaluateMilestoneGate([
      {
        ...base,
        latestRun: run({
          result: 'FAIL',
          ceiling: 'FAIL',
          failureAttribution: 'IMPLEMENTATION_DEFECT',
        }),
      },
    ])
    expect(c).toMatchObject({ state: 'held', reason: 'PROVEN_DEFECT' })
  })
  it('opens a proven defect dispositioned KNOWN_DEFECT', () => {
    const [c] = evaluateMilestoneGate([
      {
        ...base,
        latestRun: run({
          result: 'FAIL',
          ceiling: 'FAIL',
          failureAttribution: 'IMPLEMENTATION_DEFECT',
          disposition: 'KNOWN_DEFECT',
        }),
      },
    ])
    expect(c).toMatchObject({ state: 'open', reason: null })
  })
  it('still holds a proven defect dispositioned NOT_A_DEFECT', () => {
    const [c] = evaluateMilestoneGate([
      {
        ...base,
        latestRun: run({
          result: 'FAIL',
          ceiling: 'FAIL',
          failureAttribution: 'IMPLEMENTATION_DEFECT',
          disposition: 'NOT_A_DEFECT',
        }),
      },
    ])
    expect(c).toMatchObject({ state: 'held', reason: 'FAILING' })
  })
  it.each(['CASE_OUTDATED', 'EXTERNAL_BLOCK', 'UNKNOWN'])(
    'holds a FAIL attributed %s',
    attribution => {
      const [c] = evaluateMilestoneGate([
        {
          ...base,
          latestRun: run({
            result: 'FAIL',
            ceiling: 'FAIL',
            failureAttribution: attribution,
          }),
        },
      ])
      expect(c).toMatchObject({ state: 'held', reason: 'FAILING' })
    }
  )
  it('holds an IMPLEMENTATION_DEFECT without evidence as FAILING, not PROVEN_DEFECT', () => {
    const [c] = evaluateMilestoneGate([
      {
        ...base,
        latestRun: run({
          result: 'FAIL',
          ceiling: 'FAIL',
          failureAttribution: 'IMPLEMENTATION_DEFECT',
          evidenceCount: 0,
        }),
      },
    ])
    expect(c).toMatchObject({ state: 'held', reason: 'FAILING' })
  })
  it('holds BLOCKED', () => {
    const [c] = evaluateMilestoneGate([
      { ...base, latestRun: run({ result: 'BLOCKED', ceiling: 'BLOCKED' }) },
    ])
    expect(c).toMatchObject({ state: 'held', reason: 'BLOCKED' })
  })
  it('empty contract → nothing held', () => {
    expect(countHeld(evaluateMilestoneGate([]))).toBe(0)
  })
  it('counts held cases', () => {
    const cases = evaluateMilestoneGate([
      { ...base, latestRun: null },
      { ...base, number: 2, latestRun: run({}) },
      {
        ...base,
        number: 3,
        latestRun: run({ result: 'BLOCKED', ceiling: 'BLOCKED' }),
      },
    ])
    expect(countHeld(cases)).toBe(2)
  })
})
