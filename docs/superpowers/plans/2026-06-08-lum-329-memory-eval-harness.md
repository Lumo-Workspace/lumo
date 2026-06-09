# LUM-329 Memory Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a partly-deterministic eval harness that measures the memory system's retrieval (AR) and conflict-resolution (SF) correctness, and emits the empirical `(model, EMBEDDING_SCORE_FLOOR, upgrade recall@k threshold)` calibration triple.

**Architecture:** A DI-testable pure-metrics core (`ar-metrics.ts`) runs offline against a checked-in fixture of real qwen3 vectors; key-gated runnables (`fixture-gen.ts`, `sf-runner.ts`) compute the fixture and the live reconcile-LLM accuracy. One unified `EvalCase[]` corpus drives both AR and SF. Mirrors the `scripts/backfill-memory-embeddings.ts` DI-core + thin entry pattern.

**Tech Stack:** TypeScript, `tsx` (script runner), Jest (`@jest-environment node` for live-touching tests), Vercel AI Gateway (`@ai-sdk/gateway` via `lib/ai/embedding.ts`), Prisma (lineage read for TTL).

**Spec:** `docs/superpowers/specs/2026-06-08-lum-329-memory-eval-harness-design.md`

**Branch:** `lumo/LUM-329-memory-eval-harness` (already created off origin/main).

---

## File Structure

| File                                              | Responsibility                                                                                                                  | Touches gateway  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `scripts/eval/memory/types.ts`                    | `EvalCase`, `Relationship`, `ExpectedOp`, `relationshipToExpectedOp`, `validateEvalCase`, derived-AR helpers (`isPositiveCase`) | no               |
| `scripts/eval/memory/ar-metrics.ts`               | pure: `cosineSimilarity`, `floorSweep`, `recallAtK`, `separation`; imports `bigramSimilarity` from `@/lib/similarity`           | no               |
| `scripts/eval/memory/eval-set.ts`                 | the unified `EvalCase[]` corpus (~50–60 cases), authored from real prod seeds                                                   | no               |
| `scripts/eval/memory/vectors.fixture.json`        | frozen vectors `{ [caseId]: { candidate: {m: number[]}, existing: {m: number[]} } }`                                            | n/a (data)       |
| `scripts/eval/memory/fixture-gen.ts`              | live runnable: embed corpus under 3 models → write fixture                                                                      | yes (entry only) |
| `scripts/eval/memory/sf-runner.ts`                | live: run reconcile LLM per case → op-accuracy; DI core + thin entry                                                            | yes (entry only) |
| `scripts/eval/memory/ttl-report.ts`               | descriptive: lineage used-rate for CONVENTION/PROCEDURAL; DI core + thin entry                                                  | no (prisma)      |
| `scripts/eval/memory/run.ts`                      | orchestrator: offline AR + key-gated SF + descriptive TTL → headline + triple                                                   | dynamic          |
| `__tests__/eval/memory/types.test.ts`             | unit: relationship↔op map, validation                                                                                           | no               |
| `__tests__/eval/memory/ar-metrics.test.ts`        | unit: cosine/floor/recall/separation on a tiny synthetic fixture                                                                | no               |
| `__tests__/eval/memory/ar-metrics.frozen.test.ts` | deterministic: math invariants over the real committed fixture                                                                  | no               |
| `__tests__/eval/memory/eval-set.test.ts`          | structural: corpus shape, category balance, label consistency                                                                   | no               |
| `__tests__/eval/memory/sf-runner.test.ts`         | unit: op-accuracy aggregation with a mocked reconcile fn                                                                        | no               |
| `__tests__/eval/memory/ttl-report.test.ts`        | unit: used-rate aggregation with mocked rows                                                                                    | no               |

**Per-category content shapes** (from `lib/memory/schemas.ts`, used when authoring cases):

- TRAP: `{ summary?, trigger, outcome, workaround? }`
- DECISION: `{ summary?, what, why, alternatives?, implications? }`
- CONVENTION: `{ summary?, rule, scope }`
- PROCEDURAL: `{ summary?, workflow, trigger, steps?: string[] }`

`memoryContentToText(category, content)` (from `@/lib/memory/content-text`) flattens these to the comparable string used for both embedding and lexical scoring.

---

## Task 1: Types module

**Files:**

- Create: `scripts/eval/memory/types.ts`
- Test: `__tests__/eval/memory/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/eval/memory/types.test.ts
import {
  relationshipToExpectedOp,
  validateEvalCase,
  isPositiveCase,
  type EvalCase,
} from '@/scripts/eval/memory/types'

const base: EvalCase = {
  id: 'trap-x-01',
  category: 'TRAP',
  existing: { trigger: 'a', outcome: 'b' },
  candidate: { trigger: 'a2', outcome: 'b2' },
  relationship: 'CONTRADICTION',
  expectedOp: 'SUPERSEDE',
}

describe('eval types', () => {
  it('maps each relationship to its op', () => {
    expect(relationshipToExpectedOp.CONTRADICTION).toBe('SUPERSEDE')
    expect(relationshipToExpectedOp.REFINEMENT).toBe('UPDATE')
    expect(relationshipToExpectedOp.DUPLICATE).toBe('NOOP')
    expect(relationshipToExpectedOp.UNRELATED).toBe('ADD')
  })

  it('validates a well-formed case', () => {
    expect(validateEvalCase(base)).toEqual([])
  })

  it('flags expectedOp that disagrees with relationship', () => {
    const bad = { ...base, expectedOp: 'NOOP' as const }
    expect(validateEvalCase(bad)).toContain(
      'trap-x-01: expectedOp NOOP != SUPERSEDE for relationship CONTRADICTION'
    )
  })

  it('flags duplicate ids across a list', () => {
    expect(validateEvalCase(base, new Set(['trap-x-01']))).toContain(
      'trap-x-01: duplicate id'
    )
  })

  it('isPositiveCase: only UNRELATED/ADD lacks a positive', () => {
    expect(isPositiveCase(base)).toBe(true)
    expect(
      isPositiveCase({ ...base, relationship: 'UNRELATED', expectedOp: 'ADD' })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/eval/memory/types.test.ts`
Expected: FAIL — cannot find module `@/scripts/eval/memory/types`.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/eval/memory/types.ts
import type { MemoryCategory } from '@prisma/client'

export type Relationship =
  | 'CONTRADICTION'
  | 'REFINEMENT'
  | 'DUPLICATE'
  | 'UNRELATED'
export type ExpectedOp = 'SUPERSEDE' | 'UPDATE' | 'NOOP' | 'ADD'

/** Fixed 1:1 mapping — the relationship label is the source of truth; expectedOp
 * is derived and re-asserted in validation to catch annotation typos. */
export const relationshipToExpectedOp: Record<Relationship, ExpectedOp> = {
  CONTRADICTION: 'SUPERSEDE',
  REFINEMENT: 'UPDATE',
  DUPLICATE: 'NOOP',
  UNRELATED: 'ADD',
}

export interface EvalCase {
  id: string
  category: MemoryCategory
  /** On-file memory content (per-category shape from lib/memory/schemas.ts). */
  existing: unknown
  /** Newly-extracted candidate fact content (same per-category shape). */
  candidate: unknown
  relationship: Relationship
  expectedOp: ExpectedOp
  /** Annotator rationale — never fed to the model. */
  note?: string
}

/** A case has an AR "positive" (the existing memory should be retrieved) unless
 * it is an ADD/UNRELATED case, where the correct behavior is no neighbor. */
export function isPositiveCase(c: EvalCase): boolean {
  return c.relationship !== 'UNRELATED'
}

/** Return a list of human-readable problems with a case ([] = valid). Pass
 * `seenIds` to also flag duplicate ids across a corpus. */
export function validateEvalCase(c: EvalCase, seenIds?: Set<string>): string[] {
  const errs: string[] = []
  if (!c.id) errs.push('(missing id)')
  if (seenIds?.has(c.id)) errs.push(`${c.id}: duplicate id`)
  const want = relationshipToExpectedOp[c.relationship]
  if (c.expectedOp !== want) {
    errs.push(
      `${c.id}: expectedOp ${c.expectedOp} != ${want} for relationship ${c.relationship}`
    )
  }
  if (c.existing === null || typeof c.existing !== 'object')
    errs.push(`${c.id}: existing not an object`)
  if (c.candidate === null || typeof c.candidate !== 'object')
    errs.push(`${c.id}: candidate not an object`)
  return errs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/eval/memory/types.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/eval/memory/types.ts __tests__/eval/memory/types.test.ts
git commit -m "feat: LUM-329 eval-case types + validation [LUM-329]"
```

---

## Task 2: Pure AR metrics module

**Files:**

- Create: `scripts/eval/memory/ar-metrics.ts`
- Test: `__tests__/eval/memory/ar-metrics.test.ts`

This module is pure (no gateway, no prisma) so it is jest-safe and CI-gateable. It imports `bigramSimilarity` from `@/lib/similarity` for the lexical baseline — **never re-implement** lexical scoring, or the eval and production lexical paths drift.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/eval/memory/ar-metrics.test.ts
import {
  cosineSimilarity,
  floorSweep,
  recallAtK,
  separation,
  type ScoredItem,
} from '@/scripts/eval/memory/ar-metrics'

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal, matches pgvector cosine (normalized)', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    // non-unit vectors: must normalize, not raw-dot
    expect(cosineSimilarity([2, 0], [3, 0])).toBeCloseTo(1)
  })
  it('returns 0 on a zero vector (no throw)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('floorSweep', () => {
  // Two queries. q1 is a positive case: positive score 0.8, distractor 0.4.
  // q2 is an ADD case (no positive): best pool score 0.5 (any admit = FP).
  const cases = [
    { positiveScore: 0.8, distractorScores: [0.4, 0.2], hasPositive: true },
    { positiveScore: null, distractorScores: [0.5, 0.3], hasPositive: false },
  ]
  it('at floor 0.6: q1 TP (0.8≥.6), q1 distractors rejected, q2 all rejected → P=1 R=1', () => {
    const row = floorSweep(cases, [0.6]).find(r => r.floor === 0.6)!
    expect(row.precision).toBeCloseTo(1)
    expect(row.recall).toBeCloseTo(1)
    expect(row.f1).toBeCloseTo(1)
  })
  it('at floor 0.3: q1 distractor 0.4 admitted (FP), q2 0.5 & 0.3 admitted (FP) → precision drops', () => {
    const row = floorSweep(cases, [0.3]).find(r => r.floor === 0.3)!
    // TP=1 (q1 positive), FP=3 (q1 0.4; q2 0.5,0.3) → precision 1/4
    expect(row.precision).toBeCloseTo(0.25)
    expect(row.recall).toBeCloseTo(1)
  })
  it('recommends the floor with the best F1', () => {
    const { rows, recommended } = floorSweepWithKnee(cases, [0.3, 0.6])
    expect(rows).toHaveLength(2)
    expect(recommended.floor).toBe(0.6)
  })
})

describe('recallAtK', () => {
  const ranked: ScoredItem[][] = [
    // case A: positive is rank 1 → in top-1
    [
      { id: 'pos', score: 0.9, isPositive: true },
      { id: 'd', score: 0.4, isPositive: false },
    ],
    // case B: positive is rank 2 → in top-2, not top-1
    [
      { id: 'd', score: 0.7, isPositive: false },
      { id: 'pos', score: 0.6, isPositive: true },
    ],
  ]
  it('recall@1 = 0.5, recall@2 = 1.0 (monotone in k)', () => {
    expect(recallAtK(ranked, 1)).toBeCloseTo(0.5)
    expect(recallAtK(ranked, 2)).toBeCloseTo(1.0)
  })
})

describe('separation', () => {
  it('margin = positive − best distractor, averaged', () => {
    const s = separation([
      { positiveScore: 0.8, distractorScores: [0.4, 0.5] }, // margin 0.3
      { positiveScore: 0.9, distractorScores: [0.7] }, // margin 0.2
    ])
    expect(s.mean).toBeCloseTo(0.25)
    expect(s.min).toBeCloseTo(0.2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/eval/memory/ar-metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/eval/memory/ar-metrics.ts

/** Cosine similarity matching pgvector's `1 - (a <=> b)`: dot / (‖a‖‖b‖).
 * Returns 0 for a zero-magnitude vector (never NaN/throw). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dot += ai * bi
    na += ai * ai
    nb += bi * bi
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** One query's scored relationship to the pool, for the floor sweep. */
export interface FloorCase {
  /** Score of the labeled positive, or null for an ADD/no-positive case. */
  positiveScore: number | null
  /** Scores of every distractor pool member. */
  distractorScores: number[]
  /** Convenience mirror of (positiveScore !== null). */
  hasPositive?: boolean
}

export interface FloorRow {
  floor: number
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
}

/** Sweep candidate floors. A positive admitted (score ≥ floor) is a TP; any
 * distractor admitted is an FP; a positive not admitted is an FN. ADD cases
 * (positiveScore null) contribute only FPs (any admission is wrong). */
export function floorSweep(cases: FloorCase[], floors: number[]): FloorRow[] {
  return floors.map(floor => {
    let tp = 0
    let fp = 0
    let fn = 0
    for (const c of cases) {
      if (c.positiveScore !== null) {
        if (c.positiveScore >= floor) tp++
        else fn++
      }
      for (const d of c.distractorScores) if (d >= floor) fp++
    }
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
    const f1 =
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall)
    return { floor, tp, fp, fn, precision, recall, f1 }
  })
}

/** Floor sweep + the row with the best F1 (ties → lowest floor, the more
 * permissive choice). */
export function floorSweepWithKnee(
  cases: FloorCase[],
  floors: number[]
): { rows: FloorRow[]; recommended: FloorRow } {
  const rows = floorSweep(cases, floors)
  const recommended = rows.reduce(
    (best, r) => (r.f1 > best.f1 ? r : best),
    rows[0]!
  )
  return { rows, recommended }
}

export interface ScoredItem {
  id: string
  score: number
  isPositive: boolean
}

/** Fraction of positive-bearing cases whose positive is within the top-k by
 * score. `ranked[i]` must be pre-sorted desc by score. Cases with no positive
 * member are skipped (they have nothing to recall). */
export function recallAtK(ranked: ScoredItem[][], k: number): number {
  let denom = 0
  let hit = 0
  for (const list of ranked) {
    if (!list.some(x => x.isPositive)) continue
    denom++
    if (list.slice(0, k).some(x => x.isPositive)) hit++
  }
  return denom === 0 ? 0 : hit / denom
}

export interface SeparationCase {
  positiveScore: number
  distractorScores: number[]
}

/** Distribution of (positive − best distractor) over positive-bearing cases. */
export function separation(cases: SeparationCase[]): {
  mean: number
  min: number
  margins: number[]
} {
  const margins = cases.map(
    c => c.positiveScore - Math.max(0, ...c.distractorScores)
  )
  const mean = margins.length
    ? margins.reduce((a, b) => a + b, 0) / margins.length
    : 0
  const min = margins.length ? Math.min(...margins) : 0
  return { mean, min, margins }
}
```

Note: the test imports `floorSweepWithKnee` — add it to the test's import line:
`import { cosineSimilarity, floorSweep, floorSweepWithKnee, recallAtK, separation, type ScoredItem } from '@/scripts/eval/memory/ar-metrics'`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/eval/memory/ar-metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval/memory/ar-metrics.ts __tests__/eval/memory/ar-metrics.test.ts
git commit -m "feat: LUM-329 pure AR metrics (cosine/floor/recall/separation) [LUM-329]"
```

---

## Task 3: Author the unified eval-set corpus (MAIN-AGENT + USER VALIDATION)

**Files:**

- Create: `scripts/eval/memory/eval-set.ts`
- Test: `__tests__/eval/memory/eval-set.test.ts`

> **Not subagent-delegable.** Authoring ~55 realistic, in-domain cases requires
> the Lumo domain context and a human-validation gate. The main agent reads real
> prod memory seeds (read-only), **rewrites** them into fresh case text (never
> raw-copies — this is the first sanitization line), constructs perturbations,
> and the **user validates the labels** before fixture-gen runs.

- [ ] **Step 1: Pull real seeds (read-only, for inspiration only)**

Run a throwaway probe (delete after) from the repo dir to sample real memory
content per category, to anchor the cases in genuine project topics:

```bash
cat > ./_seed-probe.mjs <<'EOF'
import { config } from 'dotenv'
config({ path: '.env.production' })
const { PrismaPg } = await import('@prisma/adapter-pg')
const { PrismaClient } = await import('@prisma/client')
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
for (const cat of ['TRAP','DECISION','CONVENTION','PROCEDURAL']) {
  const rows = await prisma.memory.findMany({ where: { category: cat, status: 'ACTIVE' }, select: { content: true }, take: 8 })
  console.log('\n===', cat, '===')
  for (const r of rows) console.log(JSON.stringify(r.content).slice(0, 200))
}
await prisma.$disconnect()
EOF
node ./_seed-probe.mjs 2>&1 | grep -v "SECURITY WARNING\|sslmode\|libpq\|prepare for\|want the\|See https\|trace-warnings\|^$" ; rm -f ./_seed-probe.mjs
```

- [ ] **Step 2: Author `eval-set.ts`**

Write ~55 cases balanced across categories and relationships. Target mix:
~14 CONTRADICTION (→SUPERSEDE), ~13 REFINEMENT (→UPDATE), ~13 DUPLICATE (→NOOP),
~15 UNRELATED (→ADD). Each pair stays **in the same engineering domain** (no
cross-domain analogies — the LUM-324 live-validation trap). Example shape:

```ts
// scripts/eval/memory/eval-set.ts
import type { EvalCase } from './types'

/**
 * In-domain memory eval corpus (LUM-329). Authored from real Lumo prod memory
 * topics, rewritten (not copied) so no secrets/internal ids leak. The
 * `relationship` label is the ground truth; `expectedOp` is its 1:1 derivation
 * (re-asserted by eval-set.test.ts). Distractor pool = every other case's
 * `existing` content.
 */
export const evalSet: EvalCase[] = [
  {
    id: 'trap-prisma-drift-contradiction-01',
    category: 'TRAP',
    existing: {
      summary:
        'Vercel CI runs prisma migrate deploy automatically on every deploy',
      trigger: 'Merging a schema-change PR',
      outcome:
        'Production schema stays in sync with app code with no manual step',
    },
    candidate: {
      summary:
        'Vercel CI does NOT run prisma migrate deploy — prod schema drifts',
      trigger: 'Merging a schema-change PR',
      outcome:
        'App reads columns absent in prod → 500s until you migrate deploy manually',
      workaround:
        'SSH to prod and run prisma migrate deploy after the deploy completes',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Direct negation of the earlier (wrong) belief that CI auto-migrates.',
  },
  // ... ~54 more, see authoring guide below ...
]
```

**Authoring guide per relationship:**

- **CONTRADICTION** — `candidate` asserts the opposite of `existing` on the same
  subject (a belief proven wrong). Different headline, same topic vocabulary.
- **REFINEMENT** — `candidate` keeps `existing` true but adds a field / narrows
  scope / adds a step. High lexical overlap.
- **DUPLICATE** — `candidate` restates `existing` in different words, no new
  signal. Paraphrase with synonym swaps (this is the hardest AR case — it must
  still retrieve `existing` as the positive).
- **UNRELATED** — `candidate` is a real memory about a _different_ topic; the
  matching-category `existing` in the pool shares some generic vocabulary but is
  not the same fact (a hard distractor). The correct op is ADD and the correct
  retrieval is **no neighbor over floor**.

- [ ] **Step 3: Write the structural test**

```ts
// __tests__/eval/memory/eval-set.test.ts
import { evalSet } from '@/scripts/eval/memory/eval-set'
import { validateEvalCase, isPositiveCase } from '@/scripts/eval/memory/types'

describe('eval-set corpus', () => {
  it('has 50–60 cases', () => {
    expect(evalSet.length).toBeGreaterThanOrEqual(50)
    expect(evalSet.length).toBeLessThanOrEqual(60)
  })

  it('every case is structurally valid with unique ids', () => {
    const seen = new Set<string>()
    const errs: string[] = []
    for (const c of evalSet) {
      errs.push(...validateEvalCase(c, seen))
      seen.add(c.id)
    }
    expect(errs).toEqual([])
  })

  it('covers all four relationships with ≥10 each', () => {
    const counts: Record<string, number> = {}
    for (const c of evalSet)
      counts[c.relationship] = (counts[c.relationship] ?? 0) + 1
    for (const r of ['CONTRADICTION', 'REFINEMENT', 'DUPLICATE', 'UNRELATED']) {
      expect(counts[r] ?? 0).toBeGreaterThanOrEqual(10)
    }
  })

  it('covers all four categories', () => {
    expect(new Set(evalSet.map(c => c.category)).size).toBe(4)
  })

  it('has a non-trivial distractor pool for positive cases', () => {
    // every positive case competes against ≥40 other existing members
    expect(evalSet.filter(isPositiveCase).length).toBeGreaterThanOrEqual(35)
  })
})
```

- [ ] **Step 4: Run the structural test**

Run: `npx jest __tests__/eval/memory/eval-set.test.ts`
Expected: PASS once ~55 cases are authored.

- [ ] **Step 5: USER VALIDATION GATE**

Present the authored corpus to the user (group by relationship). The user
confirms the labels are correct ground truth. Apply any corrections, re-run the
structural test.

- [ ] **Step 6: Commit**

```bash
git add scripts/eval/memory/eval-set.ts __tests__/eval/memory/eval-set.test.ts
git commit -m "feat: LUM-329 unified AR/SF eval corpus (user-validated) [LUM-329]"
```

---

## Task 4: Fixture generation (LIVE, key-gated)

**Files:**

- Create: `scripts/eval/memory/fixture-gen.ts`
- Create (generated): `scripts/eval/memory/vectors.fixture.json`

- [ ] **Step 1: Write `fixture-gen.ts`**

```ts
// scripts/eval/memory/fixture-gen.ts
/**
 * LIVE, key-gated. Embeds every eval case's candidate + existing text under each
 * qwen3 model and writes vectors.fixture.json. Run once (and re-run when the
 * corpus changes or to re-check model drift). Requires AI_GATEWAY_API_KEY.
 *
 * Usage: npx tsx scripts/eval/memory/fixture-gen.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { embedMany } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { memoryContentToText } from '@/lib/memory/content-text'
import { evalSet } from './eval-set'

export const FIXTURE_MODELS = [
  'alibaba/qwen3-embedding-0.6b',
  'alibaba/qwen3-embedding-4b',
  'alibaba/qwen3-embedding-8b',
] as const

export type FixtureModel = (typeof FIXTURE_MODELS)[number]

export interface VectorsFixture {
  models: string[]
  /** caseId → { candidate: { model → vec }, existing: { model → vec } } */
  cases: Record<
    string,
    { candidate: Record<string, number[]>; existing: Record<string, number[]> }
  >
}

async function embedAll(model: string, texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: gateway.textEmbeddingModel(model),
    values: texts,
  })
  return embeddings
}

async function main(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY required for fixture-gen (live step).')
  }
  const ids = evalSet.map(c => c.id)
  const candidateTexts = evalSet.map(c =>
    memoryContentToText(c.category, c.candidate)
  )
  const existingTexts = evalSet.map(c =>
    memoryContentToText(c.category, c.existing)
  )

  const fixture: VectorsFixture = { models: [...FIXTURE_MODELS], cases: {} }
  for (const id of ids) fixture.cases[id] = { candidate: {}, existing: {} }

  for (const model of FIXTURE_MODELS) {
    // eslint-disable-next-line no-console
    console.log(
      `Embedding ${ids.length} candidate + ${ids.length} existing under ${model}…`
    )
    const [candVecs, existVecs] = await Promise.all([
      embedAll(model, candidateTexts),
      embedAll(model, existingTexts),
    ])
    ids.forEach((id, i) => {
      fixture.cases[id]!.candidate[model] = candVecs[i]!
      fixture.cases[id]!.existing[model] = existVecs[i]!
    })
  }

  const out = join(__dirname, 'vectors.fixture.json')
  writeFileSync(out, JSON.stringify(fixture))
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${out} (${ids.length} cases × ${FIXTURE_MODELS.length} models).`
  )
}

if (require.main === module) {
  // Load .env.local before the gateway reads the key.
  void import('dotenv').then(({ config }) => {
    config({ path: '.env.local' })
    main().catch(err => {
      // eslint-disable-next-line no-console
      console.error(err)
      process.exit(1)
    })
  })
}
```

- [ ] **Step 2: Run it (live)**

Run: `npx tsx scripts/eval/memory/fixture-gen.ts`
Expected: writes `vectors.fixture.json`; logs three "Embedding …" lines and a final count. If the key is absent it throws clearly (gate honored).

- [ ] **Step 3: Sanitization scan before commit**

Run: `git diff --staged --stat` after `git add`, and grep the fixture is numeric-only and the eval-set has no secret-shaped strings:

```bash
grep -nEi 'sk-|api[_-]?key|secret|password|bearer|lum_[a-z0-9]{8}' scripts/eval/memory/eval-set.ts || echo "eval-set: clean"
node -e "const f=require('./scripts/eval/memory/vectors.fixture.json'); const s=JSON.stringify(f); console.log('fixture non-numeric tokens:', /[a-rt-zA-RT-Z]/.test(s.replace(/\"(candidate|existing|models|cases|alibaba\/[^\"]+)\"/g,'')) ? 'CHECK' : 'numeric-only OK')"
```

Expected: `eval-set: clean` and `numeric-only OK`.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval/memory/fixture-gen.ts scripts/eval/memory/vectors.fixture.json
git commit -m "feat: LUM-329 frozen qwen3 vector fixture + generator [LUM-329]"
```

---

## Task 5: Deterministic frozen-fixture AR test

**Files:**

- Create: `__tests__/eval/memory/ar-metrics.frozen.test.ts`

Asserts math invariants over the **real committed fixture** — guards ranking
logic from decay without pinning prod-dependent exact values.

- [ ] **Step 1: Write the test**

```ts
// __tests__/eval/memory/ar-metrics.frozen.test.ts
import fixture from '@/scripts/eval/memory/vectors.fixture.json'
import { evalSet } from '@/scripts/eval/memory/eval-set'
import { isPositiveCase } from '@/scripts/eval/memory/types'
import {
  cosineSimilarity,
  floorSweepWithKnee,
  recallAtK,
  type FloorCase,
  type ScoredItem,
} from '@/scripts/eval/memory/ar-metrics'

const MODEL = 'alibaba/qwen3-embedding-0.6b' // production model

// Build per-case scored views against the shared distractor pool.
function buildScored(model: string) {
  const floorCases: FloorCase[] = []
  const ranked: ScoredItem[][] = []
  for (const c of evalSet) {
    const q = (fixture as any).cases[c.id].candidate[model] as number[]
    const items: ScoredItem[] = []
    let positiveScore: number | null = null
    if (isPositiveCase(c)) {
      positiveScore = cosineSimilarity(
        q,
        (fixture as any).cases[c.id].existing[model]
      )
      items.push({ id: c.id, score: positiveScore, isPositive: true })
    }
    const distractorScores: number[] = []
    for (const other of evalSet) {
      if (other.id === c.id) continue
      const score = cosineSimilarity(
        q,
        (fixture as any).cases[other.id].existing[model]
      )
      distractorScores.push(score)
      items.push({ id: other.id, score, isPositive: false })
    }
    floorCases.push({ positiveScore, distractorScores })
    items.sort((a, b) => b.score - a.score)
    ranked.push(items)
  }
  return { floorCases, ranked }
}

describe('AR metrics over frozen fixture (0.6b)', () => {
  const { floorCases, ranked } = buildScored(MODEL)

  it('recall@10 ≥ recall@1 (monotone in k)', () => {
    expect(recallAtK(ranked, 10)).toBeGreaterThanOrEqual(recallAtK(ranked, 1))
  })

  it('recommended floor lands in a sane band [0.4, 0.85]', () => {
    const floors = Array.from(
      { length: 31 },
      (_, i) => +(0.3 + i * 0.02).toFixed(2)
    )
    const { recommended } = floorSweepWithKnee(floorCases, floors)
    expect(recommended.floor).toBeGreaterThanOrEqual(0.4)
    expect(recommended.floor).toBeLessThanOrEqual(0.85)
  })

  it('most positive cases out-rank their best distractor', () => {
    const wins = floorCases.filter(
      c =>
        c.positiveScore !== null &&
        c.positiveScore > Math.max(0, ...c.distractorScores)
    ).length
    const positives = floorCases.filter(c => c.positiveScore !== null).length
    expect(wins / positives).toBeGreaterThanOrEqual(0.6)
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx jest __tests__/eval/memory/ar-metrics.frozen.test.ts`
Expected: PASS. If the "sane band" or "out-rank" assertion fails, that is a real
signal (corpus too easy/hard or model unsuitable) — investigate before relaxing.

- [ ] **Step 3: Commit**

```bash
git add __tests__/eval/memory/ar-metrics.frozen.test.ts
git commit -m "test: LUM-329 deterministic AR invariants over frozen fixture [LUM-329]"
```

---

## Task 6: SF runner (LIVE, key-gated) + DI unit test

**Files:**

- Create: `scripts/eval/memory/sf-runner.ts`
- Test: `__tests__/eval/memory/sf-runner.test.ts`

- [ ] **Step 1: Write the DI unit test first (no gateway)**

```ts
// __tests__/eval/memory/sf-runner.test.ts
import { scoreSfRun, type SfResult } from '@/scripts/eval/memory/sf-runner'
import type { EvalCase } from '@/scripts/eval/memory/types'

const mk = (
  id: string,
  rel: EvalCase['relationship'],
  op: EvalCase['expectedOp']
): EvalCase => ({
  id,
  category: 'TRAP',
  existing: { trigger: 'a', outcome: 'b' },
  candidate: { trigger: 'c', outcome: 'd' },
  relationship: rel,
  expectedOp: op,
})

describe('scoreSfRun', () => {
  const cases: EvalCase[] = [
    mk('c1', 'CONTRADICTION', 'SUPERSEDE'),
    mk('c2', 'CONTRADICTION', 'SUPERSEDE'),
    mk('d1', 'DUPLICATE', 'NOOP'),
    mk('u1', 'UNRELATED', 'ADD'),
  ]
  // predicted ops: c1 right, c2 wrong (NOOP), d1 wrongly superseded, u1 right
  const predicted: Record<string, SfResult['predictedOp']> = {
    c1: 'SUPERSEDE',
    c2: 'NOOP',
    d1: 'SUPERSEDE',
    u1: 'ADD',
  }
  const results: SfResult[] = cases.map(c => ({
    id: c.id,
    expectedOp: c.expectedOp,
    relationship: c.relationship,
    predictedOp: predicted[c.id]!,
  }))

  it('overall accuracy = 2/4', () => {
    expect(scoreSfRun(results).accuracy).toBeCloseTo(0.5)
  })
  it('SUPERSEDE recall = 1/2 (c1 hit, c2 missed)', () => {
    expect(scoreSfRun(results).supersedeRecall).toBeCloseTo(0.5)
  })
  it('non-conflict protection = 1/2 (d1 wrongly superseded, u1 safe)', () => {
    // of the 2 non-CONTRADICTION cases, 1 was wrongly superseded/deleted
    expect(scoreSfRun(results).nonConflictProtection).toBeCloseTo(0.5)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/eval/memory/sf-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `sf-runner.ts`**

```ts
// scripts/eval/memory/sf-runner.ts
/**
 * LIVE, key-gated. Feeds each eval case to the REAL reconcile LLM (one
 * candidate, one neighbor = its `existing`) and scores the decision against the
 * labeled expectedOp. Inverse of LUM-326 (which mocked the decision). Requires
 * AI_GATEWAY_API_KEY. The reconcile import is dynamic so this module is never
 * pulled into a jest bundle (@ai-sdk/gateway TransformStream trap).
 */
import type { EvalCase, ExpectedOp, Relationship } from './types'

export interface SfResult {
  id: string
  relationship: Relationship
  expectedOp: ExpectedOp
  predictedOp: ExpectedOp | 'DELETE'
}

export interface SfScore {
  n: number
  accuracy: number
  supersedeRecall: number
  nonConflictProtection: number
}

/** Pure aggregation — unit-tested without a gateway. */
export function scoreSfRun(results: SfResult[]): SfScore {
  const n = results.length
  const correct = results.filter(r => r.predictedOp === r.expectedOp).length
  const contradictions = results.filter(r => r.relationship === 'CONTRADICTION')
  const supersedeHits = contradictions.filter(
    r => r.predictedOp === 'SUPERSEDE'
  ).length
  const nonConflicts = results.filter(r => r.relationship !== 'CONTRADICTION')
  // "didn't wrongly delete" = predicted op is not a destructive op on the neighbor
  const protectedCount = nonConflicts.filter(
    r => r.predictedOp !== 'SUPERSEDE' && r.predictedOp !== 'DELETE'
  ).length
  return {
    n,
    accuracy: n === 0 ? 0 : correct / n,
    supersedeRecall:
      contradictions.length === 0 ? 0 : supersedeHits / contradictions.length,
    nonConflictProtection:
      nonConflicts.length === 0 ? 0 : protectedCount / nonConflicts.length,
  }
}

/** Map a reconcile op object to our coarse op label. NOOP/empty → NOOP. */
function opLabel(op: { type: string } | undefined): SfResult['predictedOp'] {
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
      // one neighbor: the case's existing memory, with a stable fake id.
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
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx jest __tests__/eval/memory/sf-runner.test.ts`
Expected: PASS (accuracy 0.5, supersedeRecall 0.5, nonConflictProtection 0.5).

- [ ] **Step 5: Run the live runner (key-gated, smoke)**

Run: `npx tsx scripts/eval/memory/sf-runner.ts`
Expected: JSON with a `score` block (`accuracy`, `supersedeRecall`,
`nonConflictProtection`) and per-case results. This is the SF quality headline.

- [ ] **Step 6: Commit**

```bash
git add scripts/eval/memory/sf-runner.ts __tests__/eval/memory/sf-runner.test.ts
git commit -m "feat: LUM-329 SF reconcile-decision runner + scoring [LUM-329]"
```

---

## Task 7: TTL descriptive report + DI unit test

**Files:**

- Create: `scripts/eval/memory/ttl-report.ts`
- Test: `__tests__/eval/memory/ttl-report.test.ts`

Descriptive only (no ground truth). Reads lineage `used` votes for memory
fragments of category CONVENTION/PROCEDURAL.

- [ ] **Step 1: Write the DI unit test**

```ts
// __tests__/eval/memory/ttl-report.test.ts
import {
  aggregateUsedRate,
  type UsageRow,
} from '@/scripts/eval/memory/ttl-report'

describe('aggregateUsedRate', () => {
  const rows: UsageRow[] = [
    { category: 'CONVENTION', used: true },
    { category: 'CONVENTION', used: false },
    { category: 'CONVENTION', used: null }, // not voted → excluded from denom
    { category: 'PROCEDURAL', used: true },
  ]
  it('used-rate = voted-used / voted, per category', () => {
    const r = aggregateUsedRate(rows)
    expect(r.CONVENTION).toEqual({ usedRate: 0.5, voted: 2, used: 1 })
    expect(r.PROCEDURAL).toEqual({ usedRate: 1, voted: 1, used: 1 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/eval/memory/ttl-report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ttl-report.ts`**

```ts
// scripts/eval/memory/ttl-report.ts
/**
 * DESCRIPTIVE ONLY (LUM-329). Reuses lineage `used=true` votes as a proxy for
 * "an injected CONVENTION/PROCEDURAL fragment got applied". No ground truth —
 * reported in a separate descriptive section, NEVER alongside AR/SF metrics.
 */
import type { MemoryCategory } from '@prisma/client'

export interface UsageRow {
  category: MemoryCategory
  used: boolean | null
}

export type UsedRateByCategory = Partial<
  Record<MemoryCategory, { usedRate: number; voted: number; used: number }>
>

/** voted = used !== null; usedRate = (used === true) / voted, per category. */
export function aggregateUsedRate(rows: UsageRow[]): UsedRateByCategory {
  const acc: UsedRateByCategory = {}
  for (const row of rows) {
    if (row.used === null) continue
    const cur = acc[row.category] ?? { usedRate: 0, voted: 0, used: 0 }
    cur.voted++
    if (row.used) cur.used++
    cur.usedRate = cur.used / cur.voted
    acc[row.category] = cur
  }
  return acc
}

if (require.main === module) {
  void import('dotenv').then(async ({ config }) => {
    config({ path: '.env.local' })
    const { prisma } = await import('@/lib/db/prisma')
    // lineage_edges.fragmentId → memories.id for memory fragments; join to category.
    const rows = await prisma.$queryRaw<UsageRow[]>`
      SELECT m."category" AS category, e."used" AS used
      FROM "lineage_edges" e
      JOIN "memories" m ON m."id" = e."fragmentId"
      WHERE m."category" IN ('CONVENTION', 'PROCEDURAL')
    `
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(aggregateUsedRate(rows), null, 2))
    await prisma.$disconnect()
  })
}
```

- [ ] **Step 4: Run the unit test**

Run: `npx jest __tests__/eval/memory/ttl-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval/memory/ttl-report.ts __tests__/eval/memory/ttl-report.test.ts
git commit -m "feat: LUM-329 descriptive TTL used-rate report [LUM-329]"
```

---

## Task 8: Orchestrator `run.ts`

**Files:**

- Create: `scripts/eval/memory/run.ts`

Ties offline AR (always) + live SF (key-gated) + descriptive TTL into one report
printing the two-line headline and the `(model, floor, threshold)` triple.

- [ ] **Step 1: Write `run.ts`**

```ts
// scripts/eval/memory/run.ts
/**
 * LUM-329 memory eval orchestrator. Offline AR always runs from the frozen
 * fixture; SF runs only when AI_GATEWAY_API_KEY is present (key-gated quality
 * headline); TTL is descriptive. Prints the calibration (model, floor,
 * recall@k threshold) triple.
 *
 * Usage: npx tsx scripts/eval/memory/run.ts
 */
import fixture from './vectors.fixture.json'
import { evalSet } from './eval-set'
import { isPositiveCase, type EvalCase } from './types'
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

const FLOORS = Array.from(
  { length: 31 },
  (_, i) => +(0.3 + i * 0.02).toFixed(2)
)
const PROD_MODEL = 'alibaba/qwen3-embedding-0.6b'

function arForModel(model: string) {
  const floorCases: FloorCase[] = []
  const ranked: ScoredItem[][] = []
  const sepCases: SeparationCase[] = []
  for (const c of evalSet) {
    const q = (fixture as any).cases[c.id].candidate[model] as number[]
    let positiveScore: number | null = null
    const items: ScoredItem[] = []
    if (isPositiveCase(c)) {
      positiveScore = cosineSimilarity(
        q,
        (fixture as any).cases[c.id].existing[model]
      )
      items.push({ id: c.id, score: positiveScore, isPositive: true })
    }
    const distractorScores: number[] = []
    for (const other of evalSet) {
      if (other.id === c.id) continue
      const s = cosineSimilarity(
        q,
        (fixture as any).cases[other.id].existing[model]
      )
      distractorScores.push(s)
      items.push({ id: other.id, score: s, isPositive: false })
    }
    floorCases.push({ positiveScore, distractorScores })
    items.sort((a, b) => b.score - a.score)
    ranked.push(items)
    if (positiveScore !== null)
      sepCases.push({ positiveScore, distractorScores })
  }
  const { recommended } = floorSweepWithKnee(floorCases, FLOORS)
  return {
    floor: recommended.floor,
    f1: recommended.f1,
    precision: recommended.precision,
    recall: recommended.recall,
    recallAt10: recallAtK(ranked, 10),
    separation: separation(sepCases),
  }
}

// Lexical recall@10 over the same corpus (no vectors) → upgrade-trigger basis.
function lexicalRecallAt10(): number {
  const ranked: ScoredItem[][] = []
  for (const c of evalSet) {
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
    for (const other of evalSet) {
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
  return recallAtK(ranked, 10)
}

async function main(): Promise<void> {
  const models: string[] = (fixture as any).models
  const arByModel = Object.fromEntries(models.map(m => [m, arForModel(m)]))
  const prod = arByModel[PROD_MODEL]
  const lexRecall = lexicalRecallAt10()
  const n = evalSet.filter(isPositiveCase).length

  // eslint-disable-next-line no-console
  const log = console.log
  log('=== LUM-329 Memory Eval ===\n')
  log('— AR (offline, deterministic) —')
  for (const m of models) {
    const a = arByModel[m]!
    log(
      `  ${m}: floor*=${a.floor} F1=${a.f1.toFixed(3)} recall@10=${a.recallAt10.toFixed(3)} sep(mean/min)=${a.separation.mean.toFixed(3)}/${a.separation.min.toFixed(3)}`
    )
  }
  log(
    `  lexical recall@10 = ${lexRecall.toFixed(3)} (embedding ${PROD_MODEL} recall@10 = ${prod!.recallAt10.toFixed(3)})`
  )

  let sf: ReturnType<typeof scoreSfRun> | null = null
  if (process.env.AI_GATEWAY_API_KEY) {
    const { runSf } = await import('./sf-runner')
    sf = scoreSfRun(await runSf(evalSet))
  }

  log('\n— HEADLINE —')
  log(
    `  [regression]  AR F1 @ floor ${prod!.floor} (${PROD_MODEL}) = ${prod!.f1.toFixed(3)}  (n=${n})`
  )
  log(
    `  [quality]     SF op-accuracy = ${sf ? sf.accuracy.toFixed(3) : 'SKIPPED (no AI_GATEWAY_API_KEY)'}`
  )
  if (sf)
    log(
      `                  SUPERSEDE recall=${sf.supersedeRecall.toFixed(3)} non-conflict protection=${sf.nonConflictProtection.toFixed(3)}`
    )

  log('\n— CALIBRATION TRIPLE (回改 LUM-324) —')
  // Pick the model with the best separation mean as the selection candidate.
  const best = models.reduce(
    (b, m) =>
      arByModel[m]!.separation.mean > arByModel[b]!.separation.mean ? m : b,
    models[0]!
  )
  log(
    `  selected model:   ${best} (best separation mean ${arByModel[best]!.separation.mean.toFixed(3)} vs 0.6b ${prod!.separation.mean.toFixed(3)})`
  )
  log(
    `  EMBEDDING_SCORE_FLOOR: ${arByModel[best]!.floor} (empirical knee, n=${n})`
  )
  log(
    `  upgrade recall@k:  lexical recall@10=${lexRecall.toFixed(3)} → switch to embedding when below the embedding ${prod!.recallAt10.toFixed(3)} baseline`
  )

  log('\n— DESCRIPTIVE (no ground truth; not a capability score) —')
  log(
    '  TTL used-rate: run `npx tsx scripts/eval/memory/ttl-report.ts` (lineage proxy).'
  )
}

if (require.main === module) {
  void import('dotenv').then(({ config }) => {
    config({ path: '.env.local' })
    main().catch(err => {
      /* eslint-disable-next-line no-console */ console.error(err)
      process.exit(1)
    })
  })
}
```

- [ ] **Step 2: Run the orchestrator (offline AR always; SF if key present)**

Run: `npx tsx scripts/eval/memory/run.ts`
Expected: prints AR per-model, the two-line headline, and the calibration triple.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval/memory/run.ts
git commit -m "feat: LUM-329 eval orchestrator (headline + calibration triple) [LUM-329]"
```

---

## Task 9: Calibrate constants from the live numbers

**Files:**

- Modify: `lib/services/memory/embedding-neighbor-retriever.ts:15` (the `EMBEDDING_SCORE_FLOOR` comment + value, only if the evidence warrants a change)
- Modify: `lib/services/memory/neighbor-retriever.ts:18` (upgrade-trigger seam comment → point at the empirical threshold)
- Modify: `lib/ai/embedding.ts:6` (model-selection comment → record the 0.6b-vs-4B/8B evidence and the decision)

- [ ] **Step 1: Run the full harness and capture numbers**

Run: `npx tsx scripts/eval/memory/run.ts` and `npx tsx scripts/eval/memory/ttl-report.ts`. Record the headline + triple.

- [ ] **Step 2: Update `EMBEDDING_SCORE_FLOOR`**

Replace the placeholder comment with the empirical result. Example (use real
numbers from Step 1):

```ts
/**
 * Cosine-similarity floor for the embedding path. Calibrated by the LUM-329 eval
 * harness over a 55-case in-domain corpus (qwen3-embedding-0.6b): the
 * precision/recall knee sits at <FLOOR> (F1 <F1>, n=<N>). UNRELATED candidates
 * score below this; same-fact paraphrases clear it. Re-derive via
 * `npx tsx scripts/eval/memory/run.ts` if the model changes (floor is
 * model-coupled — a different model re-opens the sweep).
 */
export const EMBEDDING_SCORE_FLOOR = <FLOOR>
```

- [ ] **Step 3: Update the upgrade-trigger and model-selection seam comments**

In `neighbor-retriever.ts`, replace "revisit via the LUM-329 eval harness" with
the empirical lexical recall@10 vs embedding recall@10 and the resulting switch
rule. In `embedding.ts`, record the model decision (keep 0.6b vs switch to 4B/8B)
with the separation-mean evidence.

- [ ] **Step 4: Verify nothing else broke**

Run: `npx tsc --noEmit` and `npx jest __tests__/eval __tests__/memory.repository.embedding.test.ts __tests__/lib/services/memory`
Expected: no TS errors; all memory + eval tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/embedding-neighbor-retriever.ts lib/services/memory/neighbor-retriever.ts lib/ai/embedding.ts
git commit -m "feat: LUM-329 calibrate embedding floor/threshold/model from eval [LUM-329]"
```

---

## Task 10: Memories + full verification + PR

**Files:** none (CLI + git)

- [ ] **Step 1: Full test + type gate**

Run: `npx tsc --noEmit && npx jest __tests__/eval`
Expected: clean tsc; all eval tests green. Also run the broader memory suite:
`npx jest memory` (both `__tests__/` and `tests/` roots — two-test-root convention).

- [ ] **Step 2: Record the calibration as memory**

```bash
lumo task memory add LUM-329 --category DECISION \
  --summary "LUM-329 calibration: (model, floor, upgrade) triple" \
  # what/why fields capturing: chosen model + empirical floor interval + upgrade recall@k
lumo task memory add LUM-329 --category PROCEDURAL \
  --summary "Memory eval protocol: fixture-gen → run.ts → calibrate" \
  # workflow/trigger/steps for re-running the harness
```

(Use the real `lumo task memory add` flags from `references/memory.md`; capture
the floor interval, the 0.6b-vs-4B/8B separation numbers, and the SF accuracy.)

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin lumo/LUM-329-memory-eval-harness
gh pr create --title "feat: in-domain memory eval harness + calibration [LUM-329]" \
  --body "<summary: harness, the (model,floor,threshold) triple, SF accuracy, no schema/dep change>"
```

PR body must note: no schema change, no new npm dep, live numbers gated on
`AI_GATEWAY_API_KEY`, and the calibration constants that changed.

- [ ] **Step 4: Mark task in_review (not done — PR open)**

Per the no-done-without-verification convention: keep LUM-329 `in_review` while
the PR is open; only DONE after merge + verification.

---

## Self-Review notes (author)

- **Spec coverage:** AR floor sweep (T2/T5/T8) ✓; upgrade recall@k threshold (T8 lexical-vs-embedding) ✓; model selection 0.6b/4B/8B (T4 fixture + T8 separation) ✓; SF decision quality (T6) ✓; TTL descriptive (T7) ✓; unified corpus (T3) ✓; two-line headline (T8) ✓; (model,floor,threshold) triple (T8/T9) ✓; offline reproducibility (T5 frozen test) ✓; key-gating (T4/T6 entries) ✓; sanitization (T4 step 3) ✓; calibrate-back constants (T9) ✓; DECISION+PROCEDURAL memories (T10) ✓.
- **Type consistency:** `EvalCase`/`Relationship`/`ExpectedOp`/`relationshipToExpectedOp`/`isPositiveCase`/`validateEvalCase` (T1) reused verbatim in T3/T5/T6/T8. `FloorCase`/`ScoredItem`/`SeparationCase`/`floorSweepWithKnee`/`recallAtK`/`separation`/`cosineSimilarity` (T2) reused in T5/T8. `SfResult`/`SfScore`/`scoreSfRun`/`runSf` (T6) reused in T8. `UsageRow`/`aggregateUsedRate` (T7).
- **Placeholder scan:** the only intentional `<FLOOR>/<F1>/<N>` placeholders are in T9 comment text, filled from live Step-1 output (the numbers don't exist until the harness runs) — not plan gaps.

```

```
