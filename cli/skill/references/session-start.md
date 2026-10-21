# Session start & end-of-session housekeeping

What the Lumo SessionStart hook injects, and what runs automatically server-side. Binding: [sessions.md](sessions.md).

## Suggest-on-start from local git (no auto-bind)

When a session starts **without** a bound task, the `session-start` hook infers a task from local git and **suggests** it — it never binds for you.

Detection order and rules:

- `current branch name` first (e.g. `lumo/LUM-145-...`), then the `most recent commit subjects` (e.g. `... [LUM-145]`), extracting the first task identifier.
- `prefix-agnostic` — any team prefix matches (`SPEC-12` as much as `LUM-145`), using the same pattern the server uses to link PR branches to tasks.
- `well-known acronym-number tokens` (`UTF-8`, `SHA-256`, `ISO-8601`, …) are skipped, never suggested.

On a hit it prints one suggestion line and stops — the session stays **unbound**, no task context injected yet (only the workspace-level lines below):

```
Detected LUM-145 (from branch name). Run lumo session attach LUM-145 to bind.
```

- The basis reads `from recent commits` when the hit came from commit subjects instead of the branch name.
- No task title is shown here (nothing was fetched); title, memory, and PR-review todos appear only once you attach.
- No match (detached HEAD; a branch with no identifier and no tagged commits; not a git repo) → degrades to the normal unbound prompt.

### When to suggest

You see a suggestion line. Confirm the inferred task is the one the user wants, then run `lumo session attach <LUM-N>` followed by `lumo task show <LUM-N> --full` to load the background. `session attach` is the **only** path that binds — there is nothing to "undo" if the inference is wrong; just attach the correct task instead.

## Session record notice at session start

Every session start — bound or not — injects one line saying how this workspace stores session records: the mode (kept forever / kept at least N days / code and command output not stored, discarded after the work is used up), that credentials are always redacted, and that an OWNER can change it in **Settings → Data retention** (with the link). It is read fresh each session start, so an OWNER's change shows on the next one. An older server or a failed lookup simply omits the line. `lumo init` prints the same line when logged in.

### When to suggest

The user asks whether / how long Lumo keeps their Claude Code sessions, code or command output: quote the line, and point an OWNER at the settings link to change it. Don't add claims beyond it (e.g. about encryption).

## Layer 2 project-memory review at session start

When the session is bound, session-start may inject a **"🆕 Review needed: project memories auto-consolidated by the previous session"** section alongside the memory / PR-review blocks. It lists the **PROJECT-scope** memories that the member's **immediately-preceding session** auto-consolidated (Layer 2 runs asynchronously when a task is marked `done`). Each item shows its `id`.

- **Why async / next-session:** Layer 2 promotions land after the task hits DONE, so they surface at the _next_ session-start, when they've definitely landed.
- **Show-once:** the section appears only at the session immediately following the one that produced the memories. It does **not** re-nag later, so act now or it scrolls off.
- **Attribution:** `lumo task update <id> --status done` automatically sends `CLAUDE_CODE_SESSION_ID` (via `X-Lumo-Session-Id`) so the Layer 2 memories are attributed to the session. Marking done from the **web UI** leaves them unattributed (they won't surface for review) — expected.

### When to suggest

Briefly sanity-check each listed memory against the codebase/context. If one is wrong or over-generalized, remove it with `lumo memory delete <ref>` (the 8-char ref printed under it) — it exits 4 with a confirmation envelope; show it to the user and re-run with `--confirm` only on their approval ([confirmation.md](confirmation.md)). If they all look right, ignore the section and continue.

## Blocker alert injected at `session attach` / session-start

When the bound task has live blockers or SUGGESTED dependency candidates, the attach output and session-start hook context inject a dependency warning block. Built by `buildBlockerWarningSectionForTask`; **omitted entirely** (empty string) when nothing is actionable — no output when there are no live blockers and no SUGGESTED candidates. The function never throws — on failure it silently returns an empty string, leaving session start unaffected.

Trigger conditions (OR — either or both may appear):

1. At least one CONFIRMED "blocked by" edge where the blocking task's status is not DONE.
2. At least one SUGGESTED (unconfirmed) dependency candidate on the task.

**Form A — live blockers exist (with or without SUGGESTED candidates):** `## ⚠ Dependency alerts` header, one line per live blocker, then the advice line. If SUGGESTED candidates also exist, the candidate-hint line is appended after the advice line.

```
## ⚠ Dependency alerts

- This task is blocked by LUM-9 "Fix auth token expiry" (status IN_PROGRESS).
- This task is blocked by LUM-15 "Upgrade Postgres driver" (status IN_REVIEW, PR #42 not merged).

Consider waiting for the blocker(s) to merge before starting work to avoid a wasted run; if an edge is stale, clean it up with `lumo task dep remove/dismiss`.
Detected 3 candidate dependencies awaiting confirmation: run `lumo task show LUM-42 --deps`.
```

**Form B — NO live blockers, but SUGGESTED candidates exist:** the hint line **only** — no `## ⚠ Dependency alerts` header, no advice line. Rationale: pure candidates are a hint, not an alert, so they don't get the ⚠ header and real alerts aren't diluted.

```
Detected 3 candidate dependencies awaiting confirmation: run `lumo task show LUM-42 --deps`.
```

- Each blocker line shows: identifier, title, current status. An open PR on the blocking task appends `, PR #N not merged` — `, PR #N (draft) not merged` for draft PRs.
- The advice line ("Consider waiting for the blocker(s) to merge…") appears only when there is at least one live blocker (form A).

### When to suggest

Watch for EITHER the `## ⚠ Dependency alerts` header (form A) OR the standalone hint line (form B).

- `lumo task show <LUM-N> --deps` — inspect the full edge list (run for any candidate hint, form A or B; confirm real SUGGESTED edges, dismiss false positives — unreviewed edges mean repeated hints every session).
- `lumo task dep remove <LUM-N> <edge> --confirm` — drop a manually-added, now-obsolete edge (exit 4 + envelope without `--confirm`).
- `lumo task dep dismiss <LUM-N> <edge>` — dismiss a false positive from detection.
- Form A live blockers: evaluate whether to wait — overlapping work (same files, same API surface) risks rework; read the blocker's status and open-PR note before deciding.
- Do **not** blindly start work on a task whose live blocker is still IN_PROGRESS or IN_REVIEW unless the user explicitly decides to proceed in parallel.

## Automatic end-of-session housekeeping (no command)

The old end-of-session command was **removed**. The three passes it ran interactively now happen **automatically server-side** — all evidence-gated, best-effort, and silent. There is nothing for the agent to run or confirm. Two fire when the bound task reaches **DONE** (`lumo task update <id> --status done`, which threads `CLAUDE_CODE_SESSION_ID` so attribution lands); one runs continuously off the failure/progress hooks.

**1. Layer-1 memory curation (on DONE).** An LLM judge reviews the Layer-1 memories each of the task's sessions recorded, against that session's event log, and **soft-invalidates only the clearly-wrong / self-contradictory ones**: the row flips to `INVALIDATED` and is excluded from injection but **kept for audit — never hard-deleted**. **Uncertain memories are left untouched** (the judge defaults to keeping). Promotion to project scope is **not** done here — that stays with the Layer-2 flow (surfaced at the next session-start, see above).

**2. Fragment-usage audit (on DONE).** An LLM judge sees the fragments this session consumed (its lineage edges) plus the session's event log and votes which were **actually used**:

- confidently-used edges → `used=true`
- confidently-unused → `used=false`
- genuinely-uncertain edges stay `null` (honest "not voted", not "unused")

Already-voted sessions are skipped; a cron backstop drains any backlog. **Why:** upgrades the flywheel signal from "co-loaded" (constant) to "actually used" (discriminative). `task show --full --memory` then reports each fragment's **judged-used track record** — of the N tasks it appeared in, X were judged to have actually used it. That is a **lower bound** (never-audited appearances are excluded from the proven/retire calls), and it **replaced the retired merge-rate signal** .

> Don't confuse this with the used-vs-base **merge rate** still reported by `lumo task show --lineage --signal` ([task-context.md](task-context.md)) — that is a different, live metric for workspace signal-health, not the retired fragment-usefulness one.

**3. Blocked-tag automation (server-side).** When a session crosses the same-tool failure threshold (**≥ 3** same-type failures, aggregated from `POST_TOOL_USE_FAILURE` grouped by tool name + `STOP_FAILURE` turn-level failures), the server **auto-applies the shared `blocked` tag** to the bound task. This inverts the old manual gate — no prompt, no human in the loop — and is safe via three safeguards:

- **idempotent:** at most one active auto-block per task, so re-crossing is a no-op.
- **auto-untag on progress:** the next observable progress (a successful tool call or a non-failure turn end) removes the tag.
- **attribution:** the triggering session + model are recorded.

A **human-applied** `blocked` tag has no auto-block record and is **never** auto-removed by progress.

### When to suggest

Nothing to suggest — these run on their own. If a teammate asks why a task shows `blocked`, explain it's the auto-block (repeated same-tool failures) and that it clears itself once the task makes progress; a human can also remove the tag manually from the board.
