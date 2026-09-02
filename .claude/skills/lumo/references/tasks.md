# Task Management

Core task CRUD — create, update, list, recommend-next, show, comment. For dependency edges between tasks, see [task-deps.md](task-deps.md).

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

Next:
  lumo session attach LUM-55
      Bind this session to the task so its work is recorded against it
  lumo task criteria set LUM-55 --file <criteria.json>
      Draft the acceptance contract before writing the first line of code
```

The `Tags:` line is omitted when no tags were attached. The trailing `Next:` block is server-computed and conditional — the attach line is skipped when this session is already bound (a second attach is a 409), and the whole block is suppressed by `--no-hints` / `LUMO_NO_HINTS=1`. The `Created …` line stays first and unchanged. See SKILL.md "Next-step hints".

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
| `--claimable`            | boolean             | LUM-646: mark the task agent-claimable (fail-closed default is false). Surfaces the task in `lumo next --claimable`. Mutually exclusive with `--not-claimable`.                                                                                                       |
| `--not-claimable`        | boolean             | LUM-646: mark the task NOT agent-claimable. Mutually exclusive with `--claimable`.                                                                                                                                                                                    |
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

Next:
  lumo verify --note "<self-report>"
      Run the machine acceptance loop before claiming the task is done
```

The `Tags:` line is omitted when the resulting tag set is empty. The trailing `Next:` block reflects the **post-update** status — `--status in_review` prints a stop-and-wait note instead of a command, and a DONE task prints nothing. Suppressed by `--no-hints` / `LUMO_NO_HINTS=1`.

### Status transitions — direct moves are legal

The server's transition matrix (`lib/task/state-machine.ts`):

| From        | Allowed targets                       |
| ----------- | ------------------------------------- |
| TODO        | IN_PROGRESS, IN_REVIEW, DONE          |
| IN_PROGRESS | TODO, IN_REVIEW, DONE                 |
| IN_REVIEW   | TODO, IN_PROGRESS, DONE               |
| DONE        | TODO, IN_PROGRESS, IN_REVIEW (reopen) |

Practical rules:

- **One call suffices.** `--status done` straight from TODO or IN_PROGRESS is legal — never walk `in_progress → in_review → done` as a ritual; it just wastes calls. That one call **asks for interactive confirmation** (see below) — there is no `--yes`.
- **Under the verify flow you don't set `in_review`/`done` at all** — `lumo verify` moves the task to IN_REVIEW on all-pass and the DONE adjudication is human-only.
- **A DONE task can be reopened** — to IN_REVIEW, IN_PROGRESS, or TODO. Reopening is a plain status change and does not alter any recorded acceptance verdict; verdict adjudication is human-only and has no CLI path. To attach context without reopening, `lumo task comment` works.

### `--status done` asks for interactive confirmation (LUM-731)

DONE is the one status move that needs a human at the keyboard. Before the PATCH, the CLI looks the task up, prints what is about to change plus every linked PR with its synced state, and asks `[y/N]` (empty answer = N). When a linked PR is **not merged** (open, closed-without-merge, draft), the unmerged ones are listed again and a **second** `[y/N]` is asked. Only after every prompt is answered `y` does the PATCH go out — and the server's own DONE gates (unresolved send-back / open boundary crossing → 409) still apply on top; the 409 text is printed verbatim.

```
About to move LUM-48 "Title" to DONE
  Status:  IN_REVIEW → DONE
  Pull requests:
    #926  merged   refactor: panel    https://github.com/o/r/pull/926
    #930  open     feat: wip          https://github.com/o/r/pull/930
Move LUM-48 to DONE? [y/N] y

  ⚠ 1 linked pull request not merged:
    #930  open     feat: wip          https://github.com/o/r/pull/930
Mark LUM-48 DONE anyway with unmerged PRs? [y/N] n
Aborted — LUM-48 unchanged.
```

`Pull requests:  none linked` is printed when the task has no PR; then only the first prompt is asked.

- **There is no `--yes`, `--force`, or `--confirm`.** A flag an agent can pass is not a gate. Do not look for one.
- **Non-TTY stdin → exit 1 before any network call** (`--status done requires interactive confirmation, but stdin is not a TTY …`). An agent shell cannot move a task to DONE; tell the user to run the command in their terminal or use the web UI. Every other status (`todo` / `in_progress` / `in_review`) is unaffected.
- A declined prompt prints `Aborted — LUM-N unchanged.` and exits 1 with nothing sent.

### When to suggest `task update`

- The user describes a state change in natural language (e.g. "mark LUM-48 as in progress", "rename LUM-12 to ...", "assign LUM-30 to me", "bump the priority on LUM-7").
- After the agent finishes a task and the user confirms — tell the user to run `lumo task update LUM-N --status done` in their terminal (it prompts for confirmation; an agent shell is non-TTY and is refused).
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

```bash
lumo task list                                  # everything assigned to me
lumo task list --status in_progress -n 10       # capped, status-filtered
lumo task list --project backend --status todo
lumo task list --milestone "Q3 Launch"
```

When `--milestone` is set, the CLI calls `GET /api/milestones/<id>/tasks?assigned=me` instead of `/api/tasks/me`. Other filters (`--status`, `--limit`) still apply client-side to the milestone-scoped result.

Filtering is currently client-side — the server returns the full "my tasks" set and the CLI slices it. This is fine for typical workspaces (dozens of tasks); revisit if a workspace has hundreds.

### When to suggest `task list`

- The user asks "what am I working on", "what tasks do I have", "list my tasks", "show me my queue".
- Before suggesting a status change ("mark something as done"), if no task ID is in context — run `task list` first to surface candidates.

### `lumo next [--count <N>] [--claimable]` — recommend the next task to work on

Ranks the tasks assigned to you and prints the top N (default 3), each with a
one-line reason. Read-only — it does **not** bind or load context. Pick one from
the list, then run `lumo session attach <LUM-N>` + `lumo task context <LUM-N>`.

Ranking is lexicographic: **priority** (URGENT→LOW) first, then **active-sprint
membership**, then **dependency topology** (LUM-645: tasks with an open
CONFIRMED blocker sort after workable ones; among workable peers the task that
directly unblocks the most open tasks ranks first), then **due date** (earlier
first), then in-flight status (IN_PROGRESS / IN_REVIEW ahead of TODO). DONE
tasks are excluded. The active sprint lookup is best-effort — if it fails the
command still recommends, just without the sprint boost. The topology counts
come from the server (`/api/tasks/me`); against an older server without them
the order is simply the pre-topology ranking.

| Flag              | Type    | Notes                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-n, --count <N>` | integer | How many tasks to recommend. Defaults to 3. Must be a positive integer.                                                                                                                                                                                                                                |
| `--claimable`     | boolean | LUM-646 (F4/自治边界): restrict to the autonomy boundary — recommend **only** tasks that are agent-claimable (steward-triaged) **and** unblocked (no open CONFIRMED blocker, F3) **and** within milestone budget (not measured over the LUM-644 token budget, F2). Off by default (unchanged ranking). |

```bash
lumo next
lumo next --count 1
lumo next --claimable        # autonomy-scoped: only claimable ∩ unblocked ∩ in-budget
```

**`--claimable` semantics (LUM-646):** the three-part gate is a hard filter, not just a re-ranking (default `next` still soft-deprioritizes blocked tasks per LUM-645). `claimable` is **fail-closed** — a task is not claimable until a steward (`lumo milestone triage`) or `lumo task update --claimable` marks it, so the default field value excludes it. Budget is **fail-open on the unknown** — only a _measured_ overrun excludes; no budget set / unmeasured burn never gates. When the gate empties the list, the output states the honest breakdown (e.g. `No claimable, unblocked, in-budget tasks right now. (excluded: 3 not triaged claimable, 1 blocked by open deps)`). Against a server that predates F4 (no `claimable` field), `--claimable` prints a one-line notice and **degrades to the standard ranking** rather than returning nothing.

Output:

```
Top 3 recommended tasks (of 12 open):

1. LUM-42  IN_PROGRESS  URGENT  Fix Slack OAuth redirect
     ↳ URGENT · active sprint · due 2026-06-03 (overdue) · in progress
2. LUM-48  TODO         HIGH    Investigate slow query
     ↳ HIGH · active sprint · unblocks 2 tasks
3. LUM-12  TODO         MEDIUM  Add rate limiting
     ↳ MEDIUM · blocked by 1 open dep · due 2026-06-10

Next:
  lumo session attach LUM-42 && lumo task context LUM-42
      start on the top-ranked task
```

When to suggest: the user asks "what should I work on", "what's next", "recommend my next task" (in any language), "pick my next task", or starts a session without a task in mind. After they choose, run `session attach` + `task context` for the picked task.

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

**Task dependencies** (`lumo task deps add/list/confirm/dismiss/rm`) now live in [task-deps.md](task-deps.md).
