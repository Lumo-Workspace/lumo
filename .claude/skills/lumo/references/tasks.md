# Task Management

## Task Management

### `lumo task create <title> [flags]` — create a new task

Use this when the user wants to file a new task from the terminal. Title is positional and required (non-empty).

| Flag                     | Type   | Notes                                                                               |
| ------------------------ | ------ | ----------------------------------------------------------------------------------- |
| `-d, --description <>`   | string | Optional task description.                                                          |
| `-p, --priority <level>` | enum   | `low \| medium \| high \| urgent` (case-insensitive). Defaults to `low`.            |
| `-a, --assignee <ref>`   | string | `me`, an email, or a member name. Defaults to `me`.                                 |
| `--project <ref>`        | string | Project name or slug. **Required when the workspace has more than one project.**    |
| `--milestone <ref>`      | string | Milestone name (case-insensitive) within the resolved project. Omit for no binding. |
| `--sprint <ref>`         | string | Sprint number or UUID to bind the task to on creation. Omit for no sprint binding.  |
| `--tag <name>`           | string | Attach a tag by name (repeatable). The name is resolved to an id server-side.       |
| `--tag-id <cuid>`        | string | Attach a tag by cuid (repeatable). Combines with `--tag`.                           |

Examples:

```bash
lumo task create "Fix Slack OAuth redirect bug"
lumo task create "Refactor task service" --priority high --description "Split into smaller files"
lumo task create "Investigate slow query" --assignee teammate@example.com --project backend
lumo task create "Plan API design" --milestone "v1.0"
lumo task create "Sprint task" --sprint 3
lumo task create "Add rate limiting" --tag bug --tag urgent
lumo task create "Spike: evaluate caching options" --tag rfc --tag-id clm_abc123
```

On success the command prints one or two lines to stdout:

```
Created LUM-55 "Title"  https://www.uselumo.ai/workspace/<slug>/my-tasks/LUM-55
Tags: bug, urgent
```

The `Tags:` line is omitted when no tags were attached.

If the workspace has multiple projects and `--project` is omitted, the server will return an error naming available projects — re-run with `--project <slug>`.

### When to suggest `task create`

- The user describes wanting a new task ("create a task to ...", "file a bug for ...", "log a TODO that ...", "add a task: ...").
- After a discussion that ends in "let's track that separately" — offer to create the task with a sensible title and priority.
- For follow-ups discovered mid-work that shouldn't bloat the current change — propose `task create` rather than silently expanding scope.

### `lumo task update <identifier> [flags]` — patch a task

Pure flag-driven update. Provide at least one of:

| Flag                     | Type                | Notes                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-t, --title <text>`     | string              | Cannot be empty.                                                                                                                                                                                                                                                      |
| `-d, --description <>`   | string              | `--description ""` clears the field.                                                                                                                                                                                                                                  |
| `-s, --status <value>`   | enum                | `todo \| in_progress \| in_review \| done` (case-insensitive).                                                                                                                                                                                                        |
| `-p, --priority <lvl>`   | enum                | `low \| medium \| high \| urgent`.                                                                                                                                                                                                                                    |
| `-a, --assignee <ref>`   | string              | `me`, an email, or a member name. `--assignee ""` clears the field.                                                                                                                                                                                                   |
| `--milestone <ref>`      | string              | Milestone name (case-insensitive) within the task's project. `--milestone ""` unbinds.                                                                                                                                                                                |
| `--sprint <ref>`         | string              | Sprint number or UUID to bind the task to. `--sprint ""` clears the current sprint binding (idempotent when already unbound).                                                                                                                                         |
| `--tag <name>`           | string (repeatable) | **Bulk replace** the tag set by name. Creates tag if missing. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                                                                                                                         |
| `--tag-id <cuid>`        | string (repeatable) | **Bulk replace** the tag set by id. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                                                                                                                                                   |
| `--add-tag <name>`       | string (repeatable) | Attach tag by name (find-or-create). Max 20.                                                                                                                                                                                                                          |
| `--add-tag-id <cuid>`    | string (repeatable) | Attach tag by id. Max 20.                                                                                                                                                                                                                                             |
| `--remove-tag <name>`    | string (repeatable) | Detach tag by name. `--remove-tag <name>` resolves the name via find-or-create on the workspace. If the name was unknown, a new Tag row is created (orphan, no attachments) before the detach runs as a no-op. Use `--remove-tag-id <cuid>` to avoid orphans. Max 20. |
| `--remove-tag-id <cuid>` | string (repeatable) | Detach tag by id. Unknown ids are a no-op (no side effects). Max 20.                                                                                                                                                                                                  |

`--tag` / `--tag-id` (bulk replace) are mutually exclusive with `--add-tag` / `--add-tag-id` / `--remove-tag` / `--remove-tag-id`. The CLI errors before any network call if both families are mixed.

Examples:

```bash
lumo task update LUM-48 --status in_progress
lumo task update LUM-48 --title "Update task from CLI" --priority high
lumo task update LUM-48 --assignee me
lumo task update LUM-48 --description ""        # clear description
lumo task update LUM-48 --assignee ""           # unassign
lumo task update LUM-48 --milestone "v1.0"      # attach to milestone
lumo task update LUM-48 --milestone ""          # unbind milestone
lumo task update LUM-48 --sprint 3              # bind to sprint #3
lumo task update LUM-48 --sprint ""             # unbind from current sprint
lumo task update LUM-42 --add-tag urgent --remove-tag draft
lumo task update LUM-42 --tag final --tag approved   # replace entire tag set
lumo task update LUM-42 --tag final --add-tag oops
# Error: --tag/--tag-id are mutually exclusive with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id
```

On success the command prints one or two lines to stdout:

```
Updated LUM-48 "Title"  https://www.uselumo.ai/workspace/<slug>/my-tasks/LUM-48
Tags: urgent
```

The `Tags:` line is omitted when the resulting tag set is empty.

### When to suggest `task update`

- The user describes a state change in natural language (e.g. "mark LUM-48 as in progress", "rename LUM-12 to ...", "assign LUM-30 to me", "bump the priority on LUM-7").
- After the agent finishes a task and the user confirms — offer to move it to `done`.
- Multiple status changes in a row should each be a separate `update` invocation rather than batched.

### Sprint output format

`--sprint <ref>` prints a `Sprint:` line after the update line showing old → new binding:

```
Sprint: - → #3        # newly bound (was backlog)
Sprint: #2 → #3       # rebound (moved from sprint 2 to 3)
Sprint: #3 → -        # unbound
Task LUM-48 already in sprint #3    # noop (same sprint)
Task LUM-48 has no sprint binding   # noop (already unbound)
```

`--sprint` can be combined with other update flags. The PATCH (field updates) runs first; the sprint operation runs after. Failures on either step pass through independently without rollback.

### Out of scope

The CLI does **not** currently update due date or parent task. Those need to be edited in the web UI.

Milestone updates (`--milestone`) and sprint binding (`--sprint`) both work. Full milestone CRUD is available via `lumo milestone create / show / update / delete`, tasks can be bound/unbound in bulk via `lumo milestone add / remove <identifier> <task...>`, and milestones can be manually reordered via `lumo milestone reorder <ref...>` / `lumo milestone move <ref> --before|--after <ref>` (see below). Full sprint CRUD is available via `lumo sprint create / show / update / delete / start / close / add / remove` (see below).

### `lumo task list [flags]` — list tasks assigned to you

Default behavior: prints every task currently assigned to the authenticated user (no project / status filter), one per line, as a fixed-width table:

```
LUM-42  IN_PROGRESS  HIGH    web        Fix Slack OAuth redirect
LUM-48  TODO         MEDIUM  backend    Investigate slow query
```

| Flag                    | Type    | Notes                                                                            |
| ----------------------- | ------- | -------------------------------------------------------------------------------- |
| `-s, --status <value>`  | enum    | Filter by status: `todo \| in_progress \| in_review \| done` (case-insensitive). |
| `-p, --project <ref>`   | string  | Filter by project name (case-insensitive match against display name).            |
| `-m, --milestone <ref>` | string  | Filter to my tasks under this milestone (name or UUID).                          |
| `-n, --limit <count>`   | integer | Cap output to the first N rows.                                                  |

When `--milestone` is set, the CLI calls `GET /api/milestones/<id>/tasks?assigned=me` instead of `/api/tasks/me`. Other filters (`--status`, `--limit`) still apply client-side to the milestone-scoped result.

Filtering is currently client-side — the server returns the full "my tasks" set and the CLI slices it. This is fine for typical workspaces (dozens of tasks); revisit if a workspace has hundreds.

### When to suggest `task list`

- The user asks "what am I working on", "what tasks do I have", "list my tasks", "show me my queue".
- Before suggesting a status change ("mark something as done"), if no task ID is in context — run `task list` first to surface candidates.

### `lumo next [--count <N>]` — recommend the next task to work on

Ranks the tasks assigned to you and prints the top N (default 3), each with a
one-line reason. Read-only — it does **not** bind or load context. Pick one from
the list, then run `lumo session attach <LUM-N>` + `lumo task context <LUM-N>`.

Ranking is lexicographic: **priority** (URGENT→LOW) first, then **active-sprint
membership**, then **due date** (earlier first), then in-flight status
(IN_PROGRESS / IN_REVIEW ahead of TODO). DONE tasks are excluded. The active
sprint lookup is best-effort — if it fails the command still recommends, just
without the sprint boost.

| Flag              | Type    | Notes                                                                   |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| `-n, --count <N>` | integer | How many tasks to recommend. Defaults to 3. Must be a positive integer. |

```bash
lumo next
lumo next --count 1
```

Output:

```
Top 3 recommended tasks (of 12 open):

1. LUM-42  IN_PROGRESS  URGENT  Fix Slack OAuth redirect
     ↳ URGENT · active sprint · due 2026-06-03 (overdue) · in progress
2. LUM-48  TODO         HIGH    Investigate slow query
     ↳ HIGH · active sprint
3. LUM-12  TODO         MEDIUM  Add rate limiting
     ↳ MEDIUM · due 2026-06-10

Next: lumo session attach LUM-42 && lumo task context LUM-42
```

When to suggest: the user asks "what should I work on", "what's next", "推荐下一个任务", "pick my next task", or starts a session without a task in mind. After they choose, run `session attach` + `task context` for the picked task.

### `lumo task show <identifier>` — print one task's detail

Returns a key:value block for a single task — title, status, priority, project, assignee (with display name from Clerk), URL, and the full description below. Lighter than `task context` because it does not load prior session summaries or memory.

```bash
lumo task show LUM-42
```

Use when the user wants the current state of a task without the agent-handoff payload.

### `lumo task comment <identifier> <body>` — leave a comment

Two-step under the hood (resolve LUM-N → POST comment). Body is plain text; quote it to embed spaces or newlines.

```bash
lumo task comment LUM-42 "Reproduced the redirect bug on staging — Safari only, not Chrome."
```

The CLI does not support @-mention chip syntax. If the user wants to ping someone, they should comment from the web UI.

---

## Task Dependencies (`lumo task deps …`)

### `lumo task deps list <LUM-N>` — show all dependency edges

Prints the task's dependency edges grouped into three sections: **CONFIRMED**, **SUGGESTED(待确认)**, and **DISMISSED**. Each row includes a short 8-character edge id in square brackets, the direction (`blocked by` / `blocks`), the other task's identifier and title, the other task's current status, the source (`MANUAL` or `DETECTED`), and inline evidence for detected edges.

```bash
lumo task deps list LUM-42
```

Example output:

```
Dependencies for LUM-42 (3)

CONFIRMED
  [a1b2c3d4] blocked by LUM-9「Fix auth token expiry」 IN_PROGRESS · MANUAL

SUGGESTED(待确认)
  [e5f6a7b8] blocks LUM-55「Migrate DB schema」 TODO · shared_files(4 个共享文件: src/db/schema.ts, src/db/migrate.ts, ...)
      确认: lumo task deps confirm LUM-42 e5f6a7b8(方向反了加 --reverse;误报: dismiss)
  [c9d0e1f2] blocked by LUM-38「Add OAuth scopes」 IN_REVIEW · task_mention(description)
      确认: lumo task deps confirm LUM-42 c9d0e1f2(方向反了加 --reverse;误报: dismiss)

DISMISSED
  [b3c4d5e6] blocks LUM-12 · 已忽略
```

CONFIRMED and SUGGESTED rows show the other task's identifier, title, current status, and source/evidence. DISMISSED rows render as `[shortId] <direction> <identifier> · 已忽略` only — no title, status, or source.

When there are no edges at all the output is:
```
Dependencies for LUM-42: 无依赖边。
```

**Evidence fields by detection signal:**
- `shared_files` — `shared_files(N 个共享文件: path1, path2, …)` — number of shared write-touched files in the 14-day window, plus up to 5 sample paths.
- `task_mention` — `task_mention(description)` or `task_mention(comment)` — the surface where the mention appeared.

CONFIRMED rows also show `source`: `MANUAL` (user-declared via `deps add`) or `DETECTED` (auto-found then confirmed via `deps confirm`).

### `lumo task deps add <LUM-N> --blocked-by <LUM-M>` — declare a manual hard dependency

Asserts that LUM-N is blocked by LUM-M. The edge is created as CONFIRMED + MANUAL, meaning it is immediately in effect (no confirmation step required).

```bash
lumo task deps add LUM-42 --blocked-by LUM-9
```

Both `<LUM-N>` and `--blocked-by` are required. The command errors on usage if either is missing.

**Service semantics (read before using):**
- **Self-edge** → 400 ("A task cannot depend on itself").
- **CONFIRMED edge in the same direction already exists** → 409 ("Dependency already exists").
- **CONFIRMED edge in the reverse direction already exists** → the cycle guard fires and returns 409 ("Dependency would create a cycle").
- **Pair has a SUGGESTED or DISMISSED edge** in the same direction → `add` confirms it in place, preserving the original DETECTED source (so the edge transitions to CONFIRMED while keeping its auto-detected provenance). No new row is created.
- **Cycle guard** — the service runs a DFS over all CONFIRMED BLOCKS edges in the workspace before writing. If adding the edge would create a cycle → 409 ("Dependency would create a cycle").

### `lumo task deps confirm <LUM-N> <edge> [--reverse]` — confirm a detected candidate

Promotes a SUGGESTED edge to CONFIRMED. `<edge>` is a selector for the specific edge on LUM-N's edge list.

```bash
lumo task deps confirm LUM-42 e5f6a7b8           # confirm as detected direction
lumo task deps confirm LUM-42 LUM-55              # selector by other task's identifier
lumo task deps confirm LUM-42 e5f6a7b8 --reverse  # flip direction before confirming
```

**Edge selector semantics** (shared by `confirm`, `dismiss`, `rm`):
- **Other task's identifier** (e.g., `LUM-55`) — case-insensitive exact match against the edge's other-task identifier. Resolves unambiguously when there is exactly one edge to that task.
- **Edge-id prefix** — at least 6 characters of the short id (e.g., `e5f6a7`). Must match exactly one edge.
- If zero or more than one edge matches → prints all candidate edges with short ids and exits 1. Retry with a more specific selector.

**`--reverse` semantics:**
- The detector's direction heuristic is best-effort. If the suggested direction is backwards (e.g., the detector says "LUM-42 blocks LUM-55" but actually LUM-55 blocks LUM-42), confirm with `--reverse` to flip before writing.
- The service checks that the reversed pair does not already have an edge (→ 409), and re-runs the cycle guard with the flipped direction.

### `lumo task deps dismiss <LUM-N> <edge>` — dismiss a candidate (immune to re-detection)

Marks the edge DISMISSED. The row is kept in the database — this is the key difference from `rm`. Because the row exists (in either direction), the detection service will never re-suggest this pair.

```bash
lumo task deps dismiss LUM-42 e5f6a7b8
lumo task deps dismiss LUM-42 LUM-38
```

Output: `Dismissed: [e5f6a7b8] LUM-38「Add OAuth scopes」(不再建议)`

Use `dismiss` for false positives. Use `rm` only when you want the pair to be eligible for re-detection in the future (the detection service can re-suggest pairs with no existing row).

### `lumo task deps rm <LUM-N> <edge> --yes` — delete an edge

Hard-deletes the edge row. **Requires `--yes`** — the CLI refuses without it (no interactive prompt exists).

```bash
lumo task deps rm LUM-42 a1b2c3d4 --yes
```

Output: `Removed [a1b2c3d4] from LUM-42`

**`rm` vs `dismiss`:** deleting removes the immunity — the detection service may re-suggest this pair the next time a shared-files sweep or task-mention event fires. Prefer `dismiss` for detection false positives; use `rm` to remove an incorrectly-declared MANUAL edge that you want fully erased.

---

### Detection red lines

- The detection service **never creates CONFIRMED edges automatically**. All auto-detected candidates are SUGGESTED; a human must `confirm` or `add` for an edge to become CONFIRMED.
- **Dismiss is pair-wise immunity**: once any edge exists between task A and task B (in either direction, regardless of status including DISMISSED), the detection service will not create a new candidate for that pair.
- **`rm` lifts the immunity**: after deleting the only edge between A and B, the detector may re-suggest them on the next event or sweep.

---

### Detection signals

**Signal 1 — `task_mention`**: fires when a task's description is updated or a comment is created. If the updated HTML contains @-mentions of other tasks, the mentioning task is recorded as depending on the mentioned task (direction heuristic: mentioner blocked by mentioned). Triggers immediately on write events; no cron needed.

**Signal 2 — `shared_files`**: hourly cron sweep. Looks at write-tool hook events (file edits, creates, etc.) in the past 14 days. For every pair of open (non-DONE) tasks that share **≥ 3 written files**, a SUGGESTED edge is created. Direction heuristic: older task blocks newer task. Parent–child task pairs are skipped (they share files by design). Edges are not created across different workspaces.

---

### When to suggest `task deps` commands

- **After `session attach` output shows a blocker warning or candidate-count hint** → run `lumo task deps list <LUM-N>` to review the full edge list, then `confirm` or `dismiss` each SUGGESTED candidate.
- **User says "X needs to wait for Y" or "LUM-42 is blocked by LUM-9"** → run `lumo task deps add LUM-42 --blocked-by LUM-9`.
- **Agent sees a `## ⚠ 依赖告警` block (form A — live blockers) at session-start** → evaluate whether to wait for the blocker to merge before starting work; if the edge is stale or wrong, clean it with `deps rm` or `deps dismiss`.
- **Agent sees only a standalone hint line `检测到 N 条候选依赖待确认…` (form B — no live blockers)** → no immediate blocker, but run `lumo task deps list <LUM-N>` to review and confirm/dismiss SUGGESTED candidates. See [sessions.md](sessions.md) for the full alert format.
- **User reports a false positive dependency suggestion** → `lumo task deps dismiss <LUM-N> <edge>` to permanently suppress it for this pair.
