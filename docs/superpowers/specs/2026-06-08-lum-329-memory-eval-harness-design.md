# LUM-329 — In-domain memory eval harness

**Milestone:** Memory v6: Reconcile-on-Write & Lifecycle
**Status:** design (approved approach A, pending spec review)
**Date:** 2026-06-08

## Goal

Build a runnable, partly-deterministic eval harness that measures the memory
system's **retrieval / application correctness** — did we retrieve the right
neighbor, did we resolve the conflict correctly — as distinct from the flywheel's
**outcome** signal (lineage merge-rate). This closes the "可度量 eval" slice of
the milestone and discharges the calibration TODOs that LUM-324/325/326 explicitly
parked on LUM-329:

1. `EMBEDDING_SCORE_FLOOR` — empirical value (currently the placeholder `0.6` at
   `lib/services/memory/embedding-neighbor-retriever.ts:15`).
2. Neighbor-retriever **upgrade trigger** — the lexical recall@k below which we
   should switch to embedding / a bigger model
   (`lib/services/memory/neighbor-retriever.ts` seam).
3. **Model selection** — qwen3-embedding-0.6b vs 4B/8B separation numbers
   (`EMBEDDING_MODEL` / `EMBEDDING_DIM` at `lib/ai/embedding.ts:6`).

This harness covers the **retrieve** + **answer** legs of the
preserve/retrieve/answer attribution; the flywheel covers outcome. They are
complementary and must not be conflated.

## Confirmed facts (probed 2026-06-08)

- `AI_GATEWAY_API_KEY` is present in `.env.local`; the live path runs locally.
- Gateway serves all three models: `qwen3-embedding-0.6b` (1024-d),
  `qwen3-embedding-4b` (2560-d), `qwen3-embedding-8b` (4096-d).
- Seed pool: **prod has 790 ACTIVE embedded memories** (DECISION 311, PROCEDURAL
  237, TRAP 152, CONVENTION 90) — rich source for seeding realistic perturbations.

## Approach (A): DI-core harness + frozen-vector fixture + key-gated live runners

Mirrors the existing `scripts/backfill-memory-embeddings.ts` pattern (DI-testable
core + thin `require.main === module` entry). The deterministic ranking math runs
offline against a checked-in fixture of real qwen3 vectors (computed once via the
key, frozen); the decision-quality and fixture-generation steps are key-gated.

### Core decision: one unified corpus, not two disjoint sets

A single labeled corpus of **~50–60 cases** drives both AR and SF. Each case:

```ts
type Relationship = 'CONTRADICTION' | 'REFINEMENT' | 'DUPLICATE' | 'UNRELATED'
type ExpectedOp = 'SUPERSEDE' | 'UPDATE' | 'NOOP' | 'ADD'

interface EvalCase {
  id: string // stable slug, e.g. "sf-prisma-drift-01"
  category: MemoryCategory // TRAP | DECISION | CONVENTION | PROCEDURAL
  existing: unknown // the on-file memory content (per-category shape)
  candidate: unknown // the newly-extracted fact content
  relationship: Relationship // human-readable label of why
  expectedOp: ExpectedOp // machine label, derived 1:1 from relationship
  note?: string // annotator rationale (not fed to the model)
}
```

`relationship → expectedOp` is fixed: CONTRADICTION→SUPERSEDE, REFINEMENT→UPDATE,
DUPLICATE→NOOP, UNRELATED→ADD. `DELETE` is out of scope (the reconcile prompt
treats it as rare/"merely confirms it should go" — hard to construct realistically;
noted as a gap, not covered).

**Why merge (per review ①):** one annotation yields both metrics, forces the AR
and SF labels to agree on the same pair, and lifts SF coverage from ~25 to ~55.
It also wires retrieve + answer on the _same_ data.

### Deriving AR from the unified corpus

For each case, the **candidate** is the query.

- **Non-ADD** (SUPERSEDE/UPDATE/NOOP): the case's `existing` is the AR
  **positive** — the memory the candidate query should retrieve as a neighbor.
- **ADD** (UNRELATED): there is **no positive** — the correct AR behavior is that
  _no_ pool member clears the floor. These cases test the floor's **precision**.
- **Distractor pool** = every _other_ case's `existing` content (shared pool of
  ~50–60 members). This is a realistic task/project-scope size, and a positive
  must out-rank ~55 distractors to count.

Vectors for every `candidate` and `existing` text, under all three models, are
frozen into the fixture (see Fixture generation).

### Capability dimensions (MemoryAgentBench; LRU skipped)

- **AR — accurate retrieval (offline, deterministic).** Over the frozen vectors:
  1. **Floor sweep** `f ∈ [0.30, 0.90] step 0.02`. Per `(query, pool-member, f)`:
     a non-ADD positive admitted (`cos ≥ f`) → TP; a distractor admitted → FP;
     positive not admitted → FN; for ADD cases any admission → FP, none → TN.
     Aggregate precision/recall per floor → the knee is the empirical
     `EMBEDDING_SCORE_FLOOR`. **Swept per model** (see review ②).
  2. **recall@k** (k = `NEIGHBOR_K` = 10): fraction of non-ADD cases whose positive
     is in the top-k by cosine. Computed for **embedding** and for **lexical**
     (`bigramSimilarity` imported directly from `lib/similarity` — never re-implemented,
     so the eval's lexical scoring matches production exactly). The lexical recall@k
     is the basis for the upgrade-trigger threshold.
  3. **Separation margin** per model: distribution of
     `cos(candidate, positive) − max_d cos(candidate, distractor)` over non-ADD
     cases → margin → model-selection number.
  - Cosine here is `dot(a,b)/(‖a‖‖b‖)` computed in JS, matching pgvector's
    cosine semantics (`score = 1 − (embedding <=> q)`); it is **not** raw dot
    product (qwen vectors are not assumed unit-normalized).
- **SF — selective forgetting (live, key-gated). The quality headline.** Each case
  is fed as a single-candidate / single-neighbor reconcile input through the
  **real** `buildLayer1ReconcilePrompt` + `generateObject` (model
  `deepseek/deepseek-v4-flash`, same as production). Metrics:
  - **SUPERSEDE recall** — of CONTRADICTION cases, fraction the LLM judged SUPERSEDE.
  - **Non-conflict protection** — of non-CONTRADICTION cases, fraction _not_ wrongly
    superseded/deleted ("不该动的没误删").
  - **Overall op-accuracy** — fraction matching `expectedOp`.
    This is the inverse of LUM-326 (which mocked the decision to test the pipeline;
    here we test only the decision).
- **TTL — deployment learning (descriptive only, may defer).** Reuse lineage
  `used=true` voting: of injected CONVENTION/PROCEDURAL fragments, the fraction
  voted used. **Read-only over prod lineage, no ground truth → a proxy-of-proxy.**
  Reported in a clearly separated **Descriptive** section, never alongside the
  ground-truth AR/SF metrics (review ③). Acceptable to defer until real ground
  truth exists.

### Headline: two numbers, distinct jobs (review revision)

- **AR F1 @ recommended floor** — offline, deterministic, **CI-gateable**.
  The **regression guard**: catches ranking-math decay.
- **SF op-accuracy** — live, key-gated. The **quality story** (the hard, valuable
  capability). AR does not stand in for SF.

A synthetic cross-dimension composite is intentionally avoided (weak semantics).

### Deliverable: a coupled (model, floor, threshold) triple — not three knobs

Because cosine scale differs across models, `EMBEDDING_SCORE_FLOOR` is only valid
for the model it was swept on. The calibration output is **one triple**:

1. **Selected embedding model** (with the 0.6b-vs-4B/8B separation evidence).
2. **Its** empirical `EMBEDDING_SCORE_FLOOR`, reported as an **interval with n**
   (~55 samples → the recommended value carries a CI; consistent with the
   cold-start/confidence convention elsewhere), not a bare point value.
3. The lexical→embedding **upgrade recall@k threshold**.

Picking a different model re-opens the floor sweep for that model.

## File layout (`scripts/eval/memory/`, mirroring backfill)

| File                   | Role                                                                                                                                                         | Imports gateway?    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `eval-set.ts`          | the ~50–60 unified `EvalCase[]` + `Relationship→ExpectedOp` map. Reviewable artifact.                                                                        | no                  |
| `ar-metrics.ts`        | **pure**: `cosineSimilarity`, `floorSweep`, `recallAtK`, `separation`. Imports `bigramSimilarity` from `lib/similarity`.                                     | no (jest-safe)      |
| `vectors.fixture.json` | frozen vectors keyed by `{caseId, role: candidate\|existing, model}`.                                                                                        | n/a (data)          |
| `fixture-gen.ts`       | **live**: embed all corpus texts under 0.6b/4b/8b, write the fixture. Dynamic-imports `lib/ai/embedding`.                                                    | yes (runnable only) |
| `sf-runner.ts`         | **live**: run reconcile LLM per case, return op-accuracy. Dynamic-imports the gateway-touching extract.                                                      | yes (runnable only) |
| `ttl-report.ts`        | **descriptive**: lineage used-rate for CONVENTION/PROCEDURAL.                                                                                                | no (prisma)         |
| `run.ts`               | thin orchestrator: offline AR (always) + live SF (key-gated) + descriptive TTL; prints two-line headline + breakdown + the (model, floor, threshold) triple. | dynamic             |

Deterministic test: `__tests__/eval/memory/ar-metrics.test.ts` runs `ar-metrics`
over the committed fixture and asserts the **math, not prod-exact values**:
positives out-rank their distractors, the recommended floor lands in a sane band,
recall@k is monotone in k. (Model drift is caught by the intentional live
fixture-gen step, not by this test.) One test root suffices unless a shared
suite emerges; not duplicated into `tests/`.

## Workflow

1. I draft `eval-set.ts` (texts authored by me, _inspired by_ real prod memories —
   not raw-copied, which naturally sanitizes), ~35 derived-AR-positive cases
   (SUPERSEDE/UPDATE/NOOP) + ~20 ADD cases, balanced across categories.
2. **You validate the eval set** (the labels are the ground truth; this is the
   reviewable gate).
3. `fixture-gen` (live) embeds the corpus under all three models → `vectors.fixture.json`.
4. `run.ts` produces AR (offline) + SF (live) + TTL (descriptive) → headline,
   breakdown, and the (model, floor, threshold) triple.
5. Write the calibration back: update the three constants if the evidence warrants,
   with the empirical interval in the comments.
6. Memory output: **DECISION** (chosen eval set + floor/model calibration
   conclusions) + **PROCEDURAL** (the eval protocol).

## Gating / risk

- Live parts (SF decision quality, fixture-gen) gate on `AI_GATEWAY_API_KEY`
  presence, per the LUM-324 Task-8 convention — **key absent ⇒ not marked done**.
  Offline floor sweep / recall / separation run from the fixture without a key.
- **Sanitization:** `eval-set.ts` and `vectors.fixture.json` are checked in →
  scan for secrets / internal identifiers before commit; authoring (not copying)
  the case text is the first line of defense.
- Annotation is the main effort; scale held at ~50–60, realistic (no cross-domain
  analogies — the LUM-324 live-validation trap).
- Model selection may trigger a follow-up "swap model + change dimension column"
  migration task; out of scope here (this task produces the _evidence_).
- No schema change, no new npm dependency.

## Out of scope

- Changing `EMBEDDING_DIM` / the pgvector column (a model swap is a separate task).
- DELETE-op evaluation. The flywheel / merge-rate (already covered). LRU capability.
