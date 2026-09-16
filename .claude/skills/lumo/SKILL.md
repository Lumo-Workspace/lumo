---
name: lumo
description: 'Use when the user mentions a Lumo task id (LUM-N, or any team prefix like SPEC-12) or the `lumo` CLI, in any language; is starting, resuming, or about to claim completion of a task; asks what to work on next; or works with any Lumo resource — task context, sessions, acceptance criteria, machine verification, tasks, ideas, plan runs (the idea→plan converter), projects, milestones, sprints, docs, artifacts, Figma links, dependencies, team memory, priorities, PR security scans, or worktrees. Key triggers: "LUM-", "lumo", "task context", "session attach", "verify", "task status", "acceptance criteria", "what should I work on", "resume task".'
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
| `pr scan <number>` — one PR's security scans by number (layers, findings, hunt detail)  | [references/pr-scan.md](references/pr-scan.md)                 |
| `task create/update/list/show/comment`, `next`                                          | [references/tasks.md](references/tasks.md)                     |
| `task deps add/list/confirm/dismiss/rm` (dependency edges)                              | [references/task-deps.md](references/task-deps.md)             |
| `idea*` — capture pool, lifecycle, evidence, comments                                   | [references/ideas.md](references/ideas.md)                     |
| `plan`, `plan status` — the idea→plan converter run                                     | [references/plan-runs.md](references/plan-runs.md)             |
| `initiative create/list` (`LUM-INIT-<n>`)                                               | [references/initiatives.md](references/initiatives.md)         |
| `task artifact*`, `task figma*`                                                         | [references/artifacts-figma.md](references/artifacts-figma.md) |
| `task criteria set/list/confirm`, drafting the acceptance contract                      | [references/criteria.md](references/criteria.md)               |
| `verify`, `task status` — machine verification loop, claim-done flow, self-check/resume | [references/verify.md](references/verify.md)                   |
| `cost` — per-operation (per-tool) token cost read-out; `task lineage` Top-5             | [references/task-context.md](references/task-context.md)       |
| `outcome show/rate` — post-hoc outcome well (falsifier oracle, rejection-only)          | [references/outcome.md](references/outcome.md)                 |
| `priority [text]`, `priority list` — team priority declaration (append-only)            | [references/priority.md](references/priority.md)               |
| `project list`, `milestone*`                                                            | [references/milestones.md](references/milestones.md)           |
| `doc create/update/list/move/bind/share/import` (CRUD)                                  | [references/docs.md](references/docs.md)                       |
| `doc show --raw/--section`, `doc patch/append/diff/rebuild-source` (editing live docs)  | [references/doc-editing.md](references/doc-editing.md)         |
| `sprint*`                                                                               | [references/sprints.md](references/sprints.md)                 |
| `task/project memory`, `memory promote/rm`                                              | [references/memory.md](references/memory.md)                   |
| `session attach/status`, git-suggest on start, Layer-2 review                           | [references/sessions.md](references/sessions.md)               |
| `worktree add/rm/list` (local dev tooling)                                              | [references/worktree.md](references/worktree.md)               |
| `--confirm` / exit code 4 — the confirmation envelope every gated mutation speaks       | [references/confirmation.md](references/confirmation.md)       |

## Command catalog

### Onboarding / auth / update — see [onboarding.md](references/onboarding.md)

- `lumo setup [--user|--project] [--force] [--agent <token>]` — install skill files + hooks
- `lumo auth login` / `lumo auth logout` — paste an API key / clear credentials
- `lumo whoami` — show current identity (email, workspace, key)
- `lumo update` — upgrade the CLI to the latest npm release

### Task context & retrieval — see [task-context.md](references/task-context.md)

- `lumo task context <id>` — load task background (memory, source cards, PR review todos, prior sessions)
- `lumo task slack show <id> <contextId>` — full stored Slack thread
- `lumo task web show <id> <linkId>` — fetched web link body
- `lumo task figma context <id> <linkId>` — Figma link metadata (v1)
- `lumo task comments list <id>` — comment thread, capped to the output budget (`--full` prints every comment; read-only; ≠ `task comment`)
- `lumo task pr show <id> <number>` — synced PR metadata (v1)
- `lumo task lineage <id>` — read-only causal-trail audit: fragments that fed the task + each one's disclosure tag/outcome, the run's token/loop cost, a disclosure-funnel summary, and a Top-5 "operations by token cost"; `--signal` appends workspace-level usage signal-health (see [task-context.md](references/task-context.md))

### Pull requests by number — see [pr-scan.md](references/pr-scan.md)

- `lumo pr scan <number> [--repo owner/repo] [--all] [--full] [--json]` — one PR's security scans by number, linked to a task or not: layer line (same labels as `task status`), every finding incl. dispositioned ones + their source, hunt coverage; `--full` per-task hunt detail, `--all` every head. Read-only.

### Tasks — see [tasks.md](references/tasks.md)

- `lumo task create <title> [flags]` — create a task. **Mid-task** (your session is bound to an in-flight task) it requires `--rework-of <id>` (redirects you to fix the existing task — creates nothing) or `--new-scope` (genuinely new, out-of-scope work). On a send-back, fix in place / amend the contract instead of spinning off a new task — see [verify.md](references/verify.md) and [criteria.md](references/criteria.md).
- `lumo task update <id> [flags]` — patch status/title/priority/assignee/milestone/sprint/tags; `--claimable`/`--not-claimable` set the agent-claimable marker (LUM-646). `--status done` without `--confirm` exits 4 with a confirmation envelope (see [confirmation.md](references/confirmation.md))
- `lumo task list [flags]` — list tasks assigned to you
- `lumo next [--count N] [--claimable]` — recommend the next task to work on (read-only). `--claimable` restricts to the autonomy boundary: only tasks that are claimable ∩ unblocked (F3 topology) ∩ within milestone budget (F2); old server degrades gracefully to the standard ranking (LUM-646)
- `lumo task show <id>` — print one task's detail
- `lumo task comment <id> <body>` — leave a comment

### Ideas (team-level capture pool) — see [ideas.md](references/ideas.md)

- `lumo idea "<statement>" [--context <text>]` — capture an un-triaged spark into the team pool (<10s); prints an **I-prefixed** id (`LUM-I42`) that cannot collide with task ids
- `lumo idea list` — the whole pool newest-first (every status); also browsable at `/workspace/<slug>/ideas`
- `lumo idea update <id> --status <captured|developing|planned|dropped>` — manual lifecycle move; `CAPTURED→PLANNED` is converter-only
- `lumo idea slack|web|figma …` — attach & inspect evidence on an idea, mirroring the task-side source cards
- `lumo idea comment <id> <body>` · `lumo idea comments list <id> [--full]` — flat comment thread on an idea

### Plan runs (design-thinking 转换器) — see [plan-runs.md](references/plan-runs.md)

- `lumo plan [--abandon-active]` — start a converter run (聚类→对齐→成计划) over the captured pool + current priority; one active run per team; prints the gate-A web deep-link
- `lumo plan status` — the active run's stage plus the deep-link to its next gate. Gate work is **web-only**

### Initiatives (team-level, `LUM-INIT-<n>`) — see [initiatives.md](references/initiatives.md)

- `lumo initiative create "<goal>" [--assumption <text>]` — create directly, no plan run required
- `lumo initiative list` — team initiatives newest-first; lineage browsable in web

### Task dependencies — see [task-deps.md](references/task-deps.md)

- `lumo task deps list <id>` — list dependency edges both directions, grouped CONFIRMED / SUGGESTED / DISMISSED (each row: short edge id + other task + detected evidence)
- `lumo task deps add <id> --blocked-by <LUM-N>` — declare a manual hard dependency (CONFIRMED)
- `lumo task deps confirm <id> <edge> [--reverse]` — confirm a detected candidate (`--reverse` flips direction)
- `lumo task deps dismiss <id> <edge>` — dismiss a candidate (never re-suggested)
- `lumo task deps rm <id> <edge> --confirm` — delete an edge (without `--confirm`: exit 4 + confirmation envelope; `--yes` is a legacy alias)
- `<edge>` = short edge-id prefix (≥6 chars) or the other task's identifier; ambiguous/unknown selectors list candidates and exit 1. See [tasks.md](references/tasks.md)

### Acceptance criteria (contract) — see [criteria.md](references/criteria.md)

- `lumo task criteria set <task> --file <criteria.json> [--human] [--cause <tag>]` — submit the whole contract (full-group replace). Default = agent draft (AGENT_DRAFT, editable until DONE); `--human` = a HUMAN_EDIT revision transcribed from the conversation; `--cause` annotates why the contract drifted. See [criteria.md](references/criteria.md)
- `lumo task criteria list <task>` — print the contract (id, MACHINE/HUMAN, provenance source@round, checkpointer)
- `lumo task criteria confirm <task> [--confirm]` — record the **user's** confirmation of the contract; without `--confirm` it exits 4 with an envelope listing every criterion (writes nothing). Never blocks DONE. See [criteria.md](references/criteria.md)

### Verification (machine acceptance loop) — see [verify.md](references/verify.md)

- `lumo verify [task] [--note "<self-report>"] [--timeout <seconds>]` — run every MACHINE criterion's checkpointer locally and report a structured PASS/FAIL verdict per criterion. `--note` is an optional one-line self-report ("我改了 X,因为 Y 可验收"), frozen as the task's claim (source AGENT) when the round passes into IN_REVIEW. The round cap is the workspace's `verificationMaxRounds` (default 3) — read the actual budget off the `Round N/M` line the command prints, never assume a number. All-pass → task to IN_REVIEW (agent stops); a fail on the last round → escalate to human. **Run this before claiming a task is done.**
- `lumo task status [task] [--full] [--json]` — read-only acceptance self-check (no LLM): the contract with each criterion's latest verdict, the current round, last failure reasons, `nextActions` (the unmet criteria, plus any undispositioned PR **security findings** as `SECURITY_FINDING` entries — `blocks DONE` vs `advisory`), a per-linked-PR **scan status line** (stage states incl. the L3 `hunt` layer, external-finding count, partial flag, external failure reason — LUM-735/739) plus the hunt's per-category coverage line (LUM-762), and any OPEN boundary crossings; `--full` adds the dashboard sections (verification rollup, history, cost, struggle trail, trend) (fails closed — `null`/`⚠` means "could not confirm", not safe). **Run it first when resuming a task or after a round was rejected.**
- `lumo crossing explain <id> --note "<text>"` — append an agent self-explanation ("申辩") to a boundary crossing; append-only, **never clears the crossing or unblocks Done**. A review aid, not a self-clear.
- `lumo crossing disposition <id> --false-positive | --confirmed [--note "<text>"] [--task <LUM-N>]` — record the **user's** ruling on a task crossing through a **three-step** confirmation handshake the server enforces (LUM-769): (1) no step flag — prints the crossing (severity, detail, recurrence, your explanations) as an exit-4 envelope with a stage-1 **read receipt**, writes nothing; relay it and ask the user to confirm they have **read** it, then run its `confirmCommand` (`--receipt <r1> --confirm-read`); (2) that prints a second exit-4 envelope for the ruling with the stage-2 receipt; relay it and ask the user to **approve**, then run its `confirmCommand` (`--receipt <r2> --confirm`); (3) the write. Confirming the ruling before the read is acknowledged is refused and told to confirm the read first; never supply either step flag yourself. Either ruling clears that crossing's block on DONE and is audited as a CLI-channel disposition. Reverting to OPEN, repository suppression rules and steward (milestone) crossings stay web-only. See [verify.md](references/verify.md)

### Cost (per-operation token read-out) — see [task-context.md](references/task-context.md)

- `lumo cost [--task <id>|--session <id>|--since <date>] [--by tool|model|member|session] [--json]` — per-operation token cost read-out, attributing each model step's token delta to the tool(s) it ran. Scope is mutually exclusive (default = workspace last-30-days). For the per-task Top-5 inline, see `lumo task lineage`.

### Priority (team-level declaration) — see [priority.md](references/priority.md)

- `lumo priority [text]` — declare the team's current priority (a 1-3 sentence plain-text statement). With `text`, records it directly; with no argument, prompts interactively. **Append-only**: a new declaration supersedes the old by a later `effectiveFrom` — nothing is ever overwritten or deleted.
- `lumo priority list` — print the append history newest-first (the current declaration is marked `*`).

### Criteria audit — see [criteria.md](references/criteria.md)

- `lumo criteria audit` — workspace-level read-out: count of acceptance criteria by effective referent kind (EXTERNAL_FACT / AGENT_CONSTRUCTED_STATE / PENDING_OUTCOME / UNVERIFIED_ASSERTION / UNCLASSIFIED) + the self-confirming-green ratio

### Outcome well (post-hoc oracle) — see [outcome.md](references/outcome.md)

- `lumo outcome show <task>` — read the post-hoc outcome well: the **falsifier** verdict (`REJECTED` | `INCONCLUSIVE` — never a "pass") plus its backing rejection signals. `INCONCLUSIVE` = no rejection on record, **not** "satisfied".
- `lumo outcome rate [--min N] [--json]` — workspace **trust × post-hoc-fate** join (LUM-603, LUM-606): per delivery-time **verification-friction** bucket (`no-verification` / `single-round` / `multi-round-or-sendback` — two raw counts frozen at delivery, replacing the saturating forecast-confidence axis), the post-hoc REJECTED rate from the well. Honest by construction — thin buckets read `insufficient` (no fabricated rate), the single-round-vs-multi comparison stays `inconclusive` until CIs separate, and the rate is a **lower bound** (no signal = INCONCLUSIVE, never satisfied). Bucket names are value-neutral — direction is decided by the correlation, never welded into the label. Under-sampled today by design — the skeleton produces real strata once the well fills.

### Artifacts & Figma — see [artifacts-figma.md](references/artifacts-figma.md)

- `lumo task artifact add/update/list/show/rm` — record spec/plan products on a task
- `lumo task figma add/list/rm/refresh` — attach & manage Figma designs

### Projects & milestones — see [milestones.md](references/milestones.md)

- `lumo project list` — list projects (slugs feed `--project`)
- `lumo milestone list/create/show/update/delete` — milestone CRUD (`show` includes a Sprint-coverage section)
- `lumo milestone archive/unarchive` — soft-archive / restore
- `lumo milestone add/remove <id> <task...>` — batch bind/unbind tasks
- `lumo milestone triage <id> <task...> --claimable|--not-claimable` — steward batch agent-claimable triage (LUM-646): mark in-milestone tasks (not) claimable; tasks not in the milestone are skipped. Feeds `lumo next --claimable`
- `lumo milestone summary [--retry]` — AI retro
- `lumo milestone changelog <id> [--json]` — structured changelog from DONE tasks + merged PRs + frozen claimSnapshot (pure assembly, no LLM; runs on any status). Headline counts carry a baseline vs prior completed milestones (LUM-508); each claim shows provenance, no-PR/no-claim rendered explicitly (LUM-649)
- `lumo milestone reorder/move` — manual ordering
- `lumo milestone criteria set/list/verdict` — milestone-level **exit criteria** (LUM-643): the close contract, drafted & adjudicated (裁定) by the steward (LUM-640) or a human. Unresolved criteria (pending or NOT_MET) hold the LUM-714 derived completion fail-closed (no `completedAt`, no retro); human override is web-only, stamped as a persistent trail. `verdict --met` on `EXTERNAL_FACT` requires `--evidence` (422); `PENDING_OUTCOME` can never be MET

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

- `lumo session attach <id>` — bind this session to a task (then run `task context`). **Lifetime lock**: re-attaching to the same task is a no-op; attaching to a _different_ task is refused with 409 — start a new Claude Code session instead. No `--force`, no `session detach`.
- `lumo session attach --steward <milestone>` — bind this session to a **milestone** as a **STEWARD (governance) session** (LUM-640): plan & accept only. Governance passes (task create/update, criteria set incl. `--human`, deps confirm/dismiss, milestone add/remove, milestone triage (LUM-646 claimable), all reads); implementation is gated (`lumo verify` → 409 **without burning a round**; moving a task to in_progress assigned to yourself → 409); commits/PRs produced anyway are recorded as milestone-scoped boundary crossings (fail-closed; disposition stays web+human-only, no CLI clear path). Same lifetime lock: same milestone idempotent, any other attach (a task, or a different milestone) → 409; multiple stewards per milestone are fine. See [sessions.md](references/sessions.md)
- `lumo session status` — show current binding (a task, or the milestone + STEWARD role)
- End-of-session housekeeping is fully automatic (no command). On DONE the server runs three best-effort silent passes: Layer-1 memory curation, fragment-usage audit, and blocked-tag automation. See [sessions.md](references/sessions.md)
- Git-suggest at session start (suggests `session attach`, never auto-binds) + Layer-2 project-memory review — see the reference

### Worktrees (local dev tooling) — see [worktree.md](references/worktree.md)

- `lumo worktree add <LUM-N> [slug]` — scaffold `.worktrees/<LUM-N>` + node_modules symlink off origin/main; run from the main checkout
- `lumo worktree rm <LUM-N> --confirm` — remove a worktree (exit 4 + envelope without `--confirm`; dirty tree also needs `--force`; keeps the branch unless `--delete-branch`)
- `lumo worktree list` — list `.worktrees/` worktrees (task id, branch, dirty, node_modules link)

## Next-step hints (the trailing `Next:` block)

`task create`, `task update`, `session attach`, `task context` and `next` end with a short `Next:` block naming what to do now — attach an unbound session, draft a missing contract, run `lumo verify`, read `task status` after a rejected round, explain an open boundary crossing, or stop and wait when the task is IN_REVIEW.

The rules are computed **server-side** from task status × contract × session binding × verify round, so the advice tracks the real state machine rather than a hard-coded string. Capped at **3 suggestions**; a rule whose condition is already satisfied never appears. The block goes to **stdout**, after the command's own result line — the result line stays first and unchanged, so reading line 1 still works.

Silence it with `--no-hints` on any command, or `LUMO_NO_HINTS=1` for a whole shell.

The block never replaces the acceptance-contract section: on `session attach` / `task context` the criteria draft reminder comes from `criteriaSection` and is deliberately **not** repeated as a step.

## Commands & flags that do NOT exist (common mistakes)

Don't guess these:

- No `lumo verdict`, `lumo fidelity`, or `lumo outcome record` (removed in LUM-733): send-backs and passes are human-only in the web verdict bar; outcome signals are derived automatically (git revert feed); the fidelity read-out is an internal API (`GET /api/tasks/<id>/fidelity`), not a CLI command
- No `lumo session start` — binding is `lumo session attach <LUM-N>`
- No `lumo session detach` — the session↔task binding is a lifetime lock; to work on a different task, start a new Claude Code session
- No steward "role switch" or un-steward — `session attach --steward` is the same lifetime lock on a milestone; a steward session never converts to an implementation session (and there is no CLI path to clear its boundary crossings)
- No `lumo task delete` — tasks can't be deleted from the CLI (web UI only)
- No `lumo pr show` / `lumo scan` — the by-number security read-out is `lumo pr scan <number>`; `lumo task pr show` is the task-scoped PR card
- No `lumo task artifact edit` — it's `lumo task artifact update`
- No `lumo auth status` — identity check is `lumo whoami`
- No `--body` on `lumo task comment` — the body is a positional arg: `lumo task comment LUM-N "text"`
- No `--content` on `task/project memory add` — memory is structured fields (`--category` + per-category flags), see [memory.md](references/memory.md)
- No global `--verbose` flag on any command
- `lumo task comments list` (plural) **reads** the thread; `lumo task comment` (singular) **writes** one
- Status updates: `lumo task update LUM-N --status done` is one direct call — do **not** walk `in_progress → in_review → done` step by step (see [tasks.md](references/tasks.md) for the transition matrix; under the verify flow you shouldn't be setting `in_review`/`done` yourself at all). `--status done` has no interactive prompt and no `--yes`: without `--confirm` it exits 4 with a confirmation envelope you relay to the user (see [confirmation.md](references/confirmation.md))
- No interactive yes/no prompts anywhere, and no `--yes` on `task update` — every gated mutation exits 4 with a `confirmation_required` envelope instead; `--yes` survives only as a legacy alias of `--confirm` on the delete/rm/close commands

## Core workflow

**Starting fresh** — user says "help me with LUM-42":

1. `lumo session attach LUM-42` — bind this session (the binding is a lifetime lock; one session = one task)
2. `lumo task context LUM-42` — load background; review unresolved items, PR-review todos, the description
3. **If the task has no acceptance criteria** (context shows the draft reminder, not a contract): draft outcome-level criteria sized to the task (3–7 for a typical multi-file task; 1–2 for a micro task) and submit them with `lumo task criteria set` **before writing the first line of code**. When a `### Reference class (outside view)` block follows the reminder, draft against it — it lists how similar delivered tasks actually failed; treat it as material to reason from, never as a checklist to cover. See [criteria.md](references/criteria.md)
4. Do the work
5. **Before claiming done: `lumo verify`** — the machine half of the acceptance loop. Fix failures and re-run (the cap is workspace-configurable — see the `Round N/M` line in the output). All-pass → task moves to IN_REVIEW and you stop. See [verify.md](references/verify.md)

**Resuming / after a send-back** — `lumo task status` **before** re-reading code or planning. It tells you where the loop stands (round, what passed, what's unmet and why, any REVIEW_ADDED criteria from review) so you don't redo finished work or miss why it bounced. A send-back means **fix in place / amend the contract — do not spin off a new task.** See [verify.md](references/verify.md)

**Git-suggest at start:** when unbound, session-start may infer the task from the git branch / recent commits (any team prefix, e.g. `SPEC-12`) and print `Detected LUM-N … Run lumo session attach LUM-N to bind.` — **without** binding. Confirm it's right, then attach yourself. See [sessions.md](references/sessions.md)

### Golden rules (most-violated)

- **Attach + draft criteria before coding.** Skipping attach triggers `SESSION_BINDING_MISSING`; skipping criteria means verification has nothing to check.
- **Evidence before "done".** Never claim done from reading code — run `lumo verify`. While a PR is open, the task is IN_REVIEW, not DONE.
- **Never set DONE yourself after a verify loop** — that adjudication is human-only. An unresolved send-back blocks the DONE transition with 409.
- **Status updates are one direct call** (`task update --status done`), not a step-by-step walk through `in_progress → in_review → done`.
- **Exit code 4 = the user must confirm — you may not.** A gated mutation (`--status done`, `sprint/milestone/doc delete`, `memory rm`, `task deps/artifact rm`, `sprint close --move-all/--backlog-all`, `worktree rm`, `doc rebuild-source` on an existing source) run without `--confirm` prints a `confirmation_required` envelope on stdout and does nothing. Show every line of its `changes` to the user, wait for their explicit approval, then run its `confirmCommand` verbatim. **Never add `--confirm` (or `--yes` / `--force`) yourself** — the flag means "the user has confirmed", and adding it on your own initiative is the exact failure the protocol exists to stop. **Exit code 5 = blocked by a human-only gate** (`DONE_BLOCKED`: a send-back, an undispositioned boundary crossing, a blocking security finding): relay its `blockers` and `remediation` to the user; nothing on `task update` clears it — no retry, no flag, no rewording a failed criterion. A boundary crossing is the one blocker with a terminal path, and it is the user's: `lumo crossing disposition <id> --false-positive | --confirmed` prints an exit-4 envelope you relay exactly like `--status done` — never self-approve. Details: [confirmation.md](references/confirmation.md)
- **Read the reference before composing a command** whose flags/edge-cases matter — don't run from memory.
