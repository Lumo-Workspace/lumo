# Task Context Loading & Context Retrieval

## Task Context Loading

When the user mentions a task identifier or asks for task background, load the context:

```bash
lumo task context <identifier>
```

Example: `lumo task context LUM-42`

### Reading the output

The command prints a markdown document to stdout containing:

1. **Task header** — identifier, title, status, description
2. **Acceptance criteria (contract)** — the task's acceptance criteria (LUM-342), shown right after the header as the `## Acceptance criteria (contract)` section. Each line: `[MACHINE|HUMAN] statement` with a `↳ check:` line for MACHINE checkpointers; HUMAN_EDIT / REVIEW_ADDED provenance is tagged inline. If a still-open task has none, a draft reminder appears instead — draft 3–7 criteria **before writing code** (see [criteria.md](criteria.md))
3. **Memory section** — cross-session learnings accumulated over prior sessions; treat as trusted background context
4. **Inline source cards** — Slack / web / Figma / artifacts / documents / comments / Pull Requests (see "Context Retrieval" below)
5. **PR review todos** — mirrored PR review comments as a checkbox todo list under the `## PR review todos` header: each line-level reviewer comment (shown as `` `file:line` `` + the reviewer's ask + a link to the GitHub comment) and each `changes_requested` review summary (shown as "🛑 Changes requested (whole PR)"). Present only when the task's PR(s) have review comments. This same block is **auto-injected at session start** (alongside the memory section) when the session is bound to a task — so reviewer asks surface without re-running `task context`.
   - The **inline source cards** (Slack / web / Figma / PR) are likewise **auto-injected at session start** when the session is bound, under a single global token budget shared with the memory section (priority: criteria > memory > PR > Slack > Figma > web). Cards that don't fit the budget are degraded to a one-line manifest carrying just the title and its `lumo task … show` retrieval command — so you still know they exist and can pull the full content on demand.
6. **Previous sessions** — ordered newest-first, each with:
   - A headline summary of what was done
   - Unresolved items (carry-over TODOs from that session)
7. **Flywheel signal · historical merge contribution** — appended at the very end as the `## Flywheel signal · historical merge contribution` section. For each context fragment with enough history, a one-line historical merge-contribution signal (e.g. `appeared in 5 resolved tasks · 4 merged (80%)`), computed from accumulated lineage edges. Denominator = distinct tasks where the fragment appeared with a resolved (non-UNKNOWN) outcome; only fragments with ≥3 such tasks are shown (cold-start gate), so the block is often absent early on. This is **historical correlation, not causation** — don't read it as a prediction.

### How to use the context

- **Unresolved items** from the most recent session are the highest-priority carry-overs — address them before starting new work unless the user says otherwise
- **PR review todos** items are reviewer-requested changes — treat each unchecked box as a TODO to resolve, then reply on the PR (a Lumo comment mirrors back to GitHub)
- **Memory section** provides validated context that persists across sessions — use it to avoid re-learning decisions or constraints
- Focus on the **most recent 1–2 sessions** for relevant state; older sessions are for historical reference only
- If there are **no prior sessions**, this is a fresh start — read the task description carefully and ask clarifying questions if needed

## Context Retrieval (full text on demand)

LUM-122 split task context injection into tiers. `lumo task context <LUM-N>`
now emits a **cheap inline card** for each source — a short summary or just
metadata — instead of dumping full bodies. Slack, docs, artifacts, and comments
get an **LLM summary**; web links, Figma, and PRs get **metadata only**. Each
card ends with the **retrieval command** you run to pull the heavy content on
demand.

**How to use it:** when the inline card is not enough and you need the full
Slack thread, the web page body, the Figma metadata, the entire comment thread,
or the PR detail — run the matching command below. Pass the same identifier
(`LUM-N`) plus the id the card shows for that source (a Slack `contextId`, a web
`linkId`, a Figma `linkId`, or a PR `number`).

**Output budget (LUM-428):** the whole `task context` handoff is capped to the
output-token budget (25,000 tokens). If a memory-rich task with a long thread
overflows, the output is truncated and ends in a pointer to the precise
sub-commands (`lumo task status` / `task comments list --full` / `task lineage`
/ `doc show`) to pull any dropped section just-in-time.

All five are **read-only** (no live Slack/GitHub/Figma calls except the web body
fetch). Web/Figma/PR are v1 metadata-degraded: they print a `note:` explaining
that live content needs an external integration.

### `lumo task slack show <identifier> <contextId>` — full Slack thread snapshot

Prints the **stored** thread snapshot (no live Slack call), one line per message
as `author: text`. Author falls back to `@<userId>` when the display name is
missing. Empty snapshot prints `(no messages in stored snapshot)`.

```bash
lumo task slack show LUM-42 ctx_abc123
```

### `lumo task web show <identifier> <linkId>` — fetched web link body

Fetches the page body on demand behind the SSRF guard (cached after first read)
and prints it as plain text. Empty body prints `(empty body)`. Fetch failures
(blocked host, timeout) print the server's error message.

```bash
lumo task web show LUM-42 wl_abc123
```

### `lumo task figma context <identifier> <linkId>` — Figma link metadata

**v1 metadata fallback.** Prints the cached design metadata as `file:` /
`frame:` / `url:` / `synced:` (and `syncError:` if the last sync failed) lines.
Live design context (layers, variables, code connect) requires the Figma MCP
server, so the command ends with a `note:` saying so.

```bash
lumo task figma context LUM-42 cfl_abc123
```

### `lumo task comments list <identifier>` — comment thread

Prints the comment thread: each comment as `author · createdAt` followed by its
plain-text body (comment bodies are stored as HTML and stripped to text).
Replies are indented two spaces under their parent. Author falls back to
`unknown`. No comments prints `(no comments)`.

**Output budget (LUM-428).** By default the thread is capped to the
output-token budget (25,000 tokens — every line you print spends from your
context). When it overflows, the output is truncated to the budget and ends in
a fetch-more pointer (`… +N more comments not shown (output capped at 25,000
tokens) — read the whole thread with: lumo task comments list <id> --full`).
Pass **`--full`** to print every comment uncapped — only when you actually need
the whole thread.

```bash
lumo task comments list LUM-42          # capped to the output budget
lumo task comments list LUM-42 --full   # every comment, no cap
```

**Plural, and distinct from `task comment`.** `task comments list` _reads_ the
whole thread (this retrieval command). `task comment <identifier> <body>`
_writes_ a single new comment (see Task Management). Don't confuse the two —
the plural `comments` is read-only.

### `lumo task pr show <identifier> <number>` — synced PR metadata

**v1 metadata fallback.** Prints the synced PR record: a `#<number> (repo)
title` header, then `state:` (with ` · draft` when draft), `ci:`, `author:`,
`branch: <head> → <base>`, and `url:` lines. The live diff + review comments
require the GitHub integration, so the command ends with a `note:` saying so.

```bash
lumo task pr show LUM-42 128
```

## `lumo task lineage <id>`

Read-only audit view over the task's `LineageEdge` rows. Given a task
identifier (`LUM-N`), prints the causal trail:

```bash
lumo task lineage LUM-42            # per-session causal trail + cost
lumo task lineage LUM-42 --signal   # append workspace-level usage signal-health; used-vs-base merge rate uses iteration-taint fold (send-back/reopen/PR-close = negative class even if later merged); shows negative-class size per side; prints "metric cannot discriminate" when no failure outcomes exist yet
```

- **Totals banner** — distinct sessions, fragment count, edge count,
  total tokens (input/output/cache split) and loops, and the outcome
  distribution. After the outcome summary, one funnel line is appended:
  `- Disclosure funnel: N impressions · M INDEX (X%) · K pulled (Y% of INDEX) · J used (Z%)`
  where impressions = edge count, INDEX% and used% are over impressions,
  pull% is over INDEX only (FULL fragments have no pull opportunity).
  Divide-by-zero is guarded (zero impressions or zero INDEX renders `0%`).
  When per-fragment token weights have been collected (LUM-522), the line also
  appends `· ~T tokens saved` = Σ(fullTokens − indexTokens) over un-pulled INDEX
  edges (the token cost the index-only injection avoided); the suffix is omitted
  cleanly when no edge carries token data yet (older edges predate the columns).
- **One block per session** — the group's cost shown **once** (token/loop),
  the date it consumed context, then each context fragment as
  `[OUTCOME] TYPE — <source label>`, plus a disclosure annotation suffix:
  `· INDEX pulled` (INDEX fragment, `pulledAt` is set) /
  `· INDEX not-pulled` (INDEX fragment, never pulled) /
  `· FULL` (injected in full at session-start).
  Per-group outcome summary follows.

Cost is attributed once per session (a session that injected many fragments is
not double-counted). Fragment ids are canonical — MEMORY fragments survive
consolidation drift.

**`--signal` workspace funnel:** the workspace-level usage signal-health block
appended by `--signal` ends with a workspace-wide disclosure funnel in the
same format: `- Disclosure funnel: N impressions · M INDEX (X%) · K pulled (Y% of INDEX) · J used (Z%)`
aggregated over all edges in the workspace (not just this task) — including the
same `· ~T tokens saved` suffix when token data exists (LUM-522).

**Cold start:** a task with no edges prints a friendly note (lineage is captured
when a session-bound run consumes the task's context), not an error.

**When to suggest:** the user wants to audit "what context did the AI actually
use, and what did it cost" for a task / merged PR — CFO / compliance / trust
narratives.

Entry point is the task identifier only; PR-number lookup is a future addition.
