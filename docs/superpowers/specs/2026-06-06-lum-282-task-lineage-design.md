# LUM-282 — `lumo task lineage <id>`: read the causal trail of a task

**Date:** 2026-06-06
**Task:** LUM-282 (Milestone: Context Lineage / System of Record, target 2026-06-14)
**Type:** Read-only aggregation + CLI output. No new infrastructure.

## Problem

The Context Lineage milestone's system-of-record asset is the **edge**:
"this context fragment → was injected into this task during this run → and here's
the outcome + what it cost". The `LineageEdge` table (LUM-275) already records
those edges; outcome stamping (LUM-277) and per-run token/loop cost (LUM-281)
already populate the closing fields.

This task delivers the milestone's **audit/trust exit (DoD ⑥)**: one terminal
command that lists, for a given task, which fragments went in (type + readable
source) + each one's outcome + the token/loop cost of the run that consumed it.
Turns "what did the AI actually use, and why did this ship?" from a slide into a
runnable command (CFO / compliance demo).

## Scope

**In scope**
- New `lumo task lineage <id>` CLI command (task identifier `LUM-N` only).
- New read-only API route `GET /api/tasks/lineage/[identifier]`.
- New `lib/services/lineage.service.ts` that aggregates `LineageEdge` rows.
- Human-readable source hydration per fragment type (batched, not true N+1).
- SKILL.md sync per CLAUDE.md (catalog + reference section + trigger words).
- Tests (service aggregation + CLI formatter, incl. empty/cold-start state).

**Out of scope (deliberately deferred)**
- PR-number entry point (PR → task reverse lookup) — mentioned as future.
- Outcome filter flags.
- Lineage-aware ranking/pruning (LUM-279, next milestone).
- Billing UI; deletion/GDPR propagation (known debt).

## Dependencies (verified present in codebase)

| Dependency | Status | Location |
|---|---|---|
| `LineageEdge` model + `LineageFragmentType` / `LineageOutcome` enums | ✅ | `prisma/schema.prisma` (~1857) |
| `lineageEdgeRepository.listByTask` / `aggregateByFragments` | ✅ | `lib/repositories/lineage-edge.repository.ts` |
| Run/Session cost fields (input/output/cache*/loopCount) | ✅ | `prisma/schema.prisma` (AgentRun ~881, Session ~1463) |
| `getEdgeCost()` cost mapper (run-first, session fallback) | ✅ | `lib/repositories/lineage-cost.ts` |
| `resolveCanonicalFragment()` (MEMORY drift-stable) | ✅ | `lib/repositories/memory-provenance.repository.ts:59` |
| `requireIdentity()` auth | ✅ | `lib/auth/identity.ts` |
| `taskService.resolveIdentifier()` (LUM-N → task) | ✅ | `lib/services/task.service.ts` |
| CLI command pattern (creds → authed URL → Bearer fetch → pure formatter) | ✅ | `cli/src/commands/task-context.ts` |

## Architecture

Follows the project's layered data flow:

```
cli/src/commands/task-lineage.ts        (parse arg, fetch, format)
  → GET /api/tasks/lineage/[identifier]  (requireIdentity → service → 404)
    → lib/services/lineage.service.ts    (resolve task, aggregate edges)
      → lineageEdgeRepository.listByTask  (+ run/session relations)
      → memoryProvenanceRepository.resolveCanonicalFragment
      → getEdgeCost
      → per-type source hydration (batched repo reads)
```

### Service: `lib/services/lineage.service.ts` (new)

`getLineageForIdentifier(workspaceId, memberId, identifier): Promise<LineageDto | null>`

1. `taskService.resolveIdentifier(workspaceId, identifier)` → task; `null` ⇒ 404.
2. Read edges via `lineageEdgeRepository.listByTask(taskId)` **with `run` and
   `session` relations included**. If the existing method does not include them,
   add a sibling read method (`listByTaskWithCost`) rather than mutating the
   existing one (OCP).
3. For each edge, `resolveCanonicalFragment(fragmentType, fragmentId)` so MEMORY
   fragments don't show stale pre-consolidation cuids (LUM-280).
4. **Hydration:** bucket canonical ids by `fragmentType`, run one batched query
   per type (≤ 7 queries total), produce a `sourceLabel` string:
   - `MEMORY` → memory text snippet (truncated)
   - `SLACK_CONTEXT` → channel / thread title
   - `WEB_LINK` → url (or title)
   - `FIGMA` → figma link name / url
   - `PR` → `#<number> <title>`
   - `PR_REVIEW_TODO` → todo text (truncated)
   - `SESSION` → session label / id
   Missing/deleted source ⇒ graceful fallback label (`<type> (source removed)`).
5. **Grouping:** group key = `runId ?? sessionId ?? '__orphan__'`. One group per
   distinct run/session. Cost is resolved **once per group** via `getEdgeCost`
   — never summed per-edge — so a run that injected many fragments counts its
   cost exactly once.
6. **Totals:** distinct run/session count, distinct fragment count, edge count,
   summed tokens (over groups, not edges), summed loopCount, outcome
   distribution.

### DTO (API response shape, consumed by the CLI formatter)

```ts
interface LineageDto {
  task: { identifier: string; title: string; status: string }
  totals: {
    runCount: number
    fragmentCount: number
    edgeCount: number
    tokens: { input: number; output: number; cacheRead: number; cacheCreation: number; total: number }
    loopCount: number
    outcomes: { MERGED: number; REJECTED: number; REWORKED: number; UNKNOWN: number }
  }
  groups: Array<{
    kind: 'run' | 'session' | 'orphan'
    runId?: string
    sessionId?: string
    label: string
    includedAt: string          // earliest edge in the group (ISO)
    cost: {
      input: number; output: number; cacheRead: number; cacheCreation: number
      total: number; loopCount: number
    } | null
    fragments: Array<{
      fragmentType: string
      fragmentId: string         // canonical
      sourceLabel: string
      outcome: 'MERGED' | 'REJECTED' | 'REWORKED' | 'UNKNOWN'
    }>
  }>
}
```

### API route: `app/api/tasks/lineage/[identifier]/route.ts` (new)

Thin handler: `requireIdentity(request)` → call service → `null` ⇒ 404. No
Prisma, no business logic.

### CLI: `cli/src/commands/task-lineage.ts` (new) + register in `cli/src/index.ts`

- `task lineage <identifier>` → load creds, `resolveAuthedApiUrl`, Bearer fetch,
  `formatLineageMarkdown(dto)`.
- `formatLineageMarkdown` is a **pure** function (testable like
  `formatTaskContextMarkdown`):
  - Header: task identifier/title/status.
  - **Totals banner:** run count, fragment count, total tokens, total loops,
    outcome distribution.
  - **Per group:** group label + the group's cost shown **once** + included-at;
    then each fragment as a line with `fragmentType`, `sourceLabel`, and its own
    `outcome`; plus a **group summary** line (e.g. `3 fragments: 2 MERGED, 1 UNKNOWN`).
  - **Cold-start / empty state:** when `groups` is empty, print a friendly note
    (no lineage edges yet — a session-bound run must consume context first), not
    an error.
- Sanitize any server-returned free text through `sanitizeField()` before stdout
  (CLI untrusted-output rule).

## Error handling

- Not logged in → CLI prints `lumo auth login` hint (existing pattern).
- 401 bad token / 404 not found / other HTTP → typed messages (mirror
  `task-context.ts`).
- Task with zero edges → 200 with empty `groups`; CLI renders cold-start note.
- Deleted/missing fragment source rows → fallback `sourceLabel`, never throws.

## Testing

- **Service unit test** (mock repositories): grouping by run/session;
  **cost counted once per group** (the central correctness guarantee);
  canonical MEMORY resolution applied; hydration buckets by type; totals math;
  orphan (no run/session) bucket.
- **Formatter unit test:** normal render (groups + totals + per-fragment outcome
  + group summary) and empty/cold-start state.
- Every new function gets ≥ 1 test (CLAUDE.md).
- `npx tsc --noEmit` clean; `npm run lint:tokens` unaffected (no styles).

## Documentation (CLAUDE.md CLI-sync requirement)

- `.claude/skills/lumo/SKILL.md`: add `lumo task lineage <id>` to the
  Task-context catalog block; add trigger words to frontmatter `description`
  (`lineage`, `causal trail`, `审计`, `因果`, `成本归因`).
- `references/task-context.md`: new section documenting the command, flags,
  output format, empty-state semantics, and when to suggest it.

## Delivery

- Branch `lumo/LUM-282-task-lineage` off fresh `origin/main`, in a worktree.
- Run `tsc --noEmit` + `jest` + lint; open PR titled
  `feat: add 'lumo task lineage <id>' [LUM-282]`.
- No schema change ⇒ no migration. CLI surface changed ⇒ PR note: needs a
  `cli/package.json` minor bump + `npm publish` to ship to users.
