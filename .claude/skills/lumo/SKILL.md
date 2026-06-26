---
name: lumo
description: 'Use when the user mentions a Lumo task id (LUM-N, or any team prefix like SPEC-12) or the `lumo` CLI, in any language; is starting, resuming, or about to claim completion of a task; asks what to work on next; or works with any Lumo resource — task context, sessions, acceptance criteria, machine verification, tasks, projects, milestones, sprints, docs, artifacts, Figma links, dependencies, team memory, or worktrees. Key triggers: "LUM-", "lumo", "task context", "session attach", "verify", "task status", "acceptance criteria", "what should I work on", "resume task".'
---

## Prerequisites

Before running any `lumo` command, verify the CLI is available and authenticated:

```bash
which lumo && lumo whoami
```

- If `lumo` is not found: tell the user to install it (`npm install -g @lumoai/cli`; for monorepo dev, `cd cli && npm install && npm link` also works)
- If `lumo whoami` fails with an auth error: tell the user to run `lumo auth login`
- Do NOT proceed with any lumo commands until both checks pass

## How this skill is organized

**Starting, resuming, or finishing work on a task? Read [Core workflow](#core-workflow) at the bottom first** — it's the happy path (attach → context → criteria → work → verify) and the recurring traps. The catalog is a lookup table, not the starting point.

The command catalog below is a **map**: it lists every command grouped by domain with a one-line summary. **Detailed flags, examples, output formats, and "when to suggest" guidance live in the `references/` files** — when a user request lands in a domain, **Read the matching reference file before composing the command**. Don't run a command from memory if its flags/edge-cases matter; open the reference first.

| Domain                                                                                  | Read this reference                                            |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `setup`, `auth login/logout`, `whoami`, `update`                                        | [references/onboarding.md](references/onboarding.md)           |
| `task context`, retrieval (`slack/web/figma context`, `comments list`, `pr show`)       | [references/task-context.md](references/task-context.md)       |
| `task create/update/list/show/comment`, `next`                                          | [references/tasks.md](references/tasks.md)                     |
| `task deps add/list/confirm/dismiss/rm` (dependency edges)                              | [references/task-deps.md](references/task-deps.md)             |
| `task artifact*`, `task figma*`                                                         | [references/artifacts-figma.md](references/artifacts-figma.md) |
| `task criteria set/list`, drafting the acceptance contract                              | [references/criteria.md](references/criteria.md)               |
| `verify`, `task status` — machine verification loop, claim-done flow, self-check/resume | [references/verify.md](references/verify.md)                   |
| `cost` — per-operation (per-tool) token cost read-out; `task lineage` Top-5             | [references/task-context.md](references/task-context.md)       |
| `outcome show/record` — post-hoc outcome well (falsifier oracle, rejection-only)        | [references/outcome.md](references/outcome.md)                 |
| `project list`, `milestone*`                                                            | [references/milestones.md](references/milestones.md)           |
| `doc create/update/list/move/bind/share/import` (CRUD)                                  | [references/docs.md](references/docs.md)                       |
| `doc show --raw/--section`, `doc patch/append/diff/rebuild-source` (editing live docs)  | [references/doc-editing.md](references/doc-editing.md)         |
| `sprint*`                                                                               | [references/sprints.md](references/sprints.md)                 |
| `task/project memory`, `memory promote/rm`                                              | [references/memory.md](references/memory.md)                   |
| `session attach/status`, git-suggest on start, Layer-2 review                           | [references/sessions.md](references/sessions.md)               |
| `worktree add/rm/list` (local dev tooling)                                              | [references/worktree.md](references/worktree.md)               |

## Command catalog

**Onboarding / auth / update** — see [onboarding.md](references/onboarding.md)

- `lumo setup [--user|--project] [--force] [--agent <token>]` — install skill files + hooks
- `lumo auth login` / `lumo auth logout` — paste an API key / clear credentials
- `lumo whoami` — show current identity (email, workspace, key)
- `lumo update` — upgrade the CLI to the latest npm release

**Task context & retrieval** — see [task-context.md](references/task-context.md)

- `lumo task context <id>` — load task background (memory, source cards, PR review todos, prior sessions)
- `lumo task slack show <id> <contextId>` — full stored Slack thread
- `lumo task web show <id> <linkId>` — fetched web link body
- `lumo task figma context <id> <linkId>` — Figma link metadata (v1)
- `lumo task comments list <id>` — comment thread, capped to the output budget (`--full` prints every comment; read-only; ≠ `task comment`)
- `lumo task pr show <id> <number>` — synced PR metadata (v1)
- `lumo task lineage <id>` — read-only causal-trail audit: fragments that fed the task + each one's disclosure tag/outcome, the run's token/loop cost, a disclosure-funnel summary, and a Top-5 "operations by token cost"; `--signal` appends workspace-level usage signal-health (see [task-context.md](references/task-context.md))

**Tasks** — see [tasks.md](references/tasks.md)

- `lumo task create <title> [flags]` — create a task. **Mid-task** (your session is bound to an in-flight task) it requires `--rework-of <id>` (redirects you to fix the existing task — creates nothing) or `--new-scope` (genuinely new, out-of-scope work). On a send-back, fix in place / amend the contract instead of spinning off a new task — see [verify.md](references/verify.md) and [criteria.md](references/criteria.md).
- `lumo task update <id> [flags]` — patch status/title/priority/assignee/milestone/sprint/tags
- `lumo task list [flags]` — list tasks assigned to you
- `lumo next [--count N]` — recommend the next task to work on (read-only)
- `lumo task show <id>` — print one task's detail
- `lumo task comment <id> <body>` — leave a comment

**Task dependencies** — see [task-deps.md](references/task-deps.md)

- `lumo task deps list <id>` — list dependency edges both directions, grouped CONFIRMED / SUGGESTED / DISMISSED (each row: short edge id + other task + detected evidence)
- `lumo task deps add <id> --blocked-by <LUM-N>` — declare a manual hard dependency (CONFIRMED)
- `lumo task deps confirm <id> <edge> [--reverse]` — confirm a detected candidate (`--reverse` flips direction)
- `lumo task deps dismiss <id> <edge>` — dismiss a candidate (never re-suggested)
- `lumo task deps rm <id> <edge> --yes` — delete an edge (refuses without `--yes`)
- `<edge>` = short edge-id prefix (≥6 chars) or the other task's identifier; ambiguous/unknown selectors list candidates and exit 1. See [tasks.md](references/tasks.md)

**Acceptance criteria (contract)** — see [criteria.md](references/criteria.md)

- `lumo task criteria set <task> --file <criteria.json> [--human] [--cause <tag>]` — submit the whole contract (full-group replace). Default = agent draft (AGENT_DRAFT, editable until DONE); `--human` = a HUMAN_EDIT revision transcribed from the conversation; `--cause` annotates why the contract drifted. See [criteria.md](references/criteria.md)
- `lumo task criteria list <task>` — print the contract (id, MACHINE/HUMAN, provenance source@round, checkpointer)

**Verification (machine acceptance loop)** — see [verify.md](references/verify.md)

- `lumo verify [task] --note "<self-report>" [--timeout <seconds>]` — run every MACHINE criterion's checkpointer locally and report a structured PASS/FAIL verdict per criterion. **`--note` is required** when a round will be posted: a one-line self-report ("我改了 X,因为 Y 可验收") frozen as your task's claim (source AGENT) the moment the round passes into IN_REVIEW, then checked against the diff for faithfulness. No note → no round posted (none burned). Round cap 3: all-pass → task to IN_REVIEW (agent stops); round-3 fail → escalate to human. **Run this before claiming a task is done.**
- `lumo task status [task] [--json]` — read-only acceptance self-check (no LLM): the contract with each criterion's latest verdict, verification history/round, last failure reasons, `nextActions` (the unmet criteria), and any OPEN boundary crossings (fails closed — `null`/`⚠` means "could not confirm", not safe). **Run it first when resuming a task or after a round was rejected.**
- `lumo verdict [task] --pass | --fail` — acceptance verdicts. `--pass` deep-links to the human verdict bar (records nothing). `--fail --reason <enum> …` records an AGENT send-back → IN_PROGRESS. **An unresolved send-back blocks the DONE transition with 409.**
- `lumo crossing explain <id> --note "<text>"` — append an agent self-explanation ("申辩") to a boundary crossing; append-only, **never clears the crossing or unblocks Done** (disposition stays web + human-only). A review aid, not a self-clear.

**Cost (per-operation token read-out)** — see [task-context.md](references/task-context.md)

- `lumo cost [--task <id>|--session <id>|--since <date>] [--by tool|model|member|session] [--json]` — per-operation token cost read-out, attributing each model step's token delta to the tool(s) it ran. Scope is mutually exclusive (default = workspace last-30-days). For the per-task Top-5 inline, see `lumo task lineage`.

**Criteria audit** — workspace-level referent-kind analytics

- `lumo criteria audit` — workspace-level read-out: count of acceptance criteria by effective referent kind (EXTERNAL_FACT / AGENT_CONSTRUCTED_STATE / PENDING_OUTCOME / UNVERIFIED_ASSERTION / UNCLASSIFIED) + the self-confirming-green ratio

**Outcome well (post-hoc oracle)** — see [outcome.md](references/outcome.md)

- `lumo outcome show <task>` — read the post-hoc outcome well: the **falsifier** verdict (`REJECTED` | `INCONCLUSIVE` — never a "pass") plus its backing rejection signals. `INCONCLUSIVE` = no rejection on record, **not** "satisfied".
- `lumo outcome record <task> --note "<what reality did>" [--kind <kind>]` — record a human-observed post-hoc **rejection** of a delivery (revert / rollback / CI regression / downstream redirect / bypass). Append-only; **there is no "mark satisfied" counterpart** — the well only asserts rejection. `--note` is required (the observed referent).

**Artifacts & Figma** — see [artifacts-figma.md](references/artifacts-figma.md)

- `lumo task artifact add/update/list/show/rm` — record spec/plan products on a task
- `lumo task figma add/list/rm/refresh` — attach & manage Figma designs

**Projects & milestones** — see [milestones.md](references/milestones.md)

- `lumo project list` — list projects (slugs feed `--project`)
- `lumo milestone list/create/show/update/delete` — milestone CRUD (`show` includes a Sprint-coverage section)
- `lumo milestone archive/unarchive` — soft-archive / restore
- `lumo milestone add/remove <id> <task...>` — batch bind/unbind tasks
- `lumo milestone summary [--retry]` — AI retro
- `lumo milestone reorder/move` — manual ordering

**Documents** — CRUD/sharing → [docs.md](references/docs.md); **editing live docs** (raw/section/patch/append/diff/rebuild) → [doc-editing.md](references/doc-editing.md)

- `lumo doc create/update/show/list/delete` — document CRUD; `doc update` takes `--if-revision <n>` (mismatch → 409, re-read and retry) and is structure-guarded (drops to tables/rows/headings → 422 unless `--allow-shrink`)
- `lumo doc show <doc> --raw` / `--section "<heading>"` — print the byte-identical markdown source (the only legal edit base; never the lossy HTML→md render), whole or one heading-addressed slice
- `lumo doc patch <doc> --section "<heading>" …` — replace ONLY that section; everything else untouched; concurrent edits 409; structure-guarded
- `lumo doc append <doc> [--section "<heading>"] …` — pure insertion at section/doc end — the safest write for logs/ledgers
- `lumo doc diff <doc> --file <local.md>` — compare server markdown source vs a local file (guards stale uploads)
- `lumo doc rebuild-source <doc>` — regenerate `sourceMarkdown` from the HTML body (recovery when raw/section/patch errors "no stored source")
- `lumo doc move/bind/unbind/share/unshare/share-list` — reparent · task linkage · member sharing
- `lumo doc import-gdoc` / `lumo doc sync` — Google Doc import & re-sync

**Sprints** — see [sprints.md](references/sprints.md)

- `lumo sprint list/create/show/update/delete` — sprint CRUD (`show` includes Progress / Health / Blockers)
- `lumo sprint start/close` — status transitions (no `--status` flag)
- `lumo sprint add/remove <id> <task>` — bind/unbind a task
- `lumo sprint summary [--retry]` — AI retro

**Memory** — see [memory.md](references/memory.md)

- `lumo task memory add/list` · `lumo project memory add/list` — record/curate Memory (TASK vs PROJECT)
- `lumo memory show <id>` — show one memory's full card (category + content) by id (progressive disclosure from a one-line index entry)
- `lumo memory promote <id>` / `lumo memory rm <id> --yes` — TASK→PROJECT / delete
- `lumo memory sync [--dry-run] [--clean]` — downsync team memory into the local Claude Code store (`team/<id>.md` + a managed MEMORY.md block); only touches files it owns
- `lumo memory push [--dry-run]` — upsync locally-authored memories from `<memory-dir>/outbox/*.json` to the team
- `lumo memory fold [project-ref] --dry-run` — read-only PREVIEW of the autonomous topic-fold pass (folding runs via a daily cron; no manual apply, no `unfold`). See [memory.md](references/memory.md)

**Sessions** — see [sessions.md](references/sessions.md)

- `lumo session attach <id>` — bind this session to a task (then run `task context`). **Lifetime lock**: re-attaching to the same task is a no-op; attaching to a _different_ task is refused with 409 — start a new Claude Code session instead. No `--force`, no `session detach`.
- `lumo session status` — show current binding
- End-of-session housekeeping is fully automatic (no command). On DONE the server runs three best-effort silent passes: Layer-1 memory curation, fragment-usage audit, and blocked-tag automation. See [sessions.md](references/sessions.md)
- Git-suggest at session start (suggests `session attach`, never auto-binds) + Layer-2 project-memory review — see the reference

**Worktrees (local dev tooling)** — see [worktree.md](references/worktree.md)

- `lumo worktree add <LUM-N> [slug]` — scaffold `.worktrees/<LUM-N>` + node_modules symlink off origin/main; run from the main checkout
- `lumo worktree rm <LUM-N> --yes` — remove a worktree (keeps the branch unless `--delete-branch`)
- `lumo worktree list` — list `.worktrees/` worktrees (task id, branch, dirty, node_modules link)

## Criteria audit

`lumo criteria audit` — workspace-level acceptance-criteria analytics. Calls `GET /api/criteria/audit` and prints two things:

1. **Declared-kind distribution** — count of criteria by effective referent kind:
   - `EXTERNAL_FACT` — declared as externally observable (git SHA, CI status, DB row) and the checkpointer invokes real external tooling
   - `AGENT_CONSTRUCTED_STATE` — passes by checking output the agent itself produced
   - `PENDING_OUTCOME` — deferred to post-hoc falsifier
   - `UNVERIFIED_ASSERTION` — declared `EXTERNAL_FACT` but the checkpointer does **not** actually invoke external tooling (git/CI/HTTP); downgraded by the audit
   - `UNCLASSIFIED` — legacy rows predating the `referentKind` field (null in DB)

2. **Self-confirming-green headline ratio** — `(AGENT_CONSTRUCTED_STATE + UNVERIFIED_ASSERTION) / classified`. Criteria in these two buckets pass by confirming only the agent's own work, not an independent external state.

**When to suggest**: when the user wants to audit how much of the workspace's "green" criteria are self-confirming vs externally anchored; when diagnosing whether acceptance criteria have real external hooks or are circular.

## Commands & flags that do NOT exist (common mistakes)

Don't guess these:

- No `lumo session start` — binding is `lumo session attach <LUM-N>`
- No `lumo session detach` — the session↔task binding is a lifetime lock; to work on a different task, start a new Claude Code session
- No `lumo task delete` — tasks can't be deleted from the CLI (web UI only)
- No `lumo task artifact edit` — it's `lumo task artifact update`
- No `lumo auth status` — identity check is `lumo whoami`
- No `--body` on `lumo task comment` — the body is a positional arg: `lumo task comment LUM-N "text"`
- No `--content` on `task/project memory add` — memory is structured fields (`--category` + per-category flags), see [memory.md](references/memory.md)
- No global `--verbose` flag on any command
- `lumo task comments list` (plural) **reads** the thread; `lumo task comment` (singular) **writes** one
- Status updates: `lumo task update LUM-N --status done` is one direct call — do **not** walk `in_progress → in_review → done` step by step (see [tasks.md](references/tasks.md) for the transition matrix; under the verify flow you shouldn't be setting `in_review`/`done` yourself at all)

## Core workflow

**Starting fresh** — user says "help me with LUM-42":

1. `lumo session attach LUM-42` — bind this session (the binding is a lifetime lock; one session = one task)
2. `lumo task context LUM-42` — load background; review unresolved items, PR-review todos, the description
3. **If the task has no acceptance criteria** (context shows the draft reminder, not a contract): draft outcome-level criteria sized to the task (3–7 for a typical multi-file task; 1–2 for a micro task) and submit them with `lumo task criteria set` **before writing the first line of code** — see [criteria.md](references/criteria.md)
4. Do the work
5. **Before claiming done: `lumo verify`** — the machine half of the acceptance loop. Fix failures and re-run (round cap 3). All-pass → task moves to IN_REVIEW and you stop. See [verify.md](references/verify.md)

**Resuming / after a send-back** — `lumo task status` **before** re-reading code or planning. It tells you where the loop stands (round, what passed, what's unmet and why, any REVIEW_ADDED criteria from review) so you don't redo finished work or miss why it bounced. A send-back means **fix in place / amend the contract — do not spin off a new task.** See [verify.md](references/verify.md)

**Git-suggest at start:** when unbound, session-start may infer the task from the git branch / recent commits (any team prefix, e.g. `SPEC-12`) and print `Detected LUM-N … Run lumo session attach LUM-N to bind.` — **without** binding. Confirm it's right, then attach yourself. See [sessions.md](references/sessions.md)

### Golden rules (most-violated)

- **Attach + draft criteria before coding.** Skipping attach triggers `SESSION_BINDING_MISSING`; skipping criteria means verification has nothing to check.
- **Evidence before "done".** Never claim done from reading code — run `lumo verify`. While a PR is open, the task is IN_REVIEW, not DONE.
- **Never set DONE yourself after a verify loop** — that adjudication is human-only. An unresolved send-back blocks the DONE transition with 409.
- **Status updates are one direct call** (`task update --status done`), not a step-by-step walk through `in_progress → in_review → done`.
- **Read the reference before composing a command** whose flags/edge-cases matter — don't run from memory.
