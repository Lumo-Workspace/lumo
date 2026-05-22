# Project Milestones — Design

**Task:** [LUM-61](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-61) — 在 project 下增加 milestone 支持
**Date:** 2026-05-21
**Status:** Approved (pending spec review)

## 1. Goal

Add a **Milestone** concept under each Project. A milestone groups tasks around a delivery / phase / version (e.g. "v1.0", "MVP", "Q2 release"). Tasks may optionally belong to a milestone.

Milestones are **orthogonal to Sprints**:

- Sprint = team-level iteration cadence (already exists, `Sprint` model on Team).
- Milestone = project-level delivery phase (new).

A task can simultaneously belong to one Sprint and one Milestone; the two dimensions do not interact.

## 2. Scope

Single PR delivering the full vertical:

- Prisma model + migration
- Repository / Service / API
- Project detail page: new **Milestones** tab (between Overview and Tasks) + Milestone detail page
- Task form: Milestone selector (alongside the Sprint selector)
- Project Tasks tab: Milestone filter
- CLI: `--milestone` flag on `task create` / `task update`, plus `milestone list` discovery command
- i18n: all locale files
- Tests: repository + service

**Out of scope this iteration:**

- My Tasks page milestone filter
- Sidebar milestone entry
- Drag-and-drop milestone ordering
- Milestone-completed notifications / webhooks
- API route end-to-end tests, frontend component tests (no existing convention)
- CLI tests (no existing convention)

## 3. Data Model

### 3.1 New model

```prisma
enum MilestoneStatus {
  PLANNED
  ACTIVE
  COMPLETED
  CANCELLED
}

model Milestone {
  id          String          @id @default(cuid())
  projectId   String
  name        String
  description String?
  status      MilestoneStatus @default(PLANNED)
  startDate   DateTime?
  targetDate  DateTime?
  completedAt DateTime?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tasks   Task[]

  @@index([projectId])
  @@index([projectId, status])
}
```

### 3.2 Task model change

```prisma
model Task {
  // ... existing fields ...
  milestoneId String?
  milestone   Milestone? @relation(fields: [milestoneId], references: [id], onDelete: SetNull)

  @@index([milestoneId])
}
```

### 3.3 Semantics

| Decision                       | Choice                                                                                              | Rationale                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Task ↔ Milestone cardinality   | `0..1`                                                                                              | Matches "shipped in one version" semantics; simple FK on Task.      |
| `(projectId, name)` uniqueness | **Not enforced**                                                                                    | Allow re-using a name across phases; revisit if product asks.       |
| Project deletion               | Cascade to Milestone                                                                                | Milestones are owned by the project.                                |
| Milestone deletion             | `SetNull` on Task.milestoneId                                                                       | Tasks are not owned by the milestone; unbinding is safe.            |
| Concurrent ACTIVE milestones   | Allowed                                                                                             | Realistic (v1.1 maintenance while v2.0 ramps up); no DB constraint. |
| Ordering                       | None — sorted by `targetDate ASC NULLS LAST, createdAt ASC`                                         | YAGNI; no `order` column.                                           |
| Time attributes                | `startDate?`, `targetDate?` — both optional                                                         | Flexible across "no date", "target only", "start+target".           |
| `completedAt`                  | Written when status becomes COMPLETED, cleared when leaving COMPLETED, **not** written on CANCELLED | Cancelled is not a completion event.                                |
| Archiving                      | Reuse `CANCELLED` state instead of a separate `archivedAt`                                          | One fewer column, fewer code paths.                                 |

### 3.4 Migration

Single migration file `prisma/migrations/<timestamp>_add_milestones/`:

1. Create `MilestoneStatus` enum
2. Create `Milestone` table with all columns and indexes
3. Add `milestoneId` column + index + FK to `Task`

No data backfill required — existing tasks get `milestoneId = NULL`.

## 4. Backend Layers

### 4.1 Repository — `lib/repositories/milestone.repository.ts`

```ts
findById(id: string)
findByProject(projectId: string)            // orderBy targetDate asc nulls last, createdAt asc
create(data: {
  projectId: string
  name: string
  description?: string
  startDate?: Date
  targetDate?: Date
})
update(id: string, data: Partial<Pick<Milestone, 'name' | 'description' | 'status' | 'startDate' | 'targetDate' | 'completedAt'>>)
delete(id: string)                          // relies on Cascade / SetNull FKs
countTasksByStatus(milestoneId: string)     // for progress display
```

- Use `select` to fetch only required fields (codebase convention).
- The `nulls: 'last'` ordering uses Prisma 5+ syntax: `orderBy: [{ targetDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]`.

### 4.2 Service — `lib/services/milestone.service.ts`

```ts
listMilestones(projectId: string, memberId: string)
getMilestone(milestoneId: string, memberId: string)
createMilestone(projectId: string, memberId: string, input)
updateMilestone(milestoneId: string, memberId: string, input)
deleteMilestone(milestoneId: string, memberId: string)
```

**Key behaviors:**

- **Permission delegation:** Every method first calls `projectService.getProject(projectId, memberId)` to inherit the project's visibility rules (including draft / `isIdea` handling). No bespoke permission code.
- **Status transition side effects** in `updateMilestone`:
  - Status change `* → COMPLETED`: set `completedAt = new Date()`.
  - Status change `COMPLETED → *`: set `completedAt = null`.
  - Status change `* → CANCELLED`: do **not** touch `completedAt`.
- **Error style:** `throw Object.assign(new Error('Milestone not found'), { status: 404 })` (matches existing services).
- **No notifications / webhooks** this iteration.

### 4.3 API Routes

| Method | Path                                   | Notes                                 |
| ------ | -------------------------------------- | ------------------------------------- |
| GET    | `/api/projects/[projectId]/milestones` | list                                  |
| POST   | `/api/projects/[projectId]/milestones` | create                                |
| GET    | `/api/milestones/[milestoneId]`        | detail                                |
| PATCH  | `/api/milestones/[milestoneId]`        | update (including status transitions) |
| DELETE | `/api/milestones/[milestoneId]`        | delete                                |

Each route stays ~50–80 lines: `requireMember()` → Zod parse → service call → `respondError()` on error. Use existing helpers; do not introduce new patterns.

### 4.4 Validation — `lib/validation/milestone.ts`

```ts
export const milestoneCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
})

export const milestoneUpdateSchema = milestoneCreateSchema.partial().extend({
  status: z.nativeEnum(MilestoneStatus).optional(),
})
```

No `startDate <= targetDate` constraint — overdue / not-yet-started milestones are valid real-world states.

### 4.5 Task API extension

`PATCH /api/tasks/[id]` and `POST /api/tasks` accept an optional `milestoneId`:

- `string` → set/replace milestone binding
- `null` → unbind
- omitted → unchanged

**Cross-project guard:** if a `milestoneId` is provided, the task service must verify that the milestone's `projectId` matches the task's `projectId`. Reject with `400` otherwise. Implementation lives in `task.service.ts` (project does not use DB triggers).

### 4.6 Task list API filter

The existing task list endpoint (used by Project Tasks tab) accepts a new `milestoneId` query parameter:

- `milestoneId=<id>` → filter to that milestone
- `milestoneId=null` → tasks with no milestone (mirrors the existing `sprintId=null` convention)
- omitted → no filter

## 5. CLI

### 5.1 New flag on `task create` / `task update`

| Command            | New flag            | Semantics                                                                                                                                                                                          |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lumo task create` | `--milestone <ref>` | Resolve `<ref>` as a milestone name (case-insensitive) within the project the task is being created in (the one resolved from `--project` or the workspace default). Empty / omitted = no binding. |
| `lumo task update` | `--milestone <ref>` | Same resolution, scoped to the existing task's project. `--milestone ""` unbinds (mirrors `--assignee ""`).                                                                                        |

**Resolution rules:**

- `<ref>` is matched by **name only** (case-insensitive) within the relevant project. IDs are not exposed in the UI and not accepted by the CLI.
- If the name does not match, the CLI prints an error and suggests `lumo milestone list --project <slug>`.

### 5.2 New command — `lumo milestone list`

```
lumo milestone list [--project <ref>]
```

Output (fixed-width):

```
PLANNED    -           v2.0
ACTIVE     2026-06-30  v1.1 Performance
COMPLETED  2026-04-15  v1.0 Launch
```

Columns: status, target date (or `-`), name. Sorted with the same rule as the API (`targetDate asc nulls last, createdAt asc`).

`--project <ref>` is required when the workspace has more than one project (consistent with `task create --project`).

### 5.3 `lumo task context` output

Add one line to the task context output when a milestone is bound:

```
Current milestone: v1.0 (ACTIVE, target 2026-06-30)
```

If no milestone is bound, the line is omitted.

### 5.4 SKILL.md sync (CLAUDE.md hard requirement)

Update `.claude/skills/lumo/SKILL.md` in the same PR:

- Frontmatter `description` field: add triggers — "milestone", "里程碑", "set milestone", "挂到 milestone"
- `lumo task create` section: document `--milestone <ref>` flag and one example
- `lumo task update` section: document `--milestone <ref>` flag, `--milestone ""` clearing semantics, and one example
- New `### lumo milestone list [--project <ref>]` section under "Project Management"

### 5.5 Out of scope for CLI

- `lumo milestone create / show / update / delete` — web UI covers creation / editing; CLI's primary use case is binding existing milestones to tasks.

## 6. Frontend

### 6.1 Project detail page — Milestones tab

Tab order: **Overview | Milestones | Tasks | Summary** (Milestones placed before Tasks to reflect PM workflow).

Tab content:

- Header: `+ New milestone` button
- List: milestone cards, sorted by `targetDate asc nulls last, createdAt asc`
- Each card: name, status pill, target date (if set), progress (`done / total tasks`), overflow menu (Edit / Delete)
- Click a card → navigate to Milestone detail page

Empty state: centered illustration + CTA `Create your first milestone`.

### 6.2 Milestone detail page

Route: `/workspace/[workspaceUrl]/projects/[projectSlug]/milestones/[milestoneId]`

- Header: name, status pill, start / target dates, Edit + Delete buttons
- Description block (if present)
- Task list: reuse existing `<TaskList>` component, fetched via the task list API with `milestoneId=<id>` filter

### 6.3 Milestone create / edit dialog

Single dialog component `<MilestoneFormDialog>`, reused for create and edit:

- Fields: name (required), description, status, start date, target date
- On submit: call API client, then invalidate the project's milestone list query
- Visual / interaction parity with existing creation dialogs in this codebase

### 6.4 Task form — Milestone selector

Position: same row as the Sprint selector in the task detail / form right rail.

- Data source: all non-`CANCELLED` milestones in the task's project
- Option label: `<name> · <target date or ->`
- Supports clearing (`None`)
- On change: `PATCH /api/tasks/[id]` with `milestoneId`

### 6.5 Project Tasks tab — Milestone filter

Add a Milestone dropdown next to the existing Status / Priority / Assignee filters:

- Options: all milestones in the project + a `No milestone` option
- Selecting `No milestone` sends `milestoneId=null`
- Selecting a milestone sends `milestoneId=<id>`

### 6.6 API Client — `lib/api-client/milestone.ts`

```ts
listMilestones(projectId: string)
getMilestone(milestoneId: string)
createMilestone(projectId: string, input)
updateMilestone(milestoneId: string, input)
deleteMilestone(milestoneId: string)
```

Wraps `fetch` with the standard error handling used by `lib/api-client/project.ts`.

## 7. i18n

All new strings live in the `milestone.*` namespace, with a few additions under `task.*` and `project.*`. **Every locale file must be updated** — no English fallback.

### 7.1 New keys (representative; full set finalized during implementation)

```
milestone.tab.title
milestone.empty.title
milestone.empty.cta
milestone.new
milestone.edit
milestone.delete
milestone.delete.confirm        // params: {name}
milestone.field.name
milestone.field.description
milestone.field.status
milestone.field.startDate
milestone.field.targetDate
milestone.status.PLANNED
milestone.status.ACTIVE
milestone.status.COMPLETED
milestone.status.CANCELLED
milestone.progress              // params: {done}, {total}
milestone.targetDate.none

task.field.milestone
task.field.milestone.none
task.filter.milestone
task.filter.milestone.none

project.tab.milestones
```

### 7.2 Chinese translation conventions

- milestone → 里程碑
- target date → 目标日期
- cancelled → 已取消

## 8. Testing

Mirror the existing Prisma-mock test pattern from `__tests__/lib/repositories/task.repository.test.ts` and `__tests__/sprint.service.test.ts`.

| File                                                                    | Coverage                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `__tests__/lib/repositories/milestone.repository.test.ts`               | `findByProject` ordering (target nulls last), `findById`, `countTasksByStatus`                            |
| `__tests__/lib/services/milestone.service.test.ts`                      | Permission delegation to `projectService`, status transition writes/clears `completedAt`, 404 error shape |
| Extension of `__tests__/lib/services/task.service.test.ts` (or sibling) | Reject cross-project `milestoneId`, `milestoneId: null` unbinds                                           |

**Not introduced:** API route tests, frontend component tests, CLI tests — no existing convention; do not break the pattern this iteration.

## 9. Acceptance Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] `prisma migrate dev` applies cleanly on a local DB
- [ ] Manual walkthrough: create milestone → bind a task → toggle status → delete milestone → task unbinds (milestoneId becomes null)
- [ ] CLI: `lumo milestone list`, `lumo task create --milestone X`, `lumo task update LUM-N --milestone ""` all behave per spec
- [ ] All locale files updated; no English fallback in non-English files
- [ ] `.claude/skills/lumo/SKILL.md` updated to match new CLI surface
- [ ] PR title `feat: add milestones under project [LUM-61]`
- [ ] Branch `lumo/LUM-61-add-project-milestones`

## 10. Open Questions / Deferred

- Notification when a milestone enters `COMPLETED` — deferred.
- Drag-and-drop milestone ordering — deferred.
- `(projectId, name)` uniqueness — deferred; add migration only if product requires.
- My Tasks page milestone filter — deferred.
- Full `lumo milestone create / update / delete` CLI surface — deferred; revisit if agents need full CLI closure.
