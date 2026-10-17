# Task Management

Core task CRUD — create, update, list, recommend-next, show, comment. For dependency edges between tasks, see [task-deps.md](task-deps.md).

### `lumo task create <title> [flags]` — create a new task

Use this when the user wants to file a new task from the terminal. Title is positional and required (non-empty).

| Flag                     | Type   | Notes                                                                                                                                                                   |
| ------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-d, --description <>`   | string | Optional task description.                                                                                                                                              |
| `--template <key>`       | string | Pre-fill the description from a task template. Not with `--description`.                                                                                                |
| `-p, --priority <level>` | enum   | `low \| medium \| high \| urgent` (case-insensitive). Defaults to `low`.                                                                                                |
| `-a, --assignee <ref>`   | string | `me`, an email, or a member name. Defaults to `me`.                                                                                                                     |
| `--project <ref>`        | string | Project name or slug. **Required when the workspace has more than one project.**                                                                                        |
| `--milestone <ref>`      | string | Milestone slug (as in the web URL) or name (case-insensitive) within the resolved project; an ambiguous name is rejected with the candidate slugs. Omit for no binding. |
| `--sprint <ref>`         | string | Sprint number or UUID to bind the task to on creation. Omit for no sprint binding.                                                                                      |
| `--due <date>`           | string | Due date `YYYY-MM-DD`, your local day (same convention as the web due-date picker).                                                                                     |
| `--tag <name>`           | string | Attach a tag by name (repeatable). The name is resolved to an id server-side.                                                                                           |
| `--tag-id <cuid>`        | string | Attach a tag by cuid (repeatable). Combines with `--tag`.                                                                                                               |

Examples:

```bash
lumo task create "Fix Slack OAuth redirect bug"
lumo task create "Refactor task service" --priority high --description "Split into smaller files"
lumo task create "Investigate slow query" --assignee teammate@example.com --project backend
lumo task create "Plan API design" --milestone "v1.0"
lumo task create "Sprint task" --sprint 3
lumo task create "Add rate limiting" --tag bug --tag urgent
lumo task create "Spike: evaluate caching options" --tag rfc --tag-id clm_abc123
lumo task create "Add CSV export" --template agent-brief
```

On success the command prints one or two lines to stdout:

```
Created LUM-55 "Title"  https://www.uselumo.ai/workspace/<slug>/my-tasks/LUM-55
Tags: bug, urgent

Next:
  lumo session attach LUM-55
      Bind this session to the task so its work is recorded against it
```

The `Tags:` line is omitted when no tags were attached. The trailing `Next:` block is server-computed and conditional — the attach line is skipped when this session is already bound (a second attach is a 409), and the whole block is suppressed by `--no-hints` / `LUMO_NO_HINTS=1`. The `Created …` line stays first and unchanged. See [Next-step hints](#next-step-hints) below.

If the workspace has multiple projects and `--project` is omitted, the server will return an error naming available projects — re-run with `--project <slug>`.

### Next-step hints

`task create`, `task update`, `session attach`, `task show --full` and `next` end with a short `Next:` block naming what to do now — attach an unbound session, explain an open boundary crossing, or stop and wait when the task is IN_REVIEW.

The rules are computed **server-side** from task status × session binding × open crossings, so the advice tracks the real state machine rather than a hard-coded string. Capped at **3 suggestions**; a rule whose condition is already satisfied never appears. The block goes to **stdout**, after the command's own result line — the result line stays first and unchanged, so reading line 1 still works.

Silence it with `--no-hints` on any command, or `LUMO_NO_HINTS=1` for a whole shell.

### When to suggest `task create`

- The user describes wanting a new task ("create a task to ...", "file a bug for ...", "log a TODO that ...", "add a task: ...").
- After a discussion that ends in "let's track that separately" — offer to create the task with a sensible title and priority.
- For follow-ups discovered mid-work that shouldn't bloat the current change — propose `task create` rather than silently expanding scope.
- When the task will be handed to an agent, suggest `--template agent-brief` so the description starts as a brief (Context / Goal / Non-goals / Watch out / Done when / Decisions) the user fills in before work starts.

### `lumo task template list [--json]` — task templates (LUM-970)

Lists the keys `--template` accepts as a table `KEY  NAME  KIND  DESCRIPTION` (KIND is `built-in`, e.g. `agent-brief`, or `workspace`; TAB-separated when piped). `--json` prints `{ version, templates: [{ key, name, description, isSystem, content }], total, nextCursor }` — it includes each template's Markdown `content` (before LUM-1232 batch C it was a bare array; read `.templates` now). Built-in template bodies are English in every language; only their name and description are localized.

```bash
lumo task template list
```

An unknown key on `task create --template` is a 404 that names this command.

### `lumo task template show / create / edit / rm` — manage templates (LUM-974)

Task templates are managed only from the CLI (there is no web UI). Every command takes the template **key**. `show` works for any template; `create` / `edit` / `rm` are for the workspace's own templates and need the workspace **OWNER** role (others get a 403). Built-in keys (`agent-brief`) can't be created, edited or removed — save a copy and create your own instead.

| Command        | Flags                                                  | Notes                                                                                                                                                                       |
| -------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `show <key>`   | `--json`                                               | Prints only the Markdown body, so `> file.md` saves it. `--json`: key, name, description, isSystem, content.                                                                |
| `create <key>` | `--name <name>` `--file <path.md>` (both required)     | `<key>`: lowercase slug ≤40 chars; name ≤80. Refuses an existing key (use `edit`).                                                                                          |
| `edit <key>`   | `--name` / `--file` / `--key <new-key>` (at least one) | Only the flags given change.                                                                                                                                                |
| `rm <key>`     | `--confirm`                                            | Irreversible. Without `--confirm`: exit 4 + an envelope naming key and name (see [confirmation.md](confirmation.md)). Tasks already created from it keep their description. |

`--file` reads a UTF-8 Markdown file inside the project directory (`-` reads stdin, e.g. `--file - < ~/notes/brief.md`). It is checked locally before anything is sent: a missing, empty (whitespace-only), non-UTF-8 or over-20,000-character file exits 1 with a clear error — nothing is truncated or uploaded.

```bash
lumo task template show agent-brief > brief.md     # start from the built-in
lumo task template create team-brief --name "Team brief" --file brief.md
# Created task template team-brief "Team brief" (845 chars)
# Next: lumo task create <title> --template team-brief
lumo task template edit team-brief --file brief.md --name "Team agent brief"
lumo task template rm team-brief                    # exit 4 envelope; re-run with --confirm after the user approves
```

When to suggest: the user wants a reusable description skeleton for their team ("make a bug-report template", "change our brief template") — `show` an existing one to a file, edit it, then `create` / `edit` with `--file`.

### `lumo task decide <identifier> "<text>"` — record a decision in the brief (LUM-970)

Appends one list item to the description's `## Decisions` section, creating the section at the end when it is missing; the rest of the description is left as is. The text is prefixed with today's local date unless it already starts with `YYYY-MM-DD`; inline Markdown (`code`, **bold**) works. The edit shows in `task history` like any description change.

```bash
lumo task decide LUM-42 "Keep the v1 API; v2 is a separate task (user)"
# Recorded decision on LUM-42 "Title"  https://…/my-tasks/LUM-42
```

When to suggest: the user rules on scope or approach mid-task ("do X, not Y", "leave that out") — record it with `task decide` rather than a comment, so the brief stays the single place the agreed scope lives.

### `lumo task update <identifier> [flags]` — patch a task

Pure flag-driven update. Provide at least one of:

| Flag                     | Type                | Notes                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-t, --title <text>`     | string              | Cannot be empty.                                                                                                                                                                                                                                                      |
| `-d, --description <>`   | string              | `--description ""` clears the field.                                                                                                                                                                                                                                  |
| `-s, --status <value>`   | enum                | `backlog \| todo \| in_progress \| in_review \| done` (case-insensitive).                                                                                                                                                                                             |
| `-p, --priority <lvl>`   | enum                | `low \| medium \| high \| urgent`.                                                                                                                                                                                                                                    |
| `-a, --assignee <ref>`   | string              | `me`, an email, or a member name. `--assignee ""` clears the field.                                                                                                                                                                                                   |
| `--milestone <ref>`      | string              | Milestone slug (as in the web URL) or name (case-insensitive) within the task's project; an ambiguous name is rejected with the candidate slugs. `--milestone ""` unbinds.                                                                                            |
| `--sprint <ref>`         | string              | Sprint number or UUID to bind the task to. `--sprint ""` clears the current sprint binding (idempotent when already unbound).                                                                                                                                         |
| `--due <date>`           | string              | Due date `YYYY-MM-DD` (your local day). `--due ""` clears it.                                                                                                                                                                                                         |
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
```

The `Tags:` line is omitted when the resulting tag set is empty. The trailing `Next:` block reflects the **post-update** status — `--status in_review` prints a stop-and-wait note instead of a command, and a DONE task prints nothing. Suppressed by `--no-hints` / `LUMO_NO_HINTS=1`.

### Status transitions — direct moves are legal

The server's transition matrix (`lib/task/state-machine.ts`):

| From        | Allowed targets                                |
| ----------- | ---------------------------------------------- |
| BACKLOG     | TODO, IN_PROGRESS, IN_REVIEW, DONE             |
| TODO        | BACKLOG, IN_PROGRESS, IN_REVIEW, DONE          |
| IN_PROGRESS | BACKLOG, TODO, IN_REVIEW, DONE                 |
| IN_REVIEW   | BACKLOG, TODO, IN_PROGRESS, DONE               |
| DONE        | BACKLOG, TODO, IN_PROGRESS, IN_REVIEW (reopen) |

BACKLOG (LUM-1057) = not yet scheduled. New tasks still default to TODO. BACKLOG tasks are left out of sprint progress / burnup and milestone progress totals; `milestone show` prints them on a `Backlog:  N (not in the total)` row of its Progress section.

Practical rules:

- **One call suffices.** `--status done` straight from TODO or IN_PROGRESS is legal — never walk `in_progress → in_review → done` as a ritual; it just wastes calls. That one call either runs directly (every linked PR merged, nothing blocks — LUM-1106) or **walks the confirmation protocol** (see below): exit 4 with an envelope, never a prompt.
- **DONE is the user's call unless the one-step condition holds** — short of it, `--status done` exits 4 for their approval first (below).
- **A DONE task can be reopened** — to IN_REVIEW, IN_PROGRESS, or TODO. Reopening is a plain status change. To attach context without reopening, `lumo task comment` works.

### `--status done` — one step, or the confirmation envelope (LUM-755 / LUM-1106)

**One step when nothing is left (LUM-1106).** Before any envelope the CLI checks the _one-step condition_: `--status` is the only flag (LUM-1116 — `--status done --title …`, a tag or `--sprint` flag, etc. always take the envelope, which then adds an `Also updates: --title, … (one-step DONE covers a status-only change)` line so the user signs off on those changes too), at least one linked PR, **every** linked PR `merged`, and the status digest read cleanly with `Blocks DONE: nothing on record` (no blocking crossing, no blocking security finding, no proven test-case defect, no `⚠ could not confirm`). When it holds, `--status done` sends the PATCH straight away — no envelope, no `--confirm`, exit 0 — and prints:

```text
Updated LUM-48 "Title"  https://…/LUM-48
One-step DONE (no --confirm needed): the linked PR is merged and nothing blocks DONE.
  Status: IN_REVIEW → DONE
  #926  MERGED   refactor: panel  https://github.com/o/r/pull/926
<the actual worktree removal report, then the status digest>
```

The first line keeps its `Updated <id> …` format. It fails closed: any flag besides `--status`, no linked PR (a docs-only task), any PR open/closed/draft/unknown, an older server that sends no `pullRequests`, a task that is already DONE, or any failed digest read → the exit-4 envelope below, exactly as before. The server's 409 gates still apply to the PATCH either way.

Otherwise DONE needs a human's sign-off. It no longer prompts (LUM-731's interactive yes/no question is gone): run without `--confirm`, the CLI looks the task up, prints a **confirmation envelope** on stdout and exits **4** with nothing sent — no PATCH, and no tag resolution either. The envelope's `changes` carry everything the old prompt showed, including a trailing `⚠` line when a linked PR has not merged (that line replaces the old second prompt — the protocol is one step, and you relay the whole block). Full protocol: [confirmation.md](confirmation.md).

```bash
lumo task update LUM-48 --status done
# exit 4, stdout (JSON when piped; the same lines as text on a TTY):
# {
#   "status": "confirmation_required",
#   "command": "task update",
#   "changes": [
#     "Will move LUM-48 \"Title\" to DONE",
#     "Status: IN_REVIEW → DONE",
#     "#926  MERGED   refactor: panel  https://github.com/o/r/pull/926",
#     "#930  open     feat: wip        https://github.com/o/r/pull/930",
#     "⚠ 1 linked pull request not merged: #930 OPEN"
#   ],
#   "confirmCommand": "lumo task update LUM-48 --status done --confirm"
# }
```

With no linked PR the PR lines collapse to `Pull requests: none linked` and there is no `⚠` line. Other flags on the same call (`--title`, `--add-tag`…) are preserved in `confirmCommand`.

When the task has local git worktrees, the envelope ends with one line per worktree — `Will remove worktree <path> (branch … kept)` or `Keeps worktree <path>: <reason>` (uncommitted changes / unpushed commits that aren't a merged PR's head / the current directory is inside it). After `--confirm` and a successful DONE the removable ones are removed; a refused DONE removes nothing. Never forced, branches kept (LUM-825, see [worktree.md](worktree.md)).

- **Show `changes` to the user and wait for an explicit yes**, then run `confirmCommand` unchanged. `--confirm` means the user confirmed — never add it on your own.
- With `--confirm` the PATCH goes out directly. The server's own DONE gates still apply on top — an undispositioned boundary crossing, a blocking security finding or a proven test-case defect refuses with **409**, which the CLI turns into a structured **`DONE_BLOCKED` error on stdout with exit 5**: the 409 text verbatim, a `blockers[]` with ids (built from `task status` + the crossings read model), and `remediation` lines that only name human-side or user-approved paths. Nothing on `task update` clears any of them — relay, don't retry. Each blocker's terminal path is the user's ruling — `lumo crossing disposition`, `lumo finding disposition`, or for a `TEST_CASE_DEFECT` `lumo task testcase disposition <task>/TC<n> --known-defect | --not-a-defect` (all exit-4: the user rules, never you); once every blocker is cleared, re-run this `--confirm` call. See [confirmation.md](confirmation.md) "When the gate is human-only". Any other 409 stays plain text, exit 1.
- `--confirm` is the only flag: there is no `--yes` or `--force` on `task update`. Every other status (`backlog` / `todo` / `in_progress` / `in_review`) PATCHes directly and ignores `--confirm`.
- A failed lookup (404, network) exits 1 before any envelope.

```bash
lumo task update LUM-48 --status done --confirm   # only after the user approved the envelope
```

### When to suggest `task update`

- The user describes a state change in natural language (e.g. "mark LUM-48 as in progress", "rename LUM-12 to ...", "assign LUM-30 to me", "bump the priority on LUM-7").
- After the agent finishes a task: every linked PR merged and nothing blocks → run `lumo task update LUM-N --status done` (one step); otherwise relay its exit-4 envelope and wait for the user's yes.
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

There are no subtasks — the parent/child hierarchy and `--parent` were removed in LUM-959 (an older CLI that still sends `--parent` gets a 400). Group related tasks with a milestone, express "A before B" with `lumo task deps add`, and fold small follow-ups into the original task rather than spinning off a child.

Milestone updates (`--milestone`) and sprint binding (`--sprint`) both work. Full milestone CRUD is available via `lumo milestone create / show / update / delete`, tasks can be bound/unbound in bulk via `lumo milestone add / remove <identifier> <task...>`, and milestones can be manually reordered via `lumo milestone reorder <ref...>` / `lumo milestone move <ref> --before|--after <ref>` (see below). Full sprint CRUD is available via `lumo sprint create / show / update / delete / start / close / add / remove` (see below).

### `lumo task list [flags]` — list tasks assigned to you

Default behavior: prints every task currently assigned to the authenticated user (no project / status filter), one per line. Piped / agent output (non-TTY) is one row per line with the fields separated by a single **TAB** (LUM-1232; `⇥` marks a TAB below), no header, nothing truncated, and column 1 is always the id:

```
LUM-42⇥IN_PROGRESS⇥HIGH⇥web⇥Fix Slack OAuth redirect
LUM-48⇥TODO⇥MEDIUM⇥backend⇥Investigate slow query
```

On a terminal (stdout is a TTY) the columns align by display width (CJK counts 2), an upper-case header row comes first and only the title is cut with `…` to fit the terminal width. `task search` and `next` use the same table (`next`: `ID  STATUS  PRIORITY  WHY  TITLE`, row order is the rank).

| Flag                    | Type    | Notes                                                                                       |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `-s, --status <value>`  | enum    | Filter by status: `backlog \| todo \| in_progress \| in_review \| done` (case-insensitive). |
| `-p, --project <ref>`   | string  | Filter by project name (case-insensitive match against display name).                       |
| `-m, --milestone <ref>` | string  | Filter to my tasks under this milestone (slug, name or id).                                 |
| `-n, --limit <count>`   | integer | Tasks per page (1-500, default **50**).                                                     |
| `--cursor <cursor>`     | string  | Next page — copy it from the footer (or `nextCursor` in `--json`).                          |
| `--json`                | boolean | `{ version, tasks, total, nextCursor, deprecatedFields }` — see **`--json` fields** below.  |
| `--fields <list>`       | string  | With `--json`: only these comma-separated fields per task (from the list below).            |

```bash
lumo task list                                  # everything assigned to me
lumo task list --status in_progress -n 10       # 10 per page, status-filtered
lumo task list --cursor 50                      # page 2 (from the footer)
lumo task list --project backend --status todo
lumo task list --milestone "Q3 Launch"
```

#### `task list --json` fields

The fields callers may rely on (the whitelist; `--fields` accepts exactly these): `ref` (`LUM-42`), `id`, `title`, `status`, `priority`, `project` (`{ id, name, … }`), `assignee`, `milestone`, `sprint`, `tags`, `dueDate`, `blockedByOpenCount`, `unblocksOpenCount`, `createdAt`, `updatedAt`. Bare `--json` still prints every other field the server returns, unchanged.

**Deprecated** (still emitted; listed in the envelope's `deprecatedFields`; removed only in a release that bumps `version`): `workspaceId`, `order`, `viewOrder`, `deletedAt`, `deletedByClerkId`, `trashRootId`, `claimSnapshot`, `claimSnapshotAt`, `claimSnapshotSessionId`, `claimSnapshotSource`. Don't build on them.

```bash
lumo task list --json --fields ref,title,status,dueDate
```

`--fields` without `--json`, or an unknown field name, is a usage error (exit 2) that lists the valid names.

Every filter and the page run server-side (`GET /api/tasks/me?statuses=…&milestoneIds=…&projectName=…&limit=…&cursor=…`). Against a server that predates paging the CLI filters and pages the full list itself.

#### Paging (LUM-1093) — shared by `task list`, `task search`, `task show --history`, `task show --comments`, `milestone list`, `doc list`

Lists print **50 rows per page** by default (`--limit` 1-500 changes it). When a page is not the whole result, the output ends with a fixed footer — the first line is `Showing <first>-<last> of <total>.`, the second the command for the next page:

```
Showing 1-50 of 132.
Next page: lumo task list --status todo --cursor 50
```

The second line is data, not a hint: it always prints, `--no-hints` does not hide it (LUM-1232).

The last page prints only the `Showing …` line; a result that fits on one page prints no footer. **If you see the footer, you have not seen everything** — run the printed command before concluding a task/doc/milestone is absent. `--json` adds `total` and `nextCursor` (`null` on the last page). The cursor is opaque: copy it, don't compute it.

### When to suggest `task list`

- The user asks "what am I working on", "what tasks do I have", "list my tasks", "show me my queue".
- Before suggesting a status change ("mark something as done"), if no task ID is in context — run `task list` first to surface candidates.

### `lumo task search [query] [flags]` — search tasks across the workspace (LUM-821)

`task list` only shows **your** tasks; `task search` spans every member — the CLI counterpart of a Jira JQL search or Linear `list_issues`. Every filter runs server-side (`GET /api/tasks/workspace`), paged 50 at a time (`--limit` / `--cursor`, footer as in **Paging** above; a fuzzy query ranks at most 500 matches — when it hits that cap the output still ends with `(result capped at 500 — narrow the filters)` and `--json` has `truncated: true`). `--json` prints `{ version, tasks, truncated, total, nextCursor, deprecatedFields }`; each task gains `ref` (`LUM-42`) first and keeps every server field; the internal fields named in `deprecatedFields` are the same as `task list`'s and are deprecated (still emitted, removed only with a `version` bump).

`[query]` is split on whitespace and **every term must match** (AND): as a case-insensitive substring of the title or description, or as the task number (`42`, `LUM-42`). Typo tolerance is a **tiered fallback** — it only runs when what you typed matches nothing, so a correctly spelled word is never widened (`content` never pulls in "context", `form` never "from"/"for"): (1) exact substring / number; if that finds nothing, (2) typo matching of title words via Postgres `pg_trgm` for non-numeric terms of 4+ letters (`serch`, `filtr`, `dashbord`, `migraton` find their task); if that finds nothing too, (3) one swapped pair of adjacent letters (`oauht` → "OAuth"). A typo'd title word must be ≥ 4 letters and at most one letter shorter than the term. Results are ranked by a relevance score summed over the terms: task number 2.0, title substring 1.0, trigram typo 0.9 × similarity, letter swap 0.85, description substring 0.5. `--exact` switches the fallback tiers off.

| Flag                              | Type                | Notes                                                                                            |
| --------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `-a, --assignee <ref>`            | string (repeatable) | `me`, an email, a member name, an agent name, or `none` (unassigned). Repeats are ORed.          |
| `--tag <name>`                    | string (repeatable) | Tag name, matched case-insensitively (any of). Unknown name = error — search never creates tags. |
| `-s, --status <value>`            | enum (repeatable)   | `backlog \| todo \| in_progress \| in_review \| done`; repeat or comma-separate.                 |
| `-p, --priority <level>`          | enum (repeatable)   | `low \| medium \| high \| urgent`; repeat or comma-separate.                                     |
| `--project <ref>`                 | string              | Project name or slug.                                                                            |
| `-m, --milestone <ref>`           | string              | Milestone slug, name or id.                                                                      |
| `--sprint <ref>` / `--team <ref>` | string              | Sprint number or UUID (`--team` disambiguates the number).                                       |
| `--due-after` / `--due-before`    | `YYYY-MM-DD`        | Inclusive calendar days in your local timezone (same as the web due-date picker).                |
| `-n, --limit <count>`             | integer             | Tasks per page (1-500, default 50).                                                              |
| `--cursor <cursor>`               | string              | Next page — from the footer or `nextCursor`.                                                     |
| `--exact`                         | boolean             | Substring matching only, in board order (default: typo-tolerant, ranked).                        |
| `--json`                          | boolean             | `{ tasks, truncated, total, nextCursor }`.                                                       |

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

Prints the status set with each status's allowed transitions, the priorities, and which status is gated (`DONE`: needs the user's `--confirm` — unless every linked PR is merged and nothing blocks, LUM-1106 — and a clear DONE gate). Served by `GET /api/tasks/statuses`, so it tracks the real state machine.

```bash
lumo task statuses
```

### `lumo next [--count <N>] [--claimable]` — recommend the next task to work on

`--json` prints `{ version, tasks, total, nextCursor, poolSize, claimable }` — the ranked tasks in order, each with `ref` (first) and `reasons` (`excluded` too with `--claimable`); no `Next:` block.

Ranks the tasks assigned to you and prints the top N (default 3), each with a
one-line reason. Read-only — it does **not** bind or load context. Pick one from
the list, then run `lumo session attach <LUM-N>` + `lumo task show <LUM-N> --full`.

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

LUM-42⇥IN_PROGRESS⇥URGENT⇥active sprint · due 2026-06-03 (overdue) · in progress⇥Fix Slack OAuth redirect
LUM-48⇥TODO⇥HIGH⇥active sprint · unblocks 2 tasks⇥Investigate slow query
LUM-12⇥TODO⇥MEDIUM⇥blocked by 1 open dep · due 2026-06-10⇥Add rate limiting

Next:
  lumo session attach LUM-42 && lumo task show LUM-42 --full
      start on the top-ranked task
Hint: any other task in the list works the same way.
```

`--no-hints` / `LUMO_NO_HINTS=1` drops the `Next:` block and the `Hint:` line, leaving the ranked list (LUM-1232).

When to suggest: the user asks "what should I work on", "what's next", "recommend my next task" (in any language), "pick my next task", or starts a session without a task in mind. After they choose, run `session attach` + `task show --full` for the picked task.

### `lumo task show [task]` — print one task's detail

`[task]` defaults to the session-bound task. Aspect flags (`--full`, `--memory`, `--comments`, `--history`, `--scans`, `--runs`, `--outcome`, `--lineage`, `--deps`) add sections — see [task-context.md](task-context.md#reading-a-task--lumo-task-show). `--json` prints `{ version, task }` (plus one key per aspect) — `task.ref` (`LUM-42`) first, then the server fields (the description guarded like the block body, without the block).

Returns a `<id>  <title>` line (bold on a TTY), then `Label:  value` rows padded to the widest label (LUM-1090) — status, priority, project, assignee (with display name from Clerk), due date when set, URL (never wrapped: a URL too long for its row moves, whole, under `URL:`) — and the full description below, verbatim, in an `<untrusted-task-description>` block (fence tags defanged, directive-shaped content flagged at the block head — LUM-998). Without `--full` it does not load prior session summaries or memory.

```bash
lumo task show LUM-42
```

Use when the user wants the current state of a task without the agent-handoff payload.

### `lumo task show <identifier> --history [-n <count>] [--cursor <c>] [--json]` — field-change log (LUM-821)

The task's changelog, oldest first, as a table: `<time>  actor  change` — `<time>` is `2026-10-16T22:24:00Z` (UTC) when piped, `2026-10-17 09:24 +11:00` (local + offset) on a terminal (LUM-1232); an actor the directory can't name prints `-` (header `WHEN  ACTOR  CHANGE` and change cut to the terminal width on a TTY only; piped output headerless and whole — LUM-1090) for status, priority, title, description, assignee, due date, tags and sprint changes (tasks created before LUM-959 may also show old `parent set` / `parent cleared` rows) (milestone / project moves are not recorded). Paged from the newest end: the first page is the latest 50 entries (`-n` changes the page size); when older entries exist the footer reads `Showing 71-120 of 120.` + `Next page: lumo task show LUM-42 --history --cursor 50`. `--json` prints `{ version, entries: [...], total, nextCursor }` — `entries` is this page's entries, each as before (`id, kind, type, actorId, actor, payload, createdAt, taskId`); `nextCursor` is the `--cursor` value for the next (older) page. Before LUM-1232 batch C it printed the bare array — read `.entries` now. Comments are not included — use `task show --comments`.

```bash
lumo task show LUM-42 --history
```

### `lumo task delete <identifier>` — move a task to the trash (LUM-821, LUM-918)

Moves the task to the trash. It is restorable for **30 days** from the web app's **Settings → Trash**, then the daily purge deletes it permanently. While trashed it is hidden from lists, search, `lumo next` and task context; comments, test cases and history are kept and come back on restore. Without `--confirm` it exits 4 with an envelope saying exactly this — relay it and wait for the user; never add `--confirm` yourself. To erase a task at once (e.g. a GDPR erasure request), the user deletes it permanently from Settings → Trash — there is no CLI flag for that. Prefer `task update --status done` or re-scoping for work that merely stopped mattering.

```bash
lumo task delete LUM-42
```

### `lumo task comment <identifier> <body>` — leave a comment

Two-step under the hood (resolve LUM-N → POST comment). Body is plain text; quote it to embed spaces or newlines.

```bash
lumo task comment LUM-42 "Reproduced the redirect bug on staging — Safari only, not Chrome."
```

The CLI does not support @-mention chip syntax. If the user wants to ping someone, they should comment from the web UI.

**Listing.** `lumo task show <id> --comments` pages top-level threads 50 at a time (replies stay with their parent; `--limit` / `--cursor`, footer as in **Paging** above, printed after the fenced thread). `--full` alone prints every comment with no paging and no output-budget cap.

**Replying (LUM-821).** `lumo task show --comments` prints every comment with a short id (`#cmaaaaaa · <author> · <time>`). `--reply-to <comment>` takes that id — any unique prefix of 6+ characters. Threads are one level deep: replying to a reply is refused, naming the top-level comment to reply to instead.

```bash
lumo task comment LUM-42 "Fixed in the latest push" --reply-to cmaaaaaa
```

### `lumo task comments edit <identifier> <comment> <body>` / `lumo task comments rm <identifier> <comment>`

Edit or delete **your own** comment (anyone else's → 403). `<comment>` is the short id from `task show --comments`. `rm` is a soft delete that also hides the replies under a top-level comment; without `--confirm` it exits 4 with an envelope quoting the comment and deletes nothing — relay it and let the user approve.

```bash
lumo task comments edit LUM-42 cmaaaaaa "Reproduced on Safari 18 only"
lumo task comments rm LUM-42 cmaaaaaa
```

---

**Task dependencies** (`lumo task deps add/list/confirm/dismiss/rm`) now live in [task-deps.md](task-deps.md).
