---
name: lumo
description: 'Use when the user mentions a Lumo task id (LUM-N, or any team prefix like SPEC-12) or the `lumo` CLI, in any language; is starting, resuming, or about to claim completion of a task; asks what to work on next; or works with any Lumo resource — task context, sessions, task status and wrap-up, test cases, tasks, projects, milestones, sprints, docs, artifacts, Figma links, dependencies, team memory, priorities, PR security scans, or worktrees. Key triggers: "LUM-", "lumo", "task show", "session attach", "task status", "test case", "what should I work on", "resume task".'
---

## Prerequisites

Don't pre-probe (`which lumo` / `lumo whoami` / `lumo --version`): the SessionStart line (`[Lumo] session_id=… | lumo <version> · <email> (<workspace>) · skill <version>`) proves the CLI is installed and logged in. On failure only:

- `command not found: lumo` → user installs it (`npm install -g @lumoai/cli`; monorepo dev: `cd cli && npm link`)
- an error naming `lumo auth login` (not logged in / key invalid / HTTP 401) → user runs `lumo auth login`
- a hint naming `lumo update` (HTTP 426, CLI too old for the server) → `lumo update`; `may not have deployed this feature yet` (HTTP 404) → server needs a deploy — see [onboarding.md](references/onboarding.md)

**Agent support:** Claude Code and Codex (`lumo init` sets up both). In Codex the user must **trust the Lumo hooks** (`/hooks`) — untrusted hooks are skipped silently and `session attach/status` warn; relay it. Run `lumo` unpiped in Codex (sandbox/network rules, `fetch failed` hints); `memory sync` / `memory push` are Claude Code only. See [sessions.md](references/sessions.md#codex).

## How this skill is organized

**Starting, resuming, or finishing work on a task? Read [Core workflow](#core-workflow) at the bottom first** — the happy path (attach → context → work → test cases → wrap-up) and the recurring traps. The catalog is a lookup table, not the starting point.

The catalog below is a **map**: every command by domain, one line each. **Flags, examples, output formats and "when to suggest" live in `references/`** — when a request lands in a domain, **Read the matching reference before composing the command**; don't run from memory when flags/edge-cases matter.

| Domain                                                               | Reference                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| `init`, `doctor`, `skill`, `auth`, `whoami`, `update`                | [onboarding.md](references/onboarding.md)                 |
| `task show` and its aspects, `slack/web/figma`, comments, PRs        | [task-context.md](references/task-context.md)             |
| `pr show`, `pr review`, `task show --scans`, `finding disposition`   | [pr-scan.md](references/pr-scan.md)                       |
| `security scan` — scan your local changes before pushing             | [security-scan.md](references/security-scan.md)           |
| `task create/update/list/search/show/…`, `status --next`, templates  | [tasks.md](references/tasks.md)                           |
| `member list` — workspace directory (`--assignee` refs)              | [members.md](references/members.md)                       |
| `tag list/create`                                                    | [tags.md](references/tags.md)                             |
| `audit list` (OWNER only)                                            | [audit.md](references/audit.md)                           |
| `feedback create/list/show` — report a Lumo problem to the Lumo team | [feedback.md](references/feedback.md)                     |
| `workspace security-scan show/update` (update: OWNER)                | [workspace-settings.md](references/workspace-settings.md) |
| `status` (priority, inbox, drafts, next), `project show`             | [overview.md](references/overview.md)                     |
| `task dep *` (dependency edges)                                      | [task-deps.md](references/task-deps.md)                   |
| `task artifact*`, `task figma*`                                      | [artifacts-figma.md](references/artifacts-figma.md)       |
| `task testcase *`, `milestone testcase *` (one command set)          | [test-cases.md](references/test-cases.md)                 |
| `task status`, `crossing *` — self-check, DONE gate, readiness       | [task-status.md](references/task-status.md)               |
| `usage show` — token cost / tokens + DONE per window                 | [task-context.md](references/task-context.md)             |
| `task show --outcome` — post-hoc outcome well                        | [outcome.md](references/outcome.md)                       |
| `priority create`, `priority list` — team priority (append-only)     | [priority.md](references/priority.md)                     |
| `project *`, `milestone *`                                           | [milestones.md](references/milestones.md)                 |
| `doc` CRUD / move / bind / share / import                            | [docs.md](references/docs.md)                             |
| `doc show --raw/--section`, `doc patch/append/diff/rebuild-source`   | [doc-editing.md](references/doc-editing.md)               |
| `sprint *`                                                           | [sprints.md](references/sprints.md)                       |
| `memory *` (task / project scope as a flag)                          | [memory.md](references/memory.md)                         |
| `session attach/status`, `usage resync`, git-suggest, Layer-2        | [sessions.md](references/sessions.md)                     |
| `worktree add/rm/list/prune`                                         | [worktree.md](references/worktree.md)                     |
| `--confirm` / exit code 4 — the envelope every gated mutation speaks | [confirmation.md](references/confirmation.md)             |

## Command catalog

### Onboarding / auth / update — see [onboarding.md](references/onboarding.md)

- `lumo init [--scope user|project] [--force] [--agent <token>] [--dry-run]` — skill + hooks for Claude Code + Codex (re-run to refresh; no `--scope` = `project`, never asks)
- `lumo doctor [--json]` — read-only report of every Lumo install (skills, hooks, Codex rule, git hook) + fix commands
- `lumo skill status [--json]` · `lumo skill update [--scope user|project] [--agent <t>] [--dry-run] [--force]` — report / refresh only the skill copies (never hooks)
- `lumo uninstall [--scope user|project|all] [--agent <t>] [--force] [--purge] --confirm` — remove skills, hook entries, git hook block (exit 4 envelope first)
- `lumo auth login` / `lumo auth logout` — paste an API key / clear credentials
- `lumo whoami [--full|--json]` — one-line identity from local credentials (not a pre-flight check)
- `lumo update [--auto on|off]` — upgrade the CLI now; `--auto` toggles background self-update

### Task context & retrieval — see [task-context.md](references/task-context.md)

- `lumo task show [task] [--json]` — **the one way to read a task**; aspect flags add sections and combine: `--full` (alone: the task context — memory headlines, sources, PR review todos, prior sessions), `--memory` (context with memory bodies), `--comments`, `--history`, `--scans [--all]`, `--runs`, `--outcome`, `--lineage [--signal]`, `--deps`; with an aspect, `--full` = that aspect's long form
- `lumo task slack show <id> <ref>` · `lumo task web show <id> <ref>` · `lumo task figma show <id> <ref>` (`<ref>` = 8-char short ref from the `task show --full` card) — stored Slack thread / web link body / Figma metadata
- `lumo task pr show <id> <number>` — synced PR metadata

### Pull requests by number — see [pr-scan.md](references/pr-scan.md)

- `lumo pr show <number> [--repo owner/repo] [--all] [--full] [--json]` — read one PR's scans · `lumo pr review <number> [--full | --pause | --resume]` — request / pause AI reviews (read the reference first)
- `lumo finding disposition <id...> --false-positive | --accepted-risk [--note]` — the **user's** ruling on security findings (clears a DONE block); exit-4 gated. See [pr-scan.md](references/pr-scan.md#finding-disposition).

### Local security scans — see [security-scan.md](references/security-scan.md)

- `lumo security scan [--secrets] [--staged | --since <ref>] [--fail-on <sev>] [--offline | --pr] [--repo <o/r>] [--json]` — the PR scan's rules on your local changes (merge-base → working tree), each finding labelled from the server (new / on main / ruled / learning, would block DONE); exit 3 at `--fail-on`. Read-only; never a DONE gate.

### Tasks — see [tasks.md](references/tasks.md)

- `lumo task create <title> [flags]` — create a task. **Mid-task** it requires `--rework-of <id>` (creates nothing; fix the existing task) or `--new-scope`; on a review bounce fix in place — see [task-status.md](references/task-status.md)
- `lumo task create <title> --template <key>` — pre-filled description (`lumo task template list`; `task template show/create/edit/rm`). `lumo task decide <id> "<text>"` appends a dated ruling to `## Decisions` — use it for scope/approach rulings
- `lumo task update <id> [flags]` — patch status/title/priority/assignee/milestone/sprint/tags/due/claimable. `--status done` alone runs in one step when ≥1 linked PR, all merged, nothing blocks DONE; else exit 4 (see [confirmation.md](references/confirmation.md)). `--status canceled [--duplicate-of <LUM-N>]` always exits 4 — the user's ruling ([tasks.md](references/tasks.md))
- `lumo task list [flags]` — your tasks; `--assignee any` = everyone's, `--search <text>` ranked + typo-tolerant; repeated flag ORs, flags AND. 50 per page: a `Showing X-Y of N.` footer means more
- `lumo task statuses` — status set + allowed transitions + priorities, as the server defines them
- `lumo task delete <id>` — move to trash (restorable 30 days); exits 4 without `--confirm`
- `lumo status --next [--limit N] [--claimable] [--json]` — recommend the next task (read-only); `--claimable` = claimable ∩ unblocked ∩ within milestone budget
- `lumo task comment add <body> [--task <id>] [--reply-to <comment>]` — leave a comment or reply (`--task` defaults to the bound task)
- `lumo task comment update <comment> <body>` / `task comment delete <comment>` (both `[--task <id>]`) — edit / delete your own comment (`delete` exits 4 without `--confirm`)

### Members, tags & audit — see [members.md](references/members.md), [tags.md](references/tags.md), [audit.md](references/audit.md)

- `lumo member list [--json]` — members (name, email, role) + agent actors
- `lumo tag list` / `lumo tag create <name> [--color <hex>]` — workspace tags with usage counts
- `lumo audit list [--action] [--actor] [--since] [--until] [--json | --csv]` — sensitive workspace actions, newest first (OWNER only)

### Feedback to the Lumo team — see [feedback.md](references/feedback.md)

- `lumo feedback create --title <t> [--kind bug|idea|question] [--step …] [--expected] [--actual] [--evidence-file …] [--task] [--no-env]` / `feedback list [--mine]` / `feedback show FB-<n>` — report a Lumo bug, idea or question (agents may file without asking; say so), read status + Lumo team replies

### Workspace settings & overview — see [workspace-settings.md](references/workspace-settings.md), [overview.md](references/overview.md)

- `lumo workspace security-scan show` / `update` — show / set PR security-scan switches (`--disable-all`/`--enable-all`, `--reward-hack`, `--request-changes`, `--repos`/`--repo` …; OWNER; risky changes exit 4)
- `lumo status [--inbox [--all]|--drafts|--next] [--json]` — me across the workspace: team priority line, unread inbox (`--all` adds read), my drafts, next tasks (read-only; not a task ref — that is `task status`) · `lumo project show [project]` — project health + latest summary

### Task dependencies — see [task-deps.md](references/task-deps.md)

- `lumo task dep add <id> --blocked-by <LUM-N>` — manual hard dependency (CONFIRMED); read edges with `lumo task show <id> --deps`
- `lumo task dep confirm <id> <edge> [--reverse]` / `task dep dismiss <id> <edge>` — accept / dismiss a detected candidate
- `lumo task dep remove <id> <edge> --confirm` — delete an edge (exit 4 envelope without `--confirm`)
- `<edge>` = short edge-id prefix (≥6 chars) or the other task's identifier; ambiguous/unknown selectors list candidates and exit 1

### Test cases — see [test-cases.md](references/test-cases.md)

- `lumo task|milestone testcase add/list/show/download/update/delete/run/disposition` — 任务与里程碑共用一套命令，句柄 `<父对象>/TC<n>`（`LUM-42/TC3` / `<milestone-slug>/TC3`）；可反复执行的结构化用例 + append-only 执行记录（`run --env` 必填、`run --step` 逐步必报）；**唯一拦 DONE 的用例信号**是最新 run 带证据的 `--cause defect`，清闸走 `testcase disposition` 三步握手；`download` 用 API key 存证据

### Task status, wrap-up & crossings — see [task-status.md](references/task-status.md)

- `lumo task status [task] [--full] [--json]` — read-only self-check (no LLM): Done gate verdict (crossings / security / tests), `nextActions` (`blocks DONE` vs `advisory`), PR scans, open crossings. Fails closed (`⚠` = could not confirm); when READY it adds the DONE-readiness section and the one command to run. **Run it first when resuming and near the end.** `task update --status`, `crossing disposition/explain`, `testcase run/disposition` already end with its digest — **no follow-up `task status`**
- `lumo crossing list [task] [--all] [--json]` — read-only: each crossing in full (`<id>` = ref like `LUM-X12`); `--all` adds ruling history
- `lumo crossing explain <id> --note "<text>"` (several: `--file <json|->`; unattached: `--task <LUM-N>`) — append an agent self-explanation; append-only, **never clears the crossing or unblocks Done** — a review aid, not a self-clear
- `lumo crossing disposition <id...> --false-positive | --confirmed [--note "<text>"] [--task <LUM-N>]` — record the **user's** ruling through a **three-step** read-then-rule handshake the server enforces (several ids = one batch); **never supply a step flag (`--confirm-read` / `--confirm`) on your own initiative** — relay each envelope, supply it only once the user approves **that step** in chat, and say in the note that the ruling is theirs. Either ruling clears that crossing's DONE block; reverting to OPEN, repository suppression and steward crossings stay web-only

### Usage — see [task-context.md](references/task-context.md#lumo-usage-show)

- `lumo usage show [--by tool|model|member|session] [--task <id>|--session <id>|--since <day> --until <day>] [--json]` — per-operation token cost (default workspace, last 30 days, by tool)
- `lumo usage show --by member --tasks [--since 7d|<day>] [--until <day>] [--member me|<ref>] [--project <name>] [--json]` — tokens used + tasks completed per window, team + per member; unmetered sessions are counted, never as 0

### Priority — see [priority.md](references/priority.md)

- `lumo priority create <text>` — declare the team's current priority (1-3 sentences; no prompt); **append-only**, never overwritten · `lumo priority list` — history, newest first (the current one also heads `lumo status`)

### Artifacts & Figma — see [artifacts-figma.md](references/artifacts-figma.md)

- `lumo task artifact add/update/list/show/rm` — record spec/plan products on a task
- `lumo task figma add/list/rm/refresh` — attach & manage Figma designs

### Projects & milestones — see [milestones.md](references/milestones.md)

- `lumo project list [--all]` — list projects + status (slugs feed `--project`; archived hidden unless `--all`) · `project create/update` — create / rename / re-own / dates; `update --status active|paused|canceled` is a human ruling (exit 4 envelope) · `project archive|unarchive` — paused/canceled/archived projects leave `status --next`; canceled/archived refuse `task create`
- `lumo milestone list/create/show/update/delete` — milestone CRUD (`show` includes Metrics + Sprint coverage); a milestone `<ref>` is its slug (the web URL segment, `list` SLUG column), name or id
- `lumo milestone archive/unarchive` · `milestone reorder/move` — soft-archive / restore · manual ordering
- `lumo milestone add/remove <ref> <task...>` — batch bind/unbind tasks
- `lumo milestone triage <ref> <task...> --claimable|--not-claimable` — steward batch claimable triage (feeds `lumo status --next --claimable`)
- `lumo milestone show <ref> --summary` — + AI retro · `--changelog [--json]` — + changelog from DONE tasks + merged PRs (no LLM); regenerate the retro with `milestone update <ref> --refresh-summary`
- `lumo milestone testcase …` — the close contract: the same command set as `task testcase` ([test-cases.md](references/test-cases.md))

### Documents — CRUD/sharing → [docs.md](references/docs.md); **editing live docs** → [doc-editing.md](references/doc-editing.md)

- `lumo doc create/update/show/list/delete` — document CRUD; `doc update` takes `--if-revision <n>` (structure-guarded), `--add-task/--remove-task` and `--add-member/--remove-member [--role]`; `doc show --members` lists shares
- `lumo doc show <doc> --raw` / `--section "<heading>"` — byte-identical markdown source (the only legal edit base; never the lossy render)
- `lumo doc patch <doc> --section "<heading>" …` — replace ONLY that section · `lumo doc append <doc> [--section "<heading>"] …` — pure insertion (safest for logs/ledgers)
- `lumo doc diff <doc> --file <local.md>` — server source vs a local file (guards stale uploads)
- `lumo doc rebuild-source <doc>` — regenerate the source from HTML (recovery for "no stored source")
- `lumo doc move` — reparent
- `lumo doc import --gdoc <url>` / `lumo doc sync` — Google Doc import & re-sync

### Sprints — see [sprints.md](references/sprints.md)

- `lumo sprint list/create/show/update/delete` — sprint CRUD (`show` includes Progress / Blockers / Burnup / Team performance)
- `lumo sprint start/close` — status transitions (no `--status` flag)
- `lumo sprint add/remove <id> <task>` — bind/unbind a task · `lumo sprint show <id> --summary` — + AI retro (`sprint update <id> --refresh-summary` regenerates)

### Memory — see [memory.md](references/memory.md)

- `lumo memory add|list [--scope task|project] [--task <id>] [--project <ref>]` — record/list Memory (TASK default, PROJECT); `memory list --learnings [--repo]` — PR-review learnings
- `lumo memory show <ref>` — one memory's full card (`<ref>` = 8-char short ref from listings / index lines; full id still works)
- `lumo memory update <ref> --scope project` / `lumo memory delete <ref> --confirm` — TASK→PROJECT / delete (exit 4 envelope)
- `lumo memory sync [--dry-run] [--clean]` / `lumo memory push [--dry-run]` — down/upsync team memory with the local Claude Code store
- `lumo memory fold [project-ref] --dry-run` — read-only preview of the daily topic-fold pass

### Sessions — see [sessions.md](references/sessions.md)

- `lumo session attach <id>` — bind this session to a task; prints blockers/security findings only — run `task show --full` next. **Lifetime lock**: same task = no-op; a _different_ task is refused (409) — start a new agent session. No `--force`, no `session detach`
- `lumo session attach --steward <milestone>` — STEWARD (governance) session on a milestone: plan & accept only (self-dispatch to in_progress refused; commits/PRs become milestone-scoped crossings, web+human disposition only); same lifetime lock
- `lumo session status` — current binding
- `lumo usage resync [--dry-run]` — correct inflated historical token numbers (writes when run; preview with `--dry-run` first)
- End-of-session housekeeping is automatic server-side (no command)

### Worktrees (local dev tooling) — see [worktree.md](references/worktree.md)

- `lumo worktree add <LUM-N> [slug]` — `.worktrees/<LUM-N>` off the remote default branch
- `lumo worktree rm <LUM-N> --confirm` — remove one (exit 4 envelope; dirty also needs `--force`)
- `lumo worktree prune --confirm` — remove DONE tasks' worktrees holding nothing unlanded (exit 4 envelope)
- `lumo worktree list` — task id, branch, dirty, node_modules link

## Reading list output

Every list prints its ref (`LUM-42`, `TC3`, a slug, `#13`) in column 1. Piped (how agents read it): one row per line, fields separated by a single TAB, no header row, nothing truncated — split on `\t`. On a terminal: aligned columns under an upper-case header, only the last free-text column cut with `…`. A paged list ends with `Showing a-b of n.` + `Next page: <command>` (always printed). See [tasks.md](references/tasks.md#paging-lum-1093--shared-by-task-list-task-show---history-task-show---comments-milestone-list-doc-list).

## JSON output

Every read-only command takes `--json`: one object on stdout, never a bare array, always with `version` (bumped only on a breaking change). Lists add `total` (`null` = unknown) and `nextCursor` (`null` = last page). Fields are only ever added; a field is removed only after a deprecation notice and a `version` bump. `task list --json --fields ref,title,status` selects fields. Errors stay on stderr (above).

## Global flags

`--project <ref>` (a project name or slug) and `--no-hints` are global: every command accepts them, before or after the command words (`lumo task list --project app`). Commands that resolve names in a project (tasks, docs, milestones, memory, test cases, `usage show --tasks`) use `--project`; the rest ignore it. There is no `-p` short form.

## Next-step hints

`task create/update`, `session attach`, `task show --full` and `status --next` end with a server-computed `Next:` block (≤3 suggestions, after the result line); `--no-hints` / `LUMO_NO_HINTS=1` silence it (and `status --next` / `task show --runs` trailing `Hint:` lines; the paging footer is data and always prints) — see [tasks.md](references/tasks.md#next-step-hints).

## Commands & flags that do NOT exist (common mistakes)

- No `lumo verify`, `lumo task criteria …`, `lumo criteria audit` or `lumo outcome rate` (removed in LUM-942) — and no `lumo verdict`, `lumo fidelity`, `lumo outcome record` (LUM-733). Evidence is `lumo task testcase`; milestone close contracts are `lumo milestone testcase` (no `lumo milestone criteria` — removed in LUM-1141)
- No subtasks / `--parent` (removed in LUM-959) — group with a milestone, order with `task dep add`, fold small follow-ups into the original task
- No `lumo session start` (it's `session attach`) and no `lumo session detach` — the binding is a lifetime lock; start a new agent session for a different task
- No steward role switch or un-steward — `session attach --steward` is the same lifetime lock; a steward session never converts to an implementation session (and there is no CLI path to clear its boundary crossings)
- No `lumo scan` / `lumo pr view` — a PR's scans are `lumo pr show <number>` (read) and `lumo pr review <number>` (request / pause; settings: `workspace security-scan show/update`); scanning local changes is `lumo security scan`; `lumo task pr show` is the task-scoped PR card
- No `lumo task artifact edit` (it's `update`), no `lumo auth status` (it's `lumo whoami`), no global `--verbose`
- No `--body` on `lumo task comment add` (body is positional); no `--content` on `memory add` (structured fields, see [memory.md](references/memory.md))
- Removed in LUM-1233 (they print `was removed. Use: …`, exit 2): `task context` → `task show --full` (`--full` → `--full --memory`), `task wrapup` → `task status`, `task comments list` / `history` / `scans` / `runs` / `lineage` / `deps list` and `outcome show` → `task show --comments` / `--history` / `--scans` / `--runs` / `--lineage` / `--deps` / `--outcome`; `task|milestone testcase rm` → `delete`; `milestone testcase <verb> <milestone> <case>` → `<milestone>/TC<n>`; `task memory` / `project memory` → `memory add|list [--scope project]`, `memory promote` → `memory update --scope project`, `memory rm` → `memory delete`, `workspace learnings` → `memory list --learnings`; `doc bind/unbind` → `doc update --add-task/--remove-task`, `doc share/unshare` → `doc update --add-member/--remove-member`, `doc share-list` → `doc show --members`, `doc import-gdoc` → `doc import --gdoc`; `pr scan` → `pr show` (read) / `pr review` (`--review incremental` → default, `--review full` → `--full`, `--pause`, `--resume`); `cost` → `usage show`, `report` → `usage show --by member --tasks`, `usage resync --apply` → `usage resync` (it writes by default; `--dry-run` previews); `inbox list` / `draft list` / `next` → `status --inbox` / `--drafts` / `--next` (`--count` → `--limit`), `priority <text>` → `priority create <text>` (no prompt); `init` / `skill update --user|--project` → `--scope user|project`, `setup` → `init`, `task list -p` → `--project`, `--yes` → `--confirm` (every command), `doc rebuild-source --force` → `--confirm`; 3j renames: `task comment <task> <body>` → `task comment add <body> --task <task>`, `task comments edit/rm` → `task comment update/delete`, `task deps *` → `task dep *` (`rm` → `remove`), `task artifact rm` / `task template rm` → `delete`, `task template edit` → `update`, `task figma rm/context` → `remove/show`, `project overview` → `project show`, `milestone summary` / `changelog` / `sprint summary` → `show --summary` / `--changelog` (`--retry` → `update --refresh-summary`), `workspace security-scan [--setting …]` → `security-scan show` / `update`
- `lumo task update LUM-N --status done` is one direct call — don't walk `in_progress → in_review → done` ([tasks.md](references/tasks.md)); no prompt, no `--yes`
- No interactive yes/no prompts and no `--yes` anywhere (removed in LUM-1233) — gated mutations exit 4 with a `confirmation_required` envelope; approval is `--confirm` only

## Core workflow

**Starting fresh** — user says "help me with LUM-42":

1. `lumo session attach LUM-42` — bind this session (lifetime lock; one session = one task)
2. `lumo task show LUM-42 --full` — load background; review unresolved items, PR-review todos, the description
3. Do the work
4. **Before claiming done: run the real checks and record them** — tests/tsc/the actual path, then `lumo task testcase add/run` with evidence ([test-cases.md](references/test-cases.md))
5. **Near the end: `lumo task status`** — what still blocks DONE; when READY it also shows what DONE would change and the one command to run ([task-status.md](references/task-status.md))

**Resuming / after a review bounce** — `lumo task status` **before** re-reading code or planning: it tells you what still stands between the task and DONE. A bounce means **fix in place — do not spin off a new task.**

**Git-suggest at start:** when unbound, session-start may print `Detected LUM-N … Run lumo session attach LUM-N to bind.` — it **never** binds. Confirm, then attach yourself ([sessions.md](references/sessions.md)).

### Golden rules (most-violated)

- **Attach before coding.** Unattached work is attributed by inference and counts toward gates and cost; explicit attach is highest-priority.
- **Evidence before "done".** Never claim done from reading code — run the checks and record a test-case run. While a PR is open, the task is IN_REVIEW, not DONE.
- **DONE is the user's call** — `--status done` exits 4 for their approval unless its one-step condition holds; blocking crossings, blocking security findings and proven test-case defects refuse it with 409. **CANCELED is only the user's call** — `--status canceled` always exits 4; propose it, never use it to drop hard work.
- **Exit code 4 = the user must confirm — you may not.** A gated mutation (`--status done` short of its one-step condition, `--status canceled`, `sprint/milestone/doc/memory delete`, `task dep remove`, `task artifact delete`, `sprint close --move-all/--backlog-all`, `worktree rm`, `uninstall`, `doc rebuild-source` on an existing source, `finding disposition`) run without `--confirm` prints a `confirmation_required` envelope and does nothing. Show every line of its `changes` to the user, wait for explicit approval, then run its `confirmCommand` verbatim. **Never add `--confirm` (or `--yes` / `--force`) yourself** — the flag means "the user has confirmed". **Exit code 5 = blocked by a human-only gate** (`DONE_BLOCKED`: an undispositioned crossing, a blocking security finding, a proven test-case defect): relay its `blockers` and `remediation`; nothing on `task update` clears it — no retry, no flag. The terminal path is the user's ruling — `crossing disposition` / `finding disposition` / `task testcase disposition`. Details: [confirmation.md](references/confirmation.md)
- **Exit codes:** 0 ok · 1 failed (not found, auth, server, network) · **2 usage error** (unknown flag, missing/extra argument, invalid flag value — fix the command; nothing ran) · 4 confirm · 5 blocked. Errors are `Error:` + `Hint:` (+ `Usage:` for 2) on stderr; with `--json`, one `{"error":{code,message,hint,exitCode}}` object on stderr. Lumo's 4 is not gh's 4 — see [confirmation.md](references/confirmation.md#exit-codes).
- **Read the reference before composing a command** whose flags/edge-cases matter — don't run from memory.
