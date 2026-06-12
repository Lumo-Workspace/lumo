# Session Management

## Session Management

### Suggest-on-start from local git (no auto-bind)

When a session starts **without** a bound task, the `session-start` hook tries to
infer the task from local git so it can **suggest** one — it never binds for you
(LUM-302):

- It reads the **current branch name** first (e.g. `lumo/LUM-145-...`), then the
  **most recent commit subjects** (e.g. `... [LUM-145]`), extracting the first
  task identifier. Detection is **prefix-agnostic** (LUM-419): any team prefix
  matches — `SPEC-12` as much as `LUM-145` — using the same pattern the server
  uses to link PR branches to tasks. Well-known acronym-number tokens
  (`UTF-8`, `SHA-256`, `ISO-8601`, …) are skipped, never suggested.
- On a hit it prints a single suggestion line and stops — the session stays
  **unbound** and no context is injected yet:
  `Detected LUM-145 (from branch name). Run lumo session attach LUM-145 to bind.`
  (the basis reads `from recent commits` when the hit came from commit subjects instead of the branch name)
  No task title is shown here because nothing was fetched; the title, memory,
  and PR-review todos appear only once you actually attach.
- No match (detached HEAD, a branch with no identifier and no tagged commits,
  not a git repo) → it degrades to the normal unbound prompt.

**Agent guidance:** when you see a suggestion line, confirm the inferred task is
the one the user wants, then run `lumo session attach <LUM-N>` (followed by
`lumo task context <LUM-N>` to load the background). `session attach` is the
**only** path that binds — there is nothing to "undo" if the inference is wrong;
just attach the correct task instead.

### Layer 2 project-memory review at session start

When the session is bound, session-start may inject a **"🆕 Review needed: project memories auto-consolidated by the previous session"** section alongside the memory / PR-review blocks (LUM-165). It lists the **PROJECT-scope** memories that the member's **immediately-preceding session** auto-consolidated (Layer 2 runs asynchronously when a task is marked `done`). Each item shows its `id`.

- **Why it's here:** Layer 2 promotions land async, so they can't be reviewed in the synchronous `session wrap` panel — they're surfaced at the _next_ session-start instead, when they've definitely landed.
- **Show-once:** the section appears only at the session that immediately follows the one that produced the memories. It does **not** re-nag on later sessions, so act on it now or it scrolls off.
- **Agent guidance:** briefly sanity-check each listed memory against the codebase/context. If one is wrong or over-generalized, remove it with `lumo memory rm <id> --yes` (ideally confirm with the user first). If they all look right, ignore the section and continue.

Attribution requires the CC session id to reach the server: `lumo task update <id> --status done` automatically sends `CLAUDE_CODE_SESSION_ID` (via an `X-Lumo-Session-Id` header) so the resulting Layer 2 memories are attributed to the session. Marking a task done from the **web UI** leaves them unattributed (they won't surface for review) — that's expected.

### Blocker alert injected at `session attach` / session-start

When the bound task has live blockers or SUGGESTED dependency candidates, the attach output and session-start hook context inject a dependency warning block. The warning is built by `buildBlockerWarningSectionForTask` and is **omitted entirely** (empty string) when nothing is actionable — no output appears when there are no live blockers and no SUGGESTED candidates.

**Trigger conditions (OR — either or both may appear):**

1. At least one CONFIRMED "blocked by" edge where the blocking task's status is not DONE.
2. At least one SUGGESTED (unconfirmed) dependency candidate on the task.

**Output form A — live blockers exist (with or without SUGGESTED candidates):**

Starts with the `## ⚠ Dependency alerts` header, followed by one line per live blocker, then the advice line. If there are also SUGGESTED candidates the candidate-hint line is appended after the advice line.

```
## ⚠ Dependency alerts

- This task is blocked by LUM-9 "Fix auth token expiry" (status IN_PROGRESS).
- This task is blocked by LUM-15 "Upgrade Postgres driver" (status IN_REVIEW, PR #42 not merged).

Consider waiting for the blocker(s) to merge before starting work to avoid a wasted run; if an edge is stale, clean it up with `lumo task deps rm/dismiss`.
Detected 3 candidate dependencies awaiting confirmation: run `lumo task deps list LUM-42`.
```

**Output form B — NO live blockers, but SUGGESTED candidates exist:**

Output is **only** the hint line — no `## ⚠ Dependency alerts` header, no advice line. Design rationale: pure candidates are a hint, not an alert — they don't get the ⚠ header, so real alerts aren't diluted.

```
Detected 3 candidate dependencies awaiting confirmation: run `lumo task deps list LUM-42`.
```

- Each blocker line shows: identifier, title, current status. If the blocking task has an open pull request, a `, PR #N not merged` note is appended — `, PR #N (draft) not merged` for draft PRs.
- The guidance line ("Consider waiting for the blocker(s) to merge…") appears only when there is at least one live blocker (form A).
- The function never throws — if it fails it silently returns an empty string, leaving the session start unaffected.

**Agent guidance — watch for EITHER the `## ⚠ Dependency alerts` header (form A) OR the standalone hint line (form B):**

- **Form A — live blockers:** Evaluate whether to wait. If the blocking task's work overlaps with yours (same files, same API surface), starting immediately risks rework. Read the blocker's status and open PR note before deciding.
- **Stale or wrong edge?** Run `lumo task deps list <LUM-N>` to inspect the full edge list, then `lumo task deps rm <LUM-N> <edge> --yes` (if manually added and now obsolete) or `lumo task deps dismiss <LUM-N> <edge>` (if a false positive from detection).
- **Candidate hint present (form A or B)?** Run `lumo task deps list <LUM-N>` and review each SUGGESTED edge — confirm real ones, dismiss false positives. Leaving SUGGESTED edges unreviewed means repeated hints every session.
- Do **not** blindly start work on a task whose live blocker is still IN_PROGRESS or IN_REVIEW unless the user explicitly decides to proceed in parallel.

### `lumo session attach <identifier>` — bind the current session to a task

Use this whenever the user mentions a task ID. The command is the only way to bind a session to a task.

```bash
lumo session attach LUM-42
```

What it does:

- Reads `CLAUDE_CODE_SESSION_ID` from the environment (Claude Code sets this automatically). If it is not set, the command errors out — it must run from inside a Claude Code session.
- Calls `POST /api/sessions/<session_id>/bind-task` on the Lumo server, which sets the Session row's `taskId` and re-tags previously-untagged HookEvent rows in this session.
- The binding lives entirely on the server (`Session.taskId`); subsequent hooks read it back via the session row. The CLI keeps no local sentinel.

- Prints the task's **acceptance contract** (`## Acceptance criteria (contract)`, LUM-342) right after the bind confirmation — or, when a still-open task has none, the draft reminder telling you to draft 3–7 criteria before the first line of code (see [criteria.md](criteria.md)). The same section is auto-injected at session start when the session is already bound (highest priority in the injection budget, ahead of memory).

**After attaching, always run `lumo task context <identifier>` to load the task background.**

#### Overwriting an existing binding (LUM-266)

Re-attaching a session that's already bound to a **different** task no longer silently clobbers the binding. The server returns the current binding instead of overwriting, and the CLI decides what to do:

- **On a TTY** (a human running it directly): prompts `Already bound to LUM-X. Rebind to LUM-Y? [y/N]`. Answering `y`/`yes` re-binds to `LUM-Y`; anything else (including bare Enter) cancels and leaves `LUM-X` bound.
- **Off a TTY** (the usual agent case — `stdin` is not interactive): the command **refuses** and prints `Session already bound to LUM-X … Re-run with --force …` without overwriting. Exit code is `0` (a safe refusal, not an error).
- **`--force`**: skips the prompt/refusal and overwrites unconditionally. Re-attaching to the **same** task is always a no-op re-bind (never prompts).

```bash
lumo session attach LUM-42            # already on LUM-7 → prompts (TTY) / refuses (agent)
lumo session attach LUM-42 --force    # overwrite without confirmation
```

**Agent guidance:** when `session attach` reports the session is already bound to a different task, **ask the user** whether to switch before re-running with `--force`. Don't auto-`--force` — the existing binding may be intentional (e.g. a manual attach the user ran earlier). Alternatively run `lumo session detach` first, then a clean `session attach`.

### Parallel sessions

Each Claude Code session has its own `CLAUDE_CODE_SESSION_ID`. Two terminals running `claude code` and binding to different tasks will not interfere with each other — the bindings are scoped per session row server-side.

### `lumo session status` — show current binding

Prints which task the current Claude Code session is bound to, or "(no task)" if none. Requires `$CLAUDE_CODE_SESSION_ID` (i.e. must run inside Claude Code).

```bash
lumo session status
```

When to suggest: the user asks "which task am I on", "what's this session bound to", or you need to decide whether to suggest `session attach` for a mentioned task ID.

### `lumo session detach` — clear the current binding

Idempotent — running it twice is fine, the second call reports `already unbound`. Past hook events keep their original `taskId`; only future events on this session will be untagged.

```bash
lumo session detach
```

When to suggest: the user wants to stop tagging the current session with the active task (e.g., switching to unrelated exploratory work without binding to a different task).

### `lumo session wrap [--yes] [--dry-run] [--used <indices>]` — wrap-up panel: progress comment + memory review + fragment-usage vote + blocked-tag prompt

Session-end wrap-up panel with **four sections, run in order**:

**1. Progress comment** — reads back the current Claude Code session's per-turn
`turnSummary` rows (the one-line summaries written each STOP), aggregates
every turn **since the last progress comment** into one bulleted body, and — after
a `[y] post / [e] edit / [s] skip` confirmation — posts it as a comment on the
session's bound task. A server-side watermark (`Session.lastProgressCommentAt`)
means re-running never re-posts the same turns.

**2. Memory review** — lists the Layer1 memories this session sedimented since the
last review (deduped by a per-session watermark `Session.lastMemoryReviewAt`).
Each new memory is shown as `[SCOPE] CATEGORY  headline`, numbered from 1. You
curate with a single line: `d 1,3` deletes rows 1 and 3, `p 2` promotes row 2 to
project scope, and they combine (`d 1,3 p 2`). **Enter (empty) keeps all**; `s`
skips the section. Keeping all (Enter or `--yes`) still **advances the watermark**
so the next wrap won't re-list reviewed memories; `s` leaves them for next time.
Out-of-range indices are ignored. Deletes/promotes run server-side, scoped to
memories this session created (you can't touch other sessions' memories through
this panel). With no new memories the section prints "(no content)" and does nothing.

**3. Fragment-usage vote (LUM-300)** — lists the context
fragments this session **consumed** (its lineage edges: memory / slack / web /
figma / PR / review-todo / session), numbered from 1 with a content snippet
label. The agent records which it **actually used** via
`lumo session wrap --used <indices>` (1-based, comma/space separated; `--used
none` = used nothing). Voted fragments get `used=true`, the rest of the
session's fragments `used=false`. **Without `--used` the section only lists the
candidates and writes nothing** (edges stay `null` = not voted — honest, not
"unused"). A session that already voted (`usedAt` set) is skipped. **Why:** it
upgrades the flywheel signal from "co-loaded" (constant, no information) to
"actually used" (varies → discriminative); `task context` then prefers each
fragment's usage-based merge rate, falling back to the weaker presence rate when
usage samples are thin. With no consumed fragments the section prints "(no content)".

**4. Blocked check (blocked-tag prompt, LUM-153)** — if the **same kind of failure
recurred ≥ 3 times** in this session (server-aggregated from
`POST_TOOL_USE_FAILURE` events grouped by tool name, plus `STOP_FAILURE`
turn-level failures), the section surfaces the dominant failure (`This session looks repeatedly stuck on <tool> (N failures).` + last error summary) and prompts `[y] tag / [s] skip` whether to
flag the bound task with a **`blocked` tag**. **Prompt-only — never auto-flips
status.** It uses a plain tag (no `TaskStatus` enum, no board column, **no
schema migration**). The prompt is **suppressed** when: there's no bound task,
the threshold isn't met, or the task **already** carries a `blocked` tag (the
idempotent gate — there's no watermark, the existing tag is what prevents
re-nagging). The default on empty input / `s` is **do nothing** (tagging is
opt-in), so a stray Enter never tags the task. Confirming with an explicit `y`
attaches the tag idempotently. **`--yes` does NOT auto-tag** — tagging the
shared board requires an interactive `y`, so `--yes` (and non-TTY) prints the
suggestion and moves on rather than silently flipping board state. When there's
nothing to prompt, the section prints "(no content)".

**After the panel — open-crossings reminder (LUM-448).** Once the four sections
finish, `session wrap` prints a one-shot read-only reminder **if** the bound
task has ≥1 OPEN (undispositioned) boundary crossing: `⚠ N open boundary
crossing(s) on LUM-N still undispositioned:` then a line per crossing `• [SEVERITY]
CATEGORY` and a web pointer. When there are none — or the session is unbound —
it prints **nothing** (truly silent, not a "(no content)" line), so a clean task
adds no wrap-up noise. **Awareness only:** it points at the web acceptance panel;
there is **no CLI path** to disposition or clear a crossing. Disposition stays
web + human-only (LUM-426/435/422) — an agent/CLI bearer cannot clear its own
crossing from the terminal.

```bash
lumo session wrap                  # interactive: preview each section, choose per-section
lumo session wrap --yes            # progress posted + memories kept; blocked tag NOT auto-applied (needs interactive y)
lumo session wrap --yes --used 1,3 # also record fragments 1 & 3 as used (the rest used=false)
lumo session wrap --used none      # record that none of the injected fragments were used
lumo session wrap --dry-run        # print all drafts only; never posts, never mutates, never advances watermarks
```

The usage vote is a two-step flow for agents: run `lumo session wrap` once to
see the numbered fragment list, decide which you actually used, then re-run with
`--used <indices>`. Re-running is safe — the other sections are watermark-guarded
(progress won't double-post, reviewed memories won't re-list).

- Requires `$CLAUDE_CODE_SESSION_ID` (must run inside Claude Code) and a bound
  task (`lumo session attach <LUM-N>` first). With no bound task or no new turn
  summaries, the Progress comment section prints "(no content)" and posts nothing.
- `[e] edit` (Progress comment) opens `$EDITOR` (fallback vi/nano) on the drafted body;
  the edited text is posted and the watermark still advances to the turns the
  draft covered.
- `--yes` posts the progress comment AND keeps all memories (no
  deletes/promotes) while advancing the memory-review watermark; for the
  blocked-tag section it prints the suggestion but does **not** apply the tag.
- `--dry-run` prints all drafts; never posts, never mutates memories/tags, never
  advances either watermark.
- Non-TTY without `--yes`: prints the drafts and does **not** post, mutate, or
  tag (safe default).

When to suggest: at the end of a working session on a bound task, to record what
was done as a progress comment — offer `lumo session wrap` rather than composing
a `task comment` by hand.
