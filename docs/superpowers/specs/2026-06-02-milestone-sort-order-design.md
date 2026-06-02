# LUM-160 — 里程碑手动排序 (sortOrder)

**Status**: Design approved
**Date**: 2026-06-02
**Task**: LUM-160 · Milestone "Milestone 功能增强"

## Problem

Milestones currently sort only by `targetDate ASC NULLS LAST, createdAt ASC`
(`milestone.repository.ts → findByProject`). There is no way to manually reorder
them. We add a `sortOrder` field to the `Milestone` model plus a reorder API and
CLI, so a project's milestones can be arranged in an explicit user-chosen order.

## Goals

- Manual ordering of milestones within a project, persisted on the model.
- Two CLI affordances over one server endpoint:
  - `milestone reorder` — supply the full desired order (batch array).
  - `milestone move` — move one milestone `--before` / `--after` another.
- A Prisma migration that **backfills** existing milestones so the on-disk order
  after deploy is identical to today's `targetDate → createdAt` order (no visible
  change until someone reorders).

## Non-Goals (YAGNI)

- No Pusher / real-time reorder event (projects have one; milestone lists have no
  live-subscription surface).
- No "dirty" flag to keep unsorted milestones on `targetDate` — once `sortOrder`
  exists it is the single source of order. The migration backfill makes the
  initial order match `targetDate`, which is sufficient.
- No fractional drag-drop UI insert path. Field is `Float` so a future UI _can_
  do fractional inserts without a migration, but we only ship full renumbering.
- No web UI changes in this task.

## Design

### 1. Data model + migration

Add to `Milestone` (prisma/schema.prisma, mirroring `Document.sortOrder`):

```prisma
sortOrder  Float  @default(0)
// plus:
@@index([projectId, sortOrder])
```

Migration `migration.sql` does two things in order:

1. `ALTER TABLE "milestones" ADD COLUMN "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0;`
   and `CREATE INDEX "milestones_projectId_sortOrder_idx" ON "milestones" ("projectId", "sortOrder");`
2. Backfill each project's milestones to `0,1,2,…` in the current display order:

```sql
UPDATE "milestones" m
SET "sortOrder" = sub.rn
FROM (
  SELECT id,
         (ROW_NUMBER() OVER (
            PARTITION BY "projectId"
            ORDER BY "targetDate" ASC NULLS LAST, "createdAt" ASC
          ) - 1)::double precision AS rn
  FROM "milestones"
) sub
WHERE m.id = sub.id;
```

The column is `NOT NULL DEFAULT 0`, so old frontend code reading the row before/
after deploy always sees a valid value — no 500 risk (cf. project memory on
migration/prod drift). PR description must note: **requires `prisma migrate deploy`
on next deploy**.

### 2. Repository (`lib/repositories/milestone.repository.ts`)

- `findByProject`: change `orderBy` to `[{ sortOrder: 'asc' }, { createdAt: 'asc' }]`.
  Ensure `sortOrder` is present in the returned shape (CLI needs it to splice).
- Add `reorder(projectId, orderedIds)` — mirror `project.repository.reorder`:

```ts
async reorder(projectId: string, orderedIds: string[]) {
  return prisma.$transaction(async tx => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.milestone.update({
        where: { id: orderedIds[i]!, projectId },
        data: { sortOrder: i },
      })
    }
  })
}
```

- `create`: accept optional `sortOrder` (default behavior unchanged when omitted;
  new milestones land at `0` by schema default — acceptable, they sort to the top
  on next list; if undesirable we can append at `max+1`, see Open Questions).

### 3. Service (`lib/services/milestone.service.ts`)

Add `reorderMilestones(projectId, memberId, orderedIds)`:

- Authorize the same way `createMilestone` does (member must be able to access the
  project — via `projectService`).
- Load the project's full milestone id set. Validate `orderedIds` is the **exact
  same set** (same ids, no missing, no extra, no duplicates). Mismatch →
  `throw Object.assign(new Error(<msg>), { status: 400 })`.
- Call `milestoneRepository.reorder(projectId, orderedIds)`.

Requiring a complete set fixes the mental model "reorder = the complete new order"
and prevents partial-subset `sortOrder` interleaving/drift.

### 4. API route + validation

- New `app/api/projects/[id]/milestones/reorder/route.ts`, `PATCH`, body
  `{ orderedIds: string[] }`. Mirror `app/api/projects/reorder/route.ts`:
  auth → `requireIdentity` / workspace resolution → zod parse → call
  `milestoneService.reorderMilestones` → `{ ok: true }`. Errors mapped via the
  `status`-on-error pattern.
- `lib/validation/schemas.ts`: add `reorderMilestonesSchema` (copy of
  `reorderProjectsSchema`: `orderedIds` array of cuid, min 1, max 500).

This single endpoint backs both CLI subcommands.

### 5. API client (`lib/api-client/milestones.ts`)

Add `reorder(projectId, orderedIds)` → `PATCH .../milestones/reorder`.

### 6. CLI — two subcommands (both resolve to a full `orderedIds`, then PATCH)

**`lumo milestone reorder <ref...> [--project <ref>]`**

- Positional list of milestone refs (name, case-insensitive, or uuid) in desired
  order. Resolve `--project` like other milestone commands (required when >1
  project).
- `GET /api/projects/<id>/milestones`, resolve each ref to an id.
- Unknown ref, duplicate, or incomplete set (not all project milestones listed)
  → error listing the offending / missing refs, no network mutation.
- `PATCH` the resolved full `orderedIds`.
- Output: `Reordered N milestones in <project>` then the new order, one per line.

**`lumo milestone move <ref> --before <ref> | --after <ref> [--project <ref>]`**

- `--before` / `--after` mutually exclusive, exactly one required (mirror
  `doc move`'s `--parent`/`--root` pre-flight validation, erroring before any
  network call).
- `GET` current ordered list. Remove `<ref>` from its position, splice it
  immediately before/after the target. Produce full `orderedIds`.
- `PATCH`. Output: `Moved "<name>" before|after "<target>"` then the new order.

### 7. Docs sync (CLAUDE.md hard requirement)

`.claude/skills/lumo/SKILL.md`:

- frontmatter `description`: add trigger words (reorder / move / 排序 / 调序 /
  before / after milestone).
- Add `### lumo milestone reorder` and `### lumo milestone move` sections with
  flags, examples, completeness semantics, and the mutually-exclusive rule.

### 8. Tests

- Service/repository: completeness validation (missing / extra / unknown id → 400) and that `reorder` writes `sortOrder = index`. Follow existing milestone
  test mocking style.
- `__tests__/api-milestones-reorder.test.ts`: route auth + 400/404 (mock service,
  mirror `api-milestone-get.test.ts`).
- `__tests__/cli/milestone-reorder.test.ts` and `milestone-move.test.ts`: arg
  parsing, before/after splice computation, mutual-exclusion, incomplete-set
  error.

## Decisions locked during brainstorming

1. **Single batch endpoint + CLI computes before/after** (vs separate fractional
   `move` endpoint).
2. **`Float @default(0)` + migration backfill** (vs Int, vs no backfill).
3. **`reorder` + `move` two subcommands** (vs one command with flags).
4. **targetDate drops out of list ordering** — order carried entirely by
   `sortOrder`, initial values backfilled.
5. **reorder requires the complete milestone set** — stricter than projects
   reorder, safer.
6. **No Pusher event** — YAGNI.

## Open questions

- New-milestone `sortOrder`: schema default `0` puts a freshly created milestone
  at the top of the list. Acceptable for v1; if it should append to the bottom,
  `createMilestone` can set `sortOrder = max(existing) + 1`. Decide during
  planning — low cost either way.

## Production note

Schema change → **requires `prisma migrate deploy` on the next deploy**. A merged
PR alone does not migrate prod. Verify with `prisma migrate status` against the
prod URL after deploy. Migration is non-destructive (additive column + backfill).
