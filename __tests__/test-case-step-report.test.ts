/**
 * LUM-1011: 逐步报告的推导。红线：只有显式上报 PASS 的步骤才画成通过——
 * 没逐步记录的 run 不能因为这张表而看起来「全过了」。
 */
import {
  deriveStepReport,
  parseStepResults,
  priorPassedResults,
  type StepReportRun,
} from '@/lib/test-cases/step-report'

const testCase = {
  steps: ['open invoice', 'click Refund', 'click Issue refund'],
  verification: ['banner says Refunded to Visa', 'db method = card'],
}

const run = (over: Partial<StepReportRun> = {}): StepReportRun => ({
  result: 'FAIL',
  failedPhase: null,
  failedIndex: null,
  failedStepText: null,
  stepResults: [],
  unprovenVerification: [],
  ...over,
})

const states = (r: ReturnType<typeof deriveStepReport>) =>
  r.rows.map(x => `${x.phase === 'STEPS' ? 's' : 'v'}${x.index + 1}:${x.state}`)

describe('deriveStepReport', () => {
  it('with per-step results: passed, failed, then not reached', () => {
    const r = deriveStepReport(
      testCase,
      run({
        stepResults: [
          {
            phase: 'STEPS',
            index: 0,
            text: 'open invoice',
            status: 'PASS',
            durationMs: 1200,
            evidence: [],
          },
          {
            phase: 'STEPS',
            index: 1,
            text: 'click Refund',
            status: 'PASS',
            durationMs: null,
            evidence: [],
          },
          {
            phase: 'STEPS',
            index: 2,
            text: 'click Issue refund',
            status: 'PASS',
            durationMs: null,
            evidence: [2],
          },
          {
            phase: 'VERIFICATION',
            index: 0,
            text: 'banner says Refunded to Visa',
            status: 'FAIL',
            durationMs: 300,
            evidence: [],
          },
        ],
      })
    )
    expect(states(r)).toEqual([
      's1:passed',
      's2:passed',
      's3:passed',
      'v1:failed',
      'v2:notReached',
    ])
    expect(r.brokeAt).toEqual({
      phase: 'VERIFICATION',
      index: 0,
      text: 'banner says Refunded to Visa',
    })
    expect(r.passed).toBe(3)
    expect(r.total).toBe(5)
    expect(r.rows[0]!.durationMs).toBe(1200)
    expect(r.rows[2]!.evidence).toEqual([2])
  })

  it('without per-step results never draws a pass: steps before the failure are only "reached"', () => {
    const r = deriveStepReport(
      testCase,
      run({
        failedPhase: 'STEPS',
        failedIndex: 1,
        failedStepText: 'click Refund (old text)',
      })
    )
    expect(states(r)).toEqual([
      's1:reached',
      's2:failed',
      's3:notReached',
      'v1:notReached',
      'v2:notReached',
    ])
    expect(r.passed).toBe(0)
    expect(r.hasStepResults).toBe(false)
    // The failing row keeps the text snapshotted at verdict time.
    expect(r.rows[1]!.text).toBe('click Refund (old text)')
  })

  it('an unreported step before the failure is "reached", not passed, even when others were reported', () => {
    const r = deriveStepReport(
      testCase,
      run({
        stepResults: [
          {
            phase: 'STEPS',
            index: 0,
            text: 'open invoice',
            status: 'PASS',
            durationMs: null,
            evidence: [],
          },
          {
            phase: 'STEPS',
            index: 2,
            text: 'click Issue refund',
            status: 'FAIL',
            durationMs: null,
            evidence: [],
          },
        ],
      })
    )
    expect(states(r).slice(0, 3)).toEqual([
      's1:passed',
      's2:reached',
      's3:failed',
    ])
  })

  it('a PASS run without per-step results stays "unrecorded" everywhere', () => {
    const r = deriveStepReport(testCase, run({ result: 'PASS' }))
    expect(new Set(r.rows.map(x => x.state))).toEqual(new Set(['unrecorded']))
    expect(r.brokeAt).toBeNull()
  })

  it('marks an unobserved verification step on a PASS run', () => {
    const r = deriveStepReport(
      testCase,
      run({
        result: 'PASS',
        unprovenVerification: [{ index: 1, text: 'db method = card' }],
      })
    )
    expect(r.rows[4]!.state).toBe('unobserved')
  })

  it('a BLOCKED run reached nothing', () => {
    const r = deriveStepReport(testCase, run({ result: 'BLOCKED' }))
    expect(new Set(r.rows.map(x => x.state))).toEqual(new Set(['notReached']))
  })

  it('keeps a step the case no longer has, using the snapshotted text', () => {
    const r = deriveStepReport(
      { steps: ['only step'], verification: [] },
      run({
        failedPhase: 'STEPS',
        failedIndex: 2,
        failedStepText: 'removed later',
      })
    )
    expect(r.rows).toHaveLength(3)
    expect(r.rows[2]).toMatchObject({ state: 'failed', text: 'removed later' })
  })
})

describe('parseStepResults', () => {
  it('drops malformed entries rather than reading them as passes', () => {
    expect(
      parseStepResults([
        { phase: 'STEPS', index: 0, status: 'PASS' },
        { phase: 'STEPS', index: -1, status: 'PASS' },
        { phase: 'NOPE', index: 0, status: 'PASS' },
        { phase: 'STEPS', index: 1, status: 'MAYBE' },
        null,
      ])
    ).toEqual([
      {
        phase: 'STEPS',
        index: 0,
        text: '',
        status: 'PASS',
        reason: null,
        durationMs: null,
        evidence: [],
      },
    ])
    expect(parseStepResults('nope')).toEqual([])
  })
})

describe('priorPassedResults', () => {
  it('passes every step before a failing verification check, then fails it', () => {
    expect(
      priorPassedResults(testCase, { phase: 'VERIFICATION', index: 1 })
    ).toEqual([
      { phase: 'STEPS', index: 0, status: 'PASS' },
      { phase: 'STEPS', index: 1, status: 'PASS' },
      { phase: 'STEPS', index: 2, status: 'PASS' },
      { phase: 'VERIFICATION', index: 0, status: 'PASS' },
      { phase: 'VERIFICATION', index: 1, status: 'FAIL' },
    ])
  })

  it('only covers earlier steps when a step fails', () => {
    expect(priorPassedResults(testCase, { phase: 'STEPS', index: 1 })).toEqual([
      { phase: 'STEPS', index: 0, status: 'PASS' },
      { phase: 'STEPS', index: 1, status: 'FAIL' },
    ])
  })
})

describe('backfilled step results (20261020090000_lum1011_backfill_step_results)', () => {
  // 迁移写入的形状原样搬过来：多一个 backfilled 键，durationMs 为 null。
  const entry = (
    phase: 'STEPS' | 'VERIFICATION',
    index: number,
    status: 'PASS' | 'FAIL'
  ) => ({
    phase,
    index,
    text: (phase === 'STEPS' ? testCase.steps : testCase.verification)[index],
    status,
    durationMs: null,
    evidence: [],
    backfilled: true,
  })

  it('a backfilled PASS run reads as every step passed', () => {
    const r = deriveStepReport(
      testCase,
      run({
        result: 'PASS',
        stepResults: [
          entry('STEPS', 0, 'PASS'),
          entry('STEPS', 1, 'PASS'),
          entry('STEPS', 2, 'PASS'),
          entry('VERIFICATION', 0, 'PASS'),
          entry('VERIFICATION', 1, 'PASS'),
        ],
      })
    )
    expect(r.passed).toBe(5)
    expect(r.total).toBe(5)
    expect(r.hasStepResults).toBe(true)
  })

  it('a backfilled FAIL run reads as passed up to the break, then not reached', () => {
    const r = deriveStepReport(
      testCase,
      run({
        failedPhase: 'STEPS',
        failedIndex: 1,
        failedStepText: 'click Refund',
        stepResults: [entry('STEPS', 0, 'PASS'), entry('STEPS', 1, 'FAIL')],
      })
    )
    expect(states(r)).toEqual([
      's1:passed',
      's2:failed',
      's3:notReached',
      'v1:notReached',
      'v2:notReached',
    ])
  })
})

describe('SKIP (LUM-1211)', () => {
  const tc = { steps: ['open page', 'call API'], verification: ['refresh'] }
  const base = {
    result: 'PASS' as const,
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    unprovenVerification: [],
  }

  it('parses a SKIP entry with its reason', () => {
    expect(
      parseStepResults([
        {
          phase: 'STEPS',
          index: 1,
          text: 'call API',
          status: 'SKIP',
          reason: 'no real DB',
        },
      ])
    ).toEqual([
      {
        phase: 'STEPS',
        index: 1,
        text: 'call API',
        status: 'SKIP',
        reason: 'no real DB',
        durationMs: null,
        evidence: [],
      },
    ])
  })

  it('renders a skipped step as skipped, never passed', () => {
    const report = deriveStepReport(tc, {
      ...base,
      stepResults: [
        { phase: 'STEPS', index: 0, text: 'open page', status: 'PASS' },
        {
          phase: 'STEPS',
          index: 1,
          text: 'call API',
          status: 'SKIP',
          reason: 'no real DB',
        },
        { phase: 'VERIFICATION', index: 0, text: 'refresh', status: 'PASS' },
      ],
    })
    expect(report.rows.map(r => r.state)).toEqual([
      'passed',
      'skipped',
      'passed',
    ])
    expect(report.rows[1]!.reason).toBe('no real DB')
    expect(report.passed).toBe(2)
  })

  it('drops a SKIP entry that has no reason (malformed Json reads as absent)', () => {
    expect(
      parseStepResults([
        { phase: 'STEPS', index: 0, text: 'x', status: 'SKIP' },
      ])
    ).toEqual([])
  })
})
