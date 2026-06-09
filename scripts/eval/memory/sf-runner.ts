/**
 * LIVE, key-gated. Feeds each eval case to the REAL reconcile LLM (one
 * candidate, one neighbor = its `existing`) and scores the decision against the
 * labeled expectedOp. Inverse of LUM-326 (which mocked the decision to test the
 * pipeline; here we test only the decision). Requires AI_GATEWAY_API_KEY. The
 * reconcile import is dynamic so this module is never pulled into a jest bundle
 * (the @ai-sdk/gateway TransformStream trap).
 *
 * LUM-335 regression: this live runner surfaced the reconcile schema-drift bug
 * (the model occasionally keyed an op `{"operation":...}` instead of
 * `{"type":...}`, and `generateObject` threw → the whole turn's writes were
 * silently dropped). The fix (loose generateObject schema + per-op safeParse
 * with an `operation`→`type` alias) is pinned by KEYLESS, deterministic unit
 * tests so CI guards it without a gateway key:
 *   - __tests__/lib/services/memory/reconcile-parse.test.ts
 *       (coerceReconcileOperation alias + parseReconcileOperations batch drop)
 *   - __tests__/lib/services/memory/layer1-reconcile.test.ts
 *   - __tests__/lib/services/memory/layer2-reconcile.test.ts
 *       (reconcile path recovers `operation`-keyed ops, drops only garbage)
 * The refinement-folding prompt change is pinned by
 *   - __tests__/lib/services/memory/reconcile-prompt.test.ts
 * This live runner remains the ground-truth check for decision QUALITY.
 */
import type { EvalCase, ExpectedOp, Relationship } from './types'

export interface SfResult {
  id: string
  relationship: Relationship
  expectedOp: ExpectedOp
  /** Coarse op label the reconcile LLM emitted for this case. */
  predictedOp: ExpectedOp | 'DELETE'
}

export interface SfScore {
  n: number
  /** Headline: DUPLICATE counts NOOP and UPDATE as equally correct (both are
   * non-destructive responses to a paraphrase). */
  accuracy: number
  /** Reference: exact predictedOp === expectedOp match. */
  strictAccuracy: number
  /** Of CONTRADICTION cases, fraction the LLM judged SUPERSEDE. */
  supersedeRecall: number
  /** Of non-CONTRADICTION cases, fraction NOT wrongly superseded/deleted. */
  nonConflictProtection: number
}

/** A DUPLICATE paraphrase answered NOOP *or* UPDATE is acceptable; every other
 * relationship requires its exact expected op. */
function isLenientCorrect(r: SfResult): boolean {
  if (r.relationship === 'DUPLICATE') {
    return r.predictedOp === 'NOOP' || r.predictedOp === 'UPDATE'
  }
  return r.predictedOp === r.expectedOp
}

/** Pure aggregation — unit-tested without a gateway. */
export function scoreSfRun(results: SfResult[]): SfScore {
  const n = results.length
  const lenient = results.filter(isLenientCorrect).length
  const strict = results.filter(r => r.predictedOp === r.expectedOp).length
  const contradictions = results.filter(r => r.relationship === 'CONTRADICTION')
  const supersedeHits = contradictions.filter(
    r => r.predictedOp === 'SUPERSEDE'
  ).length
  const nonConflicts = results.filter(r => r.relationship !== 'CONTRADICTION')
  const protectedCount = nonConflicts.filter(
    r => r.predictedOp !== 'SUPERSEDE' && r.predictedOp !== 'DELETE'
  ).length
  return {
    n,
    accuracy: n === 0 ? 0 : lenient / n,
    strictAccuracy: n === 0 ? 0 : strict / n,
    supersedeRecall:
      contradictions.length === 0 ? 0 : supersedeHits / contradictions.length,
    nonConflictProtection:
      nonConflicts.length === 0 ? 0 : protectedCount / nonConflicts.length,
  }
}

/** Map a reconcile op object to our coarse op label. NOOP/empty → NOOP. */
function opLabel(op: { type?: string } | undefined): SfResult['predictedOp'] {
  switch (op?.type) {
    case 'SUPERSEDE':
      return 'SUPERSEDE'
    case 'UPDATE':
      return 'UPDATE'
    case 'ADD':
      return 'ADD'
    case 'DELETE':
      return 'DELETE'
    default:
      return 'NOOP'
  }
}

/** LIVE: run the real reconcile LLM per case. Dynamic import keeps the gateway
 * out of test bundles. */
export async function runSf(cases: EvalCase[]): Promise<SfResult[]> {
  const { reconcileLayer1Candidates } =
    await import('@/lib/services/memory/layer1-extract')
  const results: SfResult[] = []
  for (const c of cases) {
    const ops = await reconcileLayer1Candidates({
      task: {
        id: `eval-${c.id}`,
        title: 'Memory eval (LUM-329)',
        description: null,
      },
      candidates: [{ category: c.category, content: c.candidate }],
      // One neighbor: the case's existing memory, with a stable fake id.
      neighborsByCandidate: [
        [
          {
            id: `nbr-${c.id}`,
            category: c.category,
            content: c.existing,
            score: 0.9,
          },
        ],
      ],
    })
    // The reconcile output is one op per candidate; take the first (or NOOP).
    results.push({
      id: c.id,
      relationship: c.relationship,
      expectedOp: c.expectedOp,
      predictedOp: opLabel(ops[0]),
    })
  }
  return results
}

if (require.main === module) {
  void import('dotenv').then(async ({ config }) => {
    config({ path: '.env.local' })
    if (!process.env.AI_GATEWAY_API_KEY) {
      // eslint-disable-next-line no-console
      console.error('AI_GATEWAY_API_KEY required for sf-runner (live step).')
      process.exit(1)
    }
    const { evalSet } = await import('./eval-set')
    const results = await runSf(evalSet)
    const score = scoreSfRun(results)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ score, results }, null, 2))
  })
}
