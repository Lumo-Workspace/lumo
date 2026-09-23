# Projects & Milestones

### `lumo project list` — list projects in the workspace

Prints `<slug>  <Display Name>` lines. The slug column matches the `--project <ref>` argument accepted by `task create`, so users (and you) can copy a slug straight from this output into a create command.

```bash
lumo project list
```

### `lumo project create <name> [-d <text>]` / `lumo project update <project> [flags]` (LUM-821)

`create` makes a project (≤200 chars) in the workspace. `update` takes a project name or slug plus at least one of `--name`, `--description` (`""` clears) and `--owner` (`me`, an email or a member name; `""` clears).

```bash
lumo project create "Mobile app" --description "iOS + Android client"
lumo project update mobile-app --owner alice@example.com
```

### `lumo milestone list [--project <ref>] [--archived] [--all] [--search <text>]` — list milestones in a project

Prints fixed-width rows: `<STATUS>  <HEALTH>  <target-date or ->  <name>`, sorted by target date asc (nulls last) then created asc.

By default, only **non-archived** milestones are listed. Use `--archived` to show **only** archived milestones, or `--all` to show **both** archived and non-archived. Archived rows are marked with a ` (archived)` suffix on the name.

Use `--search <text>` to filter to milestones whose **name or description** contains the text (case-insensitive substring match). It applies **on top of** the archive filter (e.g. `--all --search q3`). A blank/whitespace-only value is ignored (no filtering). The matched text is bounded to 120 chars server-side.

| Flag              | Type    | Notes                                                                                                             |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `--project <ref>` | string  | Required when the workspace has more than one project. Name or slug, case-insensitive.                            |
| `--archived`      | boolean | Show **only** archived milestones (instead of the default non-archived set).                                      |
| `--all`           | boolean | Show **both** archived and non-archived milestones.                                                               |
| `--search <text>` | string  | Filter by **name/description** case-insensitive substring. Combines with the archive filter; blank value ignored. |

`HEALTH` is the target-date risk light, server-computed from the milestone's target date + task progress:

- `ON-TRACK` — on schedule (or all tasks done)
- `AT-RISK` — completion lags elapsed time, or (no start date) the target is within ~7 days with work remaining
- `OVERDUE` — past the target date with tasks still open
- `-` — no light applies (the milestone is completed or archived, or has no target date)

```bash
lumo milestone list                  # one-project workspace (non-archived only)
lumo milestone list --project lumo   # multi-project workspace
lumo milestone list --archived       # only archived milestones
lumo milestone list --all            # archived + non-archived (archived marked "(archived)")
lumo milestone list --search q3      # name/description contains "q3" (case-insensitive)
lumo milestone list --all --search launch   # search across archived + non-archived
```

`--project <ref>` is required when the workspace has more than one project (consistent with `task create --project`). Match is by project name or slug, case-insensitive.

### When to suggest `milestone list`

- Before suggesting `task create --milestone <ref>` or `task update --milestone <ref>` to confirm the milestone exists under the expected name.
- When the user asks "what milestones do we have", "what's on v1.0", or similar.
- When the user wants to **find/search milestones by keyword** ("find the launch milestone", "which milestones mention X") — use `--search <text>` rather than listing all and eyeballing.

When to suggest: before `task create --project <ref>` when the workspace has more than one project and the user hasn't specified which one.

### `lumo milestone create <name>` — create a milestone

| Flag                   | Type   | Notes                                   |
| ---------------------- | ------ | --------------------------------------- |
| `--project <ref>`      | string | Required when workspace has >1 project. |
| `-d, --description <>` | string | Optional.                               |
| `--start <date>`       | string | YYYY-MM-DD.                             |
| `--target <date>`      | string | YYYY-MM-DD.                             |

Examples:

```bash
lumo milestone create "Q3 Launch"
lumo milestone create "Q3 Launch" --start 2026-06-01 --target 2026-08-31
```

On success: `Created milestone "Q3 Launch"  <id>`.

### `lumo milestone show <identifier>` — show milestone detail + tasks

Accepts UUID or name. With a name, `--project <ref>` is required when the workspace has >1 project.

Prints a key:value header (name, state, **health**, dates, project, description), task counts, and the full task table under the milestone. The `Health:` line shows the same target-date risk light as `milestone list` (`ON-TRACK` / `AT-RISK` / `OVERDUE`, or `-` when none applies).

**Staleness hints (LUM-624/LUM-714):** the `State:` line is annotated `(stale — task progress indicates completed|active; auto-updating)` when the stored `completedAt` disagrees with the task counts (the server self-heals the drift in the background — a re-read shows the corrected state), and the `Target:` line is annotated `(no target date — schedule health unavailable)` for an in-flight milestone with no target date.

It also prints a **Sprint coverage** section (above the task table) listing which
sprints the milestone's tasks span — each row shows the sprint number, status, name,
and `done/total` progress — plus an `Unscheduled` line counting milestone tasks not in any
sprint (shown only when there are any). The section is derived from the milestone's
tasks (no schema relation), so it needs no extra flags. When no task is in any sprint
it prints `Sprint coverage: (no sprint coverage)`.

Example coverage section:

```
Sprint coverage:
  #3  ACTIVE  Sprint 3   4/6 done
  #4  DRAFT   Sprint 4   0/2 done
  Unscheduled             1 task
```

**Cross-milestone learning (LUM-648):** when this milestone's STEWARD sessions were injected prior-milestone distilled learning (the LUM-647 learning unit), a **Cross-milestone learning** section reports how much of it was actually used — `Injected: N prior learnings (from K prior milestones)` and `Usage rate: Z% (judged-used X/Y)`. The rate reuses lineage's `used=true/false/null` usage voting (judged at the successor milestone's close): abstentions (un-audited / judge-abstained impressions) are **excluded from the denominator**, so it is a lower bound. Below 3 judged edges it reads `insufficient (judged Y, need ≥3)` rather than a fabricated percentage. The section is omitted entirely when nothing was injected (that's "nothing to migrate", not 0%).

```
Cross-milestone learning:
  Injected: 8 prior learnings (from 2 prior milestones)
  Usage rate: 62% (judged-used 5/8)
```

```bash
lumo milestone show "Q3 Launch"
lumo milestone show 11111111-2222-3333-4444-555555555555
```

### `lumo milestone update <identifier>` — patch a milestone

| Flag                   | Type   | Notes                                                                          |
| ---------------------- | ------ | ------------------------------------------------------------------------------ |
| `--project <ref>`      | string | Required when identifier is a name and workspace has >1 project.               |
| `-n, --name <text>`    | string | Cannot be empty.                                                               |
| `-d, --description <>` | string | `--description ""` clears.                                                     |
| `--start <date>`       | string | `--start ""` clears.                                                           |
| `--target <date>`      | string | `--target ""` clears.                                                          |
| `--token-budget <n>`   | int    | Advisory token budget (LUM-644), positive integer; `--token-budget ""` clears. |

At least one field required.

**Token budget is advisory only (LUM-644):** the web Overview's tokens KPI card shows burn vs budget, and when the MEASURED burn exceeds the budget an advisory alert appears in the Risk & pending queue. Nothing is ever blocked by it — no hard gate. Unmeasured burn reads as unknown, never as over/under budget.

**When to suggest**: when the user wants to cap/track token spend on a milestone ("给这个 milestone 设 token 预算 / budget"), or asks why the Overview shows an over-budget alert.

**There is no status flag — state is derived (LUM-714).** A milestone is `active`, `completed`, or `archived`, and only one of those is a choice:

- **completed** follows task completion. Every task DONE → the rollup stamps `completedAt` and triggers the retro summary; a non-DONE task (re)appearing clears the stamp. Nothing you can pass to `update` moves it.
- **archived** is the one explicit human state (`milestone archive` / `unarchive`). Archived milestones are left alone by the rollup and hidden from the default list.

The old `PLANNED` / `ACTIVE` split is gone — a milestone whose tasks have not started is simply active — and `CANCELLED` is expressed by archiving (a milestone archived while incomplete reads as dropped, not delivered).

**The close is gated by exit criteria (LUM-643):** when the milestone has exit criteria (see `milestone criteria` below), any row not adjudicated MET — unadjudicated (PENDING) **or** NOT_MET — holds the LUM-714 derived completion fail-closed: all tasks DONE leaves the milestone active, `completedAt` unstamped, no retro. There is **no CLI/agent override**: the only escape hatch is a human overriding via the web (`POST /api/milestones/<id>/close-override`, Clerk identity only), stamped on the milestone as a persistent trail (`completedOverride*` — who/when/note, never auto-cleared). To open the gate legitimately, adjudicate the contract with `lumo milestone criteria verdict`.

```bash
lumo milestone update "Q3 Launch" --target 2026-09-15
lumo milestone update "Q3 Launch" --description ""
lumo milestone update "Q3 Launch" --token-budget 50000000
lumo milestone update "Q3 Launch" --token-budget ""
```

### `lumo milestone criteria set <identifier> --file <criteria.json> [--human]` — submit the exit contract

Milestone-level **exit criteria** (LUM-643) — the close contract, mirroring the task-level acceptance contract where it transfers. Key differences from `task criteria`: there is **no `verifierType` / no `checkpointer`** — exit criteria are **adjudicated (裁定)**, not machine-verified — and each item requires only `statement` + `referentKind`. The **steward session (LUM-640) is the intended drafting & adjudicating subject** (drafting is a governance action; session provenance is recorded on every row); `--human` records a transcribed HUMAN_EDIT revision instead.

The file is a JSON array:

```json
[
  {
    "statement": "Every LUM-64x migration is applied on prod (migrate status clean)",
    "referentKind": "EXTERNAL_FACT"
  },
  {
    "statement": "All milestone read models render the new fields",
    "referentKind": "AGENT_CONSTRUCTED_STATE"
  }
]
```

Semantics: **full-group replace** — existing rows with a verdict are tombstoned (their adjudication trail survives for audit), verdict-free rows are hard-deleted. The contract **locks with 409 once the milestone is COMPLETED** (reopen to edit). Archived milestones also refuse with 409.

```bash
lumo milestone criteria set "Q3 Launch" --file exit-criteria.json
lumo milestone criteria set "Q3 Launch" --file exit-criteria.json --human
```

### `lumo milestone criteria list <identifier>` — print the exit contract

One line per criterion — `<id>  [MET|NOT_MET|PENDING]  SOURCE ⟨REFERENT⟩  statement` — plus an indented `↳` detail line (date · evidence · note) for adjudicated rows, and a trailing gate-state line: either `All exit criteria MET — the close gate is open.` or `N unresolved (pending or NOT_MET) — the close gate withholds the derived completion until adjudicated (human override only via web).`

```bash
lumo milestone criteria list "Q3 Launch"
```

### `lumo milestone criteria verdict <identifier> <criterion> --met|--unmet` — adjudicate one criterion

Records the adjudication (裁定) on one exit criterion — verdict, who, when, and the adjudicating session (LUM-640 steward provenance) are stamped server-side; re-adjudication overwrites in place (latest verdict wins). `<criterion>` accepts the full id or a **≥6-char unique id prefix** from `criteria list` (ambiguous/unknown selectors list candidates and exit 1).

| Flag                   | Type    | Notes                                                                                                 |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `--met` / `--unmet`    | boolean | Exactly one required.                                                                                 |
| `--note <text>`        | string  | Why this verdict (recommended).                                                                       |
| `--evidence <pointer>` | string  | **Required for `--met` on an `EXTERNAL_FACT` criterion** (422 otherwise) — the fact it was read from. |
| `--project <ref>`      | string  | Required when identifier is a name and workspace has >1 project.                                      |

**Grounding gate (LUM-602/605 reuse):** `--met` on `EXTERNAL_FACT` without `--evidence` → **422** (re-ground or honestly re-declare the criterion `AGENT_CONSTRUCTED_STATE`); a `PENDING_OUTCOME` criterion can **never** be adjudicated MET (its truth lands post-delivery — use the outcome well). `--unmet` never needs evidence.

```bash
lumo milestone criteria verdict "Q3 Launch" cmexit0001 --met --evidence "prisma migrate status @ prod, 2026-07-02" --note "all LUM-64x applied"
lumo milestone criteria verdict "Q3 Launch" cmexit0002 --unmet --note "read model not wired yet"
```

### When to suggest `milestone criteria`

- A steward session planning a milestone ("what does done mean for this milestone", "draft exit criteria") → `criteria set`.
- When a milestone's tasks are all DONE but it has not completed → `criteria list` to see what holds the gate, then `verdict` per criterion.
- User asks "can we close this milestone / what's blocking the close" → `criteria list` (the gate-state line answers it).

### `lumo milestone delete <identifier>` — delete a milestone

Gated by the confirmation protocol ([confirmation.md](confirmation.md)): without `--confirm` the CLI exits **4** with an envelope (`Will delete milestone "Q3 Launch"` · `12 tasks under it keep their data; only milestoneId is cleared`) and deletes nothing — relay it to the user and re-run `confirmCommand` on approval. `--yes` is a legacy alias. Tasks under the milestone keep their data; their `milestoneId` is cleared.

```bash
lumo milestone delete "Q3 Launch"            # exit 4 + envelope
lumo milestone delete "Q3 Launch" --confirm  # after the user approved
```

### `lumo milestone archive <identifier>` — soft-archive a milestone

Soft-archives a milestone by setting `archivedAt`. The milestone is **hidden from `milestone list` by default** (use `--archived` or `--all` to see it), but its **history and task links are preserved**, and the action is **reversible** via `milestone unarchive`. This is distinct from `milestone delete`, which is a **hard delete**. While archived, the milestone **rejects edits** (`milestone update`) and **new task bindings** (`task --milestone`, `milestone add`) with a 409 until it is restored. `<identifier>` accepts a UUID or name; `--project <ref>` is required when the identifier is a name and the workspace has >1 project.

```bash
lumo milestone archive "Q3 Launch"
lumo milestone archive 11111111-2222-3333-4444-555555555555
```

### `lumo milestone unarchive <identifier>` — restore an archived milestone

Restores an archived milestone by clearing `archivedAt`. It reappears in `milestone list` and can be edited and bound to tasks again. Idempotent — unarchiving an already-active milestone is a no-op. Same identifier / `--project` rules as `milestone archive`: `<identifier>` accepts a UUID or name; `--project <ref>` is required when the identifier is a name and the workspace has >1 project.

```bash
lumo milestone unarchive "Q3 Launch"
```

### `lumo milestone add <identifier> <task...>` — bind tasks to a milestone (batch)

Binds **one or more** tasks to a milestone in a single call — the batch counterpart of `task update --milestone <ref>` (which only takes one task at a time). `<identifier>` accepts a milestone name or UUID; each `<task>` accepts `LUM-N` or a task UUID. `--project <ref>` is required when the identifier is a name and the workspace has >1 project.

Task refs are deduped (case-insensitive, order preserved). Each task is PATCHed independently — **partial failures do not roll back**: a task that fails (e.g. not found, or its project has no milestone of that name) is reported on its own line while the rest still bind. Exit code is non-zero if **any** task failed.

```bash
lumo milestone add "Q3 Launch" LUM-1 LUM-2 LUM-3
lumo milestone add 11111111-2222-3333-4444-555555555555 LUM-1 LUM-2
```

Output — a tally header (zero categories omitted) plus one line per task:

```
Q3 Launch: 2 added, 1 failed
  ✓ LUM-1
  ✓ LUM-2
  ✗ LUM-3  no milestone matches "Q3 Launch" in this project. Try `lumo milestone list`.
```

### `lumo milestone remove <identifier> <task...>` — unbind tasks from a milestone (batch)

Unbinds **one or more** tasks from a milestone in one call. A task that is **not currently in this milestone is skipped** (idempotent) — it is never reassigned away from a different milestone. `<identifier>` accepts a name or UUID; each `<task>` accepts `LUM-N` or a task UUID. `--project <ref>` is required when the identifier is a name and the workspace has >1 project.

```bash
lumo milestone remove "Q3 Launch" LUM-1 LUM-5
```

Output — `✓` removed, `-` skipped (not in milestone), `✗` failed:

```
Q3 Launch: 1 removed, 1 skipped
  ✓ LUM-1
  - LUM-5  not in this milestone
```

### When to suggest `milestone add` / `milestone remove`

- The user wants to attach/detach **several** tasks to a milestone at once ("attach these tasks to Q3", "put LUM-1 LUM-2 LUM-3 into the milestone", "remove these from the milestone"). For a single task, `task update --milestone <ref>` (or `--milestone ""` to clear) is equally fine.
- `remove` only clears the binding for tasks actually in the named milestone, so it's safe to pass a broad list — anything not in it is reported as skipped, not clobbered.
- For one-at-a-time sprint binding see `lumo sprint add / remove` (sprint batch is not yet supported).

### `lumo milestone triage <identifier> <task...> --claimable | --not-claimable` — steward batch agent-claimable triage (LUM-646)

The **steward's batch annotation** for the F4/自治边界 loop. Marks **one or more** in-milestone tasks agent-claimable (or not) in one call — the "可领范围" leg of the autonomy-boundary triad (契约 F1 / 预算 F2 / 可领范围 F4). Exactly one direction is required: `--claimable` or `--not-claimable` (mutually exclusive; the CLI errors before any network call if both or neither is given).

Mirrors `milestone add/remove`: dedupes refs, and a task **not in this milestone is skipped** (triage is milestone-scoped, never touches tasks elsewhere). `<identifier>` accepts a name or UUID; each `<task>` accepts `LUM-N` or a task UUID. `--project <ref>` is required when the identifier is a name and the workspace has >1 project. Best-effort — partial failures do not roll back.

Setting the marker is a **governance** action, so a STEWARD session (`lumo session attach --steward <milestone>`) passes the server-side binding guard. `claimable` is **fail-closed**: a task is not auto-claimable until triaged. Once tasks are triaged, an agent runs `lumo next --claimable` to get only claimable ∩ unblocked (F3) ∩ in-budget (F2) work. A single task can also be toggled with `lumo task update <id> --claimable | --not-claimable`.

```bash
lumo milestone triage "Agent-Native Milestones" LUM-1 LUM-2 --claimable
lumo milestone triage "Agent-Native Milestones" LUM-9 --not-claimable
```

Output — `✓` marked, `-` skipped (not in milestone), `✗` failed:

```
Agent-Native Milestones: 1 marked claimable, 1 skipped
  ✓ LUM-1
  - LUM-9  not in this milestone
```

**When to suggest `milestone triage`**: the user (typically in a steward/governance session) wants to declare which of a milestone's tasks are safe for an agent to autonomously pick up ("mark these claimable", "open these up for agents", "triage the milestone for auto-dispatch"). For a single task, `task update --claimable` is equally fine.

### `lumo milestone summary <identifier> [--retry]` — fetch AI-generated milestone retro

Prints the AI-generated retrospective summary for a milestone (mirrors `sprint summary`). `<identifier>` accepts a milestone name or UUID; `--project <ref>` is required when the identifier is a name and the workspace has more than one project. When no summary exists yet the command prints `(no summary generated yet)`.

A summary is generated automatically when a milestone completes (the LUM-714 derived transition: its last open task turns DONE, with the exit-criteria gate open). The generated report has sections `## Summary`, `## Delivered`, `## Outstanding` plus a one-line `tldr`. Use `--retry` to queue regeneration (e.g. after a failed generation) before fetching — regeneration is async, so the printed result may still be the previous summary or `(no summary generated yet)`.

| Flag              | Type    | Notes                                                                                                  |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `--project <ref>` | string  | Project name or slug. Required when identifier is a name and the workspace has >1 project.             |
| `--retry`         | boolean | Queue a regeneration (async, server returns 202) before fetching. Only valid on a COMPLETED milestone. |

```bash
lumo milestone summary "Q3 Launch"
lumo milestone summary "Q3 Launch" --retry
lumo milestone summary 11111111-2222-3333-4444-555555555555
```

When to suggest: user asks "summarize the milestone", "milestone retro", "give me a summary of the Q3 milestone".

### `lumo milestone changelog <identifier> [--project <ref>] [--json]` — structured changelog (LUM-649)

Assembles a **structured changelog** from the milestone's **DONE tasks + merged PRs + frozen claimSnapshot**. Pure deterministic assembly — **no LLM**, and (unlike `summary`) **no completion gate**: it runs on a milestone in any state, so an active milestone reports "what has shipped so far". Only DONE tasks ever appear. `<identifier>` accepts a milestone name or UUID; `--project <ref>` is required when the identifier is a name and the workspace has >1 project.

Honest-reporting contract (why this is more than a task list):

- **Headline counts carry a baseline (LUM-508 reuse).** "Tasks shipped" and "PRs merged" are rendered as a current-vs-base stat against the reference class of **prior COMPLETED milestones in the same project** — e.g. `4 (base 3, +33% · above)`. With **fewer than 3** prior milestones the base is honestly suppressed to `4 (no baseline yet)` — never a naked number, never a thin fabricated baseline.
- **Claim provenance.** Each DONE task shows its frozen `claimSnapshot` tagged with its source + session (`Claim [RUN_SUMMARY · sess-1]: …`). A synthesized-but-empty claim reads `(no claim recorded)` (fail-closed "no material"), distinct from a never-synthesized `(not synthesized)`.
- **Nothing silently dropped.** A DONE task with no merged PR renders an explicit `PRs: (no merged PR)`. Entries are ordered newest-delivery-first (by task `updatedAt` — Task has no `completedAt` column, so this is a best-available proxy).

`--json` emits the raw structured payload (milestone / headline baseline stats / entries) unchanged for programmatic use.

| Flag              | Type    | Notes                                                                                      |
| ----------------- | ------- | ------------------------------------------------------------------------------------------ |
| `--project <ref>` | string  | Project name or slug. Required when identifier is a name and the workspace has >1 project. |
| `--json`          | boolean | Emit the raw structured changelog payload instead of the human markdown.                   |

```bash
lumo milestone changelog "Agent-Native Milestones"
lumo milestone changelog "Agent-Native Milestones" --json
lumo milestone changelog 11111111-2222-3333-4444-555555555555
```

When to suggest: user asks for a "changelog", "release notes", "what shipped in this milestone", or wants a structured delivery list they can paste into a release note. For the AI narrative retro use `milestone summary`; for the honest delivery-count/cost rollup see `milestone show`.

### `lumo milestone reorder <ref...> [--project <ref>]` — set the full milestone order

Reorders a project's milestones. Pass **every** milestone in the project (by name, case-insensitive, or its cuid) in the desired order — the command rewrites each milestone's `sortOrder` to match. An incomplete list (not every milestone named), an unknown ref, or a duplicate is rejected **before any network mutation**, with a message naming the offending / missing milestones.

```bash
lumo milestone reorder "Q3 Launch" "Beta" "Alpha"
lumo milestone reorder "Q3 Launch" "Beta" "Alpha" --project backend
```

`--project <ref>` is required when the workspace has more than one project.

Output:

```
Reordered 3 milestones:
  1. Q3 Launch
  2. Beta
  3. Alpha
```

### `lumo milestone move <ref> --before <ref> | --after <ref> [--project <ref>]` — move one milestone

Moves a single milestone immediately before or after a target milestone, leaving the rest in their current relative order. `--before` and `--after` are **mutually exclusive and exactly one is required** (the CLI errors before any network call if both or neither is given). Refs resolve by cuid or case-insensitive name.

```bash
lumo milestone move "Alpha" --before "Q3 Launch"
lumo milestone move "Alpha" --after "Beta" --project backend
```

Output:

```
Moved "Alpha" before "Q3 Launch". New order:
  1. Alpha
  2. Q3 Launch
  3. Beta
```

Both commands resolve to a full ordered list client-side and call the same `PATCH /api/projects/<id>/milestones/reorder` endpoint (which requires the list to name every milestone exactly once). New milestones created via `milestone create` are appended to the bottom of the order.

**Ambiguous names:** milestone names are not unique within a project (only the slug is). A ref whose name matches more than one milestone is **rejected** with an `ambiguous milestone name … re-run with the id` error listing the candidate cuids — pass the cuid instead. This applies to every name-based milestone ref (`reorder`, `move`, and also `show` / `update` / `delete` / `summary` / `add` / `remove`).

When to suggest: user asks to "reorder milestones", "move milestone X before/after Y", "put this milestone first".
