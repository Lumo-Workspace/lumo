# Listing & finding tasks

`task list` (search, filters, paging, `--json`), `task statuses`, `status --next`, and the plain `task show` / `--history` views. Creating and updating: [tasks.md](tasks.md).

## `lumo task list [flags]` — list and search tasks

**Without `--assignee` it lists only your tasks**; `--assignee any` spans every member of the workspace. **A repeated flag ORs its values; different flags AND** (`--status todo --status in_progress --priority high` = (TODO or IN_PROGRESS) and HIGH). Filters and paging run server-side.

Piped / agent output is one row per line, fields TAB-separated (`⇥` below), no header, nothing truncated, column 1 the id:

```
LUM-42⇥IN_PROGRESS⇥HIGH⇥web⇥Fix Slack OAuth redirect
LUM-48⇥TODO⇥MEDIUM⇥backend⇥Investigate slow query
```

With `--assignee` (any value) the rows add assignee and due day: id · status · priority · project · assignee · due · title (`-` = none). On a TTY: aligned columns, an upper-case header, only the title cut with `…`.

Flags:

- `-a, --assignee <ref>` (repeatable) — default `me`; `any` = everyone (alone), `none` = unassigned, an email, a member or agent name.
- `--search <text>` — every whitespace-separated term must match; ranked, typo-tolerant (below). `--exact` (only with `--search`) = substring matching only.
- `-s, --status <value>` / `--priority <level>` (repeatable or comma-separated; `none` = not assessed) · `--tag <name>` (unknown = error; listing never creates tags) · `-m, --milestone <ref>` · `--sprint <ref>` (`--team <ref>` disambiguates the number) · `--due-after` / `--due-before YYYY-MM-DD` (inclusive local days) · `--project <ref>` (global).
- `-n, --limit <count>` (1-500, default **50**) · `--cursor <cursor>` (copy from the footer) · `--json` · `--fields <list>` (with `--json`).

```bash
lumo task list                                        # everything assigned to me
lumo task list --status in_progress -n 10             # 10 per page, status-filtered
lumo task list --cursor 50                            # page 2 (from the footer)
lumo task list --assignee any --search "oauth redirect"
lumo task list --assignee any --search "serch filtr" --exact
lumo task list --assignee none --status todo --priority high --priority urgent
lumo task list --assignee alice@example.com --tag bug --sprint 3
lumo task list --assignee any --due-before 2026-09-30 --status todo --status in_progress
```

### Search (`--search`)

Every term must match (AND): a case-insensitive substring of title or description, or the task number (`42`, `LUM-42`). Typo tolerance is a **tiered fallback** that runs only when what you typed matches nothing (a correctly spelled word is never widened): (1) exact substring / number; (2) trigram typo matching of title words for terms of 4+ letters (`serch`, `dashbord`); (3) one swapped pair of adjacent letters (`oauht`). Ranked by relevance (number > title > typo > description). `--exact` switches the fallback off. A ranked search covers at most 500 matches — then the output ends with `(result capped at 500 — narrow the filters)` and `--json` has `truncated: true`.

### `--json` fields

`{ version, tasks, total, nextCursor, truncated, deprecatedFields }`. The fields callers may rely on (and `--fields` accepts): `ref`, `id`, `title`, `status`, `priority`, `project`, `assignee`, `milestone`, `sprint`, `tags`, `dueDate`, `blockedByOpenCount`, `unblocksOpenCount`, `createdAt`, `updatedAt`. Fields listed in `deprecatedFields` are still emitted but will go — don't build on them. `--fields` without `--json`, or an unknown name, exits 2 listing the valid names.

```bash
lumo task list --json --fields ref,title,status,dueDate
```

### Paging — shared by `task list`, `task show --history`, `task show --comments`, `milestone list`, `doc list`

Lists print **50 rows per page** by default (`--limit` 1-500). When a page is not the whole result the output ends with a fixed footer:

```
Showing 1-50 of 132.
Next page: lumo task list --status todo --cursor 50
```

The second line is data, not a hint: `--no-hints` never hides it. The last page prints only the `Showing …` line; a one-page result prints no footer. **If you see the footer, you have not seen everything** — run the printed command before concluding a task/doc/milestone is absent. `--json` adds `total` and `nextCursor` (`null` on the last page). The cursor is opaque: copy it, don't compute it.

**When to suggest `task list`:** "what am I working on", "list my tasks"; before a status change when no task id is in context; "find the task about X", "what's unassigned", "what's Alice working on", "what's overdue" (`--assignee any|none|<who>` with filters); before creating a task (`--assignee any --search "<words>"` to avoid a duplicate).

## `lumo task statuses [--json]`

The status set with each status's allowed transitions, the priorities (`NONE, LOW, MEDIUM, HIGH, URGENT` — `NONE` = not assessed, the default, sorts last), and which statuses are gated (`DONE`: the user's `--confirm` unless every linked PR is merged and nothing blocks, plus a clear DONE gate; `CANCELED`: always the user's `--confirm`). Served by the server, so it tracks the real state machine.

```bash
lumo task statuses
```

## `lumo status --next [--claimable] [-n, --limit <N>] [--json]` — recommend the next task

The Next section of [`lumo status`](overview.md). Ranks the tasks assigned to you and prints the top N (default 3), each with a one-line reason. **Read-only — it does not bind or load context.** Pick one, then `lumo session attach <LUM-N>` + `lumo task show <LUM-N> --full`.

Ranking: **priority** (URGENT→LOW, then NONE — reason `no priority`), then **active-sprint** membership, then **dependency topology** (tasks with an open confirmed blocker sort after workable ones; among workable peers the one that unblocks the most ranks first), then **due date**, then in-flight status. DONE / CANCELED tasks and tasks of a paused, canceled or archived project are excluded (a trailing `(N tasks skipped: project paused, canceled or archived)` line reports them).

**`--claimable`** is a hard filter: only tasks that are agent-claimable (steward-triaged — `lumo milestone triage` or `task update --claimable`; **fail-closed**, so untriaged tasks are excluded) **and** unblocked **and** within milestone budget (only a _measured_ overrun excludes). When it empties the list it says why (`excluded: 3 not triaged claimable, 1 blocked by open deps`). Against an older server it degrades to the standard ranking with a notice.

```bash
lumo status --next
lumo status --next --limit 1
lumo status --next --claimable   # autonomy-scoped: only claimable ∩ unblocked ∩ in-budget
```

```
Top 3 recommended tasks (of 12 open):

LUM-42⇥IN_PROGRESS⇥URGENT⇥active sprint · due 2026-06-03 (overdue) · in progress⇥Fix Slack OAuth redirect
LUM-48⇥TODO⇥HIGH⇥active sprint · unblocks 2 tasks⇥Investigate slow query

Next:
  lumo session attach LUM-42 && lumo task show LUM-42 --full
      start on the top-ranked task
```

`--json`: `{ version, tasks, total, nextCursor, poolSize, claimable }` (each task with `ref` and `reasons`; `excluded` with `--claimable`).

**When to suggest:** "what should I work on", "what's next", "pick my next task" (any language), or a session starting without a task in mind.

## `lumo task show [task]` — one task's detail

`[task]` defaults to the session-bound task. Prints `<id>  <title>`, then `Label:  value` rows — status, priority, project, assignee, `Created by` (`Name <email>`, always a member — a task an agent creates is recorded under the member whose API key ran it; `-` when unrecorded), due date, URL — and the full description, verbatim, inside an `<untrusted-task-description>` block (fence tags defanged, directive-shaped content flagged). Without aspect flags it loads no prior sessions or memory; aspects (`--full`, `--comments`, `--scans`, …) are in [task-context.md](task-context.md). `--json`: `{ version, task }` plus one key per aspect.

```bash
lumo task show LUM-42
```

### `--history [-n <count>] [--cursor <c>]` — field-change log

The task's changelog, oldest first: `<time>  actor  change` for status, priority, title, description, assignee, due date, tags and sprint changes (milestone / project moves are not recorded; comments are in `--comments`). Times are UTC (`2026-10-16T22:24:00Z`) when piped, local with offset on a terminal. Paged from the newest end (latest 50 first, footer for older ones). `--json`: `{ version, entries, total, nextCursor }`.

```bash
lumo task show LUM-42 --history
```
