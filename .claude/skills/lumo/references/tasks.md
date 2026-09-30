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
| `--due <date>`           | string | Due date `YYYY-MM-DD`, your local day (same convention as the web due-date picker). |
| `--parent <id>`          | string | Parent task `LUM-N` in the same project — creates this as a subtask.                |
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
| `--due <date>`           | string              | Due date `YYYY-MM-DD` (your local day). `--due ""` clears it.                                                                                                                                                                                                         |
| `--parent <id>`          | string              | Parent task `LUM-N` (same project) — makes this a subtask. A self, cross-project or circular parent is refused (400). `--parent ""` detaches it.                                                                                                                      |
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

- **One call suffices.** `--status done` straight from TODO or IN_PROGRESS is legal — never walk `in_progress → in_review → done` as a ritual; it just wastes calls. That one call **walks the confirmation protocol** (see below): without `--confirm` it exits 4 with an envelope, never a prompt.
- **Under the verify flow you don't set `in_review`/`done` at all** — `lumo verify` moves the task to IN_REVIEW on all-pass and the DONE adjudication is human-only.
- **A DONE task can be reopened** — to IN_REVIEW, IN_PROGRESS, or TODO. Reopening is a plain status change and does not alter any recorded acceptance verdict; verdict adjudication is human-only and has no CLI path. To attach context without reopening, `lumo task comment` works.

### `--status done` requires `--confirm` — the confirmation envelope (LUM-755)

DONE is the one status move that needs a human's sign-off. It no longer prompts (LUM-731's interactive yes/no question is gone): run without `--confirm`, the CLI looks the task up, prints a **confirmation envelope** on stdout and exits **4** with nothing sent — no PATCH, and no tag resolution either. The envelope's `changes` carry everything the old prompt showed, including a trailing `⚠` line when a linked PR has not merged (that line replaces the old second prompt — the protocol is one step, and you relay the whole block). Full protocol: [confirmation.md](confirmation.md).

```bash
lumo task update LUM-48 --status done
# exit 4, stdout (JSON when piped; the same lines as text on a TTY):
# {
#   "status": "confirmation_required",
#   "command": "task update",
#   "changes": [
#     "Will move LUM-48 \"Title\" to DONE",
#     "Status: IN_REVIEW → DONE",
#     "#926  merged   refactor: panel  https://github.com/o/r/pull/926",
#     "#930  open     feat: wip        https://github.com/o/r/pull/930",
#     "⚠ 1 linked pull request not merged: #930 open"
#   ],
#   "confirmCommand": "lumo task update LUM-48 --status done --confirm"
# }
```

With no linked PR the PR lines collapse to `Pull requests: none linked` and there is no `⚠` line. Other flags on the same call (`--title`, `--add-tag`…) are preserved in `confirmCommand`.

When the task has local git worktrees, the envelope ends with one line per worktree — `Will remove worktree <path> (branch … kept)` or `Keeps worktree <path>: <reason>` (uncommitted changes / unpushed commits that aren't a merged PR's head / the current directory is inside it). After `--confirm` and a successful DONE the removable ones are removed; a refused DONE removes nothing. Never forced, branches kept (LUM-825, see [worktree.md](worktree.md)).

- **Show `changes` to the user and wait for an explicit yes**, then run `confirmCommand` unchanged. `--confirm` means the user confirmed — never add it on your own.
- With `--confirm` the PATCH goes out directly. The server's own DONE gates still apply on top — an unresolved send-back, an undispositioned boundary crossing or a blocking security finding refuses with **409**, which the CLI turns into a structured **`DONE_BLOCKED` error on stdout with exit 5**: the 409 text verbatim, a `blockers[]` with ids (built from `task status` + the crossings read model), and `remediation` lines that only name human-side or user-approved paths. Nothing on `task update` clears any of them — relay, don't retry. A boundary crossing is the one blocker with a terminal path, `lumo crossing disposition <id> …` (itself exit-4: the user rules, never you); once every blocker is cleared, re-run this `--confirm` call. See [confirmation.md](confirmation.md) "When the gate is human-only". Any other 409 stays plain text, exit 1.
- `--confirm` is the only flag: there is no `--yes` or `--force` on `task update`. Every other status (`todo` / `in_progress` / `in_review`) PATCHes directly and ignores `--confirm`.
- A failed lookup (404, network) exits 1 before any envelope.

```bash
lumo task update LUM-48 --status done --confirm   # only after the user approved the envelope
```

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

### `lumo task search [query] [flags]` — search tasks across the workspace (LUM-821)

`task list` only shows **your** tasks; `task search` spans every member — the CLI counterpart of a Jira JQL search or Linear `list_issues`. Every filter runs server-side (`GET /api/tasks/workspace`), results capped at 500 (a `(result capped …)` line says so).

`[query]` is split on whitespace and **every term must match** (AND): as a case-insensitive substring of the title or description, or as the task number (`42`, `LUM-42`). Typo tolerance is a **tiered fallback** — it only runs when what you typed matches nothing, so a correctly spelled word is never widened (`content` never pulls in "context", `form` never "from"/"for"): (1) exact substring / number; if that finds nothing, (2) typo matching of title words via Postgres `pg_trgm` for non-numeric terms of 4+ letters (`serch`, `filtr`, `dashbord`, `migraton` find their task); if that finds nothing too, (3) one swapped pair of adjacent letters (`oauht` → "OAuth"). A typo'd title word must be ≥ 4 letters and at most one letter shorter than the term. Results are ranked by a relevance score summed over the terms: task number 2.0, title substring 1.0, trigram typo 0.9 × similarity, letter swap 0.85, description substring 0.5. `--exact` switches the fallback tiers off.

| Flag                              | Type                | Notes                                                                                            |
| --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `-a, --assignee <ref>`            | string (repeatable) | `me`, an email, a member name, an agent name, or `none` (unassigned). Repeats are ORed.          |
| `--tag <name>`                    | string (repeatable) | Tag name, matched case-insensitively (any of). Unknown name = error — search never creates tags. |
| `-s, --status <value>`            | enum (repeatable)   | `todo \| in_progress \| in_review \| done`; repeat or comma-separate.                            |
| `-p, --priority <level>`          | enum (repeatable)   | `low \| medium \| high \| urgent`; repeat or comma-separate.                                     |
| `--project <ref>`                 | string              | Project name or slug.                                                                            |
| `-m, --milestone <ref>`           | string              | Milestone name or UUID.                                                                          |
| `--sprint <ref>` / `--team <ref>` | string              | Sprint number or UUID (`--team` disambiguates the number).                                       |
| `--due-after` / `--due-before`    | `YYYY-MM-DD`        | Inclusive calendar days in your local timezone (same as the web due-date picker).                |
| `-n, --limit <count>`             | integer             | Show only the first N rows.                                                                      |
| `--exact`                         | boolean             | Substring matching only, in board order (default: typo-tolerant, ranked).                        |
| `--json`                          | boolean             | Raw `{ tasks, truncated }`.                                                                      |

```bash
lumo task search "oauth redirect"
lumo task search "serch filtr" --exact
lumo task search --assignee none --status todo --priority high --priority urgent
lumo task search --assignee alice@example.com --tag bug --sprint 3
lumo task search --due-before 2026-09-30 --status todo --status in_progress
```

Output: `LUM-42  TODO  HIGH  lumo  Alice  2026-09-30  Fix OAuth` (id · status · priority · project · assignee · due · title; `-` = none).

### When to suggest `task search`

- "Find the task about X", "what's unassigned", "what's Alice working on", "what's overdue / due this week", "high-priority bugs in sprint 3".
- Before creating a task — search first to avoid a duplicate.

### `lumo task statuses [--json]` — the workflow as the server defines it

Prints the status set with each status's allowed transitions, the priorities, and which status is gated (`DONE`: needs the user's `--confirm` and a clear DONE gate). Served by `GET /api/tasks/statuses`, so it tracks the real state machine.

```bash
lumo task statuses
```

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

Returns a key:value block for a single task — title, status, priority, project, assignee (with display name from Clerk), due date and parent when set, URL, a `Subtasks (N):` list when it has children, and the full description below. Lighter than `task context` because it does not load prior session summaries or memory.

```bash
lumo task show LUM-42
```

Use when the user wants the current state of a task without the agent-handoff payload.

### `lumo task history <identifier> [-n <count>] [--json]` — field-change log (LUM-821)

The task's changelog, oldest first: `YYYY-MM-DD HH:MM  actor  change` for status, priority, title, description, assignee, due date, parent, tags and sprint changes (milestone / project moves are not recorded). Default last 30; `-n` raises it. Comments are not included — use `task comments list`.

```bash
lumo task history LUM-42
```

### `lumo task delete <identifier>` — move a task to the trash (LUM-821, LUM-918)

Moves the task **and its subtasks** to the trash. They are restorable for **30 days** from the web app's **Settings → Trash**, then the daily purge deletes them permanently. While trashed they are hidden from lists, search, `lumo next` and task context; comments, criteria, test cases and history are kept and come back on restore. Without `--confirm` it exits 4 with an envelope saying exactly this — relay it and wait for the user; never add `--confirm` yourself. To erase a task at once (e.g. a GDPR erasure request), the user deletes it permanently from Settings → Trash — there is no CLI flag for that. Prefer `task update --status done` or re-scoping for work that merely stopped mattering.

```bash
lumo task delete LUM-42
```

### `lumo task comment <identifier> <body>` — leave a comment

Two-step under the hood (resolve LUM-N → POST comment). Body is plain text; quote it to embed spaces or newlines.

```bash
lumo task comment LUM-42 "Reproduced the redirect bug on staging — Safari only, not Chrome."
```

The CLI does not support @-mention chip syntax. If the user wants to ping someone, they should comment from the web UI.

**Replying (LUM-821).** `lumo task comments list` prints every comment with a short id (`#cmaaaaaa · <author> · <time>`). `--reply-to <comment>` takes that id — any unique prefix of 6+ characters. Threads are one level deep: replying to a reply is refused, naming the top-level comment to reply to instead.

```bash
lumo task comment LUM-42 "Fixed in the latest push" --reply-to cmaaaaaa
```

### `lumo task comments edit <identifier> <comment> <body>` / `lumo task comments rm <identifier> <comment>`

Edit or delete **your own** comment (anyone else's → 403). `<comment>` is the short id from `task comments list`. `rm` is a soft delete that also hides the replies under a top-level comment; without `--confirm` it exits 4 with an envelope quoting the comment and deletes nothing — relay it and let the user approve.

```bash
lumo task comments edit LUM-42 cmaaaaaa "Reproduced on Safari 18 only"
lumo task comments rm LUM-42 cmaaaaaa
```

---

**Task dependencies** (`lumo task deps add/list/confirm/dismiss/rm`) now live in [task-deps.md](task-deps.md).
