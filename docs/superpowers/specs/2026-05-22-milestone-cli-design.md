# Milestone CLI — Design Spec

Task: [LUM-65](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-65)

## Overview

The `lumo-cli` tool currently exposes only `milestone list`, while the underlying API already supports create / read / update / delete. This spec extends the `milestone` command group to match the shape of the `task` command group (full CRUD), and adds a `--milestone <ref>` filter to `task list` so callers can see "my tasks under this milestone" from the terminal.

A small server addition is required so that `milestone show` can render the tasks under a milestone, and so that `task list --milestone` has a clean endpoint to call without bloating `/api/tasks/me`.

## Scope

- **In scope:**
  - CLI: `milestone create`, `milestone show`, `milestone update`, `milestone delete`
  - CLI: `task list --milestone <ref>`
  - Server: new endpoint `GET /api/milestones/[milestoneId]/tasks` (optional `?assigned=me`)
  - Server: enrich `GET /api/milestones/[milestoneId]` response with `taskCounts`
  - Shared CLI helper for resolving `--project` + milestone `<identifier>`
  - Documentation sync in `.claude/skills/lumo/SKILL.md`
- **Out of scope:**
  - Milestone reorder via CLI (drag-and-drop is a UI affordance; the existing `/reorder` endpoint stays UI-only)
  - Listing tasks under a milestone that are not assigned to the caller via `task list` (use `milestone show` instead)
  - Pagination on the new `/tasks` endpoint (mirrors current `/api/tasks/me` behavior)

## Identifier Resolution

All new CLI commands accept a milestone `<identifier>` that is either a **UUID** or a **case-insensitive name**.

- UUID detection: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
- UUID form skips project resolution and calls milestone-by-id endpoints directly
- Name form resolves a project first:
  - If `--project <ref>` is set, look up that project (name or slug, case-insensitive)
  - Else if the workspace has exactly one visible (non-idea) project, auto-select it
  - Else error: `workspace has multiple projects; pass --project <slug>`
- After project resolution, fetch `GET /api/projects/[id]/milestones` and match by `name.toLowerCase()`
- Unmatched name: error `no milestone matches "<ref>" in project "<project>". Try \`lumo milestone list\`.`

Resolution lives in a new shared helper `cli/src/lib/resolve.ts` exporting:

```ts
export async function resolveProjectId(
  base: string,
  token: string,
  ref: string | undefined
): Promise<string>

export async function resolveMilestoneId(
  base: string,
  token: string,
  identifier: string,
  projectRef: string | undefined
): Promise<{ id: string; name: string; projectId: string }>
```

The existing project-resolution block in `milestone-list.ts` (`slugify` + filter) is moved into this helper. `milestone-list.ts` is refactored to call `resolveProjectId`.

## Server Changes

### New endpoint: `GET /api/milestones/[milestoneId]/tasks`

Route file: `app/api/milestones/[milestoneId]/tasks/route.ts`

```
GET /api/milestones/<id>/tasks
GET /api/milestones/<id>/tasks?assigned=me
```

Behavior:

1. `requireIdentity(request)` — supports both Clerk session and API key auth (consistent with the sibling `/api/milestones/[id]` route)
2. Load milestone via `milestoneRepository.findById`; 404 if missing
3. Load the milestone's project, check membership via `projectService.getProject(milestone.projectId, identity.memberId)` (404 if not a member, mirroring existing milestone read)
4. If `?assigned=me`: translate `identity.memberId` to the human actor id via `getHumanActorId(memberId)` (same helper `/api/tasks/me` uses); 401 if no actor is linked
5. Call a new repository method `taskRepository.findByMilestone({ milestoneId, assigneeActorId? })`
6. Return `{ tasks: [...] }` using the same shape `/api/tasks/me` returns (so the CLI's existing `TaskRow` type & `formatTaskListTable` work unchanged)

Query parsing:

- `?assigned=me` → filter by caller's actor id
- Any other value or absent → no assignee filter

Service layer: a thin method `milestoneService.listTasks(milestoneId, memberId, { assigneeActorId? })` orchestrates the load + membership check + repository query. Pure HTTP concerns stay in the route.

Repository: add a new narrow method to `lib/repositories/task.repository.ts`:

```ts
async findByMilestone(opts: { milestoneId: string; assigneeActorId?: string }) {
  return prisma.task.findMany({
    where: {
      milestoneId: opts.milestoneId,
      ...(opts.assigneeActorId ? { assigneeActorId: opts.assigneeActorId } : {}),
    },
    include: TASK_LIST_INCLUDE,
    orderBy: { order: 'asc' },
  })
}
```

The existing `findByProjectWithDetails` already accepts a `milestoneId` filter but does not support assignee filtering, and widening its signature would couple two concerns. A separate narrow method keeps each query intent-specific.

### Enhanced endpoint: `GET /api/milestones/[milestoneId]`

Add `taskCounts` to the response (parallels what `GET /api/projects/[id]/milestones` already returns per row):

```jsonc
{
  "milestone": {
    "id": "...",
    "name": "...",
    "status": "ACTIVE",
    "startDate": null,
    "targetDate": "2026-08-31T00:00:00.000Z",
    "description": "...",
    "projectId": "...",
    "taskCounts": { "TODO": 3, "IN_PROGRESS": 5, "IN_REVIEW": 2, "DONE": 2 },
  },
}
```

Implementation: after `milestoneService.getMilestone`, call `milestoneRepository.countTasksByStatus(milestoneId)` and merge. One extra query per call; acceptable.

Backward compatibility: the field is additive; existing UI consumers that ignore it remain unaffected.

## CLI Commands

### `lumo milestone create <name>`

Flags:

| Flag                   | Type   | Notes                                                          |
| ---------------------- | ------ | -------------------------------------------------------------- |
| `--project <ref>`      | string | Required when workspace has multiple projects                  |
| `-d, --description <>` | string | Optional                                                       |
| `--start <date>`       | string | `YYYY-MM-DD`. Sent as-is; server coerces via `z.coerce.date()` |
| `--target <date>`      | string | `YYYY-MM-DD`. Sent as-is                                       |

Flow:

1. `resolveProjectId(--project)`
2. `POST /api/projects/<projectId>/milestones` with `{ name, description?, startDate?, targetDate? }`
3. On 201, print: `Created milestone "<name>"  <id>` and exit 0
4. On 4xx, print server error message and exit 1

### `lumo milestone show <identifier>`

Flags:

| Flag              | Type   | Notes                                   |
| ----------------- | ------ | --------------------------------------- |
| `--project <ref>` | string | Used only when `<identifier>` is a name |

Flow:

1. `resolveMilestoneId(<identifier>, --project)` → `{ id, projectId }`
2. `GET /api/milestones/<id>` (now returns `taskCounts`)
3. `GET /api/milestones/<id>/tasks` (full list, no `assigned=me`)
4. Render:

```
Milestone:    Q3 Launch
Status:       ACTIVE
Start:        2026-06-01
Target:       2026-08-31
Project:      product-launch
Description:
  <body or "-">

Tasks:        12 total (TODO 3 / IN_PROGRESS 5 / IN_REVIEW 2 / DONE 2)

LUM-42  IN_PROGRESS  HIGH    Fix Slack OAuth redirect
LUM-48  TODO         MEDIUM  Investigate slow query
...
```

The task table reuses `formatTaskListTable` from `task-list.ts`. Since it's now used by both `task-list.ts` and `milestone-show.ts`, extract it into `cli/src/lib/format.ts` and re-export from `task-list.ts` for back-compat with existing tests. The header block uses fixed-label rendering similar to `task show`.

If the milestone has zero tasks, print `Tasks:        0 total` and omit the table.

### `lumo milestone update <identifier>`

Flags:

| Flag                   | Type   | Notes                                                                              |
| ---------------------- | ------ | ---------------------------------------------------------------------------------- |
| `--project <ref>`      | string | Used only when `<identifier>` is a name                                            |
| `-n, --name <text>`    | string | New name. Cannot be empty.                                                         |
| `-d, --description <>` | string | `--description ""` clears the field (sent as `null`).                              |
| `-s, --status <value>` | enum   | `planned \| active \| completed \| cancelled` (case-insensitive, hyphens accepted) |
| `--start <date>`       | string | `YYYY-MM-DD`. `--start ""` clears (sent as `null`).                                |
| `--target <date>`      | string | `YYYY-MM-DD`. `--target ""` clears (sent as `null`).                               |

Flow:

1. Resolve identifier
2. Build PATCH payload — must include at least one field; else print "provide at least one field to update" and exit 1
3. Normalize `--status` via a `normalizeMilestoneStatus` helper (mirrors `normalizeStatus` from `task-update.ts`)
4. `PATCH /api/milestones/<id>` with the payload
5. On success, print a one-line diff summary:
   ```
   Updated milestone "Q3 Launch": status PLANNED → ACTIVE, target → 2026-08-31
   ```
   Building the diff requires the prior values — fetch the milestone before the PATCH (one extra GET) so we can compute the delta. Acceptable cost.

### `lumo milestone delete <identifier>`

Flags:

| Flag              | Type   | Notes                                                            |
| ----------------- | ------ | ---------------------------------------------------------------- |
| `--project <ref>` | string | Used only when `<identifier>` is a name                          |
| `--yes`           | bool   | **Required.** No TTY confirm — CLI is agent-friendly by default. |

Flow:

1. Resolve identifier (also captures `name` and `taskCounts.total` for the safety message)
2. If `--yes` missing:
   ```
   Refusing to delete milestone "Q3 Launch" without --yes.
   12 tasks under it will keep their data; only milestoneId is cleared.
   Re-run with --yes to confirm.
   ```
   Exit 1.
3. `DELETE /api/milestones/<id>`
4. Print `Deleted milestone "Q3 Launch"` and exit 0

The "tasks will keep their data" line is grounded in the schema: `Task.milestoneId` has `onDelete: SetNull` (see `prisma/schema.prisma:412`).

### `lumo task list --milestone <ref>`

New flag on the existing `task list` command.

Flag:

| Flag                    | Type   | Notes                                                             |
| ----------------------- | ------ | ----------------------------------------------------------------- |
| `-m, --milestone <ref>` | string | Milestone name or UUID; `--project` may also be required for name |

Behavior:

- When `--milestone` is **not** set: existing behavior unchanged (`GET /api/tasks/me` + client-side filters)
- When `--milestone` **is** set:
  1. Resolve milestone identifier via `resolveMilestoneId`
  2. Call `GET /api/milestones/<id>/tasks?assigned=me`
  3. Apply existing client-side `--status` / `--project` / `--limit` filters on the response

The `--project` flag in this case serves a dual role: it disambiguates milestone name resolution **and** continues to filter the displayed rows (rows already share that project since they're scoped to the milestone, so the filter is effectively a no-op but stays for shape consistency).

## Output Format Conventions

All new commands mirror existing CLI conventions:

- **stdout**: machine-friendly single-line success messages or fixed-width tables
- **stderr**: human-friendly error text prefixed with `Error: `
- **Exit codes**: `0` success, `1` user-facing error (auth, not-found, invalid input, network)
- **Date display**: ISO date only (`YYYY-MM-DD`), `-` when null

## Validation & Error Handling

- Date flags (`--start`, `--target`) are passed through as strings; the server validates via `z.coerce.date()`. The CLI does not pre-validate beyond the empty-string sentinel.
- Status normalization on the CLI side accepts `planned/active/completed/cancelled`, `PLANNED/ACTIVE/...`, and hyphenated forms — returns `null` for unknown values so the caller can print an "Allowed: ..." error before hitting the server.
- API errors (4xx/5xx) print the server's `error` field when present; otherwise `Error: <verb> failed (HTTP <code>)`.

## Testing

Per `CLAUDE.md`'s "every new function needs at least one test". Tests live in the top-level `__tests__/` directory.

**Unit (`__tests__/cli/`)**:

- `resolve.test.ts` — UUID detection branch, name resolution with auto-selected project, name resolution with explicit `--project`, ambiguous workspace error, unmatched name error
- `milestone-update.test.ts` — `buildUpdatePayload` (empty string → `null`, status normalization, "no fields" error)
- `milestone-delete.test.ts` — `--yes` guard prints the right message and exits 1
- `milestone-show.test.ts` — `formatMilestoneShow` with full milestone + tasks, with no description, with zero tasks
- `milestone-status.test.ts` — `normalizeMilestoneStatus` accepts all four enum values in both cases and hyphen forms; returns null otherwise

**Integration (`__tests__/api/` or root)**:

- `api-milestones-tasks.test.ts` — `GET /api/milestones/[id]/tasks` happy path, `?assigned=me` filter, 404 on non-member, 401 on no auth
- `api-milestone-get.test.ts` — assert `taskCounts` is present on the single-milestone GET

**CLI end-to-end** can stay manual for this PR (run against staging).

## Documentation Sync

`.claude/skills/lumo/SKILL.md` updates:

1. Frontmatter `description` — add trigger phrases: `create milestone`, `update milestone`, `delete milestone`, `show milestone`, `tasks in milestone`, `milestone tasks`, `mark milestone as done`
2. Replace the "Out of scope" note in the task section that currently reads "creating / editing / deleting milestones themselves is web-UI only"
3. New `### lumo milestone create / show / update / delete` subsections under `## Task Management` (rename the section to `## Task & Milestone Management`, or split if it gets long)
4. Update `### lumo task list` to document the `--milestone` flag and the endpoint switch behavior

## Migration / Rollout

- No database migration required.
- No backfill required.
- No breaking API changes: the `taskCounts` field on `GET /api/milestones/[id]` is additive; the new `/tasks` endpoint is new.
- CLI version: bump `cli/package.json` patch version when this lands.

## Open Questions

None at design time.
