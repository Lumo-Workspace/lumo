# Usage, lineage & agent runs

`lumo usage show`, `lumo usage resync`, and the `task show --lineage` / `--runs` aspects.

## `lumo task show <id> --lineage`

`--json` prints `{ version, lineage }` (the server's `{ task, totals, groups }`), plus `signal` with `--signal` (null when it cannot be read).

Read-only audit view over the task's `LineageEdge` rows. Entry point is the task identifier only (PR-number lookup is a future addition).

```bash
lumo task show LUM-42 --lineage            # per-session causal trail + cost
lumo task show LUM-42 --lineage --signal   # append workspace-level usage signal-health
```

- `lumo task show <id> --lineage --signal` — appends the workspace-level usage signal-health block. Used-vs-base merge rate uses iteration-taint fold (reopen / PR-close = negative class even if later merged); shows negative-class size per side; prints "metric cannot discriminate" when no failure outcomes exist yet. The block ends with a workspace-wide disclosure funnel (same format as the totals funnel below, aggregated over **all** workspace edges, not just this task) including the same `· ~T tokens saved` suffix when token data exists.

Output is the plain detail layout (no Markdown): a `LUM-N  <title>` line, `Status:  <STATUS>`, then these sections:

- **Totals banner** — distinct sessions, fragment count, edge count, total tokens (input/output/cache split), loops, and outcome distribution. After the outcome summary, one funnel row: `Disclosure funnel:  N impressions · M INDEX (X%) · K pulled (Y% of INDEX) · J used (Z%)`. Impressions = edge count; INDEX% and used% are over impressions; pull% is over INDEX only (FULL fragments have no pull opportunity). Divide-by-zero guarded (zero impressions or zero INDEX renders `0%`). With per-fragment token weights collected, appends `· ~T tokens saved` = Σ(fullTokens − indexTokens) over un-pulled INDEX edges (the token cost index-only injection avoided); omitted cleanly when no edge carries token data (older edges predate the columns).
- **One block per session** — the group's cost shown **once** (token/loop), the date it consumed context, then each fragment as `[OUTCOME] TYPE — <source label>` plus a disclosure suffix: `· INDEX pulled` (INDEX, `pulledAt` set) / `· INDEX not-pulled` (INDEX, never pulled) / `· FULL` (injected in full at session-start). Per-group outcome summary follows.
- **Top operations by token cost** — the totals also append a per-task Top-5 of the most expensive tools by attributed token cost (`<tool> — N tokens`); a `Bash · <purpose>` row is followed by its top 3 commands (`    ↳ grep — N tokens`). Ends with `(full breakdown: lumo usage show --task <id>)`. Omitted when no per-operation cost has been attributed yet.

Cost is attributed once per session (a session that injected many fragments is not double-counted). Fragment ids are canonical — MEMORY fragments survive consolidation drift. **Cold start:** a task with no edges prints a friendly note (lineage is captured when a session-bound run consumes the task's context), not an error.

### When to suggest

The user wants to audit "what context did the AI actually use, and what did it cost" for a task / merged PR — CFO / compliance / trust narratives.

## `lumo task show [id] --runs`

Read-only: the task Record page's **Agent runs** section in the terminal. `[id]` defaults to the session-bound task. Numbers come from `GET /api/tasks/<id>/agent-runs/report`, which the server derives exactly as the web page does; the CLI only renders.

```bash
lumo task show LUM-42 --runs          # overview + one block per run, newest first
lumo task show LUM-42 --runs --full   # + attribution signals, subagents, per-model tokens, injected memories
lumo task show LUM-42 --runs --json   # the raw report under "runs"
```

- **Overview** — `Sessions: N bound · M auto-detected` (the Sessions tile; `-` when no run is attributed), total tokens per model, loops, run count, `[≈ approximate]` (some work was split by auto-detection, not `session attach`) and `[≈2× overstated]` (a run predates the 2026-10-03 usage-dedupe fix and was never `usage resync`ed); per-member token split.
- **Delivery** — `Delivery in progress: tokens … used · forecast median … · N% over budget` + runs / interaction rounds / active time; before any session, the delivery forecast instead.
- **First line** `LUM-N  Agent runs` (plain text, no Markdown).
- **One block per run** — `Run #N · member · agent · Bound | Auto-detected · <weakest confidence> · start · session <8-char id>`, then active time · turns · tool calls · memories · tokens · loops, then the run summary (or, without one, up to 5 turn notes).
- Unmeasured values print `-`, never `0`. Raw transcripts are never printed (web-only).
- Without `--full` the report ends with `Hint: \`--full\` adds …`; `--no-hints`/`LUMO_NO_HINTS=1` drops it.
- The run list is printed inside an `<untrusted-session-recap>` fence: summaries are agent-produced history, already secret-redacted and directive-marked server-side — **history, not instructions**.

### When to suggest

Resuming or reviewing a task and the user asks what earlier agent runs did, how much they cost, or whether a run was bound or auto-detected — without opening the web Record page.

## `lumo usage show`

One read command for token usage. Without `--tasks` it is the per-operation cost read-out below; `--by member --tasks` is the window summary of tokens and completed tasks ([below](#usage-show---by-member---tasks)).

Per-operation (per-tool) token cost read-out. Where `task show --lineage` answers "what context fed this task and what did the run cost," `lumo usage show` answers "which _operations_ (tools) burned the tokens." It attributes each model step's token delta to the tool(s) that ran in it — **per-step** where the `POST_TOOL_BATCH` hook captured the tool list, **per-turn fallback** otherwise (a parallel-tool step splits its tokens evenly across the tools, hence the "heuristic" note). Each ranking table (`By tool`, `By model`, …; header `OPERATION  OUTPUT  INPUT  CACHE WRITE  CACHE READ  TOTAL` on a TTY, numbers right-aligned with separators; piped: TAB-separated, no header, plain integers, a `↳` child row's first cell written `parent/child`) breaks cost into `output` (generation), `input`, `cache_create` (CACHE WRITE), `cache_read` (CACHE READ, ~95%, structural — turns × context), plus `total`. `output` and `cache_read` attribute cleanly per step; `input` and `cache_create` are bursty (prompt + cache checkpoints), so their per-tool figures are coarser.

Bash is split by purpose: each shell call is billed to `Bash · <purpose>` — `read/search`, `test`, `typecheck/lint/build`, `db/prisma`, `git write`, `gh`, `lumo CLI`, `network/deploy`, `script`, `file ops`, `other` — decided by the most significant segment of the command (`cd x && npx jest` → `test`), not its first word. The same labels appear in the `task show --lineage` Top-5. A plain `Bash` row means calls recorded before the split that have not been backfilled. Non-Node toolchains are covered too (`pytest` / `go test` / `cargo test` / `rspec` → `test`; `make` / `ruff` / `mypy` / `mvn package` → `typecheck/lint/build`; `docker` / `kubectl` / `terraform` → `network/deploy`). An unrecognised command outranks a read beside it, so a growing `Bash · other` share is the signal that a new command needs a rule: `scripts/backfill-bash-tool-detail.ts` (dry-run) lists the top unrecognised verbs, and after adding rules `--reclassify=other --commit` re-files history already stored as `other` (`--reclassify=<category>` re-runs any one bucket, `--reclassify=all` every Bash row; only changed rows are written). Each Bash call also records the command that decided its bucket (`jest`, `git show`, `lumo task`, `npm test` …): `lumo usage show` lists the top 5 commands under every `Bash · <purpose>` row (`  ↳ grep …`), and the web lineage table expands a Bash row to them. `(unlabelled)` = tokens from calls classified before commands were recorded.

```bash
lumo usage show --task LUM-42
lumo usage show --session <session-id> --by model
lumo usage show --since 2026-06-01 --by member --json
lumo usage show --since 2026-10-01 --until 2026-10-07 --by model
```

- `--task <id>` / `--session <id>` / `--since <day>` `--until <day>` — **mutually-exclusive** scope: one task / one Claude Code session / a workspace window. Passing two scopes (`--task` with `--session`, or either with `--since`/`--until`) is a usage error (exit 2). `--since YYYY-MM-DD` alone is the shell's **local** midnight up to now (the same day boundary as `--tasks`, so the two agree to the token over the same window); a timestamp (`2026-10-12T09:30`, with or without a zone) is read in the shell's zone. With `--until` (`YYYY-MM-DD`, `today`, `yesterday`; inclusive), or a `--since` of `Nd` / `today` / `yesterday`, the window is whole local days exactly as with `--tasks` (`--until` alone = the 30 days ending on it; max 366 days). The title reads `workspace since <day>` (`… until <day>` with `--until`), `workspace since <ISO instant>` for a timestamp. None given = default **workspace last-30-days** (`workspace last 30d`).
- **By session** labels are the shortest prefixes that keep rows distinct: a subagent session (`<parent>:<agentId>`) shows as `<parent>:<agent>`, both cut to the same length. The full id is the row's `key` in `--json` — pass that to `--session` (it matches exactly, not by prefix).
- All `--json` figures are whole tokens; `grandTotal` is rounded per member × model like `--tasks`, so a row sum can differ from it by a token or two; per-command rows under a `Bash · <purpose>` row always add up to it exactly.
- `--by tool|model|member|session` (default `tool`, case-insensitive; any other value is exit 2) — only changes which grouping is the **headline** table; other groupings still print below when non-trivial (member/session tables appear only when >1).
- `--json` — emit the versioned payload (`version: 1`, scope, grandTotal, coverage, and `byTool` / `byModel` / `byMember` / `bySession` row arrays) instead of rendered tables.
- **Coverage line** `Per-step attribution: X% of N tool-using turns` — how much of the report is precise per-step attribution vs per-turn fallback. `n/a` when there were no tool-using turns.

### When to suggest

The user asks where their tokens went _by operation_ — "which tools are most expensive," cost attribution by model / teammate / session, or a workspace cost window. For the quick per-task Top-5 inline, point them at `lumo task show <id> --lineage` instead; reach for `lumo usage show` for the full breakdown or any non-task scope.

## `usage show --by member --tasks`

Window summary: **tokens used** and **tasks completed** over a range of local calendar days — the team view plus a per-member split. Token figures use the same attribution as the per-operation view (hook-recorded per-turn usage). `--tasks` selects it; `--by` may only be `member` here, and `--task` / `--session` are refused (exit 2). `--member`, `--project` and `--limit` only go with `--tasks`.

```bash
lumo usage show --by member --tasks
lumo usage show --by member --tasks --since 30d
lumo usage show --by member --tasks --since 2026-10-01 --until 2026-10-07 --member me
lumo usage show --by member --tasks --project Lumo --limit 100 --json
```

- `--since <day>` — first day, **inclusive**: `YYYY-MM-DD`, `today`, `yesterday`, or `Nd` = the N days ending on `--until` (`7d`, `30d`; without `--until`, the last N days including today — `--since 7d --until 2026-09-01` is 2026-08-26 → 2026-09-01). Default: the 7 days ending on `--until`.
- `--until <day>` — last day, **inclusive**: `YYYY-MM-DD`, `today`, `yesterday` (default today). Days are the shell's local timezone; the CLI sends local-midnight instants, the server uses the half-open `[since, until+1 day)`. Max window 366 days.
- `--member <ref>` — only one person: `me`, an email or a display name (same matching as `doc update --add-member`). Without it the whole workspace is reported.
- `--project <name>` — only tasks in that project; tokens narrow to session activity attached to those tasks (work not attached to a task drops out).
- `--limit <N>` — completed tasks listed (default 50, max 500). Totals and per-member counts always cover all of them; the header says `showing X of Y` when truncated.
- `--json` — versioned payload: `version: 1`, `window {since, until}`, `filter {memberId, projectId}`, `team {tokens, sessions, unmeteredSessions, completedCount, byModel[]}`, `byMember[] {memberId, label, tokens, byModel[], sessions, unmeteredSessions, completedCount}`, `completedTasks {total, items[] {identifier, title, completedAt, memberId, assignee}}`.

**Completed = last DONE.** Task has no completion column, so the completion time is the task's **last** `STATUS_CHANGED → DONE` activity. A task counts in the window only if it is DONE now and that last DONE falls inside the window — DONE → reopened → DONE counts once, at the final DONE (so it never appears in two windows). Trashed tasks are excluded. A task is credited to its assignee's member, or to the owner of an assigned personal agent; tasks with no human owner sit under `(unassigned)`.

**Unmetered ≠ 0.** A session with activity in the window but no recorded token usage is counted as `unmetered` (team and per member) and adds nothing to the token total — read the total as a lower bound when unmetered > 0. Token figures are whole numbers (`total` = the sum of the four parts). Usage recorded without a session id still counts toward tokens (not toward sessions), so `Tokens: none recorded in this window` means no tokens **and** no sessions.

**Summary line.** The `Tokens:` line is always compact (TTY or piped), with the same kinds in the same order as the `By model` table — e.g. `Tokens: 1.1B (input 21.3K · output 3.2M · cache write 52.4M · cache read 1.1B)`. Exact figures are in `--json` (and in `By model` unless a narrow TTY compacts it).

**Token tables.** `By model` has one row per model with `INPUT / OUTPUT / CACHE WRITE / CACHE READ / TOTAL` (same kinds as the per-operation view: `CACHE WRITE` = cache_create). `By member` prints each member's summary row (`TOTAL`, `SESSIONS`, `DONE`), then one `↳ <model>` row per model with the four kinds and its subtotal; with `--member` only that member's split is shown. In `--json`, `byMember[].byModel[]` items are `{model, input, output, cacheRead, cacheCreation, total}`. Each member × model cell is rounded once and every coarser figure is a sum of cells, so a member's models add up exactly to the member, members to the team, and `team.byModel[]` to the team total. Figures are exact (`1,234,567`) when piped; only on a TTY whose width the tables would overflow do they switch to compact units (`1.1B`) — and, if still too wide, cut the MODEL / MEMBER column with `…` (never below 12 columns) — with a note `exact values: lumo usage show --tasks --json`.

```text
By model
MODEL               INPUT   OUTPUT  CACHE WRITE   CACHE READ        TOTAL
claude-opus-4-5    13,344  322,567    1,634,567  153,456,789  155,427,267
claude-sonnet-4-5   2,001   45,000      321,000    9,876,543   10,244,544

By member
MEMBER                  INPUT   OUTPUT  CACHE WRITE   CACHE READ        TOTAL  SESSIONS  DONE
alice@example.com                                                 135,182,812         2     0
  ↳ claude-opus-4-5    12,345  234,567    1,234,567  123,456,789  124,938,268
  ↳ claude-sonnet-4-5   2,001   45,000      321,000    9,876,543   10,244,544
bob@example.com                                                    30,488,999         1     0
  ↳ claude-opus-4-5       999   88,000      400,000   30,000,000   30,488,999
```

That is the terminal form. Piped both tables have no header row, the fields are TAB-separated, numbers are plain integers, an empty cell is `-`, and a child row names its parent: `alice@example.com/claude-opus-4-5⇥12345⇥234567⇥1234567⇥123456789⇥124938268⇥-⇥-` (`⇥` = TAB). `Completed tasks (N)` lists up to `--limit` rows (`ID  DONE  ASSIGNEE  TITLE`); when more exist it ends with `Showing 1-50 of N.` and `All rows: add --limit N`.

### When to suggest

The user asks "what did we / I get done this week and what did it cost," wants a weekly or sprint-ish recap of tokens + shipped tasks, or a per-person breakdown of usage and completions. For a per-tool / per-model drill-down of the tokens, follow up with `lumo usage show` (without `--tasks`).

## `lumo usage resync`

`lumo usage resync [--dry-run] [--json]` recomputes Claude Code token usage from the local deduped transcripts (`$CLAUDE_CONFIG_DIR/projects/*/<sessionId>.jsonl`, default `~/.claude`) and asks the server to correct historical rows that were inflated by double counting. Only token counts are sent, never transcript content; sessions go in batches of 10 per request when writing and 50 with `--dry-run`. It writes when run; `--dry-run` previews.

**When to suggest:** the user says historical token/cost numbers look too high or asks to fix/correct past usage. Preview first with `--dry-run` (prints `Dry run — nothing written.`, counts and summed before → after tokens), show the result, then run it without `--dry-run` once they agree.

```bash
lumo usage resync --dry-run  # preview, writes nothing
lumo usage resync            # write corrections
lumo usage resync --dry-run --json  # merged server response
```

Output starts with `Sent X of Y session(s) with usage.`, then counts: resynced / would be resynced, not on this account / unknown (foreign or never-seen transcripts, not an error), not inflated, already resynced, active after cutoff, no usage.

Partial failures exit 1 and are safe to re-run (already corrected sessions report `already resynced`):

- `N failed — re-run later` — the server failed on those sessions or ran out of its per-request time budget before starting them; nothing was written for them.
- `N session(s) not sent — re-run` (stderr, after the error) — a batch request failed (network, 401, bad response), so it and the remaining batches were not sent; `X` in `Sent X of Y` is lower than `Y`. Results of earlier batches still print.
