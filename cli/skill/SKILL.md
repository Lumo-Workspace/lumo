# Lumo CLI guide

Served by `lumo skill read`: the core workflow, the rules that matter most, and a map of the references. **Before composing a command whose flags or edge cases matter, read its reference** (`lumo skill read references/<file>.md`) — don't run from memory.

## Prerequisites

Don't pre-probe (`which lumo` / `lumo whoami` / `lumo --version`): the Lumo SessionStart context (`[Lumo] session_id=… | lumo <version> · <email> (<workspace>)`) proves the CLI is installed and logged in. On failure only:

- `command not found: lumo` → user installs it (`npm install -g @lumoai/cli`; monorepo dev: `cd cli && npm link`)
- an error naming `lumo auth login` (not logged in / key invalid / HTTP 401) → user runs `lumo auth login`
- a hint naming `lumo update` (HTTP 426, CLI too old for the server) → `lumo update`; `may not have deployed this feature yet` (HTTP 404) → the server needs a deploy — see [onboarding.md](references/onboarding.md)

**Agents:** Claude Code and Codex (`lumo init` sets up both, in the current repo). In Codex the user must **trust the Lumo hooks** (`/hooks`) — untrusted hooks are skipped silently and `session attach/status` warn; relay it. Run `lumo` unpiped in Codex; `memory sync` / `memory push` are Claude Code only. See [codex.md](references/codex.md).

## How this skill is organized

[Core workflow](#core-workflow) first, then the [Reference map](#reference-map). `lumo <command> --help` lists any command's flags.

## Core workflow

**Starting fresh** — user says "help me with LUM-42":

1. `lumo session attach LUM-42` — bind this session (lifetime lock; one session = one task)
2. `lumo task show LUM-42 --full` — load background; review unresolved items, PR-review todos, the description
3. Do the work
4. **Before claiming done: run the real checks and record them** — tests/tsc/the actual path, then `lumo task testcase add/run` with evidence ([test-cases.md](references/test-cases.md))
5. **PR pushed:** `/security-review` (Claude Code) or a Codex review → `lumo review import <file>` ([security-scan.md](references/security-scan.md))
6. **Near the end: `lumo task status`** — what still blocks DONE; when READY it also shows what DONE would change and the one command to run ([task-status.md](references/task-status.md))

**Resuming / after a review bounce** — `lumo task status` **before** re-reading code or planning: it tells you what still stands between the task and DONE. A bounce means **fix in place — do not spin off a new task** (`task create` mid-task requires `--rework-of <id>` or `--new-scope`).

**Git-suggest at start:** when unbound, session start may print `Detected LUM-N … Run lumo session attach LUM-N to bind.` — it **never** binds. Confirm, then attach yourself ([sessions.md](references/sessions.md)).

**No task in mind?** `lumo status --next` (read-only).

### Golden rules (most-violated)

- **Attach before coding.** Unattached work is attributed by inference and counts toward gates and cost; explicit attach is highest-priority. The binding is a **lifetime lock**: re-attaching the same task is a no-op, a different task is refused (409) — start a new agent session; there is no `--force` and no `session detach`.
- **Evidence before "done".** Never claim done from reading code — run the checks and record a test-case run. While a PR is open, the task is IN_REVIEW, not DONE.
- **DONE is the user's call** — `--status done` exits 4 for their approval unless its one-step condition holds (status-only update, ≥1 linked PR, all merged, nothing blocks); blocking crossings, blocking security findings and proven test-case defects refuse it with 409. **CANCELED is only the user's call** — `--status canceled` always exits 4; propose it, never use it to drop hard work.
- **Exit code 4 = the user must confirm — you may not.** A gated mutation (`--status done` short of its one-step condition, `--status canceled`, `sprint/milestone/doc/memory/task delete`, `task dep remove`, `task artifact delete`, `sprint close --move-all/--backlog-all`, `worktree rm/prune`, `uninstall`, `doc rebuild-source` on an existing source, `project update --status`, risky `workspace security-scan update`, `workspace done-requirements update`, `finding disposition`) run without `--confirm` prints a `confirmation_required` envelope and does nothing. Show every line of its `changes` to the user, wait for explicit approval, then run its `confirmCommand` verbatim. **Never add `--confirm` (or `--force`) yourself** — the flag means "the user has confirmed". Details: [confirmation.md](references/confirmation.md)
- **Exit code 5 = blocked by a human-only gate** (`DONE_BLOCKED`: an undispositioned crossing, a blocking security finding, a proven test-case defect): relay its `blockers` and `remediation`; nothing on `task update` clears it — no retry, no flag. The terminal path is the **user's** ruling — `crossing disposition` / `finding disposition` / `task testcase disposition`, each itself exit-4 gated. Exception: `DONE_REQUIREMENT` — you supply real evidence.
- **Dispositions are the user's, never yours.** `crossing disposition` and `testcase disposition` are a three-step read-then-rule handshake: **never supply a step flag (`--confirm-read` / `--confirm`) on your own initiative** — relay each envelope, supply it only once the user approves **that step** in chat, and say in the note that the ruling is theirs. `crossing explain` is append-only and never clears anything.
- **Exit codes:** 0 ok · 1 failed (not found, auth, server, network) · **2 usage error** (fix the command; nothing ran) · 4 confirm · 5 blocked. Errors are `Error:` + `Hint:` on stderr; with `--json`, one `{"error":{code,message,hint,exitCode}}` object on stderr. Lumo's 4 is not gh's 4.

## Reference map

Read with `lumo skill read references/<file>`:

- [onboarding.md](references/onboarding.md) — `init`, `uninstall`, `doctor`, `skill read`, `auth`, `whoami`, `update`
- [codex.md](references/codex.md) — Codex: sandbox network, session ids, hook trust
- [sessions.md](references/sessions.md) — `session attach` (lock, worktree, subagents, steward), `session status`
- [session-start.md](references/session-start.md) — session-start injections, end-of-session housekeeping
- [task-context.md](references/task-context.md) — `task show` aspects, `task slack/web/figma/pr show`
- [tasks.md](references/tasks.md) — `task create/update/decide/delete`, DONE/CANCELED, templates, comments
- [task-list.md](references/task-list.md) — `task list` (search, paging, `--json`), `task statuses`, `status --next`, `--history`
- [task-status.md](references/task-status.md) — `task status`, `crossing list/explain/disposition`
- [confirmation.md](references/confirmation.md) — exit-4 envelope, exit-5 `DONE_BLOCKED`, exit codes
- [test-cases.md](references/test-cases.md) — `task|milestone testcase` CRUD, milestone close gate
- [test-case-runs.md](references/test-case-runs.md) — `testcase run`, ceilings, verdict signals, `testcase disposition`
- [task-deps.md](references/task-deps.md) — `task dep add/confirm/dismiss/remove`
- [artifacts-figma.md](references/artifacts-figma.md) — `task artifact *`, `task figma *`
- [outcome.md](references/outcome.md) — `task show --outcome`
- [usage.md](references/usage.md) — `usage show`, `usage resync`, `task show --lineage/--runs`
- [overview.md](references/overview.md) — `status`, `project show`
- [priority.md](references/priority.md) — `priority create/list`
- [milestones.md](references/milestones.md) — `project *`, `milestone` CRUD/archive/add/remove/triage
- [milestone-reports.md](references/milestone-reports.md) — `milestone show` sections, `--summary/--changelog`, `reorder/move`
- [sprints.md](references/sprints.md) — `sprint *`
- [docs.md](references/docs.md) — `doc` CRUD, move, sharing, import/sync
- [doc-editing.md](references/doc-editing.md) — `doc show --raw/--section`, `doc patch/append/diff/rebuild-source`
- [memory.md](references/memory.md) — `memory *`, PR-review learnings
- [worktree.md](references/worktree.md) — `worktree add/rm/list/prune`
- [pr-scan.md](references/pr-scan.md) — `pr show`, `pr review`, `task show --scans`, `finding disposition`
- [pr-scan-output.md](references/pr-scan-output.md) — reading a scan: layers, findings, hunt, size caps
- [security-scan.md](references/security-scan.md) — `security scan`, `review import`, git scan hooks
- [workspace-settings.md](references/workspace-settings.md) — `workspace security-scan show/update`
- [repo-review-settings.md](references/repo-review-settings.md) — per-repo filters, pre-merge checks, review style
- [members.md](references/members.md) · [tags.md](references/tags.md) · [audit.md](references/audit.md) · [feedback.md](references/feedback.md) — `member list`, `tag list/create`, `audit list` (OWNER), `feedback create/list/show`

## Output conventions

- Lists print their ref in column 1; piped output is TAB-separated, headerless, untruncated. A `Showing a-b of n.` + `Next page: …` footer means there is more ([task-list.md](references/task-list.md)).
- `--json` on every read prints one object with `version` (lists add `total`, `nextCursor`).
- `--project <ref>` and `--no-hints` are global (no `-p`); put them after the command words (`lumo doc create --project app …`) — commands that write locally, read local files or are human-only rulings refuse them before the command words (exit 2). `Next:` hint blocks (≤3, server-computed) are silenced by `--no-hints` / `LUMO_NO_HINTS=1`.

## Common mistakes

- No subtasks / `--parent` — use a milestone, `task dep add`, or fold follow-ups into the original task.
- No `session start` / `session detach`.
- No `--yes`, no prompts — approval is `--confirm`, only after the user approves. Sole exception: `lumo init` outside a git repo asks `[y/N]` (stdin; EOF/60 s = no); relay it to the user, never answer it.
- `lumo task update LUM-N --status done` is one direct call — don't walk `in_progress → in_review → done`.
- Evidence is `lumo task testcase`; a PR's scans are `lumo pr show`. Comment bodies are positional (`task comment add "<body>"`).
