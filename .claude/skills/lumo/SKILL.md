---
name: lumo
description: 'Use the Lumo CLI to work with Lumo (project management for dev teams) from the terminal: load task context, bind/wrap Claude Code sessions, and create/update/list/show/comment on tasks, projects, milestones, sprints, documents, artifacts, Figma links, dependencies, and team memory — plus acceptance criteria, machine verification (verify / task status), lineage audit, worktree scaffolding, and CLI setup/auth/update. Activate when the user mentions a Lumo task identifier (LUM-N) or the lumo CLI, in any language; asks to load task background or bind/check/wrap a session; manages any of the resources above in Lumo; is starting, resuming, or about to claim completion of a task; or asks what to work on next. Key triggers: "LUM-", "lumo", "task context", "session attach", "session wrap", "verify", "task status", "acceptance criteria", "milestone", "sprint", "docs", "memory", "deps", "lineage", "worktree", "design link", "what should I work on", "resume task".'
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

The command catalog below is a **map**: it lists every command grouped by domain with a one-line summary. **Detailed flags, examples, output formats, and "when to suggest" guidance live in the `references/` files** — when a user request lands in a domain, **Read the matching reference file before composing the command**. Don't run a command from memory if its flags/edge-cases matter; open the reference first.

| Domain                                                                                  | Read this reference                                            |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `setup`, `auth login/logout`, `whoami`, `update`                                        | [references/onboarding.md](references/onboarding.md)           |
| `task context`, retrieval (`slack/web/figma context`, `comments list`, `pr show`)       | [references/task-context.md](references/task-context.md)       |
| `task create/update/list/show/comment`, `next`                                          | [references/tasks.md](references/tasks.md)                     |
| `task artifact*`, `task figma*`                                                         | [references/artifacts-figma.md](references/artifacts-figma.md) |
| `task criteria set/list`, drafting the acceptance contract                              | [references/criteria.md](references/criteria.md)               |
| `verify`, `task status` — machine verification loop, claim-done flow, self-check/resume | [references/verify.md](references/verify.md)                   |
| `project list`, `milestone*`                                                            | [references/milestones.md](references/milestones.md)           |
| `doc*`                                                                                  | [references/docs.md](references/docs.md)                       |
| `sprint*`                                                                               | [references/sprints.md](references/sprints.md)                 |
| `task/project memory`, `memory promote/rm`                                              | [references/memory.md](references/memory.md)                   |
| `session attach/status/wrap`, git-suggest on start, Layer-2 review                      | [references/sessions.md](references/sessions.md)               |
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
- `lumo task lineage <id>` — show the causal trail: fragments that fed the task + each one's outcome + the run's token/loop cost (read-only audit view); `lumo task lineage <id> --signal` also appends workspace-level usage signal-health (used distribution, per-session variance, used-vs-base merge rate via iteration-taint fold — tasks with a send-back/reopen/PR-close count as the negative class even if later merged; shows negative-class size per side; prints "metric cannot discriminate" when no failure outcomes exist yet; also prints a raw count of mid-flight `--new-scope` spinoffs (recorded, not yet judged — LUM-511 Phase 3))

**Tasks** — see [tasks.md](references/tasks.md)

- `lumo task create <title> [flags]` — create a task. **Mid-task** (your session is bound to an in-flight task) it requires `--rework-of <id>` (redirects you to fix the existing task — creates nothing) or `--new-scope` (genuinely new, out-of-scope work). On a send-back, fix in place / amend the contract instead of spinning off a new task — see [verify.md](references/verify.md) and [criteria.md](references/criteria.md).
- `lumo task update <id> [flags]` — patch status/title/priority/assignee/milestone/sprint/tags
- `lumo task list [flags]` — list tasks assigned to you
- `lumo next [--count N]` — recommend the next task to work on (read-only)
- `lumo task show <id>` — print one task's detail
- `lumo task comment <id> <body>` — leave a comment

**Task dependencies**

- `lumo task deps list <id>` — list dependency edges in both directions, grouped CONFIRMED / SUGGESTED (pending confirmation) / DISMISSED; each row shows a short edge id `[xxxxxxxx]`, the other task, and detected evidence (`shared_files(N shared files: …)` / `task_mention(…)`); SUGGESTED rows include a copy-pasteable confirm hint
- `lumo task deps add <id> --blocked-by <LUM-N>` — declare a manual hard dependency (created CONFIRMED, source MANUAL; if a SUGGESTED/DISMISSED edge already exists in the same direction, it is confirmed in place rather than creating a new row)
- `lumo task deps confirm <id> <edge> [--reverse]` — confirm a detected candidate; `<edge>` is a short edge-id prefix (≥6 chars) or the other task's identifier (case-insensitive); `--reverse` flips the direction when the detector guessed it backwards
- `lumo task deps dismiss <id> <edge>` — dismiss a candidate (never re-suggested)
- `lumo task deps rm <id> <edge> --yes` — delete an edge (refuses without `--yes`)
- On an ambiguous/unknown `<edge>` selector the CLI prints all candidates with short ids and exits 1 — retry with one of them

**Acceptance criteria (contract)** — see [criteria.md](references/criteria.md)

- `lumo task criteria set <task> --file <criteria.json> [--human] [--cause <tag>]` — submit the whole contract: default = agent draft (AGENT_DRAFT, editable until DONE — full-group replace while never-left-TODO; identity-preserving diff with CRITERION_CHANGED drift trail once work has started; 409 only when task is DONE); `--human` = a HUMAN_EDIT revision transcribed from the conversation (desired final list; items with `id` keep/update, missing ones are deleted; allowed in every non-DONE stage); `--cause` (with `--human`) annotates why the contract drifted: `NEW_INFO | SCOPE_CHANGE | DRAFT_BLIND_SPOT | GRANULARITY | OTHER`
- `lumo task criteria list <task>` — print the contract (id, MACHINE/HUMAN, provenance source@round, checkpointer)

**Verification (machine acceptance loop)** — see [verify.md](references/verify.md)

- `lumo verify [task] [--timeout <seconds>]` — run every MACHINE criterion's checkpointer locally, report one structured PASS/FAIL verdict per criterion to the server, print next actions. Defaults to the session-bound task. Round cap 3: an all-pass round moves the task to IN_REVIEW (agent stops there); a round-3 fail escalates to a human (stop retrying). **Run this before claiming a task is done.**
- `lumo task status [task] [--json]` — read-only acceptance self-check (no LLM, milliseconds): the contract with each criterion's latest verdict (REVIEW_ADDED provenance visible), verification history, current round, last round's failure reasons, a per-criterion **send-back lifecycle** line when applicable (`↳ send-back (rN) resolved in rM · PR #K` / `… open` — LUM-511 Phase 5), `nextActions` = the unmet criteria (the declarative "what's next" — no separate plan), and any OPEN (undispositioned) boundary crossings (count + per crossing category/severity/detail + a read-only attribution line `↳ by model=…·agent=…·session=…` naming who/what crossed, `unknown` when unresolved — LUM-469; `--json` adds an `openCrossings` field, each entry carrying an `attribution` object) — read-only awareness, disposition stays web + human-only (LUM-448). The crossings check fails closed (LUM-480): if the read errors, the block prints `⚠ Boundary-crossing check failed` instead of staying silent, and `--json` sets `openCrossings: null` (distinct from `[]` = a successful read with zero open — treat `null` as "could not confirm", not "safe"). Defaults to the session-bound task; `--json` emits a versioned payload (`version` field). **Run it first when resuming a task in a new session or after a verification round was rejected.**
- `lumo verdict [task] --pass | --fail` — acceptance verdicts (LUM-422). `--pass` opens the browser to the human verdict bar focused on Pass (a deep link — **records nothing**; a passing data row is only ever a human's own click). `--fail --reason <enum> [--note <text>] [--criterion <id>…]` records an **AGENT send-back** (verifierType=AGENT, verdict hard-coded FAIL) and bounces the task to IN_PROGRESS. Defaults to the session-bound task. **An unresolved send-back (machine/AGENT/human FAIL) blocks the agent/CLI DONE transition with 409** — clear it (re-verify) before `task update --status done`.

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

**Documents** — see [docs.md](references/docs.md)

- `lumo doc create/update/show/list/delete` — document CRUD; `doc show` prints the body revision, `doc update` takes `--if-revision <n>` (mismatch → 409 conflict, re-read and retry — no silent overwrite); a body update that drops tables/rows/headings vs the stored body is rejected 422 by the built-in structure guard unless `--allow-shrink` is passed (intentional deletions only — on 422 first suspect a stale edit base)
- `lumo doc show <doc> --raw` — print the byte-identical markdown source of the last markdown upload (the only legal edit base; errors when no source is stored — never falls back to the lossy HTML→md render)
- `lumo doc show <doc> --section "<heading>"` — print just one heading-addressed section of the markdown source (byte-faithful slice, subsections included; revision on stderr; prefix `#…` pins depth)
- `lumo doc patch <doc> --section "<heading>" --content/--file/stdin [--if-revision N] [--allow-shrink]` — replace ONLY that section (heading line included); every byte outside it is untouched; concurrent edits 409 instead of clobbering; the structure guard 422s a replacement that drops the section's tables/rows/headings unless `--allow-shrink` (appends are never guarded)
- `lumo doc append <doc> [--section "<heading>"] --content/--file/stdin [--if-revision N]` — append at section end (or doc end without `--section`); pure insertion, no existing byte modified — the safest write for running logs/ledgers
- `lumo doc diff <doc> --file <local.md>` — compare the server-side markdown source against a local file (exit 0 identical, 1 with unified diff)
- `lumo doc rebuild-source <doc> [--allow-shrink] [--force] [--if-revision N]` — regenerate `sourceMarkdown` from the stored HTML body with a lossless serializer (tables/rows/headings round-trip), re-enabling raw/diff/section/append on a source-less doc; structure-guarded (422 on any shrink, LUM-410 口径), backfills the source only; 409 if a source already exists unless `--force`. Recovery path when raw/section/patch errors "no stored source" (LUM-446)
- `lumo doc move` — reparent under a parent / to root
- `lumo doc bind/unbind <doc> <task>` — task linkage
- `lumo doc share/unshare/share-list` — member sharing
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

**Sessions** — see [sessions.md](references/sessions.md)

- `lumo session attach <id>` — bind this session to a task (then run `task context`). **Lifetime lock**: re-attaching to the same task is a no-op; attaching to a _different_ task is refused with 409 — start a new Claude Code session instead. No `--force`, no `session detach`.
- `lumo session status` — show current binding
- `lumo session wrap [--yes] [--dry-run] [--used <indices>]` — end-of-session panel: memory review + fragment-usage vote (`--used`, LUM-300) + blocked-tag prompt, then a read-only reminder when the bound task has ≥1 OPEN boundary crossing still undispositioned (silent only on a genuine empty read — no wrap-up noise; a crossings-check failure prints a "could not confirm" warning instead of staying silent, LUM-480; pointer is web + human-only, LUM-448). Usage is now also audited automatically when a task reaches DONE (evidence-gated, true-only — confident fragments marked used, the rest left NULL); `session wrap --used` remains the manual override and takes precedence for a session.
- Git-suggest at session start (suggests `session attach`, never auto-binds) + Layer-2 project-memory review — see the reference

**Worktrees (local dev tooling)** — see [worktree.md](references/worktree.md)

- `lumo worktree add <LUM-N> [slug]` — scaffold `.worktrees/<LUM-N>` + node_modules symlink off origin/main; run from the main checkout
- `lumo worktree rm <LUM-N> --yes` — remove a worktree (keeps the branch unless `--delete-branch`)
- `lumo worktree list` — list `.worktrees/` worktrees (task id, branch, dirty, node_modules link)

## Commands & flags that do NOT exist (common mistakes)

Measured from real agent sessions (LUM-392) — don't guess these:

- No `lumo session start` — binding is `lumo session attach <LUM-N>`
- No `lumo session detach` — the session↔task binding is a lifetime lock (LUM-459); to work on a different task, start a new Claude Code session
- No `lumo task delete` — tasks can't be deleted from the CLI (web UI only)
- No `lumo task artifact edit` — it's `lumo task artifact update`
- No `lumo auth status` — identity check is `lumo whoami`
- No `--body` on `lumo task comment` — the body is a positional arg: `lumo task comment LUM-N "text"`
- No `--content` on `task/project memory add` — memory is structured fields (`--category` + per-category flags), see [memory.md](references/memory.md)
- No global `--verbose` flag on any command
- `lumo task comments list` (plural) **reads** the thread; `lumo task comment` (singular) **writes** one
- Status updates: `lumo task update LUM-N --status done` is one direct call — do **not** walk `in_progress → in_review → done` step by step (see [tasks.md](references/tasks.md) for the transition matrix; under the verify flow you shouldn't be setting `in_review`/`done` yourself at all)

## Core workflow

Typical flow when a user says "help me with LUM-42":

1. `lumo session attach LUM-42` — bind this session
2. `lumo task context LUM-42` — load background
3. Review unresolved items, PR-review todos, and the task description
4. **If the task has no acceptance criteria** (context shows the draft reminder instead of a contract): draft outcome-level criteria sized to the task (3–7 for a typical multi-file task; 1–2 for a micro task) and submit them with `lumo task criteria set` **before writing the first line of code** — see [criteria.md](references/criteria.md) for the drafting guide
5. Begin working on the task
6. **Before claiming the work is done: run `lumo verify`** — the machine half of the acceptance loop. Fix failures and re-run (round cap 3). On all-pass the task moves to IN_REVIEW and you stop; never set DONE yourself after a verify loop — that adjudication is human-only. See [verify.md](references/verify.md)

**Status-first recovery:** when you pick a task back up — a new session resuming earlier work, or a task that came back after a rejected verification round / review findings — run `lumo task status` **before** re-reading code or planning. It tells you where the loop stands (current round, what passed, what's unmet and why, any REVIEW_ADDED criteria appended during review) so you don't redo finished work or miss the reason it bounced. See [verify.md](references/verify.md)

**Git-suggest at start:** when the session is unbound, session-start may infer the task from the git branch / recent commits (any team prefix, e.g. `SPEC-12`, not just `LUM-N`) and print a suggestion — `Detected LUM-N (from branch name). Run lumo session attach LUM-N to bind.` (or `from recent commits`) — **without** binding. Confirm it's the right task, then run `lumo session attach <LUM-N>` yourself (binding only happens on an explicit attach). See [sessions.md](references/sessions.md) for the full session-start behavior.
