# Session Management

## Session Management

### Suggest-on-start from local git (no auto-bind)

When a session starts **without** a bound task, the `session-start` hook infers a task from local git and **suggests** it — it never binds for you.

Detection order and rules:

- `current branch name` first (e.g. `lumo/LUM-145-...`), then the `most recent commit subjects` (e.g. `... [LUM-145]`), extracting the first task identifier.
- `prefix-agnostic` — any team prefix matches (`SPEC-12` as much as `LUM-145`), using the same pattern the server uses to link PR branches to tasks.
- `well-known acronym-number tokens` (`UTF-8`, `SHA-256`, `ISO-8601`, …) are skipped, never suggested.

On a hit it prints one suggestion line and stops — the session stays **unbound**, no context injected yet:

```
Detected LUM-145 (from branch name). Run lumo session attach LUM-145 to bind.
```

- The basis reads `from recent commits` when the hit came from commit subjects instead of the branch name.
- No task title is shown here (nothing was fetched); title, memory, and PR-review todos appear only once you attach.
- No match (detached HEAD; a branch with no identifier and no tagged commits; not a git repo) → degrades to the normal unbound prompt.

#### When to suggest

You see a suggestion line. Confirm the inferred task is the one the user wants, then run `lumo session attach <LUM-N>` followed by `lumo task context <LUM-N>` to load the background. `session attach` is the **only** path that binds — there is nothing to "undo" if the inference is wrong; just attach the correct task instead.

### Layer 2 project-memory review at session start

When the session is bound, session-start may inject a **"🆕 Review needed: project memories auto-consolidated by the previous session"** section alongside the memory / PR-review blocks. It lists the **PROJECT-scope** memories that the member's **immediately-preceding session** auto-consolidated (Layer 2 runs asynchronously when a task is marked `done`). Each item shows its `id`.

- **Why async / next-session:** Layer 2 promotions land after the task hits DONE, so they surface at the _next_ session-start, when they've definitely landed.
- **Show-once:** the section appears only at the session immediately following the one that produced the memories. It does **not** re-nag later, so act now or it scrolls off.
- **Attribution:** `lumo task update <id> --status done` automatically sends `CLAUDE_CODE_SESSION_ID` (via `X-Lumo-Session-Id`) so the Layer 2 memories are attributed to the session. Marking done from the **web UI** leaves them unattributed (they won't surface for review) — expected.

#### When to suggest

Briefly sanity-check each listed memory against the codebase/context. If one is wrong or over-generalized, remove it with `lumo memory rm <id>` — it exits 4 with a confirmation envelope; show it to the user and re-run with `--confirm` only on their approval ([confirmation.md](confirmation.md)). If they all look right, ignore the section and continue.

### Blocker alert injected at `session attach` / session-start

When the bound task has live blockers or SUGGESTED dependency candidates, the attach output and session-start hook context inject a dependency warning block. Built by `buildBlockerWarningSectionForTask`; **omitted entirely** (empty string) when nothing is actionable — no output when there are no live blockers and no SUGGESTED candidates. The function never throws — on failure it silently returns an empty string, leaving session start unaffected.

Trigger conditions (OR — either or both may appear):

1. At least one CONFIRMED "blocked by" edge where the blocking task's status is not DONE.
2. At least one SUGGESTED (unconfirmed) dependency candidate on the task.

**Form A — live blockers exist (with or without SUGGESTED candidates):** `## ⚠ Dependency alerts` header, one line per live blocker, then the advice line. If SUGGESTED candidates also exist, the candidate-hint line is appended after the advice line.

```
## ⚠ Dependency alerts

- This task is blocked by LUM-9 "Fix auth token expiry" (status IN_PROGRESS).
- This task is blocked by LUM-15 "Upgrade Postgres driver" (status IN_REVIEW, PR #42 not merged).

Consider waiting for the blocker(s) to merge before starting work to avoid a wasted run; if an edge is stale, clean it up with `lumo task deps rm/dismiss`.
Detected 3 candidate dependencies awaiting confirmation: run `lumo task deps list LUM-42`.
```

**Form B — NO live blockers, but SUGGESTED candidates exist:** the hint line **only** — no `## ⚠ Dependency alerts` header, no advice line. Rationale: pure candidates are a hint, not an alert, so they don't get the ⚠ header and real alerts aren't diluted.

```
Detected 3 candidate dependencies awaiting confirmation: run `lumo task deps list LUM-42`.
```

- Each blocker line shows: identifier, title, current status. An open PR on the blocking task appends `, PR #N not merged` — `, PR #N (draft) not merged` for draft PRs.
- The advice line ("Consider waiting for the blocker(s) to merge…") appears only when there is at least one live blocker (form A).

#### When to suggest

Watch for EITHER the `## ⚠ Dependency alerts` header (form A) OR the standalone hint line (form B).

- `lumo task deps list <LUM-N>` — inspect the full edge list (run for any candidate hint, form A or B; confirm real SUGGESTED edges, dismiss false positives — unreviewed edges mean repeated hints every session).
- `lumo task deps rm <LUM-N> <edge> --confirm` — drop a manually-added, now-obsolete edge (exit 4 + envelope without `--confirm`).
- `lumo task deps dismiss <LUM-N> <edge>` — dismiss a false positive from detection.
- Form A live blockers: evaluate whether to wait — overlapping work (same files, same API surface) risks rework; read the blocker's status and open-PR note before deciding.
- Do **not** blindly start work on a task whose live blocker is still IN_PROGRESS or IN_REVIEW unless the user explicitly decides to proceed in parallel.

### `lumo session attach <identifier>` — bind the current session to a task

Use this whenever the user mentions a task ID. It is the only way to bind a session to a task.

```bash
lumo session attach LUM-42
lumo session attach LUM-42 --worktree      # also create the task's worktree if none exists
lumo session attach LUM-42 --no-worktree   # never create one, even with autoWorktree
```

What it does:

- Reads `CLAUDE_CODE_SESSION_ID` from the environment (Claude Code sets it automatically); errors out if unset — must run from inside a Claude Code session.
- Calls `POST /api/sessions/<session_id>/bind-task`, which sets the Session row's `taskId` and re-tags previously-untagged HookEvent rows in this session.
- The binding lives entirely on the server (`Session.taskId`); subsequent hooks read it back via the session row. The CLI keeps no local sentinel.
- Prints one bind line (`Attached session … to LUM-42 "title"`, plus `· re-tagged N earlier events` when N > 0), then only the start-of-work signals: the **dependency blocker** warning, **undispositioned security findings**, and the task's **acceptance contract** (`## Acceptance criteria (contract)`) — or, when a still-open task has none, the draft reminder to draft 3–7 criteria before the first line of code, followed by the `### Reference class (outside view)` block when history supports one (see [criteria.md](criteria.md)). The same section is auto-injected at session start when already bound (highest priority in the injection budget, ahead of memory).
- Does **not** print team memory or the `## Test cases` nudge (LUM-807) — `lumo task context` prints both, and attach output is re-read on every later step (LUM-844). Instead one line: `Background (team memory, test cases, sources, prior sessions): lumo task context LUM-42`.

After attaching, always run `lumo task context <identifier>` to load the task background — memory and the test-case nudge live there.

#### Auto-downsync on attach

A successful `session attach` also runs a **best-effort team-memory downsync** for the bound task's project — the same work as `lumo memory sync` (including the P4b code-anchor staleness check), landing the team's memory in your local Claude Code memory store without a separate command.

- **Throttle-gated:** network is skipped entirely if this repo already synced within `LUMO_SYNC_THROTTLE_HOURS` (default **12h**), so re-attaches and same-day sessions are cheap.
- **Non-blocking:** a sync failure is swallowed — it **never** changes the bind outcome.
- **Output:** on a non-trivial sync the CLI prints one extra line, `memory sync → +N ~M -K`.
- Manual `lumo memory sync` stays unthrottled.
- `LUMO_DISABLE_MEMORY_AUTO=1` turns off the auto-downsync (and the hook auto-upsync — see [memory.md](memory.md)) entirely; `--no-anchor-check` on `lumo memory sync` is unchanged.

#### Worktree step (LUM-825)

After the bind (before the `Next:` block) attach checks the task's local git worktrees — best-effort, never changes the exit code:

- **Worktree(s) exist** → every one is listed by path (never one picked silently), the one you're in is marked `← you are here`, else a `cd <path>` line.
- **You're already in some other linked worktree** (e.g. a Claude Code worktree) → it says so and creates nothing.
- **Main checkout, none yet** → with `--worktree`, or `autoWorktree: true` in `.lumo/worktree.json` (this repo sets it), it runs the same scaffold as `lumo worktree add` with a slug from the title's first words; otherwise it prints a `lumo worktree add <id>` hint. `--no-worktree` suppresses creation. A failed creation is a warning — the bind already succeeded.

After an auto-create, **move into the worktree** (`cd <path>`) before editing — the session's shell still starts in the main checkout. Details: [worktree.md](worktree.md).

#### Lifetime lock

`Session.taskId` is **write-once**. Re-attaching to the **same** task is always a no-op re-bind (idempotent, re-emits context). Attaching to a **different** task is refused with HTTP 409 — the server returns `{ error, currentTaskIdentifier, currentTaskTitle }` and the CLI prints:

```
Error: this session is permanently bound to LUM-7 "Other task". A session works one task for its lifetime — start a new Claude Code session to work on LUM-42.
```

There is no `--force` and no `session detach`. To work on a different task, open a new terminal / Claude Code session and run `lumo session attach <new-task>` there. A session already bound as **STEWARD** of a milestone (below) also 409s here — it can never attach a task.

#### When to suggest

If `session attach` returns 409, do not retry or look for a workaround — start a fresh Claude Code session for the target task.

#### Subagents (LUM-932)

Every subagent gets its own child session (`<parent session id>:<agent id>`); `lumo` commands run inside a subagent act on that child session automatically.

- **Parent attached** (`lumo session attach LUM-12` in the main session): the whole session belongs to LUM-12 — every subagent inherits it, including ones spawned before the attach. A subagent may re-state `LUM-12` (no-op) but attaching a different task is refused with 409.
- **Parent not attached**: each subagent may run `lumo session attach <LUM-N>` itself as its first step; its work then belongs to that task. When dispatching subagents for different tasks, put the task id in the subagent prompt and tell it to attach first.
- A subagent that attached on its own keeps its task even if the parent attaches later.
- A subagent of a **STEWARD** session cannot attach a task (409), same as the steward session itself.
- How a command finds its subagent: Lumo matches the call to the subagent's own still-running Bash command — nothing is rewritten and permissions are unchanged. If two sessions of the same family run the **identical** `lumo` command at the same moment, a write command is refused as ambiguous (just re-run it once the other finishes); a read command falls back to the main session. `lumo session attach` is stricter: if it cannot tell the main session from a subagent that is mid-command, it refuses — a subagent should run `lumo session attach <TASK>` directly (not via a script, variable or npx).
- **Inside a subagent, always pass the task id explicitly** (`lumo verify LUM-12`, `lumo task status LUM-12`, `lumo task context LUM-12`) — parallel subagents running the same argument-less command (`lumo verify`, `lumo session status`) cannot be told apart. When dispatching subagents, include this instruction in each subagent prompt.

When to suggest: you are about to dispatch subagents to work on **different** tasks from one session — do not attach the main session; instruct each subagent to attach its own task first. If all subagents work on the **same** task, attach the main session once instead — the subagents inherit it.

#### Automatic attribution (LUM-932, shadow mode)

When a session is not attached, Lumo infers which task each turn belongs to from what the session does: the git branch (`lumo/LUM-12-…`, or a branch with a linked PR), `lumo` commands that name a task (`lumo verify LUM-12`), commit messages with `[LUM-12]`, `gh pr create` titles, task ids in your prompts, and — for subagents — task ids in the prompt that dispatched them. Attaching still takes precedence. In this release the inferred attribution is recorded for evaluation only; gates and statistics still use explicit attachment.

### `lumo session attach --steward <milestone>` — bind as a STEWARD (governance) session (LUM-640)

The **second legal session form**: instead of a task, the session binds a **milestone** and becomes a governance role — it plans and accepts, it never implements.

```bash
lumo session attach --steward "Agent-Native Milestones"   # by name (case-insensitive)
lumo session attach --steward agent-native-milestones     # by slug
lumo session attach --steward cmxyz123...                 # by milestone id
```

- **Resolution:** exact id → case-insensitive name/slug across the workspace's active milestones. An **ambiguous** name is refused with 400 listing the candidates (retry with the id); no match is 404.
- **Lifetime lock, same semantics as the task form:** re-attach to the **same** milestone = idempotent no-op; attach a **task** after a steward bind → 409; attach a **different milestone** → 409; a task-bound session running `--steward` → 409. No `--force`, no detach — a different binding needs a new Claude Code session.
- **Multiple stewards per milestone are allowed** (acceptance is multi-round by nature); sessions don't conflict.
- **Prior-milestone learnings injected at attach (LUM-647):** the attach prints a `## Prior-milestone learnings (this project)` section — the **MILESTONE-scope** memories distilled from this project's earlier milestone-close retros (a cross-milestone learning unit), wrapped in the `<untrusted-team-memory>` boundary. Empty when the project has no prior distilled learnings; the current milestone's own rows are excluded. A resumed steward session re-gets it via the session-start hook. These memories are written automatically when a milestone closes and its retro is generated — there is no manual command to author them.

**Allowed (governance — pass through unchanged, with the session recorded as provenance):** `task create` / `task update`, `task criteria set` (incl. `--human`), `task deps confirm/dismiss`, `milestone add/remove`, and **all read operations**.

**Blocked (implementation — first layer, API gate):**

- `lumo verify` → **409, no round burned, no VerificationRun written**. The error names the milestone and the remedy (start an implementation session and `lumo session attach <task>`). Do not retry from the steward session.
- Moving a task to `in_progress` with **yourself as the effective assignee** (whether already assigned to you or assigned in the same call) → 409. Dispatching to _someone else_ is planning and passes.
- Red line unchanged: a steward writes no PASS of any kind; DONE stays human-only.

**Backstop (second layer, detector):** commits / PR creations produced during a steward session anyway (the CLI can't stop local git) are recorded as **`STEWARD_IMPLEMENTATION_ARTIFACT` boundary crossings against the milestone** — fail-closed (an unparseable Bash payload records an _unconfirmed_ crossing rather than nothing), disposition stays **web + human-only** — `lumo crossing disposition` (LUM-769) is task-scoped and cannot reach a milestone crossing — and there is **no CLI clear path** (`crossing explain` remains an appeal, never a clear).

#### When to suggest

The user asks to "review/accept/plan a milestone", to act as reviewer/steward across tasks, or wants a governance session that must not implement. If a steward session needs code changed, dispatch the task to an implementation owner (or tell the user to open a new implementation session) — never work around the gate.

### Parallel sessions

Each Claude Code session has its own `CLAUDE_CODE_SESSION_ID`. Two terminals running `claude code` and binding to different tasks will not interfere — bindings are scoped per session row server-side.

### `lumo session status` — show current binding

```bash
lumo session status
```

Prints what the current Claude Code session is bound to — a task, a milestone (`Role: STEWARD (governance — plan & accept only)`), or "(no task)" if none. Requires `$CLAUDE_CODE_SESSION_ID` (must run inside Claude Code).

#### When to suggest

The user asks "which task am I on", "what's this session bound to", or you need to decide whether to suggest `session attach` for a mentioned task ID.

### Automatic end-of-session housekeeping (no command)

The old end-of-session command was **removed**. The three passes it ran interactively now happen **automatically server-side** — all evidence-gated, best-effort, and silent. There is nothing for the agent to run or confirm. Two fire when the bound task reaches **DONE** (`lumo task update <id> --status done`, which threads `CLAUDE_CODE_SESSION_ID` so attribution lands); one runs continuously off the failure/progress hooks.

**1. Layer-1 memory curation (on DONE).** An LLM judge reviews the Layer-1 memories each of the task's sessions recorded, against that session's event log, and **soft-invalidates only the clearly-wrong / self-contradictory ones**: the row flips to `INVALIDATED` and is excluded from injection but **kept for audit — never hard-deleted**. **Uncertain memories are left untouched** (the judge defaults to keeping). Promotion to project scope is **not** done here — that stays with the Layer-2 flow (surfaced at the next session-start, see above).

**2. Fragment-usage audit (on DONE).** An LLM judge sees the fragments this session consumed (its lineage edges) plus the session's event log and votes which were **actually used**:

- confidently-used edges → `used=true`
- confidently-unused → `used=false`
- genuinely-uncertain edges stay `null` (honest "not voted", not "unused")

Already-voted sessions are skipped; a cron backstop drains any backlog. **Why:** upgrades the flywheel signal from "co-loaded" (constant) to "actually used" (discriminative). `task context --full` then reports each fragment's **judged-used track record** — of the N tasks it appeared in, X were judged to have actually used it. That is a **lower bound** (never-audited appearances are excluded from the proven/retire calls), and it **replaced the retired merge-rate signal** (RFC LUM-535).

> Don't confuse this with the used-vs-base **merge rate** still reported by `lumo task lineage --signal` ([task-context.md](task-context.md)) — that is a different, live metric for workspace signal-health, not the retired fragment-usefulness one.

**3. Blocked-tag automation (server-side).** When a session crosses the same-tool failure threshold (**≥ 3** same-type failures, aggregated from `POST_TOOL_USE_FAILURE` grouped by tool name + `STOP_FAILURE` turn-level failures), the server **auto-applies the shared `blocked` tag** to the bound task. This inverts the old manual gate — no prompt, no human in the loop — and is safe via three safeguards:

- **idempotent:** at most one active auto-block per task, so re-crossing is a no-op.
- **auto-untag on progress:** the next observable progress (a successful tool call or a non-failure turn end) removes the tag.
- **attribution:** the triggering session + model are recorded.

A **human-applied** `blocked` tag has no auto-block record and is **never** auto-removed by progress.

#### When to suggest

Nothing to suggest — these run on their own. If a teammate asks why a task shows `blocked`, explain it's the auto-block (repeated same-tool failures) and that it clears itself once the task makes progress; a human can also remove the tag manually from the board.
