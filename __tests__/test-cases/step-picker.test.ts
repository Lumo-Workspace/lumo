import { pickerToStepResults } from '@/lib/test-cases/step-picker'

const steps = ['a', 'b']
const verification = ['v']

describe('pickerToStepResults', () => {
  it('reports missing items 1-based for a PASS', () => {
    expect(
      pickerToStepResults(steps, verification, 'PASS', {
        'STEPS:0': { status: 'PASS', reason: '' },
      })
    ).toEqual({ ok: false, missing: ['s2', 'v1'] })
  })
  it('builds a full PASS', () => {
    const all = {
      'STEPS:0': { status: 'PASS' as const, reason: '' },
      'STEPS:1': { status: 'SKIP' as const, reason: 'no DB' },
      'VERIFICATION:0': { status: 'PASS' as const, reason: '' },
    }
    expect(pickerToStepResults(steps, verification, 'PASS', all)).toEqual({
      ok: true,
      value: [
        { phase: 'STEPS', index: 0, status: 'PASS' },
        { phase: 'STEPS', index: 1, status: 'SKIP', reason: 'no DB' },
        { phase: 'VERIFICATION', index: 0, status: 'PASS' },
      ],
    })
  })
  it('treats a SKIP with a blank reason as missing', () => {
    const r = pickerToStepResults(steps, [], 'PASS', {
      'STEPS:0': { status: 'PASS', reason: '' },
      'STEPS:1': { status: 'SKIP', reason: '  ' },
    })
    expect(r).toEqual({ ok: false, missing: ['s2'] })
  })
  it('for a FAIL, stops at the failing item and ignores anything after it', () => {
    expect(
      pickerToStepResults(steps, verification, 'FAIL', {
        'STEPS:0': { status: 'FAIL', reason: '' },
        'STEPS:1': { status: 'PASS', reason: '' },
      })
    ).toEqual({
      ok: true,
      value: [{ phase: 'STEPS', index: 0, status: 'FAIL' }],
    })
  })
  it('a FAIL with no failing item is incomplete', () => {
    expect(
      pickerToStepResults(steps, verification, 'FAIL', {
        'STEPS:0': { status: 'PASS', reason: '' },
        'STEPS:1': { status: 'PASS', reason: '' },
        'VERIFICATION:0': { status: 'PASS', reason: '' },
      })
    ).toEqual({ ok: false, missing: [] })
  })
  it('a FAIL with an unmarked step before the failure lists it as missing', () => {
    expect(
      pickerToStepResults(steps, verification, 'FAIL', {
        'STEPS:1': { status: 'FAIL', reason: '' },
      })
    ).toEqual({ ok: false, missing: ['s1'] })
  })
})
