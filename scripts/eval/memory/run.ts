/**
 * LUM-329 memory eval orchestrator. Offline AR always runs from the frozen
 * fixture; SF runs only when AI_GATEWAY_API_KEY is present (key-gated quality
 * headline); TTL is descriptive. Prints the two-line headline and the
 * calibration (model, floor, recall@k threshold) triple.
 *
 * Usage: npx tsx scripts/eval/memory/run.ts
 */
import fixture from './vectors.fixture.json'
import { evalSet } from './eval-set'
import { isPositiveCase } from './types'

// Same-language subset: exclude cross-lingual pairs (xlang-*) from AR
// calibration. The xlang cases are retained in evalSet so fixture-gen.ts
// still embeds them and crossLingualReport() can consume them.
const sameLangSet = evalSet.filter(c => !c.id.startsWith('xlang-'))
import { bigramSimilarity } from '@/lib/similarity'
import { memoryContentToText } from '@/lib/memory/content-text'
import {
  cosineSimilarity,
  floorSweepWithKnee,
  recallAtK,
  separation,
  type FloorCase,
  type ScoredItem,
  type SeparationCase,
} from './ar-metrics'
import { scoreSfRun } from './sf-runner'
import {
  nearDupRetrievalReport,
  nearDupClusters,
  type NearDupPair,
  type VecItem,
} from './near-dup-cluster'
import { EMBEDDING_SCORE_FLOOR } from '@/lib/services/memory/embedding-neighbor-retriever'

const FLOORS = Array.from(
  { length: 31 },
  (_, i) => +(0.3 + i * 0.02).toFixed(2)
)
const PROD_MODEL = 'alibaba/qwen3-embedding-0.6b'

type Fix = {
  models: string[]
  cases: Record<
    string,
    { candidate: Record<string, number[]>; existing: Record<string, number[]> }
  >
}
const fx = fixture as Fix

interface ArResult {
  floor: number
  f1: number
  precision: number
  recall: number
  recallAt10: number
  recallAt1: number
  separation: { mean: number; min: number }
  sweepAroundKnee: Array<{
    floor: number
    precision: number
    recall: number
    f1: number
  }>
}

function arForModel(model: string): ArResult {
  const floorCases: FloorCase[] = []
  const ranked: ScoredItem[][] = []
  const sepCases: SeparationCase[] = []
  for (const c of sameLangSet) {
    const q = fx.cases[c.id]!.candidate[model]!
    let positiveScore: number | null = null
    const items: ScoredItem[] = []
    if (isPositiveCase(c)) {
      positiveScore = cosineSimilarity(q, fx.cases[c.id]!.existing[model]!)
      items.push({ id: c.id, score: positiveScore, isPositive: true })
    }
    const distractorScores: number[] = []
    for (const other of sameLangSet) {
      if (other.id === c.id) continue
      const s = cosineSimilarity(q, fx.cases[other.id]!.existing[model]!)
      distractorScores.push(s)
      items.push({ id: other.id, score: s, isPositive: false })
    }
    floorCases.push({ positiveScore, distractorScores })
    items.sort((a, b) => b.score - a.score)
    ranked.push(items)
    if (positiveScore !== null)
      sepCases.push({ positiveScore, distractorScores })
  }
  const { rows, recommended } = floorSweepWithKnee(floorCases, FLOORS)
  const sweepAroundKnee = rows
    .filter(r => Math.abs(r.floor - recommended.floor) <= 0.06)
    .map(r => ({
      floor: r.floor,
      precision: r.precision,
      recall: r.recall,
      f1: r.f1,
    }))
  return {
    floor: recommended.floor,
    f1: recommended.f1,
    precision: recommended.precision,
    recall: recommended.recall,
    recallAt10: recallAtK(ranked, 10),
    recallAt1: recallAtK(ranked, 1),
    separation: separation(sepCases),
    sweepAroundKnee,
  }
}

// Lexical recall@k over the same corpus (no vectors) → upgrade-trigger basis.
// Reported at k=1/3/10 because the embedding advantage, if any, is at rank-1:
// over a small pool both lexical and embedding tend to reach recall@10=1.0.
function lexicalRecall(): { at1: number; at3: number; at10: number } {
  const ranked: ScoredItem[][] = []
  for (const c of sameLangSet) {
    const qText = memoryContentToText(c.category, c.candidate)
    const items: ScoredItem[] = []
    if (isPositiveCase(c)) {
      items.push({
        id: c.id,
        score: bigramSimilarity(
          qText,
          memoryContentToText(c.category, c.existing)
        ),
        isPositive: true,
      })
    }
    for (const other of sameLangSet) {
      if (other.id === c.id) continue
      items.push({
        id: other.id,
        score: bigramSimilarity(
          qText,
          memoryContentToText(other.category, other.existing)
        ),
        isPositive: false,
      })
    }
    items.sort((a, b) => b.score - a.score)
    ranked.push(items)
  }
  return {
    at1: recallAtK(ranked, 1),
    at3: recallAtK(ranked, 3),
    at10: recallAtK(ranked, 10),
  }
}

function crossLingualReport(model: string): {
  n: number
  meanRaw: number
  minRaw: number
  belowFloor: number
} {
  const xlang = evalSet.filter(c => c.id.startsWith('xlang-'))
  const raws: number[] = []
  for (const c of xlang) {
    const cand = fx.cases[c.id]!.candidate[model]!
    const exist = fx.cases[c.id]!.existing[model]!
    raws.push(cosineSimilarity(cand, exist))
  }
  const mean = raws.length ? raws.reduce((a, b) => a + b, 0) / raws.length : 0
  const min = raws.length ? Math.min(...raws) : 0
  const belowFloor = raws.filter(r => r < 0.78).length
  return { n: raws.length, meanRaw: mean, minRaw: min, belowFloor }
}

async function main(): Promise<void> {
  const models = fx.models
  const arByModel = Object.fromEntries(models.map(m => [m, arForModel(m)]))
  const prod = arByModel[PROD_MODEL]!
  const lex = lexicalRecall()
  const nPos = sameLangSet.filter(isPositiveCase).length

  // eslint-disable-next-line no-console
  const log = console.log
  log('=== LUM-329 Memory Eval ===\n')
  log(
    `— AR (offline, deterministic; n=${nPos} positives, ${sameLangSet.length} same-language cases) —`
  )
  for (const m of models) {
    const a = arByModel[m]!
    log(
      `  ${m}: floor*=${a.floor} F1=${a.f1.toFixed(3)} P=${a.precision.toFixed(3)} R=${a.recall.toFixed(3)} recall@1=${a.recallAt1.toFixed(3)} recall@10=${a.recallAt10.toFixed(3)} sep(mean/min)=${a.separation.mean.toFixed(3)}/${a.separation.min.toFixed(3)}`
    )
  }
  log(`\n  floor sweep around the knee (${PROD_MODEL}):`)
  for (const r of prod.sweepAroundKnee) {
    log(
      `    floor=${r.floor.toFixed(2)}  P=${r.precision.toFixed(3)}  R=${r.recall.toFixed(3)}  F1=${r.f1.toFixed(3)}`
    )
  }
  log(
    `\n  lexical recall@1/@3/@10 = ${lex.at1.toFixed(3)}/${lex.at3.toFixed(3)}/${lex.at10.toFixed(3)}  vs  embedding(${PROD_MODEL}) recall@1/@10 = ${prod.recallAt1.toFixed(3)}/${prod.recallAt10.toFixed(3)}`
  )

  // LUM-538 — near-duplicate gate health at the SHIPPED dedup floor. A missed
  // near-dup pair never reaches the reconcile LLM → spurious ADD → residual
  // cluster. This is the metric the milestone "cluster count down, not
  // rebounding" is judged on; the regression lives in near-dup-cluster.test.ts.
  const ndPairs: NearDupPair[] = sameLangSet.filter(isPositiveCase).map(c => ({
    id: c.id,
    candidate: fx.cases[c.id]!.candidate[PROD_MODEL]!,
    existing: fx.cases[c.id]!.existing[PROD_MODEL]!,
  }))
  const ndShipped = nearDupRetrievalReport(ndPairs, EMBEDDING_SCORE_FLOOR)
  const ndOldKnee = nearDupRetrievalReport(ndPairs, 0.78)
  const residualCorpus: VecItem[] = sameLangSet.map(c => ({
    id: c.id,
    vector: fx.cases[c.id]!.existing[PROD_MODEL]!,
  }))
  const residualClusters = nearDupClusters(residualCorpus, 0.85)
  log(
    `\n— NEAR-DUP GATE (LUM-538, ${PROD_MODEL}) —\n` +
      `  shipped floor ${EMBEDDING_SCORE_FLOOR}: caught=${ndShipped.caught}/${ndShipped.total} (recall=${ndShipped.recall.toFixed(3)}) missed=${ndShipped.missed}\n` +
      `  vs old 0.78 knee:    caught=${ndOldKnee.caught}/${ndOldKnee.total} (recall=${ndOldKnee.recall.toFixed(3)}) missed=${ndOldKnee.missed}\n` +
      `  residual near-dup clusters in corpus (existing set, cos≥0.85): ${residualClusters.length}`
  )

  const xl = crossLingualReport(PROD_MODEL)
  log(
    `\n  cross-lingual RAW cosine (${PROD_MODEL}, n=${xl.n}): mean=${xl.meanRaw.toFixed(3)} min=${xl.minRaw.toFixed(3)} below-0.78=${xl.belowFloor}/${xl.n}`
  )
  log(
    `    → ${xl.belowFloor > 0 ? 'cross-language synonyms fall below the floor; LUM-336 canonicalizes manual content to English so dedup runs same-language.' : 'cross-language synonyms clear the floor at this model.'}`
  )

  let sf: ReturnType<typeof scoreSfRun> | null = null
  if (process.env.AI_GATEWAY_API_KEY) {
    const { runSf } = await import('./sf-runner')
    sf = scoreSfRun(await runSf(evalSet))
  }

  log('\n— HEADLINE —')
  log(
    `  [regression]  AR F1 @ floor ${prod.floor} (${PROD_MODEL}) = ${prod.f1.toFixed(3)}  (n=${nPos})`
  )
  if (sf) {
    log(
      `  [quality]     SF op-accuracy = ${sf.accuracy.toFixed(3)} (lenient)  /  ${sf.strictAccuracy.toFixed(3)} (strict)  (n=${sf.n})`
    )
    log(
      `                  SUPERSEDE recall=${sf.supersedeRecall.toFixed(3)}  non-conflict protection=${sf.nonConflictProtection.toFixed(3)}`
    )
  } else {
    log('  [quality]     SF op-accuracy = SKIPPED (no AI_GATEWAY_API_KEY)')
  }

  log('\n— CALIBRATION TRIPLE (回改 LUM-324) —')
  const best = models.reduce(
    (b, m) =>
      arByModel[m]!.separation.mean > arByModel[b]!.separation.mean ? m : b,
    models[0]!
  )
  log(
    `  selected model:        ${best} (separation mean ${arByModel[best]!.separation.mean.toFixed(3)}; 0.6b=${prod.separation.mean.toFixed(3)})`
  )
  log(
    `  EMBEDDING_SCORE_FLOOR: ${arByModel[best]!.floor} (empirical F1 knee, n=${nPos})`
  )
  log(
    `  upgrade trigger:       recall@k does NOT discriminate at this pool size (lexical recall@10=${lex.at10.toFixed(3)} ties embedding ${prod.recallAt10.toFixed(3)}; embedding edge is +${(prod.recallAt1 - lex.at1).toFixed(3)} at recall@1). Keep the >50-PROJECT-memory pool-size heuristic as the trigger; revisit recall@k only if a larger pool shows lexical recall@10 dropping.`
  )

  log('\n— DESCRIPTIVE (no ground truth; NOT a capability score) —')
  log(
    '  TTL used-rate: run `npx tsx scripts/eval/memory/ttl-report.ts` (lineage proxy).'
  )
  log(
    '  Grounding interception (LUM-396, live, key-gated): run `npx tsx scripts/eval/memory/ground-runner.ts`.'
  )
  log(
    '  Retrieve-segment Precision@k + abstention (LUM-414, offline): run `npx tsx scripts/eval/memory/retrieve-report.ts`;'
  )
  log(
    '    LLM-judge Probe1 (live, key-gated): `npx tsx scripts/eval/memory/retrieve-judge.ts`.'
  )
}

if (require.main === module) {
  void import('dotenv').then(({ config }) => {
    config({ path: '.env.local' })
    main().catch(err => {
      // eslint-disable-next-line no-console
      console.error(err)
      process.exit(1)
    })
  })
}
