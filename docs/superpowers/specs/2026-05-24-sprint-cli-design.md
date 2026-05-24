# Sprint CLI — Design Spec

Task: [LUM-88](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-88)

## Overview

`Sprint` is fully implemented server-side (Sprint / SprintSummary models, sprint.service, full REST surface at `/api/sprints/*` and `/api/teams/<id>/sprints`, plus a `/api/me/active-sprints` helper), but the CLI exposes nothing. SKILL.md even calls this out under `task update` ("CLI does not currently update sprint... edit in web UI").

This spec adds a `sprint` command family mirroring the shape of the existing `milestone` family — full CRUD plus the sprint-specific lifecycle verbs (start / close / summary / add-task / remove-task) — and wires `--sprint <ref>` into `task create` / `task update` so callers can attach tasks to sprints from the same flow they already use.

One small server-side change is required: extend the `POST /api/tasks` response so the `task` object includes `teamId`. Today it returns `{ id, identifier, title, url, taskTags }`, which forces the CLI to do an extra `GET /api/tasks/<id>` to learn the team before binding a sprint. Adding `teamId` is a one-line change in `taskCliService.createFromCli`.

Cadence configuration editing (`/api/teams/<id>/cadence`) stays in the Web UI.

## Scope

- **In scope:**
  - CLI: `sprint list / create / show / update / delete / start / close / summary / add / remove`
  - CLI: `task create --sprint <ref>` and `task update --sprint <ref>` (incl. `--sprint ""` to clear)
  - Shared CLI helpers: `resolveTeamId`, `resolveSprintId`
  - Documentation sync in `.claude/skills/lumo/SKILL.md` (new sprint section, remove "sprint editing is web-only" caveats from task sections)
  - One-line server tweak: include `teamId` in `POST /api/tasks` response (so `task create --sprint` doesn't need a follow-up GET)
- **Out of scope:**
  - Cadence config editing (`/api/teams/<id>/cadence`) — Web UI only
  - Fine-grained close decisions per task on the command line (use Web UI or `--move-all` / `--backlog-all` bulk defaults)
  - `lumo team list / show` — auto-resolution covers single-team workspaces; multi-team workspaces are uncommon today
  - Reordering tasks within a sprint (no API analog beyond drag-and-drop)
  - Any other server changes — existing sprint endpoints are sufficient

## Sprint vs Milestone — Key Differences

| Aspect                     | Milestone                                      | Sprint                                                                           |
| -------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Owner entity               | `Project`                                      | `Team`                                                                           |
| Status enum                | `PLANNED / ACTIVE / COMPLETED / CANCELLED` (4) | `DRAFT / ACTIVE / CLOSED` (3)                                                    |
| Status mutation            | PATCH `status`                                 | Dedicated `/start` and `/close` routes                                           |
| Required dates on create   | All optional                                   | `startDate` and `endDate` both required                                          |
| Description field          | Yes                                            | No                                                                               |
| Name on create             | Required                                       | Optional (server fills `Sprint N` default)                                       |
| Per-entity number          | No                                             | Yes — `(teamId, number)` unique, used in URLs                                    |
| Workspace lookup by number | N/A                                            | `/api/sprints/by-number` (workspace-global)                                      |
| Close flow                 | Single PATCH                                   | Requires `decisions` map: each unfinished task → `moveToNext` or `backToBacklog` |
| Summary                    | None                                           | `SprintSummary` model + AI-generated report                                      |

These differences drive most of the design decisions below.

## Identifier Resolution

### Team resolution (`--team <ref>`)

Mirrors `resolveProjectId`:

- `--team <ref>` is `name`, `slug`, or `UUID` (case-insensitive).
- If `--team` omitted: list workspace teams; if exactly one, auto-select; else error with team names.

```ts
// cli/src/lib/resolve.ts
export async function resolveTeamId(
  base: string,
  token: string,
  ref: string | undefined
): Promise<{ id: string; name: string }>
```

Endpoint: `GET /api/teams` (exists; returns `{ teams }`; non-OWNERs see only teams they belong to, OWNERs see all teams in the workspace).

### Sprint resolution

`<identifier>` is **either** a sprint number (positive integer) **or** a UUID:

- UUID detection: existing `UUID_REGEX` in resolve.ts.
- UUID → `GET /api/sprints/<id>` directly.
- Number → `GET /api/sprints/by-number?workspaceUrl=<slug>&number=<n>` (workspace-global lookup).
  - This relies on the current product constraint: "workspace has at most one sprints-enabled team". The endpoint hardcodes that assumption — document it in a comment in `resolveSprintId` so the trap is visible if/when the constraint changes.
- Number lookup that fails → check whether `--team` was passed; if not, suggest "workspace has multiple sprints-enabled teams; pass --team or use the UUID."

```ts
export async function resolveSprintId(
  base: string,
  token: string,
  identifier: string,
  teamRef: string | undefined
): Promise<{ id: string; number: number; name: string; teamId: string }>
```

`teamRef` is informational — used only to give a better error message when number lookup is ambiguous.

## Server Changes

One small change required:

**`POST /api/tasks` response** — include `teamId` on the returned `task` object.

- `taskCliService.createFromCli` return type: add `teamId: string` (the task's team is implicit from the project, already loaded server-side).
- Route serialization in `app/api/tasks/route.ts`: pass `teamId` through (already in the underlying task entity).

No other server changes. All sprint endpoints, validation schemas, and service methods already exist.

## Subcommand Surface

### `sprint list [flags]`

| Flag                   | Type   | Notes                                          |
| ---------------------- | ------ | ---------------------------------------------- |
| `--team <ref>`         | string | Required when workspace has >1 team            |
| `-s, --status <value>` | enum   | `draft \| active \| closed` (case-insensitive) |
| `-n, --limit <count>`  | int    | Cap output to N rows                           |

Endpoint: `GET /api/teams/<id>/sprints?status=...&limit=...` (server already supports `status`, `cursor`, `limit`; sorts by `number` desc).

Output (fixed-width rows, newest first per server sort):

```
<STATUS>  #<number>  <start>..<end>  <name>
DRAFT     #4         2026-05-27..2026-06-09  Sprint 4
ACTIVE    #3         2026-05-13..2026-05-26  Sprint 3
CLOSED    #2         2026-04-29..2026-05-12  Sprint 2
```

### `sprint show <identifier> [--team <ref>]`

Resolves `<identifier>` via `resolveSprintId`. Parallel-fetches `GET /api/sprints/<id>` (sprint + progress counts) and `GET /api/sprints/<id>/tasks` (task list).

Output: key:value header + task table (re-use `formatTaskListTable`):

```
Sprint:       #3 Sprint 3
Status:       ACTIVE
Team:         Engineering
Start:        2026-05-13
End:          2026-05-26
Started:      2026-05-13
Closed:       -
Progress:     7 / 12 done

LUM-42  IN_PROGRESS  HIGH    web      Fix Slack OAuth redirect
LUM-48  TODO         MEDIUM  backend  Investigate slow query
...
```

### `sprint create [flags]`

| Flag                   | Required    | Notes                                                     |
| ---------------------- | ----------- | --------------------------------------------------------- |
| `--team <ref>`         | conditional | Required when workspace has >1 team                       |
| `--start <YYYY-MM-DD>` | **yes**     | Maps to `startDate`                                       |
| `--end <YYYY-MM-DD>`   | **yes**     | Maps to `endDate`. Server enforces `endDate > startDate`. |
| `-n, --name <text>`    | no          | Server fills default when omitted                         |

Endpoint: `POST /api/teams/<id>/sprints` with body `{ name?, startDate, endDate }`.

Output: `Created sprint #<number> "<name>"  <id>`.

### `sprint update <identifier> [flags]`

| Flag                | Notes                                |
| ------------------- | ------------------------------------ |
| `-n, --name <text>` | Non-empty                            |
| `--start <date>`    | YYYY-MM-DD                           |
| `--end <date>`      | YYYY-MM-DD                           |
| `--team <ref>`      | Informational, for number resolution |

At least one mutating flag required (CLI-side check before any network call). Endpoint: `PATCH /api/sprints/<id>`. **No `--status` flag** — status mutates via `start` / `close` only.

Output: delta summary (same format as `milestone update`):

```
Updated sprint #3 "Sprint 3": name "Sprint 3" → "Sprint 3 — Recovery", end → 2026-05-30
```

### `sprint delete <identifier> --yes [--team <ref>]`

Endpoint: `DELETE /api/sprints/<id>`. Server only allows deleting `DRAFT` sprints — ACTIVE/CLOSED return an error which CLI passes through verbatim.

Without `--yes`: refuses with `Refusing to delete sprint #<n> "<name>" without --yes.`. Output on success: `Deleted sprint #<n> "<name>"`.

### `sprint start <identifier> [--team <ref>]`

Endpoint: `POST /api/sprints/<id>/start`. Server validates state transition (must be `DRAFT`, etc.).

Output: `Started sprint #<n> "<name>"`.

### `sprint close <identifier> [flags]`

| Flag            | Notes                                                                                   |
| --------------- | --------------------------------------------------------------------------------------- |
| `--move-all`    | All unfinished tasks → next sprint                                                      |
| `--backlog-all` | All unfinished tasks → backlog (no sprint)                                              |
| `--yes`         | Required when using `--move-all` / `--backlog-all` (guard against accidental bulk move) |

Behavior:

1. Pre-fetch `GET /api/sprints/<id>/tasks` to find unfinished tasks (status ≠ `DONE`).
2. **No flag, no unfinished tasks** → `POST /close` with `{ decisions: {} }`. Output `Closed sprint #<n> "<name>"`.
3. **No flag, unfinished tasks exist** → refuse, list them as `LUM-N  TITLE`, instruct user to add `--move-all --yes`, `--backlog-all --yes`, or use Web UI for per-task decisions. Exit 1.
4. **`--move-all --yes`** → build `decisions: { [taskId]: 'moveToNext', ... }` for every unfinished task, POST.
5. **`--backlog-all --yes`** → same with `'backToBacklog'`.
6. **`--move-all` and `--backlog-all` both set** → CLI-side error before any network call.
7. **`--move-all` without `--yes`** → refuse with `Re-run with --yes to confirm.`.

Server may still reject (e.g. `--move-all` with no future DRAFT sprint to receive tasks). Errors pass through.

### `sprint summary <identifier> [--retry] [--team <ref>]`

Default: `GET /api/sprints/<id>/summary` — print stats, tldr, full report.

`--retry`: `POST /api/sprints/<id>/summary/retry` first (triggers re-generation), then `GET` and print.

Output format:

```
Sprint:    #3 Sprint 3
Stats:     7 done / 5 in_progress / 0 todo / 12 total
TLDR:      <one-line summary>

<full report markdown>
```

### `sprint add <identifier> <LUM-N>` / `sprint remove <identifier> <LUM-N>`

`add`:

- Resolve sprint via `resolveSprintId`.
- Resolve task via existing `resolveTaskId` (LUM-N or UUID).
- `POST /api/sprints/<sprintId>/tasks` with `{ taskId }`.
- Output: `Added LUM-N to sprint #<number>`.
- 409 (already in sprint, or cross-team mismatch) → pass-through.

`remove`:

- `DELETE /api/sprints/<sprintId>/tasks/<taskId>`.
- Output: `Removed LUM-N from sprint #<number>`.

## Task Integration

### `task create --sprint <ref>`

Flag added to `task-create.ts`. Requires the one-line server change noted in Overview/Scope: `POST /api/tasks` response is extended so `task` includes `teamId` (today it returns `{ id, identifier, title, url, taskTags }`). Update `taskCliService.createFromCli` return type + the route's serialization to pass `teamId` through.

1. Run the existing task creation flow (resolve project, POST).
2. From the create response, extract `task.id` and `task.teamId` (no extra GET).
3. Resolve `--sprint <ref>` using `task.teamId` as the team context (number lookup still goes through workspace-global `by-number`, but post-resolve we **assert `sprint.teamId === task.teamId`** to prevent cross-team binding).
4. On mismatch: print `Sprint binding skipped: sprint #<n> belongs to team "<otherTeam>", task belongs to "<taskTeam>"`. Exit 1 (task was still created).
5. On match: `POST /api/sprints/<sprintId>/tasks` with `{ taskId }`. Pass through any error.
6. Add `Sprint: #<number> "<name>"` line to existing output.

### `task update --sprint <ref>` / `--sprint ""`

The server has no `PATCH /api/tasks/<id>` field for `sprintId`. The CLI orchestrates via the sprint task endpoints:

1. Resolve task via existing helper → `GET /api/tasks/<id>` for `currentSprintId` and `teamId`.
2. **`--sprint ""` (clear binding):**
   - `currentSprintId` is null → print `Task LUM-N has no sprint binding`. Exit **0** (idempotent).
   - Otherwise → `DELETE /api/sprints/<currentSprintId>/tasks/<taskId>`. Output: `Unbound LUM-N from sprint #<old>`.
3. **`--sprint <ref>` (non-empty):**
   - Resolve ref against task's team; same cross-team assertion as `task create --sprint`.
   - `currentSprintId === newSprintId` → print `Task LUM-N already in sprint #<n>`. Exit **0**.
   - `currentSprintId !== null && !== newSprintId` → two-step: `DELETE` old, then `POST` new. No client-side rollback on partial failure; print `Task may be in inconsistent sprint state, re-run or check Web UI` and exit 1.
   - Otherwise (no current binding) → `POST` new directly.
   - Output: `Sprint: <#old | -> → #<new>`.

`--sprint` co-exists with other update flags. Order: do the `PATCH /api/tasks/<id>` (existing flow for name/status/priority/assignee/...) first, then the sprint operation. Failures on either step pass through; already-applied changes are not rolled back (matches existing milestone behavior).

## Documentation Sync (`.claude/skills/lumo/SKILL.md`)

Per the project's "CLI & Skills 同步" rule:

1. **New `## Sprint Management` section** — covers all 10 subcommands with the same format as the milestone section: flag table, examples, expected stdout.
2. **`task create` section** — add `--sprint <ref>` row to its flag table; add an example.
3. **`task update` section** — add `--sprint <ref>` row; remove the line under "Out of scope" that says "CLI does not currently update sprint... edit in web UI".
4. **Frontmatter `description`** — add Chinese + English triggers: `sprint`, `start sprint`, `close sprint`, `add to sprint`, `active sprints`, `冲刺`, `迭代`, `开始冲刺`, `关闭冲刺`.

## Error Handling Conventions

Identical to existing CLI commands:

- Not logged in → `Error: not logged in. Run \`lumo auth login\` first.` exit 1
- 401 → `Error: API key invalid or revoked. Run \`lumo auth login\`.` exit 1
- Network throw → `Error: could not reach Lumo API at <url> (<msg>)` exit 1
- Non-2xx with `{ error: string }` body → pass-through `Error: <server.error>` exit 1
- Non-2xx with non-JSON body → `Error: sprint <action> failed (HTTP <status>)` exit 1
- CLI-side validation errors (`--move-all` + `--backlog-all` mutually exclusive, zero update flags, etc.) exit 1 before any network call

## Output Conventions

- stdout for success results (rows / key:value headers / confirmations).
- stderr for errors and refusals.
- Dates render as `YYYY-MM-DD` (slice first 10 of ISO).
- Human-readable sprint identifier in output is `#<number>` (not the cuid).
- Lists are fixed-width text rows (not JSON, not markdown tables) — downstream scripts can `awk` columns.

## Risks & Mitigations

| Risk                                                                                                                          | Mitigation                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `by-number` lookup assumes single sprints-enabled team per workspace; future multi-team enable would break it                 | Document the dependency in `resolveSprintId` comment. When the constraint changes, only `resolveSprintId` + `sprint show` need updates. CLI command tree is stable. |
| `task update --sprint <new>` is a two-step transaction; mid-failure leaves half-applied state                                 | No client-side rollback. Print explicit `Task may be in inconsistent sprint state, re-run or check Web UI`. Rare in practice.                                       |
| `sprint close --move-all` with no future DRAFT sprint → server 409 (`no draft sprint to receive spillover; create one first`) | Pass through server error verbatim. User can run `sprint create --start ... --end ...` first or switch to `--backlog-all`.                                          |
| Multi-team workspace where the user has access to several teams → `resolveTeamId` listing                                     | Mirror milestone's project-list error: `workspace has multiple teams; pass --team <slug>`. Already covers the case.                                                 |

## Test Coverage

Follow existing `cli/tests/` convention — one `.test.ts` per subcommand:

**Pure functions:**

- `formatSprintList`, `formatSprintShow`, `formatSprintUpdateSummary`
- `buildCreatePayload`, `buildUpdatePayload`
- `buildCloseDecisions` (given `--move-all` / `--backlog-all` + task list → produces correct decisions map)

**Resolvers:**

- `resolveTeamId` — single team auto, multi-team error, name vs slug vs UUID
- `resolveSprintId` — number → by-number, UUID → direct, not-found error, multi-team disambiguation hint

**Integration (mock fetch):**

- `sprint start` already ACTIVE → server error pass-through
- `sprint close` with unfinished tasks and no flag → refuses + lists tasks
- `sprint close --move-all` + `--backlog-all` set → CLI-side error before any fetch
- `sprint close --move-all` without `--yes` → refuses
- `task update --sprint ""` when already unbound → idempotent, exit 0
- `task update --sprint <new>` with same ref as current → idempotent, exit 0
- Cross-team binding rejected (assertion fails before POST)

Server-side semantics (decisions validation, sprint state transitions, cadence) are tested in `sprint.service.test.ts` already and not re-tested in CLI.

## PR Strategy

**Default: single PR.** The 10 sprint commands share `resolveTeamId` / `resolveSprintId`; splitting causes rebase churn on the resolve helper.

If the diff exceeds ~800 lines (it might), split into two:

1. **PR A** — `sprint` command family (10 commands) + resolve helpers + SKILL.md sprint section + tests
2. **PR B** — `task create / task update --sprint` integration + SKILL.md task section updates + tests

PR description must call out:

- The `POST /api/tasks` response shape extension (adds `teamId`) — small server change in `taskCliService.createFromCli` + route serialization
