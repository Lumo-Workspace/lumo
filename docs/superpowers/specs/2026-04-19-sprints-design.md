# Sprints — Team-Level Iteration Support

**Date**: 2026-04-19
**Status**: Approved
**Scope**: Introduce Scrum-style sprints at the Team level. New first-class domain object with its own lifecycle, dedicated UI surface, and a retrospective report.

## Goal

Let small dev teams plan and track work in fixed-cadence iterations. A sprint groups a subset of team tasks into a time-boxed window (start/end date), exposes a focused Kanban view, and produces an auto-generated retro report on close.

The v1 target is the "useful 20%" — planning, execution, spillover, retro — deliberately skipping estimation/velocity/burndown until the feature has real usage.

## Non-Goals (v1)

- Story points, capacity, velocity, or burndown charts.
- Sprint templates or AI-assisted sprint goal / task selection.
- Workspace-level cross-team sprint aggregation view.
- Multiple concurrent active sprints per team.
- Sprint reopen after close (close is terminal).
- Agent awareness of sprint context (agent service does not read/write `sprintId`).
- A general Teams module in the UI (sprints land under their own sidebar entry, not under a new Teams page).

## Anchors

- **Scope**: Sprints attach to **Team**. A team has zero-or-one active sprint at a time. Tasks across projects owned by the same team can share a sprint.
- **Lifecycle**: Fixed cadence per team (1/2/4 weeks, configurable). System auto-prepares the next sprint as a DRAFT; team manually Starts and manually Closes.
- **Task↔Sprint**: `Task.sprintId` is nullable. `null` = backlog. One sprint per task at a time. History preserved via `TaskActivity` (`SPRINT_CHANGED`).
- **Subtasks**: Inherit parent's `sprintId` on create; independently editable after.
- **Close flow**: Forced per-task decision for every unfinished task — Move to next / Back to backlog (no "keep in closed sprint" option).
- **Estimation**: None in v1. Progress metrics are task counts.
- **Entry point**: New top-level sidebar item "Sprints".
- **Board**: Sprint detail page reuses the existing Kanban component with `sprintId` filter applied.
- **Permissions**: Workspace OWNER + members of the specific team can mutate sprints (create / start / close / plan).
- **Notifications**: `SPRINT_STARTED` and `SPRINT_CLOSED` to all team members. No "closing soon" notification.
- **Reporting**: Minimum progress header + retro report (`SprintSummary`, same pattern as `ProjectSummary`/`WorkspaceSummary`). No burndown chart.

## Data Model

### New Prisma models

```prisma
enum SprintStatus {
  DRAFT    // system-prepared or manually created; not yet started
  ACTIVE   // started; exactly one per team at a time (enforced by partial unique index)
  CLOSED   // terminal; contents frozen
}

model Sprint {
  id        String       @id @default(cuid())
  teamId    String
  number    Int          // team-scoped auto-increment; displayed as "Sprint {number}"
  name      String       // defaults to "Sprint {number}"; user-editable while DRAFT
  status    SprintStatus @default(DRAFT)
  startDate DateTime     // planned; set from cadence, user-editable while DRAFT
  endDate   DateTime     // planned; set from cadence, user-editable while DRAFT
  startedAt DateTime?    // actual start click time
  closedAt  DateTime?    // actual close time
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  team    Team            @relation(fields: [teamId], references: [id], onDelete: Cascade)
  tasks   Task[]
  summary SprintSummary?

  @@unique([teamId, number])
  @@index([teamId, status])
  @@map("sprints")
}

model SprintSummary {
  id       String @id @default(cuid())
  sprintId String @unique
  sprint   Sprint @relation(fields: [sprintId], references: [id], onDelete: Cascade)

  stats       Json     // { totalTasks, done, spillover, byPriority, byAssignee, ... }
  tldr        String
  report      String   // LLM-generated retrospective narrative
  generatedAt DateTime @default(now())

  @@map("sprint_summaries")
}
```

### Raw migration (partial unique index)

Prisma cannot express partial unique indexes in schema. The generated migration must include, as raw SQL:

```sql
CREATE UNIQUE INDEX sprints_team_active
  ON sprints(team_id)
  WHERE status = 'ACTIVE';
```

This is the authoritative guarantee of "at most one active sprint per team" — the service-layer check is defense in depth.

### Changes to existing models

**`Team`** — add cadence config:

```prisma
sprintCadenceDays  Int?    // null = sprints disabled for this team; 7/14/28 typical
sprintAutoPrepare  Boolean @default(true)  // whether cron pre-creates the next DRAFT
sprints            Sprint[]
```

`sprintCadenceDays = null` is the single "sprints disabled" signal; no separate boolean. Teams without cadence configured are hidden from the Sprints landing page.

**`Task`** — add sprint membership:

```prisma
sprintId String?
sprint   Sprint? @relation(fields: [sprintId], references: [id], onDelete: SetNull)

@@index([sprintId])
```

`onDelete: SetNull` means deleting a sprint releases its tasks back to the backlog. In practice only DRAFT sprints are deletable, so this is mostly theoretical.

**`TaskActivityType`** — add:

```
SPRINT_CHANGED   // payload: { fromSprintId, toSprintId, reason: "planning" | "spillover" | "manual" }
```

**`NotificationType`** — add:

```
SPRINT_STARTED
SPRINT_CLOSED
```

**`Notification`** — add optional link field:

```prisma
sprintId String?   // set for SPRINT_STARTED / SPRINT_CLOSED to deep-link
```

## Architecture

Follows the project's standard layering: `Component → API Client → API Route → Service → Repository → Prisma`.

### Repositories

**`lib/repositories/sprint.repository.ts`** (new)

- `findById(sprintId)` — with `team` relation
- `findActiveByTeam(teamId)` — single-row lookup
- `listByTeam(teamId, { status?, limit?, cursor? })` — cursor-based; order by `number` desc
- `listDraftsNeedingPrep(asOf: Date)` — for cron; returns teams whose latest sprint's `endDate` is within `cadenceDays` of `asOf` and no DRAFT follows
- `create(data)` / `update(id, data)` / `remove(id)` — `remove` only valid for DRAFT
- `countTasks(sprintId, { status? })` — progress bar data
- `nextNumberForTeam(teamId)` — atomic increment helper

**`lib/repositories/sprint-summary.repository.ts`** (new) — parallel to `summary.repository.ts`.

**`lib/repositories/task.repository.ts`** (extend)

- `updateSprint(taskId, sprintId)` — single move
- `bulkUpdateSprint(taskIds[], sprintId)` — used during close/spillover
- Existing `list` / `findMany`: accept `sprintId` filter, including `sprintId: null` for backlog queries

### Services

**`lib/services/sprint.service.ts`** — core business logic.

```ts
export const sprintService = {
  createDraft(teamId, input, actor): Promise<Sprint>,
  start(sprintId, actor): Promise<Sprint>,
  close(sprintId, decisions, actor): Promise<Sprint>,
  addTaskToSprint(taskId, sprintId, actor): Promise<Task>,
  removeTaskFromSprint(taskId, actor): Promise<Task>,
  moveTaskBetweenSprints(taskId, toSprintId, actor): Promise<Task>,
  removeDraft(sprintId, actor): Promise<void>,
  configureCadence(teamId, { cadenceDays, autoPrepare }, actor): Promise<Team>,
};
```

Invariants enforced inside service transactions:

- `start`: validates `status === DRAFT` and team has no other ACTIVE sprint. Partial unique index is the ultimate backstop; `catch` Prisma P2002 and rethrow as `409`.
- `close(decisions)`: validates `status === ACTIVE` and `decisions` keys cover exactly the set of unfinished tasks currently in the sprint (else returns 409 "sprint membership changed, reopen dialog"). Serializes against concurrent `addTaskToSprint` / `removeTaskFromSprint` / sibling `close` by taking a sprint-row lock at the start of the transaction (`SELECT ... FROM sprints WHERE id = :sprintId FOR UPDATE`); the task-membership mutations take the same lock before updating `Task.sprintId`.
  - For `moveToNext`: if no DRAFT exists, `createDraft` auto-runs first (cadence-based dates).
  - Writes one `SPRINT_CHANGED` activity per moved task with `reason: "spillover"`.
- `addTaskToSprint` / `moveTaskBetweenSprints`: rejects if target sprint is CLOSED, or if task's team ≠ sprint's team. Writes `SPRINT_CHANGED` activity with `reason: "planning"` or `"manual"`.
- All mutations throw `Object.assign(new Error(msg), { status })` per project convention.

**`lib/services/sprint-prepare.service.ts`** (new) — auto-prepare logic, separated from `sprint.service` per SRP.

- `prepareNextDraft(teamId)` — idempotent. Reads `Team.sprintCadenceDays` and the team's latest sprint; computes next `startDate`/`endDate`; creates DRAFT via `sprintService.createDraft` if none exists. No-op if `sprintCadenceDays === null` or `sprintAutoPrepare === false`.
- `prepareAll()` — cron entry point; iterates teams with cadence enabled, calls `prepareNextDraft` for each.

Date math is performed in UTC to avoid DST drift. The first sprint (no prior sprint exists) starts on the next UTC Monday 00:00 after `now`.

**`lib/services/sprint-summary.service.ts`** (new) — parallels `summary.service.ts`.

- `generate(sprintId)` — loads sprint + tasks + activities + spillover counts, computes `stats`, calls LLM for `tldr` + `report`, persists `SprintSummary`. Uses `GenerationJob` (`type = "sprint"`, `targetId = sprintId`, `summaryId` on success).
- Triggered at the end of `sprintService.close` transaction commit (via outbox/await pattern consistent with existing summary triggers).

**`lib/services/task.service.ts`** (extend)

- `createTask`: if `parentTaskId` is set and parent has `sprintId`, inherit it by default (overridable via explicit `sprintId` in input).
- `updateTask`: allow `sprintId` updates with the same permission check as other task fields; emits `SPRINT_CHANGED` activity.

### API Routes

All under App Router; thin (≤100 lines): auth → Zod validate → service call → response.

```
POST    /api/teams/[teamId]/sprints              createDraft
GET     /api/teams/[teamId]/sprints              listByTeam (status filter, cursor)
GET     /api/sprints/[sprintId]                  findById
PATCH   /api/sprints/[sprintId]                  update name/dates (DRAFT only)
DELETE  /api/sprints/[sprintId]                  removeDraft (DRAFT only)
POST    /api/sprints/[sprintId]/start            start
POST    /api/sprints/[sprintId]/close            close + decisions
POST    /api/sprints/[sprintId]/tasks            addTaskToSprint
DELETE  /api/sprints/[sprintId]/tasks/[taskId]   removeTaskFromSprint
GET     /api/sprints/[sprintId]/summary          read retro
PATCH   /api/teams/[teamId]/cadence              configureCadence
POST    /api/cron/sprints/prepare                cron entry (CRON_SECRET)
```

Permissions helper `requireTeamMemberOrOwner(teamId)` gates all sprint mutations. Returns 403 otherwise.

### API Client & Validation

- `lib/api-client/sprints.ts` — fully typed wrapper over the routes above.
- `lib/validation/sprint.ts` — Zod schemas: `createSprintSchema`, `updateSprintSchema`, `startSprintSchema`, `closeSprintSchema` (with `decisions` Record validation), `cadenceSchema`.

## UI

### Sidebar

New top-level item **Sprints** inserted between Projects and Documents. Icon: `CalendarClock` (or equivalent from existing icon set). Route: `/workspace/[workspaceUrl]/sprints`.

### Sprints Landing — `/workspace/[workspaceUrl]/sprints`

Uses `PageBreadcrumb` like other pages.

- Team selector (tab strip if ≤3 teams, dropdown otherwise).
- For the selected team, three sections:
  - **Active Sprint** card: name, date range, progress bar (`done / total`), days remaining (or "Overdue by N days" in red), `[Open board]` + `[Close sprint]` buttons.
  - **Next (Draft)** card: name, date range, planned-task count, `[Plan]` + `[Start]` buttons.
  - **Recent** list: closed sprints with "View retro" links, cursor-paginated.
- When the selected team has `sprintCadenceDays === null`: shows an empty state with "Enable sprints for this team" CTA linking to team settings.

### Sprint Detail — `/workspace/[workspaceUrl]/sprints/[sprintId]`

Two-column layout.

**Main area**: reuses the existing Kanban component with `filter.sprintId = :id` applied and the filter not user-editable from within this page. Columns are the four `TaskStatus` values. Cards display a small project-color chip in the top-right corner because a sprint can span multiple projects within the team.

**Right sidebar (collapsible)**:

- Sprint meta: name, date range, status chip, progress bar.
- Spillover count (CLOSED only).
- Action buttons (status-dependent):
  - DRAFT → `[Plan tasks]` `[Start]` `[Edit]` `[Delete]`
  - ACTIVE → `[Add task]` `[Close sprint]`
  - CLOSED → `[View retro]` (once `SprintSummary.generatedAt` is set; else shows "Retro generating…" or "Retro failed — [Retry]")

**Plan tasks mode** (DRAFT only): right sidebar swaps to a **Backlog** panel listing all `sprintId = null` tasks of the team. Drag-to-Kanban calls `addTaskToSprint`. Single route; mode toggled via local UI state, not URL.

### Close Sprint Dialog

Triggered from ACTIVE sprint's `[Close sprint]` button.

- Lists every unfinished task (`status !== DONE`) with three radio choices: **Move to next sprint** / **Back to backlog**. (No "keep in closed sprint" — eliminated to prevent dead tasks.)
- Bulk actions: `[Move all to next]` `[All to backlog]`.
- `[Close sprint]` disabled until every task has a decision selected.
- Warning line: "This is irreversible. Sprint contents will be frozen."
- On confirm: calls `close` with decisions; on 409 (concurrent change) reloads the task list and re-opens the dialog.
- On success: redirects to landing with toast "Sprint closed. Generating retro…".

### Task Detail / Edit Panel

Adds a **Sprint** field in the right-side metadata column (same row family as Project / Assignee / Priority / Due date).

- Dropdown lists the task's team's DRAFT + ACTIVE sprints.
- `No sprint` option = backlog.
- Edits write `SPRINT_CHANGED` activity with `reason: "manual"`.
- Editing is disallowed when the task is already in a CLOSED sprint (field shown read-only).

### Team Settings — Sprints Panel

Added to the existing team settings surface. If the project has no Team-settings page today, the panel is surfaced from a "Sprints settings" link on each team row of the workspace settings Teams area.

```
☐ Enable sprints for this team
Cadence:  ( ) 1 week  (•) 2 weeks  ( ) 4 weeks  ( ) Custom: [  ] days
☑ Auto-prepare next sprint as draft
```

Toggling "Enable" off sets `sprintCadenceDays = null`. Existing ACTIVE / DRAFT sprints are preserved (not auto-closed).

### My Tasks

Filter chip row gets a new toggle **"Current sprint only"**. When on: tasks filtered to `sprintId ∈ { active sprints of teams the user belongs to }`.

## State Machine

```
(none) ─createDraft─▶ DRAFT ─start─▶ ACTIVE ─close─▶ CLOSED (terminal)
                       │
                       └─removeDraft─▶ (none)
```

- CLOSED is terminal. No reopen.
- Task `sprintId` edits are rejected when either the source or target sprint is CLOSED (history is frozen).

## Edge Cases & Concurrency

| Scenario                                                     | Behavior                                                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team enables cadence for the first time                      | First DRAFT generated with `startDate` = next UTC Monday 00:00 after `now`, `endDate = startDate + cadenceDays`                                                                                                |
| Team disables cadence (sets null)                            | `prepareAll` skips it; existing sprints remain untouched                                                                                                                                                       |
| Cron missed a day (provider outage)                          | Next run's `listDraftsNeedingPrep` backfills; per-team idempotency via `@@unique([teamId, number])`                                                                                                            |
| ACTIVE sprint past `endDate` not yet closed                  | No auto-close. Landing card shows red "Overdue by N days". No notification.                                                                                                                                    |
| Task's Project is deleted                                    | Cascades to task delete, which removes sprint membership naturally                                                                                                                                             |
| Task moved across teams (future feature)                     | Service ensures `sprintId` clears if new team ≠ sprint's team                                                                                                                                                  |
| Team member leaves team                                      | Assignee relation untouched; task stays in sprint (consistent with project behavior)                                                                                                                           |
| `SprintSummary` generation fails                             | `GenerationJob.status = 'failed'`; detail page shows "Retro generation failed — [Retry]"; close itself is already committed                                                                                    |
| User starts a DRAFT whose `startDate` is still in the future | Allowed. `startedAt` records actual click time. UI shows a warning but does not block.                                                                                                                         |
| Task removed from CLOSED sprint                              | Forbidden. CLOSED sprint membership is frozen.                                                                                                                                                                 |
| Two users close simultaneously                               | Second request's conditional update (`WHERE status = 'ACTIVE'`) affects 0 rows → 409                                                                                                                           |
| Two users start simultaneously                               | Second request triggers P2002 on partial unique index → 409                                                                                                                                                    |
| Task added concurrently during close                         | `close` and `addTaskToSprint` serialize via a sprint-row `FOR UPDATE` lock. If an add commits first, close's decision set no longer matches current membership → close returns 409 "sprint membership changed" |
| Two users drag the same task to different sprints            | Last-write-wins; both writes produce `SPRINT_CHANGED` activity rows for audit                                                                                                                                  |

## Cross-Cutting Integrations

- **TaskActivity**: adds `SPRINT_CHANGED` event type.
- **Notification**: two new types + optional `sprintId` column. Inbox renders sprint notifications with a deep-link to the sprint page.
- **My Tasks**: new filter chip; service-layer `list` accepts `sprintIds[]`.
- **Task creation flows (quick-add, drafts)**: inherit `sprintId` from parent task when applicable; when triggered from within a sprint detail page, pre-fill `sprintId = currentSprintId`.
- **GenerationJob**: reused with `type = "sprint"`.
- **Summary service**: `sprint-summary.service.ts` mirrors the existing `summary.service.ts` structure; no edits to existing summary code required.
- **Timeline service**: no changes (task-centric; sprint-level events not surfaced there).
- **Agent service**: no changes. Agents are unaware of sprints in v1.
- **i18n**: new namespace `sprints`, both `en` and `zh`.

## Testing

Per CLAUDE.md Jest conventions — every new function gets at least one test.

**Repository**: real Prisma + test DB; covers CRUD, `findActiveByTeam`, partial unique index enforcement (attempt two ACTIVE rows → P2002).

**Services**:

- `sprintService.start`: concurrent-start 409.
- `sprintService.close`: decisions-coverage validation (missing task → 400); `moveToNext` auto-creates DRAFT when none exists; writes `SPRINT_CHANGED` per moved task.
- `sprintService.addTaskToSprint`: cross-team rejection, closed-sprint rejection.
- `sprintService.configureCadence`: null ↔ non-null toggles.
- `sprintPrepareService.prepareNextDraft`: idempotency; correct date math; respects `autoPrepare` / `cadenceDays = null`.
- `sprintPrepareService.prepareAll`: skips cadence-disabled teams.
- `sprintSummaryService.generate`: GenerationJob lifecycle on success and failure.

**API routes**: 403 for non-owner non-member; 409 for concurrent start/close; 400 for Zod failures.

**Frontend**:

- Close dialog: `[Close]` disabled until all decisions selected; bulk actions populate all rows.
- Sprint detail: button visibility per status; Plan-tasks mode drag behavior.
- Task detail Sprint field: read-only when task is in a CLOSED sprint.

## Implementation Phases

Four vertical PRs, each independently deployable.

### PR 1 — Schema + Repository + Service Skeleton

- New `Sprint`, `SprintSummary` models + partial unique index migration.
- `Task.sprintId` + index, `Team.sprintCadenceDays` + `sprintAutoPrepare`.
- New enum values: `SprintStatus`, `SPRINT_CHANGED`, `SPRINT_STARTED`, `SPRINT_CLOSED`.
- `sprint.repository.ts`, `sprint-summary.repository.ts`, `sprint.service.ts`, `sprint-prepare.service.ts`, `sprint-summary.service.ts` with full unit coverage.
- No routes, no UI.

### PR 2 — API Routes + API Client + Permissions

- All `/api/sprints/*` and `/api/teams/*/sprints` routes + Zod schemas.
- `requireTeamMemberOrOwner` helper.
- `lib/api-client/sprints.ts`.
- Vercel Cron config for `/api/cron/sprints/prepare`.
- Integration tests for 403 / 409 / 400 paths.

### PR 3 — UI: Sidebar, Landing, Detail, Close Dialog, Task Panel

- Sidebar entry + route scaffolding.
- Sprints landing page (active / next / recent per team).
- Sprint detail page (Kanban reuse + right sidebar + Plan tasks mode).
- Close sprint dialog (per-task decisions + bulk actions).
- Team settings Sprints panel (cadence config).
- Task detail right-side Sprint field.
- i18n keys (en + zh).

### PR 4 — Reporting & Polish

- `SprintSummary` generation wiring (close → job → retro tab).
- My Tasks "Current sprint only" chip (service + UI).
- Notification integration: `SPRINT_STARTED` / `SPRINT_CLOSED` dispatch + Inbox rendering + deep link.
- Landing page overdue styling.
- Manual end-to-end pass; release.

Each PR follows the project's commit/PR conventions (`feat: … [LUM-N]`, branch `lumo/{task-id}-{description}`). Task IDs assigned when the work is cut in Linear.
