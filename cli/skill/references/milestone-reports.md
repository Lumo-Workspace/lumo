# Milestone reports & ordering

`milestone show` and its sections, `--summary`, `--changelog`, `reorder`, `move`. Milestone refs and CRUD: [milestones.md](milestones.md).

### `lumo milestone show <identifier>` — show milestone detail + tasks

`--json` prints `{ version, milestone, tasks }` (the server's milestone payload — task counts, health, close gate, metrics — and its tasks).

Accepts the slug, the name or the id (see **Milestone refs** above).

Prints a `<slug>  <name>` first line (just the name when the server sends no slug), then `Label:  value` rows padded to the widest label (`State:`, `Completed:`, `Archived:`, **`Health:`**, `Start:`, `Target:`, `Project:`), then headed sections (the same grammar as `task status` — a blank line and a plain heading, bold on a TTY; rows indented two spaces): **Description** (wrapped at the terminal width — 40 to 100 columns, 100 when piped — every line indented; `-` when empty), **Progress** (`Done:  3 / 6`, `By status:  TODO 1 · IN_PROGRESS 2 · IN_REVIEW 0 · DONE 3`, and `Backlog:  N (not in the total)` only when there is BACKLOG work), **Metrics**, **Sprint coverage**, **Cross-milestone learning**, and **Tasks (N)** — the task table indented two spaces (header row `ID  STATUS  PRIORITY  PROJECT  TITLE` on a TTY only, title cut to the terminal width there; piped output is headerless and untruncated), or `None — no task is in this milestone.` The `Health:` row shows the same target-date risk light as `milestone list` (`ON-TRACK` / `AT-RISK` / `OVERDUE`, or `-` when none applies).

**Staleness hints:** the `State:` row is annotated `(stale — task progress indicates COMPLETED|ACTIVE; auto-updating)` when the stored `completedAt` disagrees with the task counts (the server self-heals the drift in the background — a re-read shows the corrected state), and the `Target:` row is annotated `(no target date — schedule health unavailable)` for an in-flight milestone with no target date.

The **Sprint coverage** section (above the task table) lists which
sprints the milestone's tasks span — one table row per sprint with number, status, name,
and `done/total` progress (header `SPRINT  STATUS  NAME  PROGRESS` on a TTY only) — plus an
`Unscheduled` row counting milestone tasks not in any sprint (shown only when there are any).
The section is derived from the milestone's tasks (no schema relation), so it needs no extra
flags. When no task is in any sprint it prints `None — no task of this milestone is in a sprint.`

Example coverage section (piped):

```
Sprint coverage
  #3           ACTIVE  Sprint 3  4/6 done
  #4           DRAFT   Sprint 4  0/2 done
  Unscheduled                    1 task
```

**Metrics:** the text twin of the web milestone page's metric strip, same numbers (`/api/milestones/<id>` `costRollup` / `budget` / `deliveryStats`). Rows: `Tokens:` (compact total + `(measured on M of N tasks)`), `Budget:` (only when a token budget is set — `71% of 400M token budget`, `(over budget by X)` when the MEASURED burn exceeds it, `- of … (burn not measured)` when unmeasured; advisory only), `Active time:` (non-idle session time), `Merged PRs:` (`5  (rework: 1 task with more than one PR)`, or `No PRs on record`). Then three **By task** blocks (only from servers that send the per-task breakdown), each listing the top 10 tasks by its own number (the rest counted as `Showing 10 of N (all of them in --json).`), figures first and the title last (cut to the width on a TTY, where a header row prints): `By task — tokens` (tokens, then the top-3 per-model split — on the line under the row on a TTY, as one more TAB field on the row when piped — `+N more models`, and spend not attributed to a model), `By task — active time`, `By task — PRs` (PR count, `multi-PR` = rework, `+adds/−dels` or `no synced PRs`). **Unmeasured reads `-`, never 0** — `Tokens: -` / `Active time: -` mean nothing was measured, not zero spend. Durations use the CLI's usual `2h 14m` spelling. The section is omitted when the server sends neither rollup (older server).

```
Metrics
  Tokens:       283.5M  (measured on 2 of 8 tasks)
  Budget:       71% of 400M token budget
  Active time:  2h 59m  (non-idle session time)
  Merged PRs:   5  (rework: 1 task with more than one PR)

  By task — tokens
    LUM-497  201.2M tokens  reference-class anchors
      claude-opus-5 168.4M · claude-haiku-5 32.8M
    LUM-707  82.3M tokens   deferred cleanups
      82.3M not attributed to a model

  By task — active time
    LUM-497  2h 5m  reference-class anchors
    LUM-707  54m    deferred cleanups

  By task — PRs
    LUM-497  4 PRs  multi-PR  +2.1K/−140     reference-class anchors
    LUM-707  1 PR             no synced PRs  deferred cleanups
```

**Cross-milestone learning:** when this milestone's STEWARD sessions were injected prior-milestone distilled learning, a **Cross-milestone learning** section reports how much of it was actually used — `Injected: N prior learnings (from K prior milestones)` and `Usage rate: Z% (judged-used X/Y)`. The rate reuses lineage's `used=true/false/null` usage voting (judged at the successor milestone's close): abstentions (un-audited / judge-abstained impressions) are **excluded from the denominator**, so it is a lower bound. Below 3 judged edges it reads `insufficient (judged Y, need ≥3)` rather than a fabricated percentage. The section is omitted entirely when nothing was injected (that's "nothing to migrate", not 0%).

```
Cross-milestone learning
  Injected:    8 prior learnings (from 2 prior milestones)
  Usage rate:  63% (judged-used 5/8)
```

```bash
lumo milestone show "Q3 Launch"
lumo milestone show 11111111-2222-3333-4444-555555555555
```

### `lumo milestone show <identifier> --summary` — the AI-generated milestone retro

An aspect of `milestone show`: the detail view, then a **Summary** section with the AI-generated retrospective (mirrors `sprint show --summary`); `--json` adds `summary` (`{ stats, tldr, report }`, `null` when none) to the envelope. A failed read is one `Could not read (…)` line, never a failed show. Regenerate with `lumo milestone update <identifier> --refresh-summary`. `<identifier>` accepts the milestone slug, name or id (see **Milestone refs**). When no summary exists yet the section reads `(no summary generated yet)`.

A summary is generated automatically when a milestone completes (the derived transition: its last open task turns DONE, with the test-case close gate open). The generated report has sections `## Summary`, `## Delivered`, `## Outstanding` plus a one-line `tldr`. `milestone update --refresh-summary` queues regeneration (e.g. after a failed generation; it can be combined with field flags) — regeneration is async, so read it again with `--summary` once it is done.

- `--project <ref>` (string) — Project name or slug. Narrows the milestone lookup; needed only when the slug exists in two projects.

```bash
lumo milestone show "Q3 Launch" --summary
lumo milestone update "Q3 Launch" --refresh-summary   # only on a COMPLETED milestone
lumo milestone show 11111111-2222-3333-4444-555555555555 --summary --changelog
```

When to suggest: user asks "summarize the milestone", "milestone retro", "give me a summary of the Q3 milestone".

### `lumo milestone show <identifier> --changelog [--project <ref>] [--json]` — structured changelog

An aspect of `milestone show`: the detail view, then a **Changelog** section; with `--json` the payload is the `changelog` key of the show envelope. Assembles a **structured changelog** from the milestone's **DONE tasks + merged PRs + frozen claimSnapshot**. Pure deterministic assembly — **no LLM**, and (unlike `summary`) **no completion gate**: it runs on a milestone in any state, so an active milestone reports "what has shipped so far". Only DONE tasks ever appear. `<identifier>` accepts the milestone slug, name or id (see **Milestone refs**).

Honest-reporting contract (why this is more than a task list):

- **Headline counts carry a baseline .** "Tasks shipped" and "PRs merged" are rendered as a current-vs-base stat against the reference class of **prior COMPLETED milestones in the same project** — e.g. `4 (base 3, +33% · above)`. With **fewer than 3** prior milestones the base is honestly suppressed to `4 (no baseline yet)` — never a naked number, never a thin fabricated baseline.
- **Claim provenance.** Each DONE task shows its frozen `claimSnapshot` tagged with its source + session (`Claim [RUN_SUMMARY · sess-1]: …`). A synthesized-but-empty claim reads `(no claim recorded)` (fail-closed "no material"), distinct from a never-synthesized `(not synthesized)`.
- **Nothing silently dropped.** A DONE task with no merged PR renders an explicit `PRs: (no merged PR)`. Entries are ordered newest-delivery-first (by task `updatedAt` — Task has no `completedAt` column, so this is a best-available proxy).

`--json` emits the structured payload (milestone / headline baseline stats / entries) for programmatic use, every field unchanged plus `version`.

- `--project <ref>` (string) — Project name or slug. Narrows the milestone lookup; needed only when the slug exists in two projects.
- `--json` (boolean) — Emit the raw structured changelog payload instead of the human markdown.

```bash
lumo milestone show "Agent-Native Milestones" --changelog
lumo milestone show "Agent-Native Milestones" --changelog --json
lumo milestone show 11111111-2222-3333-4444-555555555555 --changelog
```

When to suggest: user asks for a "changelog", "release notes", "what shipped in this milestone", or wants a structured delivery list they can paste into a release note. For the AI narrative retro use `milestone show --summary`; for the honest delivery-count/cost rollup see `milestone show`.

### `lumo milestone reorder <ref...> [--project <ref>]` — set the full milestone order

Reorders a project's milestones. Pass **every** milestone in the project (by slug, by name (case-insensitive) or by id) in the desired order — the command rewrites each milestone's `sortOrder` to match. An incomplete list (not every milestone named), an unknown ref, or a duplicate is rejected **before any network mutation**, with a message naming the offending / missing milestones.

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

Moves a single milestone immediately before or after a target milestone, leaving the rest in their current relative order. `--before` and `--after` are **mutually exclusive and exactly one is required** (the CLI errors before any network call if both or neither is given). Refs resolve by slug, case-insensitive name or id.

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

**Ambiguous names:** milestone names are not unique within a project (only the slug is). A ref whose name matches more than one milestone is **rejected** with an `ambiguous milestone … re-run with one of these slugs` error listing the candidates as `<slug> ("<name>")` — pass the slug instead. This applies to every name-based milestone ref (`reorder`, `move`, and also `show` / `update` / `delete` / `summary` / `add` / `remove`).

When to suggest: user asks to "reorder milestones", "move milestone X before/after Y", "put this milestone first".
