# Task management

Create, update (incl. DONE / CANCELED), templates, decisions, delete, comments. Listing, search, paging and `status --next`: [task-list.md](task-list.md). Dependency edges: [task-deps.md](task-deps.md). Reading a task: [task-context.md](task-context.md).

## `lumo task create <title> [flags]`

Title is positional and required. Flags (`lumo task create --help` for the full list):

- `-d, --description <text>` or `--template <key>` (pre-fill from a template; not with `--description`).
- `-p, --priority none|low|medium|high|urgent` — omitted = `NONE` (not assessed). **Pass one only when the user decided it — never guess.**
- `-a, --assignee <ref>` — `me` (default), an email or a member name.
- `--project <ref>` — **required when the workspace has more than one project** (the error names them).
- `--milestone <ref>` (slug or name; ambiguous names are rejected with the slugs), `--sprint <ref>` (number or UUID), `--due YYYY-MM-DD` (your local day).
- `--tag <name>` / `--tag-id <cuid>` — repeatable.
- **Mid-task** it refuses the bare form and requires `--rework-of <id>` (creates nothing — fix the existing task) or `--new-scope`; on a review bounce fix in place — see [task-status.md](task-status.md).

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

Output: `Created LUM-55 "Title"  <url>`, a `Tags:` line when tags were attached, then the `Next:` block.

**Next-step hints.** `task create`, `task update`, `session attach`, `task show --full` and `status --next` end with a server-computed `Next:` block (≤3 suggestions from task status × session binding × open crossings) after the result line — the result line stays first. `--no-hints` / `LUMO_NO_HINTS=1` silence it.

**When to suggest:** the user asks to file/track something; a discussion ends in "let's track that separately" (add `--priority` only if they stated one); a follow-up discovered mid-work shouldn't bloat the current change — propose it rather than silently expanding scope; a task handed to an agent → `--template agent-brief` (Context / Goal / Non-goals / Watch out / Done when / Decisions). Search first to avoid a duplicate: `lumo task list --assignee any --search "<words>"`.

## Task templates

`lumo task template list [--json]` lists the keys `--template` accepts (`KEY  NAME  KIND  DESCRIPTION`; KIND `built-in`, e.g. `agent-brief`, or `workspace`). `show <key>` prints only the Markdown body (so `> file.md` saves it). `create` / `update` / `delete` manage the workspace's own templates and need the **OWNER** role; built-in keys can't be changed — save a copy and create your own. `--file` reads a UTF-8 Markdown file in the project (`-` = stdin); a missing, empty, non-UTF-8 or over-20,000-character file exits 1 before anything is sent. `delete` exits 4 with an envelope until the user approves ([confirmation.md](confirmation.md)); tasks created from it keep their description.

```bash
lumo task template list
lumo task template show agent-brief > brief.md     # start from the built-in
lumo task template create team-brief --name "Team brief" --file brief.md
lumo task template update team-brief --file brief.md --name "Team agent brief"
lumo task template delete team-brief                    # exit 4 envelope; re-run with --confirm after the user approves
```

## `lumo task decide <id> "<text>"` — record a decision in the brief

Appends one dated list item to the description's `## Decisions` section (created at the end if missing); the rest of the description is untouched.

```bash
lumo task decide LUM-42 "Keep the v1 API; v2 is a separate task (user)"
```

**When to suggest:** the user rules on scope or approach mid-task ("do X, not Y") — record it here rather than in a comment, so the brief stays the single place the agreed scope lives.

## `lumo task update <id> [flags]`

At least one of: `-t, --title`, `-d, --description` (`""` clears), `-s, --status backlog|todo|in_progress|in_review|done|canceled` (`done` and `canceled` are gated, below), `--duplicate-of <id>` (only with `--status canceled`), `-p, --priority` (`none` resets), `-a, --assignee` (`""` unassigns), `--milestone` / `--sprint` / `--due` (`""` clears), `--claimable` / `--not-claimable`, and tags: `--tag` / `--tag-id` **replace** the whole set; `--add-tag[-id]` / `--remove-tag[-id]` change it (the two families can't be mixed; max 20 each). `--remove-tag <name>` creates an orphan tag when the name is unknown — prefer `--remove-tag-id`.

```bash
lumo task update LUM-48 --status in_progress
lumo task update LUM-48 --title "Update task from CLI" --priority high
lumo task update LUM-48 --assignee me
lumo task update LUM-48 --description ""        # clear description
lumo task update LUM-48 --milestone ""          # unbind milestone
lumo task update LUM-48 --sprint 3              # bind to sprint #3
lumo task update LUM-42 --add-tag urgent --remove-tag draft
lumo task update LUM-42 --tag final --tag approved   # replace entire tag set
lumo task update LUM-48 --claimable
```

Output: `Updated LUM-48 "Title"  <url>`, a `Tags:` line, and for `--sprint` a `Sprint: #2 → #3` line (`- → #3` newly bound, `#3 → -` unbound). The `Next:` block reflects the **post-update** status (`in_review` prints a stop-and-wait note).

**Transitions.** Any status can move to any other directly (BACKLOG = not yet scheduled; new tasks default to TODO; BACKLOG is left out of sprint/milestone progress totals). **One call suffices:** `--status done` straight from TODO or IN_PROGRESS is legal — never walk `in_progress → in_review → done` as a ritual. A DONE task can be reopened with any other status. `lumo task statuses` prints the server's matrix ([task-list.md](task-list.md)).

### `--status done` — one step, or the confirmation envelope

**One step when nothing is left.** When `--status` is the only flag, at least one PR is linked, **every** linked PR is merged and the status digest reads `Blocks DONE: nothing on record` (no blocking crossing, security finding or proven test-case defect, no `⚠ could not confirm`), the PATCH runs straight away — no envelope, exit 0:

```text
Updated LUM-48 "Title"  https://…/LUM-48
One-step DONE (no --confirm needed): the linked PR is merged and nothing blocks DONE.
  Status: IN_REVIEW → DONE
  #926  MERGED   refactor: panel  https://github.com/o/r/pull/926
<the worktree removal report, then the status digest>
```

It fails closed: any other flag, no linked PR (a docs-only task), any PR not merged, a task already DONE, or any failed read → the envelope.

**Otherwise DONE needs the user's sign-off.** Without `--confirm` it prints a **confirmation envelope** on stdout and exits **4**, sending nothing. `changes` lists the status move, each linked PR (with a `⚠ N linked pull request(s) not merged` line when any is open) and each local worktree (`Will remove worktree <path> (branch … kept)` / `Keeps worktree <path>: <reason>` — removed only after `--confirm` and a successful DONE, never forced). Full protocol and an example: [confirmation.md](confirmation.md).

- **Show `changes` to the user and wait for an explicit yes**, then run `confirmCommand` unchanged. `--confirm` means the user confirmed — never add it on your own. There is no `--yes` or `--force` on `task update`.
- With `--confirm` the server's DONE gates still apply: an undispositioned boundary crossing, a blocking security finding or a proven test-case defect refuses with 409, which the CLI turns into a **`DONE_BLOCKED` error on stdout with exit 5** (blockers + remediation naming only human-side paths). Nothing on `task update` clears them — relay, don't retry. Each blocker's terminal path is the user's ruling — `lumo crossing disposition`, `lumo finding disposition`, or `lumo task testcase disposition <task>/TC<n> --known-defect | --not-a-defect` (all exit-4: the user rules, never you); once every blocker is cleared, re-run this `--confirm` call.

```bash
lumo task update LUM-48 --status done
lumo task update LUM-48 --status done --confirm   # only after the user approved the envelope
```

### `--status canceled` — the user's ruling, always the envelope

CANCELED is the terminal state for "we won't do this" or "this duplicates another task". It is **a human ruling**: an agent may propose it, never apply it. There is **no one-step path** — without `--confirm` it always exits 4 with an envelope (`Will move LUM-48 … to CANCELED`, `Duplicate of: …`, `CANCELED leaves completion metrics and the next-task lists; only the user rules it — an agent may propose it, never approve it`).

```bash
lumo task update LUM-48 --status canceled --duplicate-of LUM-12
```

After the user's yes, `confirmCommand` sets the status and (with `--duplicate-of`) records a `DUPLICATES` edge. CANCELED tasks are skipped by `status --next`, sprint spillover, open counts and blockers; they count in neither numerator nor denominator of progress and completion rates; `task status` reports `CANCELED — closed by the user, not delivered`. Reopen with any other status.

**When to suggest `task update`:** a state change in natural language ("mark LUM-48 in progress", "assign LUM-30 to me"); after finishing — every linked PR merged and nothing blocks → `--status done` (one step), otherwise relay the exit-4 envelope; the user says a task is obsolete or duplicates another → `--status canceled [--duplicate-of …]` and relay the envelope. **Never cancel on your own to get out of hard work.** Several changes in a row → separate calls.

**No subtasks.** `--parent` does not exist. Group related tasks with a milestone, express "A before B" with `lumo task dep add`, and fold small follow-ups into the original task.

## `lumo task delete <id>` — move to the trash

Restorable for **30 days** from the web app's Settings → Trash, then purged; hidden from lists, search and context meanwhile. Without `--confirm` it exits 4 with an envelope — relay it and wait; never add `--confirm` yourself. Permanent erasure is web-only. Prefer `--status done` / re-scoping (or the user's CANCELED) for work that merely stopped mattering.

```bash
lumo task delete LUM-42
```

## Comments

`lumo task comment add <body> [--task <id>] [--reply-to <comment>]` — body is positional plain text (quote it); `--task` defaults to the session-bound task (neither → exit 2). `--reply-to` takes the `#<short id>` from `task show --comments` (unique prefix of 6+ chars); threads are one level deep. No @-mention syntax — ping people from the web UI.

`lumo task comment update <comment> <body>` / `lumo task comment delete <comment>` (both `[--task <id>]`) — your own comments only (others → 403). `delete` hides the replies under a top-level comment and exits 4 with an envelope until the user approves.

```bash
lumo task comment add "Reproduced the redirect bug on staging — Safari only, not Chrome." --task LUM-42
lumo task comment add "Fixed in the latest push" --task LUM-42 --reply-to cmaaaaaa
lumo task comment update cmaaaaaa "Reproduced on Safari 18 only" --task LUM-42
lumo task comment delete cmaaaaaa --task LUM-42
```

Reading comments is `lumo task show <id> --comments` ([task-context.md](task-context.md)).
