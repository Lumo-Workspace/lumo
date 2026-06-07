# LUM-279 — Lineage-aware context ranking + budget trim (session-start)

**Date**: 2026-06-06
**Task**: LUM-279 `[stretch] Lineage-aware context ranking + budget trim`
**Milestone**: Context Lineage (System of Record)
**Status**: design approved, pre-implementation

## Context

`lumo` injects task context into the coding agent through two paths:

- **Path A — session-start auto-injection** (`taskContextService.buildSessionStartSections`):
  a global **2500-token** budget (`SESSION_START_BUDGET_TOKENS`) filled greedily by
  `allocateBudget` in fixed type-priority order `memory > PR > Slack > Figma > web`.
  Overflowed cards degrade to one-line manifests. **The budget actually bites here**,
  so ordering changes what the agent sees.
- **Path B — on-demand `lumo task context`** (`getContextForIdentifier`): only memory
  is budgeted (1000 tokens); other sections render in full. Appends the LUM-278
  flywheel signal at the end.

Today, ordering is purely type-priority + memory project-first. There is no
ranking by merge contribution, and the rendered body does not de-duplicate
fragments (only the trailing flywheel signal dedupes its own lines).

LUM-279 is a deliberately-deferred **stretch** item bridging to the next milestone
(方向二, Context-as-a-service). Its prerequisites (LUM-275/276/277/278/280/281/282)
are merged, so the lineage data needed to rank by merge contribution now exists.

## Scope (decided)

| Decision            | Choice                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Injection path      | **Path A only** (session-start, 2500-token budget)                                            |
| Ranking granularity | **Within-section reorder**; cross-type priority `memory > PR > Slack > Figma > web` unchanged |
| Sort tiers          | **Three tiers**: high-merge ↑ / cold-start (no signal) middle / proven-low-merge ↓            |
| High/low boundary   | **Fixed 50%** merge rate (`merged/resolved`), 50% inclusive into high tier                    |
| Dedup               | **Collapse memory duplicates by canonical id**, keep the PROJECT (curated) entry              |

**Explicitly out of scope (YAGNI / known debt)**: Path B ranking/trim; cross-section
unified ranking; adaptive (workspace-mean) threshold; dedup of non-memory types;
true causal counterfactual re-runs.

## Goal

Upgrade Path A from "全量拼盘" to "按 merge 贡献度排序 + 控 token 预算裁剪 + 去重":
make fragments that historically lead to merged work survive the 2500-token budget,
push proven-low-contribution fragments to the manifest tail first, and stop spending
budget rendering the same memory lesson twice (pre/post consolidation).

## Why this duplicate exists (verified)

Layer-2 consolidation promotes a TASK memory into a **new** PROJECT memory row
(distinct id) and records the parent→child link in `MemoryProvenance`; the original
TASK row stays active. For a task in that project, `buildSessionStartSections`'
`orderedMemories` therefore contains **both** rows — the same lesson twice.
`memoryProvenanceRepository.resolveCanonicalFragment('MEMORY', id)` collapses the
TASK cuid to the promoted PROJECT cuid, so de-duplication by canonical id is exact.
Caveat: consolidation may rewrite/merge wording, so the two rows are the same
_lineage_ but not byte-identical _content_ — collapsing keeps the curated PROJECT
phrasing and drops the task-phrased original. That is the intended outcome.

## Architecture & data flow

Insert two steps into `buildSessionStartSections`, before `allocateBudget`. The
budget layer (`lib/context/budget.ts`), the 2500 number, the manifest-degradation
mechanism, and the five section builders are **untouched**.

```
fetch (unchanged: memories, slack, web, figma, prs)
  → ① dedupeMemoriesByCanonical(orderedMemories, resolveCanonical)
        // collapse TASK+PROJECT duplicate by canonical id, keep PROJECT (keep-first)
  → ② scoreFragments(refs) → Map<key,{resolvedTasks, mergedTasks}>
        // reuse lineageEdgeRepository.mergeRateByFragments (same data as Path B signal)
  → ③ per section: rankByLineage(cards, keyOf, statByKey)  // three-tier stable sort
  → allocateBudget([memory, pr, slack, figma, web], 2500)   // UNCHANGED
  → fragments manifest = the de-duped + reordered actually-injected set
```

### Fragment-key contract (LUM-276 consistency)

The `fragments: FragmentRef[]` returned by `buildSessionStartSections` is the
**write key** for lineage edges (LUM-276) — `[sessionId, taskId, fragmentType,
fragmentId]`. Implications:

- **Reorder** changes order only; the edge unique-key is order-independent, so
  reordering cannot change edge identity.
- **Dedup** removes a fragment from _both_ the rendered body and the manifest. A
  fragment that is not injected must not produce an edge, so dropping the TASK
  duplicate from `fragments` is correct and keeps write-key == read-key.
- In Path A, overflowed cards still render as manifest one-liners (still injected),
  so they remain in `fragments` — only deduped fragments leave the set.

### Lineage keys per type

- **MEMORY**: score/dedup key = `resolveCanonicalFragment('MEMORY', id)` (canonical).
  One resolve per memory serves both dedup and scoring.
- **SLACK_CONTEXT / WEB_LINK / FIGMA / PR**: id is already the lineage key (these
  types never re-key), used directly.

## New units

### `lib/lineage/ranking.ts` (pure)

```ts
export const LINEAGE_RANK_HIGH_THRESHOLD = 0.5
// cold-start floor reused from lineage-signal: LINEAGE_MIN_RESOLVED_TASKS = 3

export type LineageTier = 0 | 1 | 2 // 0 = high (top), 1 = cold (middle), 2 = low (bottom)

export interface LineageStat {
  resolvedTasks: number
  mergedTasks: number
}

export function tierOf(stat: LineageStat | undefined): LineageTier
// undefined || resolvedTasks < LINEAGE_MIN_RESOLVED_TASKS        → 1 (cold)
// resolvedTasks >= floor && merged/resolved >= 0.5               → 0 (high)
// resolvedTasks >= floor && merged/resolved <  0.5               → 2 (low)

export function rankByLineage<T>(
  items: T[],
  keyOf: (item: T) => string,
  statByKey: Map<string, LineageStat>
): T[]
// STABLE sort by:
//   tier ascending (0 first)
//   within high tier: merge% descending, then resolvedTasks descending (more evidence wins)
//   cold + low tiers: preserve input order (existing project-first / link order)
```

- All-cold input (the common early state) ⇒ every item tier 1 ⇒ stable sort is the
  identity ⇒ feature is invisible until lineage data accrues. Matches the milestone's
  cold-start gating philosophy.

### `dedupeMemoriesByCanonical` (async helper)

```ts
async function dedupeMemoriesByCanonical(
  ordered: RenderableMemory[],
  resolveCanonical: (type: string, id: string) => Promise<string>
): Promise<RenderableMemory[]>
// resolve each memory → canonical id; keep-first by canonical id.
// orderedMemories is project-first, so keep-first retains the PROJECT (canonical) row
// and drops the TASK duplicate.
```

### `scoreFragments` (async helper)

Build lineage refs (memory canonical + raw slack/web/figma/pr ids), call
`lineageEdgeRepository.mergeRateByFragments(refs)` once, return
`Map<\`${type}::${id}\`, LineageStat>`. Same data source as `assembleLineageSection`.

## Safety / fallback

The whole score + dedup + rank block is wrapped so it **never throws and never
blocks** session-start's 3-second budget:

- Any lineage query failure ⇒ fall back to **today's behavior**: fixed order, no
  dedup. Session-start still injects everything.
- Mirrors the never-throw ethos of `assembleLineageSection`.
- `resolveCanonicalFragment` is depth/cycle-guarded already (MAX_RESOLVE_DEPTH = 16).

## Testing

- **`rankByLineage` / `tierOf` unit tests**: three-tier ordering; the 50% boundary
  (exactly 50% lands in high tier); stability (same-tier items keep input order);
  evidence tiebreak (higher `resolvedTasks` wins within high tier); all-cold input
  is the identity permutation.
- **`dedupeMemoriesByCanonical` unit test**: a TASK row and its promoted PROJECT row
  sharing a canonical id collapse to one entry, and the PROJECT row is the survivor.
- **Integration test on `buildSessionStartSections`**: with a high-merge memory and a
  low-merge memory contending for the budget, assert the high-merge one renders full
  and survives while the low-merge one sinks to the manifest tail; assert the returned
  `fragments` manifest equals the de-duped + reordered actually-injected set.
- **Fallback test**: when the lineage scoring dependency throws, output order equals
  today's fixed order and nothing is deduped.

## Files touched

- `lib/lineage/ranking.ts` — new pure ranking module.
- `lib/services/task-context.service.ts` — `buildSessionStartSections`: dedup +
  score + rank steps, safe-wrapped; fragments manifest reflects the injected set.
- (helper for `scoreFragments` / `dedupeMemoriesByCanonical` co-located in
  task-context.service.ts or a small `lib/lineage/` helper — decided in the plan.)
- `__tests__/` — ranking unit tests, dedup unit test, session-start integration +
  fallback tests.

No Prisma schema change. No new npm package. `budget.ts` and the five section
builders are unchanged.
