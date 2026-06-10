/**
 * LUM-414 Retrieve-segment offline report — deterministic, frozen-fixture only
 * (no API key, no network). Scores every gold query against the pool (each
 * case's `existing` vector from the LUM-329 fixture), then sweeps the
 * injection-policy ablation: ordering ∈ {fixed, lineage, score} × floor ∈
 * {none, EMBEDDING_SCORE_FLOOR}, k=5.
 *
 * "fixed, no floor" approximates today's prod injection (load everything in
 * stored order, truncate by budget). The lineage rows use the REAL prod
 * rankByLineage with a synthetic NULL-MODEL stat table (uncorrelated with
 * relevance by construction) — they measure how much relevance-blind
 * reordering moves Precision@k, not prod lineage quality.
 *
 * Usage: npx tsx scripts/eval/memory/retrieve-report.ts
 */
import poolFixture from './vectors.fixture.json'
import queryFixture from './retrieve-vectors.fixture.json'
import { cosineSimilarity } from './ar-metrics'
import {
  injectTopK,
  scorePolicy,
  type InjectionPolicy,
  type PolicyReport,
  type QueryOutcome,
  type ScoredFragment,
} from './retrieve-metrics'
import {
  retrievePool,
  retrieveQuerySet,
  syntheticLineageStats,
  validateRetrieveSet,
  type RetrieveQuery,
} from './retrieve-set'
import { EMBEDDING_SCORE_FLOOR } from '@/lib/services/memory/embedding-neighbor-retriever'

export const RETRIEVE_K = 5

type PoolFix = {
  models: string[]
  cases: Record<
    string,
    { candidate: Record<string, number[]>; existing: Record<string, number[]> }
  >
}
type QueryFix = { model: string; queries: Record<string, number[]> }

const poolFx = poolFixture as PoolFix
const queryFx = queryFixture as QueryFix

/** Validate both fixtures against the gold set; [] = ready to score. */
export function validateRetrieveFixtures(): string[] {
  const errs = validateRetrieveSet(
    retrieveQuerySet,
    new Set(retrievePool.map(c => c.id))
  )
  if (!poolFx.models.includes(queryFx.model)) {
    errs.push(`query fixture model ${queryFx.model} missing from pool fixture`)
  }
  const poolDim =
    poolFx.cases[retrievePool[0]!.id]?.existing[queryFx.model]?.length ?? 0
  for (const q of retrieveQuerySet) {
    const v = queryFx.queries[q.id]
    if (!v) errs.push(`${q.id}: no query vector`)
    else if (v.length !== poolDim) {
      errs.push(`${q.id}: query dim ${v.length} != pool dim ${poolDim}`)
    }
  }
  for (const c of retrievePool) {
    const v = poolFx.cases[c.id]?.existing[queryFx.model]
    if (!v) errs.push(`${c.id}: no pool vector under ${queryFx.model}`)
    else if (v.length !== poolDim) {
      errs.push(`${c.id}: pool dim ${v.length} != ${poolDim}`)
    }
  }
  return errs
}

/** Score every pool fragment against one query, in fixed corpus order. */
export function scoredPoolFor(query: RetrieveQuery): ScoredFragment[] {
  const qv = queryFx.queries[query.id]!
  return retrievePool.map(c => ({
    id: c.id,
    score: cosineSimilarity(qv, poolFx.cases[c.id]!.existing[queryFx.model]!),
  }))
}

/** Simulate one policy across the whole gold set. */
export function outcomesFor(
  policy: InjectionPolicy,
  k: number = RETRIEVE_K
): QueryOutcome[] {
  const stats = syntheticLineageStats(retrievePool.map(c => c.id))
  return retrieveQuerySet.map(q => ({
    queryId: q.id,
    isAbstention: q.relevantIds.length === 0,
    injected: injectTopK(scoredPoolFor(q), policy, k, stats).map(f => f.id),
    relevant: new Set(q.relevantIds),
  }))
}

export const ABLATION_POLICIES: InjectionPolicy[] = [
  { ordering: 'fixed', floor: null },
  { ordering: 'fixed', floor: EMBEDDING_SCORE_FLOOR },
  { ordering: 'lineage', floor: null },
  { ordering: 'lineage', floor: EMBEDDING_SCORE_FLOOR },
  { ordering: 'score', floor: null },
  { ordering: 'score', floor: EMBEDDING_SCORE_FLOOR },
]

/** Retrieve-segment floor sweep (score ordering): the dedup floor was
 * calibrated on candidate↔existing paraphrase pairs; task-query→fragment
 * cosines sit lower, so the injection gate needs its own knee. */
export const RETRIEVE_FLOOR_SWEEP = Array.from(
  { length: 16 },
  (_, i) => +(0.5 + i * 0.02).toFixed(2)
)

export interface FloorSweepRow {
  floor: number
  report: PolicyReport
}

export function retrieveFloorSweep(k: number = RETRIEVE_K): FloorSweepRow[] {
  return RETRIEVE_FLOOR_SWEEP.map(floor => {
    const policy: InjectionPolicy = { ordering: 'score', floor }
    return { floor, report: scorePolicy(outcomesFor(policy, k), policy, k) }
  })
}

/** Lowest swept floor that still abstains on every negative control — the
 * most recall-preserving gate that passes the abstention contract. */
export function abstentionSafeFloor(rows: FloorSweepRow[]): number | null {
  const safe = rows.find(r => r.report.abstentionEmptyRate === 1)
  return safe ? safe.floor : null
}

function fmt(x: number): string {
  return x.toFixed(3)
}

function policyLabel(p: InjectionPolicy): string {
  return `${p.ordering.padEnd(8)} ${p.floor === null ? 'none' : p.floor.toFixed(2)}`
}

function main(): void {
  const problems = validateRetrieveFixtures()
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error('retrieve fixtures invalid:\n' + problems.join('\n'))
    process.exit(1)
  }

  // eslint-disable-next-line no-console
  const log = console.log
  const positives = retrieveQuerySet.filter(q => q.relevantIds.length > 0)
  const abstentions = retrieveQuerySet.filter(q => q.relevantIds.length === 0)
  log('=== LUM-414 Retrieve-segment Eval (offline, deterministic) ===\n')
  log(
    `pool=${retrievePool.length} fragments (same-language existing set)  queries=${positives.length} positive + ${abstentions.length} abstention  model=${queryFx.model}  k=${RETRIEVE_K}`
  )

  const reports: PolicyReport[] = ABLATION_POLICIES.map(p =>
    scorePolicy(outcomesFor(p), p, RETRIEVE_K)
  )

  log('\n— ABLATION (means over positive queries; abstain over negatives) —')
  log('  ordering floor   P@1    P@3    P@5    R@5    hit    abstain-empty')
  for (const r of reports) {
    log(
      `  ${policyLabel(r.policy)}   ${fmt(r.precisionAt1)}  ${fmt(r.precisionAt3)}  ${fmt(r.precisionAtKFull)}  ${fmt(r.recallAtK)}  ${fmt(r.hitRate)}  ${r.abstentionEmptyRate === 1 ? `${r.nAbstention}/${r.nAbstention}` : fmt(r.abstentionEmptyRate)}`
    )
  }

  // The dedup floor does not transfer to task-query→fragment retrieval (the
  // cosines sit lower than paraphrase pairs), so sweep an injection-specific
  // floor at the score ordering.
  log('\n— RETRIEVE FLOOR SWEEP (score ordering) —')
  log('  floor   P@5    R@5    hit    abstain-empty')
  const sweep = retrieveFloorSweep()
  for (const { floor, report } of sweep) {
    log(
      `  ${floor.toFixed(2)}   ${fmt(report.precisionAtKFull)}  ${fmt(report.recallAtK)}  ${fmt(report.hitRate)}  ${fmt(report.abstentionEmptyRate)}`
    )
  }
  const safeFloor = abstentionSafeFloor(sweep)
  log(
    `  → abstention-safe floor (lowest with abstain-empty=1.0, n=${abstentions.length} negatives): ${safeFloor === null ? 'none in sweep range' : safeFloor.toFixed(2)}`
  )

  // Positive-query headroom over the abstention-safe floor.
  const maxRelevant = positives.map(q => {
    const rel = new Set(q.relevantIds)
    return scoredPoolFor(q)
      .filter(f => rel.has(f.id))
      .reduce((m, f) => Math.max(m, f.score), 0)
  })
  log(
    `  positive queries' best-relevant cosine: mean=${fmt(maxRelevant.reduce((a, b) => a + b, 0) / maxRelevant.length)} min=${fmt(Math.min(...maxRelevant))}`
  )

  // Abstention diagnostics: how close does each negative control get to the
  // floor? (max pool score per abstention query)
  log('\n— ABSTENTION DIAGNOSTICS (max pool cosine per negative control) —')
  for (const q of abstentions) {
    const max = scoredPoolFor(q).reduce((m, f) => Math.max(m, f.score), 0)
    log(
      `  ${q.id.padEnd(26)} max=${fmt(max)}  ${max < EMBEDDING_SCORE_FLOOR ? 'below floor ✓' : 'CLEARS FLOOR ✗'}`
    )
  }

  const baseline = reports[0]!
  const ceiling = reports[4]!
  log('\n— HEADLINE —')
  log(
    `  baseline (≈today: fixed order, no floor):           P@5=${fmt(baseline.precisionAtKFull)}  R@5=${fmt(baseline.recallAtK)}  abstain-empty=${fmt(baseline.abstentionEmptyRate)}`
  )
  if (safeFloor !== null) {
    const safe = sweep.find(r => r.floor === safeFloor)!.report
    log(
      `  abstention-safe gate (score order, floor ${safeFloor.toFixed(2)}):    P@5=${fmt(safe.precisionAtKFull)}  R@5=${fmt(safe.recallAtK)}  abstain-empty=${fmt(safe.abstentionEmptyRate)}`
    )
  }
  log(
    `  relevance ceiling (score order, no floor):          P@5=${fmt(ceiling.precisionAtKFull)}  R@5=${fmt(ceiling.recallAtK)}  abstain-empty=${fmt(ceiling.abstentionEmptyRate)}`
  )
  log(
    `  NOTE the dedup floor ${EMBEDDING_SCORE_FLOOR} does NOT transfer to task→fragment retrieval (R@5=${fmt(reports[5]!.recallAtK)} there — task queries are not paraphrases of memories).`
  )
  log(
    '\n  LLM-judge Probe1 (live, key-gated, k-run consistency): run `npx tsx scripts/eval/memory/retrieve-judge.ts`.'
  )
}

if (require.main === module) {
  main()
}
