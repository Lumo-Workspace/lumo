---
name: lumo
description: 'Use when the user mentions a Lumo task id (LUM-N, or any team prefix like SPEC-12) or the `lumo` CLI, in any language; is starting, resuming, or about to claim completion of a task; asks what to work on next; or works with any Lumo resource — task context, sessions, task status and wrap-up, test cases, tasks, initiatives, projects, milestones, sprints, docs, artifacts, Figma links, dependencies, team memory, priorities, PR security scans, or worktrees. Key triggers: "LUM-", "lumo", "task context", "session attach", "task status", "test case", "what should I work on", "resume task".'
---

## Prerequisites

Don't pre-probe (`which lumo` / `lumo whoami` / `lumo --version`): the SessionStart line (`[Lumo] session_id=… | lumo <version> · <email> (<workspace>)`) already proves the CLI is installed and logged in. Troubleshoot only on failure:

- `command not found: lumo` → user installs it (`npm install -g @lumoai/cli`; monorepo dev: `cd cli && npm link`)
- an error naming `lumo auth login` (not logged in / key invalid / HTTP 401) → user runs `lumo auth login`

**Agent support:** everything works in Claude Code. In Codex (skill installed by `lumo init --agent codex`) there are no Lumo hooks yet — `session attach/status`, activity capture, `memory sync` and `usage resync` are Claude Code only, so skip them and say so; every other command works.

## How this skill is organized

**Starting, resuming, or finishing work on a task? Read [Core workflow](#core-workflow) at the bottom first** — it's the happy path (attach → context → work → test cases → wrap-up) and the recurring traps. The catalog is a lookup table, not the starting point.

The command catalog below is a **map**: it lists every command grouped by domain with a one-line summary. **Detailed flags, examples, output formats, and "when to suggest" guidance live in the `references/` files** — when a user request lands in a domain, **Read the matching reference file before composing the command**. Don't run a command from memory if its flags/edge-cases matter; open the reference first.

| Domain                                                                                 | Read this reference                                                  |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `setup`, `auth login/logout`, `whoami`, `update`                                       | [references/onboarding.md](references/onboarding.md)                 |
| `task context`, retrieval (`slack/web/figma context`, `comments list`, `pr show`)      | [references/task-context.md](references/task-context.md)             |
| `pr scan <number>` — one PR's security scans by number (layers, findings, hunt detail) | [references/pr-scan.md](references/pr-scan.md)                       |
| `task create/update/list/search/statuses/show/comment/decide/template *`, `next`       | [references/tasks.md](references/tasks.md)                           |
| `member list` — workspace directory (the refs `--assignee` accepts)                    | [references/members.md](references/members.md)                       |
| `tag list/create` — workspace tags                                                     | [references/tags.md](references/tags.md)                             |
| `audit list` — workspace audit log (OWNER only)                                        | [references/audit.md](references/audit.md)                           |
| `workspace security-scan` — PR security-scan switches, disable/enable all (OWNER)      | [references/workspace-settings.md](references/workspace-settings.md) |
| `task deps add/list/confirm/dismiss/rm` (dependency edges)                             | [references/task-deps.md](references/task-deps.md)                   |
| `initiative create/list/update/progress` (`LUM-INIT-<n>`)                              | [references/initiatives.md](references/initiatives.md)               |
| `task artifact*`, `task figma*`                                                        | [references/artifacts-figma.md](references/artifacts-figma.md)       |
| `task testcase add/list/show/update/rm/run`（结构化用例 + 执行记录）                   | [references/test-cases.md](references/test-cases.md)                 |
| `task status/wrapup`, `crossing explain/disposition` — self-check, resume, DONE gate   | [references/task-status.md](references/task-status.md)               |
| `cost` — per-operation (per-tool) token cost read-out; `task lineage` Top-5            | [references/task-context.md](references/task-context.md)             |
| `outcome show` — post-hoc outcome well (falsifier oracle, rejection-only)              | [references/outcome.md](references/outcome.md)                       |
| `priority [text]`, `priority list` — team priority declaration (append-only)           | [references/priority.md](references/priority.md)                     |
| `project list/create/update`, `milestone*`                                             | [references/milestones.md](references/milestones.md)                 |
| `doc create/update/list/move/bind/share/import` (CRUD)                                 | [references/docs.md](references/docs.md)                             |
| `doc show --raw/--section`, `doc patch/append/diff/rebuild-source` (editing live docs) | [references/doc-editing.md](references/doc-editing.md)               |
| `sprint*`                                                                              | [references/sprints.md](references/sprints.md)                       |
| `task/project memory`, `memory promote/rm`                                             | [references/memory.md](references/memory.md)                         |
| `session attach/status`, git-suggest on start, Layer-2 review                          | [references/sessions.md](references/sessions.md)                     |
| `worktree add/rm/list/prune` (local dev tooling)                                       | [references/worktree.md](references/worktree.md)                     |
| `--confirm` / exit code 4 — the confirmation envelope every gated mutation speaks      | [references/confirmation.md](references/confirmation.md)             |

## Command catalog

### Onboarding / auth / update — see [onboarding.md](references/onboarding.md)

- `lumo init [--user|--project] [--force] [--agent <token>] [--upgrade]` — install skill files + hooks (`lumo setup` is a hidden alias; `--upgrade` refreshes every known install, skipping modified or newer copies; `--agent codex`: skill into `.agents/skills/`, no hooks)
- `lumo auth login` / `lumo auth logout` — paste an API key / clear credentials
- `lumo whoami [--full|--json]` — one-line identity from local credentials (not a pre-flight check)
- `lumo update` — upgrade the CLI to the latest npm release

### Task context & retrieval — see [task-context.md](references/task-context.md)

- `lumo task context <id> [--full]` — load task background (memory headlines → `lumo memory show <id>`, source cards, PR review todos, prior sessions; a pending workspace deletion shows first); `--full` = memory bodies
- `lumo task slack show <id> <contextId>` — full stored Slack thread
- `lumo task web show <id> <linkId>` — fetched web link body
- `lumo task figma context <id> <linkId>` — Figma link metadata (v1)
- `lumo task comments list <id>` — comment thread, capped to the output budget (`--full` prints every comment; read-only; ≠ `task comment`)
- `lumo task pr show <id> <number>` — synced PR metadata (v1)
- `lumo task lineage <id>` — read-only causal-trail audit: fragments that fed the task + each one's disclosure tag/outcome, the run's token/loop cost, a disclosure-funnel summary, and a Top-5 "operations by token cost"; `--signal` appends workspace-level usage signal-health (see [task-context.md](references/task-context.md))

### Pull requests by number — see [pr-scan.md](references/pr-scan.md)

- `lumo pr scan <number> [--repo owner/repo] [--all] [--full] [--json]` — one PR's security scans by number, linked to a task or not: layer line (same labels as `task status`), every finding incl. dispositioned ones + their source, hunt coverage; `--full` per-task hunt detail, `--all` every head. Read-only.

### Tasks — see [tasks.md](references/tasks.md)

- `lumo task create <title> [flags]` — create a task. **Mid-task** (your session is bound to an in-flight task) it requires `--rework-of <id>` (redirects you to fix the existing task — creates nothing) or `--new-scope` (genuinely new, out-of-scope work). On a review bounce, fix in place instead of spinning off a new task — see [task-status.md](references/task-status.md).
- `lumo task create <title> --template <key>` pre-fills the description from a template (`lumo task template list`; built-in `agent-brief`). Templates are CLI-only: `task template show/create/edit/rm` (owners upload a Markdown file with `--file`). `lumo task decide <id> "<text>"` appends a dated ruling to the description's `## Decisions` section — use it for scope/approach rulings instead of a comment.
- `lumo task update <id> [flags]` — patch status/title/priority/assignee/milestone/sprint/tags/due; `--claimable`/`--not-claimable` set the agent-claimable marker (LUM-646). `--status done` without `--confirm` exits 4 with a confirmation envelope (see [confirmation.md](references/confirmation.md))
- `lumo task list [flags]` — list tasks assigned to you
- `lumo task search [query] [flags]` — search the whole workspace (any assignee; `--assignee none`, `--tag`, `--status`, `--priority`, `--sprint`, `--due-before/--due-after`); query terms are ANDed and ranked; typo tolerance (`pg_trgm`, then letter swaps) only kicks in when nothing matches exactly, off with `--exact`
- `lumo task statuses` — status set + allowed transitions + priorities, as the server defines them
- `lumo task history <id>` — field-change log (status/priority/assignee/due/tags…), oldest first
- `lumo task delete <id>` — moves the task to the trash (restorable 30 days from web Settings → Trash, then purged); exits 4 without `--confirm`
- `lumo next [--count N] [--claimable]` — recommend the next task to work on (read-only). `--claimable` restricts to the autonomy boundary: only tasks that are claimable ∩ unblocked (F3 topology) ∩ within milestone budget (F2); old server degrades gracefully to the standard ranking (LUM-646)
- `lumo task show <id>` — print one task's detail
- `lumo task comment <id> <body> [--reply-to <comment>]` — leave a comment or a reply (`#id` from `comments list`)
- `lumo task comments edit <id> <comment> <body>` / `comments rm <id> <comment>` — edit / delete your own comment (`rm` exits 4 without `--confirm`)

### Members & tags — see [members.md](references/members.md), [tags.md](references/tags.md)

- `lumo member list [--json]` — members (name, email, role) + agent actors
- `lumo tag list` / `lumo tag create <name> [--color <hex>]` — workspace tags with usage counts

### Audit log — see [audit.md](references/audit.md)

- `lumo audit list [--action] [--actor] [--since] [--until] [--json | --csv]` — sensitive workspace actions, newest first (OWNER only)

### Workspace settings — see [workspace-settings.md](references/workspace-settings.md)

- `lumo workspace security-scan` — show / set the PR security-scan switches; `--disable-all` / `--enable-all` (OWNER; turning off exits 4)

### Initiatives (team-level, `LUM-INIT-<n>`) — see [initiatives.md](references/initiatives.md)

- `lumo initiative create "<goal>" [--assumption <text>]` — create an initiative; `--assumption` records the bet behind it
- `lumo initiative list` — team initiatives newest-first; detail browsable in web
- `lumo initiative update <LUM-INIT-n> [--status --goal --target …]` · `initiative progress add/list` — edit an initiative; append-only progress posts with health

### Task dependencies — see [task-deps.md](references/task-deps.md)

- `lumo task deps list <id>` — list dependency edges both directions, grouped CONFIRMED / SUGGESTED / DISMISSED (each row: short edge id + other task + detected evidence)
- `lumo task deps add <id> --blocked-by <LUM-N>` — declare a manual hard dependency (CONFIRMED)
- `lumo task deps confirm <id> <edge> [--reverse]` — confirm a detected candidate (`--reverse` flips direction)
- `lumo task deps dismiss <id> <edge>` — dismiss a candidate (never re-suggested)
- `lumo task deps rm <id> <edge> --confirm` — delete an edge (without `--confirm`: exit 4 + confirmation envelope; `--yes` is a legacy alias)
- `<edge>` = short edge-id prefix (≥6 chars) or the other task's identifier; ambiguous/unknown selectors list candidates and exit 1. See [tasks.md](references/tasks.md)

### Test cases (可反复执行的用例 + 执行记录) — see [test-cases.md](references/test-cases.md)

- `lumo task testcase add/list/show/update/rm/run/disposition` — 可反复执行的结构化用例 + append-only 执行记录，`run --env` 必填、`run --step` 记逐步结果；**唯一拦 DONE 的用例信号**是最新 run 带证据的 `--cause defect`，清闸走 `testcase disposition` 三步握手

### Task status, wrap-up & crossings — see [task-status.md](references/task-status.md)

- `lumo task status [task] [--full] [--json]` — read-only self-check (no LLM): `nextActions` (security findings `blocks DONE` vs `advisory`, test-case advisories), PR scans, open crossings; `--full` adds cost / rework / trend. Fails closed (`⚠` = could not confirm). **Run it first when resuming a task.** `task update --status`, `crossing disposition/explain`, `testcase run/disposition` already end with its digest (DONE envelopes: `statusSummary`) — **no follow-up `task status`** after them
- `lumo task wrapup [task]` — **near the end, instead of chaining reads**: one read-only call prints test-case signals, PR scans, open crossings (ready to relay + per-ruling commands) and DONE readiness with the envelope preview (PR merge state, worktree cleanup). See [task-status.md](references/task-status.md)
- `lumo crossing explain <id> --note "<text>"` (several: `--file <json|->`; unattached: `--task <LUM-N>`) — append an agent self-explanation ("申辩") to a boundary crossing; append-only, **never clears the crossing or unblocks Done**. A review aid, not a self-clear.
- `lumo crossing disposition <id...> --false-positive | --confirmed [--note "<text>"] [--task <LUM-N>]` — several ids = one batch, one envelope per step (LUM-845) — record the **user's** ruling on a task crossing through a **three-step** read-then-rule confirmation handshake the server enforces (LUM-769); never supply a step flag (`--confirm-read` / `--confirm`) **on your own initiative** — relay each envelope, then supply it only once the user approves **that step** in chat, and say in the note that the ruling is theirs. Either ruling clears that crossing's block on DONE. Reverting to OPEN, repository suppression and steward crossings stay web-only. See [task-status.md](references/task-status.md)

### Cost (per-operation token read-out) — see [task-context.md](references/task-context.md)

- `lumo cost [--task <id>|--session <id>|--since <date>] [--by tool|model|member|session] [--json]` — per-operation token cost read-out, attributing each model step's token delta to the tool(s) it ran. Scope is mutually exclusive (default = workspace last-30-days). For the per-task Top-5 inline, see `lumo task lineage`.

### Priority (team-level declaration) — see [priority.md](references/priority.md)

- `lumo priority [text]` — declare the team's current priority (a 1-3 sentence plain-text statement). With `text`, records it directly; with no argument, prompts interactively. **Append-only**: a new declaration supersedes the old by a later `effectiveFrom` — nothing is ever overwritten or deleted.
- `lumo priority list` — print the append history newest-first (the current declaration is marked `*`).

### Outcome well (post-hoc oracle) — see [outcome.md](references/outcome.md)

- `lumo outcome show <task>` — read the post-hoc outcome well: the **falsifier** verdict (`REJECTED` | `INCONCLUSIVE` — never a "pass") plus its backing rejection signals. `INCONCLUSIVE` = no rejection on record, **not** "satisfied".

### Artifacts & Figma — see [artifacts-figma.md](references/artifacts-figma.md)

- `lumo task artifact add/update/list/show/rm` — record spec/plan products on a task
- `lumo task figma add/list/rm/refresh` — attach & manage Figma designs

### Projects & milestones — see [milestones.md](references/milestones.md)

- `lumo project list` — list projects (slugs feed `--project`) · `project create/update` — create / rename / re-own
- `lumo milestone list/create/show/update/delete` — milestone CRUD (`show` includes a Sprint-coverage section)
- `lumo milestone archive/unarchive` — soft-archive / restore
- `lumo milestone add/remove <id> <task...>` — batch bind/unbind tasks
- `lumo milestone triage <id> <task...> --claimable|--not-claimable` — steward batch agent-claimable triage (LUM-646): mark in-milestone tasks (not) claimable; tasks not in the milestone are skipped. Feeds `lumo next --claimable`
- `lumo milestone summary [--retry]` — AI retro
- `lumo milestone changelog <id> [--json]` — structured changelog from DONE tasks + merged PRs + frozen claimSnapshot (pure assembly, no LLM; runs on any status). Headline counts carry a baseline vs prior completed milestones (LUM-508); each claim shows provenance, no-PR/no-claim rendered explicitly (LUM-649)
- `lumo milestone reorder/move` — manual ordering
- `lumo milestone criteria set/list/verdict` — milestone **exit criteria** (LUM-643), adjudicated by the steward or a human; unresolved ones hold completion fail-closed; `verdict --met` on `EXTERNAL_FACT` needs `--evidence`, `PENDING_OUTCOME` can never be MET

### Documents — CRUD/sharing → [docs.md](references/docs.md); **editing live docs** (raw/section/patch/append/diff/rebuild) → [doc-editing.md](references/doc-editing.md)

- `lumo doc create/update/show/list/delete` — document CRUD; `doc update` takes `--if-revision <n>` (mismatch → 409, re-read and retry) and is structure-guarded (drops to tables/rows/headings → 422 unless `--allow-shrink`)
- `lumo doc show <doc> --raw` / `--section "<heading>"` — print the byte-identical markdown source (the only legal edit base; never the lossy HTML→md render), whole or one heading-addressed slice
- `lumo doc patch <doc> --section "<heading>" …` — replace ONLY that section; everything else untouched; concurrent edits 409; structure-guarded
- `lumo doc append <doc> [--section "<heading>"] …` — pure insertion at section/doc end — the safest write for logs/ledgers
- `lumo doc diff <doc> --file <local.md>` — compare server markdown source vs a local file (guards stale uploads)
- `lumo doc rebuild-source <doc>` — regenerate `sourceMarkdown` from the HTML body (recovery when raw/section/patch errors "no stored source")
- `lumo doc move/bind/unbind/share/unshare/share-list` — reparent · task linkage · member sharing
- `lumo doc import-gdoc` / `lumo doc sync` — Google Doc import & re-sync

### Sprints — see [sprints.md](references/sprints.md)

- `lumo sprint list/create/show/update/delete` — sprint CRUD (`show` includes Progress / Health / Blockers)
- `lumo sprint start/close` — status transitions (no `--status` flag)
- `lumo sprint add/remove <id> <task>` — bind/unbind a task
- `lumo sprint summary [--retry]` — AI retro

### Memory — see [memory.md](references/memory.md)

- `lumo task memory add/list` · `lumo project memory add/list` — record/curate Memory (TASK vs PROJECT)
- `lumo memory show <id>` — show one memory's full card (category + content) by id (progressive disclosure from a one-line index entry)
- `lumo memory promote <id>` / `lumo memory rm <id> --confirm` — TASK→PROJECT / delete (exit 4 + envelope without `--confirm`)
- `lumo memory sync [--dry-run] [--clean]` — downsync team memory into the local Claude Code store (`team/<id>.md` + a managed MEMORY.md block); only touches files it owns
- `lumo memory push [--dry-run]` — upsync locally-authored memories from `<memory-dir>/outbox/*.json` to the team
- `lumo memory fold [project-ref] --dry-run` — read-only PREVIEW of the autonomous topic-fold pass (folding runs via a daily cron; no manual apply, no `unfold`). See [memory.md](references/memory.md)

### Sessions — see [sessions.md](references/sessions.md)

- `lumo session attach <id>` — bind this session to a task; prints blockers/security findings only — run `task context` next. **Lifetime lock**: re-attaching to the same task is a no-op; attaching to a _different_ task is refused with 409 — start a new agent session instead. No `--force`, no `session detach`.
- `lumo session attach --steward <milestone>` — bind as a **STEWARD (governance) session** on a milestone (LUM-640): plan & accept only — self-dispatch to in_progress is refused; commits/PRs become milestone-scoped boundary crossings (web+human disposition only). Same lifetime lock. See [sessions.md](references/sessions.md)
- `lumo session status` — show current binding (a task, or the milestone + STEWARD role)
- `lumo usage resync [--apply]` — correct historical inflated token numbers from local transcripts; dry run first, then `--apply`. See [sessions.md](references/sessions.md)
- End-of-session housekeeping is fully automatic (no command). On DONE the server runs three best-effort silent passes: Layer-1 memory curation, fragment-usage audit, and blocked-tag automation. See [sessions.md](references/sessions.md)
- Git-suggest at session start (suggests `session attach`, never auto-binds) + Layer-2 project-memory review — see the reference

### Worktrees (local dev tooling) — see [worktree.md](references/worktree.md)

- `lumo worktree add <LUM-N> [slug]` — `.worktrees/<LUM-N>` off the remote default branch; repo extras from `.lumo/worktree.json`
- `lumo worktree rm <LUM-N> --confirm` — remove one (exit 4 envelope; dirty also needs `--force`; branch kept unless `--delete-branch`). If a running process leaves files behind, rm / prune / DONE print what is left + a `Clean up with:` command to relay
- `lumo worktree prune --confirm` — remove DONE tasks' worktrees holding nothing unlanded (exit 4 envelope)
- `lumo worktree list` — task id, branch, dirty, node_modules link. `session attach` reports/creates the task worktree; DONE's envelope lists removals

## Next-step hints (the trailing `Next:` block)

`task create`, `task update`, `session attach`, `task context` and `next` end with a short `Next:` block naming what to do now — attach an unbound session, explain an open boundary crossing, or stop and wait when the task is IN_REVIEW.

The rules are computed **server-side** from task status × session binding × open crossings, so the advice tracks the real state machine rather than a hard-coded string. Capped at **3 suggestions**; a rule whose condition is already satisfied never appears. The block goes to **stdout**, after the command's own result line — the result line stays first and unchanged, so reading line 1 still works.

Silence it with `--no-hints` on any command, or `LUMO_NO_HINTS=1` for a whole shell.

## Commands & flags that do NOT exist (common mistakes)

Don't guess these:

- No `lumo verify`, `lumo task criteria …`, `lumo criteria audit` or `lumo outcome rate` (removed in LUM-942 with task acceptance criteria) — and no `lumo verdict`, `lumo fidelity`, `lumo outcome record` (LUM-733). Evidence is test cases (`lumo task testcase`); milestone exit criteria (`lumo milestone criteria`) remain
- No subtasks / `--parent` (removed in LUM-959) — group related tasks with a milestone, order them with `task deps add`, and fold small follow-ups into the original task
- No `lumo session start` — binding is `lumo session attach <LUM-N>`
- No `lumo session detach` — the session↔task binding is a lifetime lock; to work on a different task, start a new agent session
- No steward "role switch" or un-steward — `session attach --steward` is the same lifetime lock on a milestone; a steward session never converts to an implementation session (and there is no CLI path to clear its boundary crossings)
- No `lumo pr show` / `lumo scan` — the by-number security read-out is `lumo pr scan <number>` (scan _settings_ are `lumo workspace security-scan`); `lumo task pr show` is the task-scoped PR card
- No `lumo task artifact edit` — it's `lumo task artifact update`
- No `lumo auth status` — identity check is `lumo whoami`
- No `--body` on `lumo task comment` — the body is a positional arg: `lumo task comment LUM-N "text"`
- No `--content` on `task/project memory add` — memory is structured fields (`--category` + per-category flags), see [memory.md](references/memory.md)
- No global `--verbose` flag on any command
- `lumo task comments list` (plural) **reads** the thread; `lumo task comment` (singular) **writes** one
- Status updates: `lumo task update LUM-N --status done` is one direct call — do **not** walk `in_progress → in_review → done` step by step (see [tasks.md](references/tasks.md) for the transition matrix). `--status done` has no interactive prompt and no `--yes`: without `--confirm` it exits 4 with a confirmation envelope you relay to the user (see [confirmation.md](references/confirmation.md))
- No interactive yes/no prompts anywhere, and no `--yes` on `task update` — every gated mutation exits 4 with a `confirmation_required` envelope instead; `--yes` survives only as a legacy alias of `--confirm` on the delete/rm/close commands

## Core workflow

**Starting fresh** — user says "help me with LUM-42":

1. `lumo session attach LUM-42` — bind this session (the binding is a lifetime lock; one session = one task)
2. `lumo task context LUM-42` — load background; review unresolved items, PR-review todos, the description
3. Do the work
4. **Before claiming done: run the real checks and record them** — tests/tsc/the actual path, then `lumo task testcase add/run` with evidence so the result is re-readable (see [test-cases.md](references/test-cases.md))
5. **Near the end: `lumo task wrapup`** — one read of test-case signals, PR scans, open crossings and DONE readiness. See [task-status.md](references/task-status.md)

**Resuming / after a review bounce** — `lumo task status` **before** re-reading code or planning: it tells you what still stands between the task and DONE (security findings, test-case signals, open crossings). A bounce means **fix in place — do not spin off a new task.** See [task-status.md](references/task-status.md)

**Git-suggest at start:** when unbound, session-start may infer the task from the git branch / recent commits (any team prefix, e.g. `SPEC-12`) and print `Detected LUM-N … Run lumo session attach LUM-N to bind.` — **without** binding. Confirm it's right, then attach yourself. See [sessions.md](references/sessions.md)

### Golden rules (most-violated)

- **Attach before coding.** Unattached work is attributed by inference and counts toward gates and cost, but explicit attach is highest-priority.
- **Evidence before "done".** Never claim done from reading code — run the checks and record a test-case run. While a PR is open, the task is IN_REVIEW, not DONE.
- **DONE is the user's call** — `--status done` exits 4 for their approval; blocking crossings, blocking security findings and proven test-case defects refuse it with 409.
- **Status updates are one direct call** (`task update --status done`), not a step-by-step walk through `in_progress → in_review → done`.
- **Exit code 4 = the user must confirm — you may not.** A gated mutation (`--status done`, `sprint/milestone/doc delete`, `memory rm`, `task deps/artifact rm`, `sprint close --move-all/--backlog-all`, `worktree rm`, `doc rebuild-source` on an existing source) run without `--confirm` prints a `confirmation_required` envelope on stdout and does nothing. Show every line of its `changes` to the user, wait for their explicit approval, then run its `confirmCommand` verbatim. **Never add `--confirm` (or `--yes` / `--force`) yourself** — the flag means "the user has confirmed", and adding it on your own initiative is the exact failure the protocol exists to stop. **Exit code 5 = blocked by a human-only gate** (`DONE_BLOCKED`: an undispositioned boundary crossing, a blocking security finding): relay its `blockers` and `remediation` to the user; nothing on `task update` clears it — no retry, no flag. A boundary crossing is the one blocker with a terminal path, and it is the user's — see `crossing disposition` above. Details: [confirmation.md](references/confirmation.md)
- **Read the reference before composing a command** whose flags/edge-cases matter — don't run from memory.
