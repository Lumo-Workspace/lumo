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
2. **Memory section** — cross-session learnings accumulated over prior sessions; treat as trusted background context
3. **Inline source cards** — Slack / web / Figma / artifacts / documents / comments / Pull Requests (see "Context Retrieval" below)
4. **PR Review 待办** — mirrored PR review comments as a checkbox todo list: each line-level reviewer comment (shown as `` `file:line` `` + the reviewer's ask + a link to the GitHub comment) and each `changes_requested` review summary (shown as "🛑 整体要求改动"). Present only when the task's PR(s) have review comments. This same block is **auto-injected at session start** (alongside the memory section) when the session is bound to a task — so reviewer asks surface without re-running `task context`.
   - The **inline source cards** (Slack / web / Figma / PR) are likewise **auto-injected at session start** when the session is bound, under a single global token budget shared with the memory section (priority: memory > PR > Slack > Figma > web). Cards that don't fit the budget are degraded to a one-line manifest carrying just the title and its `lumo task … show` retrieval command — so you still know they exist and can pull the full content on demand.
5. **Previous sessions** — ordered newest-first, each with:
   - A headline summary of what was done
   - Unresolved items (carry-over TODOs from that session)
6. **飞轮信号 · 历史 merge 贡献** — appended at the very end. For each context fragment with enough history, a one-line historical merge-contribution signal (e.g. `出现在 5 个已闭合任务·4 merged (80%)`), computed from accumulated lineage edges. Denominator = distinct tasks where the fragment appeared with a resolved (non-UNKNOWN) outcome; only fragments with ≥3 such tasks are shown (cold-start gate), so the block is often absent early on. This is **historical correlation, not causation** — don't read it as a prediction.

### How to use the context

- **Unresolved items** from the most recent session are the highest-priority carry-overs — address them before starting new work unless the user says otherwise
- **PR Review 待办** items are reviewer-requested changes — treat each unchecked box as a TODO to resolve, then reply on the PR (a Lumo comment mirrors back to GitHub)
- **Memory section** provides validated context that persists across sessions — use it to avoid re-learning decisions or constraints
- Focus on the **most recent 1–2 sessions** for relevant state; older sessions are for historical reference only
- If there are **no prior sessions**, this is a fresh start — read the task description carefully and ask clarifying questions if needed

## Context Retrieval (按需取全文)

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

### `lumo task comments list <identifier>` — full comment thread

Prints the **entire** comment thread: each comment as `author · createdAt`
followed by its plain-text body (comment bodies are stored as HTML and stripped
to text). Replies are indented two spaces under their parent. Author falls back
to `unknown`. No comments prints `(no comments)`.

```bash
lumo task comments list LUM-42
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

- **Totals banner** — distinct sessions, fragment count, edge count,
  total tokens (input/output/cache split) and loops, and the outcome
  distribution.
- **One block per session** — the group's cost shown **once** (token/loop),
  the date it consumed context, then each context fragment as
  `[OUTCOME] TYPE — <source label>`, plus a per-group outcome summary.

Cost is attributed once per session (a session that injected many fragments is
not double-counted). Fragment ids are canonical — MEMORY fragments survive
consolidation drift.

**Cold start:** a task with no edges prints a friendly note (lineage is captured
when a session-bound run consumes the task's context), not an error.

**When to suggest:** the user wants to audit "what context did the AI actually
use, and what did it cost" for a task / merged PR — CFO / compliance / trust
narratives.

Entry point is the task identifier only; PR-number lookup is a future addition.
