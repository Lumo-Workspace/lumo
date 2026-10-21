# Projects & milestones

Projects, and milestone CRUD / archive / batch binding / triage. `milestone show` sections, `--summary`, `--changelog`, `reorder` / `move`: [milestone-reports.md](milestone-reports.md). Milestone test cases: [test-cases.md](test-cases.md).

### `lumo project list [--all] [--json]` — list projects in the workspace

`--json` prints `{ version, projects, total, nextCursor }` (each project with its id, name and `slug`, plus `status`, `startDate`, `targetDate`, `archivedAt` and the derived `completed`).

Prints `<slug>  <Display Name>  <STATUS>` rows (the shared list table: a `SLUG  NAME  STATUS` header on a TTY only; piped output has no header and keeps this column order). STATUS is `ACTIVE`, `PAUSED` or `CANCELED`, with `· archived` appended for an archived project. **Archived projects are hidden unless `--all`.** The slug column matches the `--project <ref>` argument accepted by `task create`, so users (and you) can copy a slug straight from this output into a create command.

```bash
lumo project list
lumo project list --all     # include archived projects
```

### `lumo project create <name> [-d <text>]` / `lumo project update <project> [flags]`

`create` makes a project (≤200 chars) in the workspace. `update` takes a project name or slug plus at least one of `--name`, `--description` (`""` clears), `--owner` (`me`, an email or a member name; `""` clears), `--start` / `--target` (`YYYY-MM-DD`, `""` clears; the target may not precede the start — checked locally and against the stored date) and `--status`.

`--status active|paused|canceled` (case-insensitive) is a **human ruling**: without `--confirm` the command exits **4** with a confirmation envelope (old → new status, what it does to agents, any other field in the call) and sends nothing — relay it and re-run `confirmCommand` only after the user approves ([confirmation.md](confirmation.md)). Never add `--confirm` yourself. Setting the status it already has needs no confirmation. There is no `completed` status: completion is derived (at least one task, none open — DONE and CANCELED count as closed) and shown by `project show`.

What the status does: **PAUSED** — its tasks drop out of `lumo status --next` (and `--claimable`); `task create` still works but prints a warning. **CANCELED** — the same, and `task create` into it is refused (exit 1, 409 with the command that reactivates it). Crossing-remediation tasks are exempt (they record something that already happened).

```bash
lumo project create "Mobile app" --description "iOS + Android client"
lumo project update mobile-app --owner alice@example.com
lumo project update mobile-app --start 2026-11-01 --target 2026-12-15
lumo project update mobile-app --status paused          # exit 4 envelope first
```

### `lumo project archive <project>` / `lumo project unarchive <project>`

Archive hides a project from the web sidebar and `project list` (`--all` shows it), drops its tasks out of `status --next`, and refuses `task create` into it; history and tasks are kept. Reversible with `unarchive`; no confirmation (like `milestone archive`). Both are idempotent. The web Projects page still lists archived projects (with an "Archived" badge), and their page's `…` menu has Archive / Unarchive.

```bash
lumo project archive mobile-app
lumo project unarchive mobile-app
```

When to suggest: the user says a project is on hold / dropped / finished and should stop attracting work → `project update <p> --status paused|canceled` (envelope) or `project archive <p>`. `task create` refused with "is canceled" / "is archived" → tell the user; reopening is their call.

### `lumo milestone list [--project <ref>] [--archived] [--all] [--search <text>] [--limit <n>] [--cursor <c>]` — list milestones in a project

`--json` prints `{ version, milestones, total, nextCursor }` for the same page.

Prints table rows: `<STATE>  <HEALTH>  <target-date or ->  <slug>  <name>`, sorted by target date asc (nulls last) then created asc. `STATE` is `ACTIVE`, `COMPLETED` or `ARCHIVED` (the same upper-case words `milestone show` prints on its `State:` line). On a terminal (stdout is a TTY) a header row is printed first and the name is cut with `…` to fit the terminal width; piped / agent output (non-TTY) has no header, is never truncated and keeps this column order.

**Milestone refs:** every `<identifier>` / `<ref>` that names a milestone (`show`, `update`, `delete`, `archive`, `unarchive`, `add`, `remove`, `triage`, `reorder`, `move`, `testcase … <milestone>`, `task create|update|list --milestone`) takes the milestone's **slug** — the `SLUG` column here and the segment of the web URL (`/projects/<project>/milestones/<slug>`) — or its name (case-insensitive), or its id (old scripts). An exact slug wins over a name; a name shared by several milestones, or a slug present in two projects, is **rejected** with every candidate listed by slug (`beta ("Beta"), beta-2 ("Beta")`) — nothing is picked silently. Without `--project`, a workspace with several projects is searched whole; pass `--project <ref>` when the same slug exists in two projects. `SLUG` prints `-` from an older server that sends none.

By default, only **non-archived** milestones are listed. Use `--archived` to show **only** archived milestones, or `--all` to show **both** archived and non-archived. Archived rows show `ARCHIVED` in the `STATE` column.

Use `--search <text>` to filter to milestones whose **name or description** contains the text (case-insensitive substring match). It applies **on top of** the archive filter (e.g. `--all --search q3`). A blank/whitespace-only value is ignored (no filtering). The matched text is bounded to 120 chars server-side.

- `--project <ref>` (string) — Required when the workspace has more than one project. Name or slug, case-insensitive.
- `--archived` (boolean) — Show **only** archived milestones (instead of the default non-archived set).
- `--all` (boolean) — Show **both** archived and non-archived milestones.
- `--search <text>` (string) — Filter by **name/description** case-insensitive substring. Combines with the archive filter; blank value ignored.
- `--limit <n>` (integer) — Milestones per page (1-500, default 50). More ends with `Showing X-Y of N.` + the next-page command.
- `--cursor <c>` (string) — Next page, copied from the footer (see **Paging** in [task-list.md](task-list.md)).

`HEALTH` is the target-date risk light, server-computed from the milestone's target date + task progress:

- `ON_TRACK` — on schedule (or all tasks done)
- `AT_RISK` — completion lags elapsed time, or (no start date) the target is within ~7 days with work remaining
- `OVERDUE` — past the target date with tasks still open
- `-` — no light applies (the milestone is completed or archived, or has no target date)

```bash
lumo milestone list                  # one-project workspace (non-archived only)
lumo milestone list --project lumo   # multi-project workspace
lumo milestone list --archived       # only archived milestones
lumo milestone list --all            # archived + non-archived (archived rows: STATE ARCHIVED)
lumo milestone list --search q3      # name/description contains "q3" (case-insensitive)
lumo milestone list --all --search launch   # search across archived + non-archived
```

`--project <ref>` is required when the workspace has more than one project (consistent with `task create --project`). Match is by project name or slug, case-insensitive.

### When to suggest `milestone list`

- Before suggesting `task create --milestone <ref>` or `task update --milestone <ref>` to confirm the milestone exists under the expected name.
- When the user asks "what milestones do we have", "what's on v1.0", or similar.
- When the user wants to **find/search milestones by keyword** ("find the launch milestone", "which milestones mention X") — use `--search <text>` rather than listing all and eyeballing.

- Before `task create --project <ref>` when the workspace has more than one project and the user hasn't specified which one (`lumo project list`).

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

On success: `Created milestone "Q3 Launch"  <slug>` (the slug every other milestone command takes; nothing after the title from an older server that returns no slug).

### `lumo milestone update <identifier>` — patch a milestone

- `--project <ref>` (string) — Required when identifier is a name and workspace has >1 project.
- `-n, --name <text>` (string) — Cannot be empty.
- `-d, --description <>` (string) — `--description ""` clears.
- `--start <date>` (string) — `--start ""` clears.
- `--target <date>` (string) — `--target ""` clears.
- `--token-budget <n>` (int) — Advisory token budget, positive integer; `--token-budget ""` clears.

At least one field required.

**Token budget is advisory only:** the web Overview's tokens KPI card shows burn vs budget, and when the MEASURED burn exceeds the budget an advisory alert appears in the Risk & pending queue. Nothing is ever blocked by it — no hard gate. Unmeasured burn reads as unknown, never as over/under budget.

**When to suggest**: when the user wants to cap/track token spend on a milestone ("给这个 milestone 设 token 预算 / budget"), or asks why the Overview shows an over-budget alert.

**There is no status flag — state is derived.** A milestone is `active`, `completed`, or `archived`, and only one of those is a choice:

- **completed** follows task completion. Every task DONE → the rollup stamps `completedAt` and triggers the retro summary; a non-DONE task (re)appearing clears the stamp. Nothing you can pass to `update` moves it.
- **archived** is the one explicit human state (`milestone archive` / `unarchive`). Archived milestones are left alone by the rollup and hidden from the default list.

A milestone whose tasks have not started is simply active; dropping one is expressed by archiving it (archived while incomplete reads as dropped, not delivered).

**The close is gated by milestone test cases:** the derived completion needs the gate open. A milestone test case holds the gate until its latest run is a PASS (or a proven defect was dispositioned KNOWN_DEFECT); a milestone with no test cases has an open gate. While held, all tasks DONE leaves the milestone active, `completedAt` unstamped, no retro. `lumo milestone show` prints a `Close gate:` row (`open`, `held (1 not run, 1 failing, ...)`, or `unknown (could not read)` when the server failed to read the gate — treat that as not open). There is **no CLI/agent override**: the only escape hatch is a human using the **Close anyway** button on the milestone page (`POST /api/milestones/<id>/close-override`, Clerk identity only), stamped on the milestone as a persistent trail (`completedOverride*` - who/when/note, never auto-cleared). To open the gate legitimately, record passing runs with `lumo milestone testcase run`.

```bash
lumo milestone update "Q3 Launch" --target 2026-09-15
lumo milestone update "Q3 Launch" --description ""
lumo milestone update "Q3 Launch" --token-budget 50000000
lumo milestone update "Q3 Launch" --token-budget ""
```

### `lumo milestone delete <identifier>` — delete a milestone

Gated by the confirmation protocol ([confirmation.md](confirmation.md)): without `--confirm` the CLI exits **4** with an envelope (`Will delete milestone "Q3 Launch"` · `12 tasks under it keep their data; only milestoneId is cleared`) and deletes nothing — relay it to the user and re-run `confirmCommand` on approval. Tasks under the milestone keep their data; their `milestoneId` is cleared.

```bash
lumo milestone delete "Q3 Launch"            # exit 4 + envelope
lumo milestone delete "Q3 Launch" --confirm  # after the user approved
```

### `lumo milestone archive <identifier>` — soft-archive a milestone

Soft-archives a milestone by setting `archivedAt`. The milestone is **hidden from `milestone list` by default** (use `--archived` or `--all` to see it), but its **history and task links are preserved**, and the action is **reversible** via `milestone unarchive`. This is distinct from `milestone delete`, which is a **hard delete**. While archived, the milestone **rejects edits** (`milestone update`) and **new task bindings** (`task --milestone`, `milestone add`) with a 409 until it is restored. `<identifier>` accepts the slug, name or id (see **Milestone refs**).

```bash
lumo milestone archive "Q3 Launch"
lumo milestone archive 11111111-2222-3333-4444-555555555555
```

### `lumo milestone unarchive <identifier>` — restore an archived milestone

Restores an archived milestone by clearing `archivedAt`. It reappears in `milestone list` and can be edited and bound to tasks again. Idempotent — unarchiving an already-active milestone is a no-op. Same identifier / `--project` rules as `milestone archive`: `<identifier>` accepts the slug, name or id (see **Milestone refs**).

```bash
lumo milestone unarchive "Q3 Launch"
```

### `lumo milestone add <identifier> <task...>` — bind tasks to a milestone (batch)

Binds **one or more** tasks to a milestone in a single call — the batch counterpart of `task update --milestone <ref>` (which only takes one task at a time). `<identifier>` accepts the milestone slug, name or id (see **Milestone refs**); each `<task>` accepts `LUM-N` or a task UUID.

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

Unbinds **one or more** tasks from a milestone in one call. A task that is **not currently in this milestone is skipped** (idempotent) — it is never reassigned away from a different milestone. `<identifier>` accepts the slug, name or id (see **Milestone refs**); each `<task>` accepts `LUM-N` or a task UUID.

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

### `lumo milestone triage <identifier> <task...> --claimable | --not-claimable` — steward batch agent-claimable triage

The **steward's batch annotation** for the F4/自治边界 loop. Marks **one or more** in-milestone tasks agent-claimable (or not) in one call — the "可领范围" leg of the autonomy-boundary triad (契约 F1 / 预算 F2 / 可领范围 F4). Exactly one direction is required: `--claimable` or `--not-claimable` (mutually exclusive; the CLI errors before any network call if both or neither is given).

Mirrors `milestone add/remove`: dedupes refs, and a task **not in this milestone is skipped** (triage is milestone-scoped, never touches tasks elsewhere). `<identifier>` accepts the slug, name or id (see **Milestone refs**); each `<task>` accepts `LUM-N` or a task UUID. Best-effort — partial failures do not roll back.

Setting the marker is a **governance** action, so a STEWARD session (`lumo session attach --steward <milestone>`) passes the server-side binding guard. `claimable` is **fail-closed**: a task is not auto-claimable until triaged. Once tasks are triaged, an agent runs `lumo status --next --claimable` to get only claimable ∩ unblocked (F3) ∩ in-budget (F2) work. A single task can also be toggled with `lumo task update <id> --claimable | --not-claimable`.

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
