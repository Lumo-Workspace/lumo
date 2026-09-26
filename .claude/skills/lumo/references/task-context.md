# Task Context Loading & Context Retrieval

## Task Context Loading

Load context when the user mentions a task identifier or asks for task background:

```bash
lumo task context LUM-42
```

### Reading the output

The command prints a markdown document to stdout with these sections, in order:

1. **Task header** — identifier, title, status, description.
2. **`## Acceptance criteria (contract)`** — shown right after the header. Each line `[MACHINE|HUMAN] statement`, with a `↳ check:` line for MACHINE checkpointers; HUMAN_EDIT / REVIEW_ADDED provenance tagged inline. A still-open task with none shows a draft reminder instead — draft 3–7 criteria **before writing code** — followed by a `### Reference class (outside view)` block giving the failure modes of similar delivered tasks, to draft against rather than to copy (see [criteria.md](criteria.md)).
3. **Memory section** — cross-session learnings; trusted background context that persists, so you avoid re-learning decisions/constraints.
4. **Inline source cards** — Slack / web / Figma / artifacts / documents / comments / Pull Requests (see "Context Retrieval" below).
5. **`## PR review todos`** — mirrored PR review comments as a checkbox todo list. Each line-level comment shows `` `file:line` `` + reviewer's ask + GitHub comment link; each `changes_requested` review summary shows "🛑 Changes requested (whole PR)". Present only when the task's PR(s) have review comments. Each unchecked box is a TODO: resolve it, then reply on the PR (a Lumo comment mirrors back to GitHub).
6. **`## Previous sessions`** — newest-first; each has a headline summary of what was done plus unresolved items (carry-over TODOs).
7. **`## Flywheel signal · historical merge contribution`** — appended at the very end. Per context fragment with enough history, a one-line signal (e.g. `appeared in 5 resolved tasks · 4 merged (80%)`) computed from lineage edges. Denominator = distinct tasks where the fragment appeared with a resolved (non-UNKNOWN) outcome; only fragments with ≥3 such tasks show (cold-start gate), so the block is often absent early on. **Historical correlation, not causation** — don't read it as a prediction.

**Auto-injected at session start** (when the session is bound to a task, so they surface without re-running `task context`):

- `## PR review todos` — injected alongside the memory section.
- **Inline source cards** (Slack / web / Figma / PR) — injected under a single global token budget shared with the memory section. Priority: criteria > memory > PR > Slack > Figma > web. Cards that don't fit degrade to a one-line manifest (title + its `lumo task … show` retrieval command) so you know they exist and can pull full content on demand.

### How to use the context

- **Unresolved items** from the most recent session are the highest-priority carry-overs — address them before new work unless the user says otherwise.
- Focus on the **most recent 1–2 sessions**; older sessions are historical reference only.
- **No prior sessions** = fresh start — read the task description carefully and ask clarifying questions if needed.

## Context Retrieval (full text on demand)

Context injection is split into tiers: `lumo task context <LUM-N>` emits a **cheap inline card** per source instead of dumping full bodies. Slack/docs/artifacts/comments get an **LLM summary**; web/Figma/PR get **metadata only**. Each card ends with the **retrieval command** for the heavy content.

Run the matching command below when the card isn't enough. Pass the same `LUM-N` plus the id the card shows for that source:

| source         | retrieval command                       | id from card |
| -------------- | --------------------------------------- | ------------ |
| Slack thread   | `lumo task slack show <id> <contextId>` | `contextId`  |
| Web link body  | `lumo task web show <id> <linkId>`      | `linkId`     |
| Figma metadata | `lumo task figma context <id> <linkId>` | `linkId`     |
| Comment thread | `lumo task comments list <id>`          | —            |
| PR detail      | `lumo task pr show <id> <number>`       | `number`     |

All five are **read-only** (no live Slack/GitHub/Figma calls except the web body fetch). Web/Figma/PR are v1 metadata-degraded: they print a `note:` saying live content needs an external integration.

**Output budget:** the whole `task context` handoff is capped to the output-token budget (25,000 tokens). On overflow, output is truncated and ends in a pointer to the precise sub-commands (`lumo task status` / `task comments list --full` / `task lineage` / `doc show`) to pull any dropped section just-in-time.

### `lumo task slack show <identifier> <contextId>` — full Slack thread snapshot

Prints the **stored** snapshot (no live Slack call), one line per message as `author: text`. Author falls back to `@<userId>` when the display name is missing. Empty snapshot prints `(no messages in stored snapshot)`. Registry secrets in message bodies are redacted server-side before printing (`AKIA…(len 20)` form, LUM-784); when any were, a trailing `⚠ N suspected credential(s) were redacted before injection …` line says so — the tokens are redactions, not the source text.

```bash
lumo task slack show LUM-42 ctx_abc123
```

### `lumo task web show <identifier> <linkId>` — fetched web link body

Fetches the page body on demand behind the SSRF guard (cached after first read), printed as plain text. Empty body prints `(empty body)`. Fetch failures (blocked host, timeout) print the server's error message. Registry secrets in the body are redacted server-side before printing, with the same trailing `⚠ N suspected credential(s) were redacted …` line as `slack show` when any were (LUM-784).

```bash
lumo task web show LUM-42 wl_abc123
```

### `lumo task figma context <identifier> <linkId>` — Figma link metadata

**v1 metadata fallback.** Prints cached design metadata as `file:` / `frame:` / `url:` / `synced:` lines (plus `syncError:` if the last sync failed). Live design context (layers, variables, code connect) requires the Figma MCP server, so the command ends with a `note:` saying so.

```bash
lumo task figma context LUM-42 cfl_abc123
```

### `lumo task comments list <identifier>` — comment thread

Prints the thread: each comment as `#<short id> · author · createdAt` then its plain-text body (bodies stored as HTML, stripped to text). Replies indent two spaces under their parent. Author falls back to `unknown`. No comments prints `(no comments)`.

- `lumo task comments list LUM-42` — capped to the output budget (25,000 tokens; every printed line spends from your context). On overflow, truncates and ends in a fetch-more pointer: `… +N more comments not shown (output capped at 25,000 tokens) — read the whole thread with: lumo task comments list <id> --full`.
- `lumo task comments list LUM-42 --full` — every comment, uncapped. Use only when you actually need the whole thread.

```bash
lumo task comments list LUM-42          # capped to the output budget
lumo task comments list LUM-42 --full   # every comment, no cap
```

**Plural, and distinct from `task comment`** — `task comments list` _reads_ the whole thread (this read-only retrieval command); `task comment <identifier> <body>` _writes_ a single new comment (see Task Management). Don't confuse the two. The `#<short id>` is the handle for `task comment --reply-to` and `task comments edit/rm` (LUM-821, see Task Management).

### `lumo task pr show <identifier> <number>` — synced PR metadata

**v1 metadata fallback.** Prints the synced PR record: a `#<number> (repo) title` header, then `state:` (` · draft` when draft), `ci:`, `author:`, `branch: <head> → <base>`, and `url:` lines. Live diff + review comments require the GitHub integration, so the command ends with a `note:` saying so.

```bash
lumo task pr show LUM-42 128
```

## `lumo task lineage <id>`

Read-only audit view over the task's `LineageEdge` rows. Entry point is the task identifier only (PR-number lookup is a future addition).

```bash
lumo task lineage LUM-42            # per-session causal trail + cost
lumo task lineage LUM-42 --signal   # append workspace-level usage signal-health
```

- `lumo task lineage <id> --signal` — appends the workspace-level usage signal-health block. Used-vs-base merge rate uses iteration-taint fold (send-back / reopen / PR-close = negative class even if later merged); shows negative-class size per side; prints "metric cannot discriminate" when no failure outcomes exist yet. The block ends with a workspace-wide disclosure funnel (same format as the totals funnel below, aggregated over **all** workspace edges, not just this task) including the same `· ~T tokens saved` suffix when token data exists.

Output sections:

- **Totals banner** — distinct sessions, fragment count, edge count, total tokens (input/output/cache split), loops, and outcome distribution. After the outcome summary, one funnel line: `- Disclosure funnel: N impressions · M INDEX (X%) · K pulled (Y% of INDEX) · J used (Z%)`. Impressions = edge count; INDEX% and used% are over impressions; pull% is over INDEX only (FULL fragments have no pull opportunity). Divide-by-zero guarded (zero impressions or zero INDEX renders `0%`). With per-fragment token weights collected, appends `· ~T tokens saved` = Σ(fullTokens − indexTokens) over un-pulled INDEX edges (the token cost index-only injection avoided); omitted cleanly when no edge carries token data (older edges predate the columns).
- **One block per session** — the group's cost shown **once** (token/loop), the date it consumed context, then each fragment as `[OUTCOME] TYPE — <source label>` plus a disclosure suffix: `· INDEX pulled` (INDEX, `pulledAt` set) / `· INDEX not-pulled` (INDEX, never pulled) / `· FULL` (injected in full at session-start). Per-group outcome summary follows.
- **Top operations by token cost** — the totals also append a per-task Top-5 of the most expensive tools by attributed token cost (`<tool> — N tokens`), ending with `(full breakdown: lumo cost --task <id>)`. Omitted when no per-operation cost has been attributed yet.

Cost is attributed once per session (a session that injected many fragments is not double-counted). Fragment ids are canonical — MEMORY fragments survive consolidation drift. **Cold start:** a task with no edges prints a friendly note (lineage is captured when a session-bound run consumes the task's context), not an error.

### When to suggest

The user wants to audit "what context did the AI actually use, and what did it cost" for a task / merged PR — CFO / compliance / trust narratives.

## `lumo cost`

Per-operation (per-tool) token cost read-out. Where `task lineage` answers "what context fed this task and what did the run cost," `lumo cost` answers "which _operations_ (tools) burned the tokens." It attributes each model step's token delta to the tool(s) that ran in it — **per-step** where the `POST_TOOL_BATCH` hook captured the tool list, **per-turn fallback** otherwise (a parallel-tool step splits its tokens evenly across the tools, hence the "heuristic" note). Each ranking row breaks cost into `output` (generation), `input`, `cache_create`, `cache_read` (~95%, structural — turns × context), plus `total`. `output` and `cache_read` attribute cleanly per step; `input` and `cache_create` are bursty (prompt + cache checkpoints), so their per-tool figures are coarser.

Bash is split by purpose (LUM-840): each shell call is billed to `Bash · <purpose>` — `read/search`, `test`, `typecheck/lint/build`, `db/prisma`, `git write`, `gh`, `lumo CLI`, `network/deploy`, `script`, `file ops`, `other` — decided by the most significant segment of the command (`cd x && npx jest` → `test`), not its first word. The same labels appear in the `task lineage` Top-5. A plain `Bash` row means calls recorded before the split that have not been backfilled. Non-Node toolchains are covered too (`pytest` / `go test` / `cargo test` / `rspec` → `test`; `make` / `ruff` / `mypy` / `mvn package` → `typecheck/lint/build`; `docker` / `kubectl` / `terraform` → `network/deploy`). An unrecognised command outranks a read beside it, so a growing `Bash · other` share is the signal that a new command needs a rule: `scripts/backfill-bash-tool-detail.ts` (dry-run) lists the top unrecognised verbs, and after adding rules `--reclassify-other --commit` re-files history already stored as `other`.

```bash
lumo cost --task LUM-42
lumo cost --session <session-id> --by model
lumo cost --since 2026-06-01 --by member --json
```

- `--task <id>` / `--session <id>` / `--since <ISO-date>` — **mutually-exclusive** scope: one task / one Claude Code session / a workspace window from that date. None given = default **workspace last-30-days**. If more than one is passed, the CLI picks task > session > since.
- `--by tool|model|member|session` (default `tool`, case-insensitive) — only changes which grouping is the **headline** table; other groupings still print below when non-trivial (member/session tables appear only when >1).
- `--json` — emit the versioned payload (`version: 1`, scope, grandTotal, coverage, and `byTool` / `byModel` / `byMember` / `bySession` row arrays) instead of rendered tables.
- **Coverage line** `Per-step attribution: X% of N tool-using turns` — how much of the report is precise per-step attribution vs per-turn fallback. `n/a` when there were no tool-using turns.

### When to suggest

The user asks where their tokens went _by operation_ — "which tools are most expensive," cost attribution by model / teammate / session, or a workspace cost window. For the quick per-task Top-5 inline, point them at `lumo task lineage <id>` instead; reach for `lumo cost` for the full breakdown or any non-task scope.
