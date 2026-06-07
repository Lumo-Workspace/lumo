# LUM-276 — Record lineage edges when a run consumes the context bundle

**Status:** Approved (design)
**Milestone:** Context Lineage (System of Record)
**Depends on:** LUM-274/280 (stable fragment IDs), LUM-275 (`LineageEdge` table + repo), LUM-281 (per-run/session cost)

## Problem

The milestone's core asset is the **edge**: `context fragment → run → outcome (+ cost)`.
LUM-275 created the `LineageEdge` table and `lineageEdgeRepository`, but **nothing
writes to it yet**. This task makes edges *be born*: when a session consumes the
injected context bundle, record one edge per injected fragment.

The hard requirement (DoD ⑥) is **coverage without sampling bias**: context is
injected from more than one path, so if we instrument the wrong subset, LUM-278's
flywheel merge-rate denominator is systematically biased.

## Scope decision (coverage)

Context injection points were enumerated. **MVP records edges at the
`session-start` hook path only.**

| Injection point | sessionId | runId | Decision |
|---|---|---|---|
| **session-start hook** (`POST /api/hooks/session-start`) | ✅ | ❌ | **Record.** Injects memory + linked resources + PR-review todos + Layer-2 review. This is exactly the ⑥ bias surface. |
| manual `lumo task context` (`/api/tasks/context/[identifier]`) | ❌ | ❌ | **Skip** — no session ⇒ "带 sessionId 才记". A non-run human read must not pollute the denominator. |
| cloud agent sandbox (`lib/agent/context-builder.ts`) | ❌ (not in RunContext) | ✅ | **Deferred follow-up.** The lightweight context-builder does not build a fragment manifest; instrumenting it is a separate enrichment. |
| Layer-2 consolidation | ✅ | ❌ | Out of band; its promoted memories are surfaced (and recorded) at the *next* session-start. |

Edges are written **only when `binding.bound === true` and `sessionId` is present** —
the existing route guard already enforces this.

## Architecture & data flow

```
SessionStart hook (CLI)
  → POST /api/hooks/session-start  (afterRecord, already waitUntil-friendly)
      → 4 builders each return { rendered section, fragments: FragmentRef[] }
      → waitUntil(
           lineageService.recordSessionStartEdges({ workspaceId, taskId, sessionId, fragments })
         )
            → resolveCanonicalFragment() on MEMORY fragments
            → dedup
            → lineageEdgeRepository.createMany({ skipDuplicates: true })
```

- New `lib/services/lineage.service.ts` owns the write logic (repository already
  exists). Route stays thin (convention: routes call services, not Prisma).
  LUM-278's aggregate/audit logic will also land here.
- Edge write runs in **`waitUntil`** (mirrors `task-state.service.ts` /
  `_handler.ts`): does not block the 3s session-start budget; failure is isolated
  and cannot break context injection or flip the hook response.
- `ctx.workspaceId`, `ctx.sessionId` are already on `AfterRecordContext`; `taskId`
  comes from `binding.taskId` (the bound task).

## Fragment manifest — "actually-injected" semantics (anti-bias)

Each builder returns the fragments it **actually injected (post-budget)** — single
source of truth, no re-derivation drift.

| Builder | Fragment type(s) | Semantics |
|---|---|---|
| `buildSessionStartSections` | MEMORY, SLACK_CONTEXT, WEB_LINK, FIGMA, PR | `allocateBudget` **degrades overflow to a one-line manifest, never drops** → record **all candidates** (they all appear in the injected text). |
| `buildReviewTodosSectionForTask` | PR_REVIEW_TODO | `collectReviewTodos` already returns `fragmentIds`, no truncation → record all. |
| `buildLayer2ReviewSectionForTask` | MEMORY | `applyTokenBudget` **drops the tail** → record **survivors only**. |
| `buildPreviousSessionRecoveryForTask` | SESSION | Return is extended with `sessionId`; record that one. |

- **MEMORY fragments pass through `memoryProvenanceRepository.resolveCanonicalFragment`**
  so promoted PROJECT memories are stored under their canonical id (LUM-280 drift).
- A memory can appear in both the main memory section and the Layer-2 review section
  → **dedup** in the service.
- Covering **every** fragment type session-start injects ⇒ no systematic bias.

## Idempotence (approved: DB unique index)

SessionStart fires multiple times per session (startup / resume / clear / compact
matchers) with the **same sessionId**. One fragment injected into one session is
**one edge**, semantically.

- Add `@@unique([sessionId, taskId, fragmentType, fragmentId])` to `LineageEdge`;
  write with `createMany({ skipDuplicates: true })`.
- `taskId` is in the key because a session can **rebind** to a different task
  (`lumo session attach --force`); a PROJECT fragment shared across two tasks in the
  same session must record one edge **per task**, not be deduped away.
- Nullable `sessionId`: Postgres treats NULLs as distinct, so future runId-only edges
  (sessionId NULL) never collide with the constraint.
- Also absorbs the cross-builder MEMORY duplicate at the DB layer.
- **Migration is additive** (index only, no data change). PR description must note
  `migrate deploy` is required on next deploy; if dev-DB drift blocks `migrate dev`,
  use the offline `migrate diff` workaround (per CLAUDE.md / project memory).

## Error handling & isolation

- Whole edge write is inside `waitUntil` and `recordSessionStartEdges` self-catches —
  canonical-resolution or DB failure never affects context injection, and
  `afterRecord` is already try/caught by `_handler` (best-effort, never 500).
- Builders keep the existing `safe()` isolation: a single resource fetch failing →
  that section renders empty **and** that fragment type is simply not recorded —
  consistent ("not injected ⇒ no edge"), never a fabricated edge.
- `createMany` no-ops on an empty batch (already implemented).

## Testing

- **`lineage.service` unit (new):** canonical normalization, cross-builder dedup,
  `skipDuplicates` idempotence (2nd call with same session does not increase count),
  empty-manifest no-op, correct workspace/task/session stamping. Prisma mocked (SWC).
- **Builder units (extend `__tests__/services/task-context-fragments.test.ts` style):**
  memory+linked records full candidate set (incl. degraded-manifest cards), Layer-2
  records survivors only, review-todos aligned, previous-session carries `sessionId`.
- **Route:** mock the 4 builders + `recordSessionStartEdges`; assert `afterRecord`
  aggregates fragments and calls with the right `{workspaceId, taskId, sessionId}`;
  unbound / no-sessionId ⇒ not called.
- **Migration sanity:** `prisma generate` + `tsc --noEmit`, run lineage/context suites
  from inside the worktree.

## Explicitly out of scope (deferred)

- Cloud agent-sandbox (runId) instrumentation — context-builder has no manifest yet.
- Manual `task context` (no-session) edges — would bias the denominator.
- Outcome stamping (LUM-277), per-fragment merge contribution display & audit command
  (LUM-278), stale-fragment-id cleanup on source delete (known debt).
