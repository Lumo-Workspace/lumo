# Projects & Milestones

### `lumo project list` — list projects in the workspace

Prints `<slug>  <Display Name>` lines. The slug column matches the `--project <ref>` argument accepted by `task create`, so users (and you) can copy a slug straight from this output into a create command.

```bash
lumo project list
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
- `-` — no light applies (status `COMPLETED`/`CANCELLED`, or no target date)

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

Prints a key:value header (name, status, **health**, dates, project, description), task counts, and the full task table under the milestone. The `Health:` line shows the same target-date risk light as `milestone list` (`ON-TRACK` / `AT-RISK` / `OVERDUE`, or `-` when none applies).

**Staleness hints (LUM-624):** the `Status:` line is annotated `(stale — task progress indicates <STATUS>; auto-updating)` when the stored status lags the task-derived one (the server self-heals the drift in the background — a re-read shows the corrected status), and the `Target:` line is annotated `(no target date — schedule health unavailable)` for an in-flight milestone with no target date.

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

```bash
lumo milestone show "Q3 Launch"
lumo milestone show 11111111-2222-3333-4444-555555555555
```

### `lumo milestone update <identifier>` — patch a milestone

| Flag                   | Type   | Notes                                                            |
| ---------------------- | ------ | ---------------------------------------------------------------- |
| `--project <ref>`      | string | Required when identifier is a name and workspace has >1 project. |
| `-n, --name <text>`    | string | Cannot be empty.                                                 |
| `-d, --description <>` | string | `--description ""` clears.                                       |
| `-s, --status <value>` | enum   | `planned \| active \| completed \| cancelled`.                   |
| `--start <date>`       | string | `--start ""` clears.                                             |
| `--target <date>`      | string | `--target ""` clears.                                            |

At least one field required.

**Status rolls up automatically (LUM-624):** milestone status follows task completion — PLANNED → ACTIVE when any task starts, → COMPLETED when every task is DONE (stamps `completedAt`, triggers the retro summary), and COMPLETED → ACTIVE when a non-DONE task (re)appears. A manual `--status planned/active/completed` that contradicts task reality gets reconciled back on the next task event or detail read; `--status cancelled` and archived milestones are human terminal choices the rollup never touches. You normally don't need `--status completed` by hand anymore.

**The close is gated by exit criteria (LUM-643):** when the milestone has exit criteria (see `milestone criteria` below), any row not adjudicated MET — unadjudicated (PENDING) **or** NOT_MET — refuses `--status completed` with **409**, and holds the LUM-624 auto-rollup fail-closed (all tasks DONE keeps the milestone ACTIVE, no retro fires). There is **no CLI/agent override**: the only escape hatch is a human closing via the web with an explicit override (`?force=1` + optional note), stamped on the milestone as a persistent trail (`completedOverride*` — who/when/note, never auto-cleared). To open the gate legitimately, adjudicate the contract with `lumo milestone criteria verdict`.

```bash
lumo milestone update "Q3 Launch" --status active
lumo milestone update "Q3 Launch" --target 2026-09-15
lumo milestone update "Q3 Launch" --description ""
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

One line per criterion — `<id>  [MET|NOT_MET|PENDING]  SOURCE ⟨REFERENT⟩  statement` — plus an indented `↳` detail line (date · evidence · note) for adjudicated rows, and a trailing gate-state line: either `All exit criteria MET — the close gate is open.` or `N unresolved (pending or NOT_MET) — the close gate refuses status→COMPLETED until adjudicated (human override only via web).`

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
- Before recommending `milestone update --status completed`, or when it just bounced with 409 → `criteria list` to see what holds the gate, then `verdict` per criterion.
- User asks "can we close this milestone / what's blocking the close" → `criteria list` (the gate-state line answers it).

### `lumo milestone delete <identifier>` — delete a milestone

Requires `--yes`. No interactive prompt — CLI is agent-friendly. Tasks under the milestone keep their data; their `milestoneId` is cleared.

```bash
lumo milestone delete "Q3 Launch" --yes
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

### `lumo milestone summary <identifier> [--retry]` — fetch AI-generated milestone retro

Prints the AI-generated retrospective summary for a milestone (mirrors `sprint summary`). `<identifier>` accepts a milestone name or UUID; `--project <ref>` is required when the identifier is a name and the workspace has more than one project. When no summary exists yet the command prints `(no summary generated yet)`.

A summary is generated automatically when a milestone transitions to `COMPLETED` (e.g. via `lumo milestone update <id> --status completed`). The generated report has sections `## Summary`, `## Delivered`, `## Outstanding` plus a one-line `tldr`. Use `--retry` to queue regeneration (e.g. after a failed generation) before fetching — regeneration is async, so the printed result may still be the previous summary or `(no summary generated yet)`.

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
