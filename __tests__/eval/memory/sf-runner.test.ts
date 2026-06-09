import { scoreSfRun, type SfResult } from '@/scripts/eval/memory/sf-runner'
import type { EvalCase } from '@/scripts/eval/memory/types'

const mk = (
  id: string,
  rel: EvalCase['relationship'],
  op: EvalCase['expectedOp'],
  predictedOp: SfResult['predictedOp']
): SfResult => ({ id, relationship: rel, expectedOp: op, predictedOp })

describe('scoreSfRun', () => {
  const results: SfResult[] = [
    mk('c1', 'CONTRADICTION', 'SUPERSEDE', 'SUPERSEDE'), // correct (both)
    mk('c2', 'CONTRADICTION', 'SUPERSEDE', 'NOOP'), // wrong (supersede miss)
    mk('d1', 'DUPLICATE', 'NOOP', 'SUPERSEDE'), // wrong (protection fail)
    mk('d2', 'DUPLICATE', 'NOOP', 'UPDATE'), // lenient-correct, strict-wrong
    mk('u1', 'UNRELATED', 'ADD', 'ADD'), // correct (both)
  ]

  it('lenient accuracy treats DUPLICATE NOOP≡UPDATE as correct → 3/5', () => {
    expect(scoreSfRun(results).accuracy).toBeCloseTo(0.6)
  })

  it('strict accuracy requires exact op match → 2/5', () => {
    expect(scoreSfRun(results).strictAccuracy).toBeCloseTo(0.4)
  })

  it('SUPERSEDE recall = 1/2 (c1 hit, c2 missed)', () => {
    expect(scoreSfRun(results).supersedeRecall).toBeCloseTo(0.5)
  })

  it('non-conflict protection = 2/3 (d1 wrongly superseded; d2, u1 safe)', () => {
    expect(scoreSfRun(results).nonConflictProtection).toBeCloseTo(2 / 3)
  })

  it('reports n', () => {
    expect(scoreSfRun(results).n).toBe(5)
  })
})
