# Session Management

## Session Management

### Suggest-on-start from local git (no auto-bind)

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

#### When to suggest

You see a suggestion line. Confirm the inferred task is the one the user wants, then run `lumo session attach <LUM-N>` followed by `lumo task context <LUM-N>` to load the background. `session attach` is the **only** path that binds — there is nothing to "undo" if the inference is wrong; just attach the correct task instead.

### Session record notice at session start (LUM-943)

Every session start — bound or not — injects one line saying how this workspace stores session records: the mode (kept forever / kept at least N days / code and command output not stored, discarded after the work is used up), that credentials are always redacted, and that an OWNER can change it in **Settings → Data retention** (with the link). It is read fresh each session start, so an OWNER's change shows on the next one. An older server or a failed lookup simply omits the line. `lumo init` prints the same line when logged in.

#### When to suggest

The user asks whether / how long Lumo keeps their Claude Code sessions, code or command output: quote the line, and point an OWNER at the settings link to change it. Don't add claims beyond it (e.g. about encryption).

### Layer 2 project-memory review at session start

When the session is bound, session-start may inject a **"🆕 Review needed: project memories auto-consolidated by the previous session"** section alongside the memory / PR-review blocks. It lists the **PROJECT-scope** memories that the member's **immediately-preceding session** auto-consolidated (Layer 2 runs asynchronously when a task is marked `done`). Each item shows its `id`.

- **Why async / next-session:** Layer 2 promotions land after the task hits DONE, so they surface at the _next_ session-start, when they've definitely landed.
- **Show-once:** the section appears only at the session immediately following the one that produced the memories. It does **not** re-nag later, so act now or it scrolls off.
- **Attribution:** `lumo task update <id> --status done` automatically sends `CLAUDE_CODE_SESSION_ID` (via `X-Lumo-Session-Id`) so the Layer 2 memories are attributed to the session. Marking done from the **web UI** leaves them unattributed (they won't surface for review) — expected.

#### When to suggest

Briefly sanity-check each listed memory against the codebase/context. If one is wrong or over-generalized, remove it with `lumo memory rm <ref>` (the 8-char ref printed under it) — it exits 4 with a confirmation envelope; show it to the user and re-run with `--confirm` only on their approval ([confirmation.md](confirmation.md)). If they all look right, ignore the section and continue.

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

- Reads the session id from the environment: in Codex `CODEX_SESSION_ID` / `CODEX_THREAD_ID` (see [Codex](#codex)), otherwise `CLAUDE_CODE_SESSION_ID` (Claude Code sets it automatically); errors out when neither is set — must run from inside a Claude Code or Codex session.
- Calls `POST /api/sessions/<session_id>/bind-task`, which sets the Session row's `taskId` and re-tags previously-untagged HookEvent rows in this session.
- The binding lives entirely on the server (`Session.taskId`); subsequent hooks read it back via the session row. The CLI keeps no local sentinel.
- Prints one bind line (`Attached session … to LUM-42 "title"`, plus `· re-tagged N earlier events` when N > 0), then only the start-of-work signals: the **dependency blocker** warning and **undispositioned security findings**.
- Does **not** print team memory or the `## Test cases` nudge (LUM-807) — `lumo task context` prints both, and attach output is re-read on every later step (LUM-844). Instead one line: ``Hint: run `lumo task context LUM-42` for background (team memory, test cases, sources, prior sessions)``.

After attaching, always run `lumo task context <identifier>` to load the task background — memory and the test-case nudge live there.

#### Auto-downsync on attach

A successful `session attach` (Claude Code only — skipped in Codex) also runs a **best-effort team-memory downsync** for the bound task's project — the same work as `lumo memory sync` (including the P4b code-anchor staleness check), landing the team's memory in your local Claude Code memory store without a separate command.

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
- **Inside a subagent, always pass the task id explicitly** (`lumo task status LUM-12`, `lumo task context LUM-12`) — parallel subagents running the same argument-less command (`lumo task status`, `lumo session status`) cannot be told apart. When dispatching subagents, include this instruction in each subagent prompt.

When to suggest: you are about to dispatch subagents to work on **different** tasks from one session — do not attach the main session; instruct each subagent to attach its own task first. If all subagents work on the **same** task, attach the main session once instead — the subagents inherit it.

#### Automatic attribution (LUM-932)

When a session is not attached, Lumo attributes its work by inference from what the session does: the git branch (`lumo/LUM-12-…`, or a branch with a linked PR), `lumo` commands that name a task (`lumo task status LUM-12`), commit messages with `[LUM-12]`, `gh pr create` titles, task ids in your prompts, subagent dispatch prompts, and the session-start git hint. This attribution drives gates and cost: events are tagged with the inferred task at record time, boundary-crossing detectors run immediately, and the task's cost and iterations include that work. Attribution can change at the next recompute (after a turn ends, a subagent stops, or an attach); undispositioned crossings move with the work, ruled ones stay. On a task branch, work belongs to the branch's task; to switch tasks, switch branch or worktree (or attach).

Off a task branch, a turn whose commands name two or more tasks belongs to the one task its output (an `[ID]` commit or `gh pr create`) names; with no output, or output for several tasks, the turn is unattributed, and later turns without their own task signal stay unattributed instead of inheriting the earlier task. A turn opened by a background subagent's completion notice follows that subagent's task (unattributed when the subagent has none or several).

`lumo session attach` remains the explicit, highest-priority binding and is recommended at the start of task work; attaching later re-tags the session's earlier work (and its open crossings) to the attached task. Unattached task work no longer records `SESSION_BINDING_MISSING`; a session explicitly attached to a _different_ task is still refused (409). STEWARD sessions and their subagents are never inferred onto a task.

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

**Allowed (governance — pass through unchanged, with the session recorded as provenance):** `task create` / `task update`, `milestone testcase add/run`, `task deps confirm/dismiss`, `milestone add/remove`, and **all read operations**.

**Blocked (implementation — first layer, API gate):**

- Moving a task to `in_progress` with **yourself as the effective assignee** (whether already assigned to you or assigned in the same call) → 409. Dispatching to _someone else_ is planning and passes.
- Red line unchanged: a steward writes no PASS of any kind; DONE stays human-only.

**Backstop (second layer, detector):** commits / PR creations produced during a steward session anyway (the CLI can't stop local git) are recorded as **`STEWARD_IMPLEMENTATION_ARTIFACT` boundary crossings against the milestone** — fail-closed (an unparseable Bash payload records an _unconfirmed_ crossing rather than nothing), disposition stays **web + human-only** — `lumo crossing disposition` (LUM-769) is task-scoped and cannot reach a milestone crossing — and there is **no CLI clear path** (`crossing explain` remains an appeal, never a clear).

#### When to suggest

The user asks to "review/accept/plan a milestone", to act as reviewer/steward across tasks, or wants a governance session that must not implement. If a steward session needs code changed, dispatch the task to an implementation owner (or tell the user to open a new implementation session) — never work around the gate.

### Parallel sessions

Each Claude Code or Codex session has its own session id (`CLAUDE_CODE_SESSION_ID` / `CODEX_THREAD_ID`, see [Codex](#codex) below). Two terminals running an agent and binding to different tasks will not interfere — bindings are scoped per session row server-side.

### `lumo session status` — show current binding

```bash
lumo session status
```

Prints what the current Claude Code or Codex session is bound to — `Session <id>`, then `Label:  value` rows padded to the widest label (LUM-1090): `Bound to:  LUM-12 "<title>"`, a milestone (`Role:  STEWARD (governance — plan & accept only)` + `Bound to:  milestone "<name>"`), or `-` if none, and `Events:  <n>`. Must run inside a Claude Code or Codex session (`$CLAUDE_CODE_SESSION_ID` or `$CODEX_THREAD_ID`).

Against a server that reports attribution (LUM-932) it also lists where the run's work is going, as headed sections with aligned tables. A subagent's own session prints a `Subagent of:  <parent session>` row first and shows its family's view.

```
Session 7c0e…
Bound to:  LUM-12 "Fix login"
Events:    42

Attribution
  LUM-12  turns 1–4  auto-detected · high (git hint LUM-12, lumo cmd LUM-12)
  LUM-13  turn 5     auto-detected · medium (agent prompt LUM-13)

Subagents
  Explore (abc123)     LUM-14 subagent attach
  general-purpose ×12  follows parent

⚠ Some work was auto-detected — time and cost may be inaccurate. For exact numbers, run:
  lumo session attach <LUM-N>
```

- Turns are numbered from 1 (turn 1 = the session's first prompt), the same as the web run panel.
- Source words: `attached`, `subagent attach`, `inherited`, `auto-detected` (the `high`/`medium` confidence only appears for auto-detected). Evidence is what triggered the inference (max 3 per segment).
- A subagent with no task of its own prints `follows parent` — its work goes wherever the parent's does.
- Subagents whose line would be identical (same type and same tasks/source words) are collapsed into one `<type> ×N` line; a lone subagent keeps its short `(id)`.
- A bound session whose attribution has not been computed yet still lists its bound task as `attached`.
- An unbound session with no signal yet prints `None yet (no task signal)` under the Attribution heading, with `lumo session attach <LUM-N>` on a line of its own; it is auto-detected later from branch, commits and `lumo` commands.
- The `⚠` line means some of the work is inferred, so time and cost are approximate; `lumo session attach <LUM-N>` makes them exact. Older servers print only the binding rows.

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

## Codex

Codex (CLI and desktop app, 0.162+) is a supported agent since LUM-1051. `lumo init` (no `--agent`, or `--agent codex`) installs the skill, `.codex/hooks.json` and `.codex/rules/lumo.rules` ([onboarding.md](onboarding.md)); the user must **trust** the hooks once (Codex app Settings → Hooks, or `/hooks`).

- **Network.** Codex's default sandbox has no network; the Lumo rules run only the **server-only** `lumo` commands outside it without a prompt — the ones that just call the Lumo API (`task show/context/list/status/wrapup/comment/create`, `doc show/list/…`, `session status`, `next`, …). The `lumo` commands that change local files or start local processes stay sandboxed on purpose: `session attach` (can create a worktree), `task update` (a confirmed DONE removes worktrees), `worktree …`, `memory sync/push`, `init`/`uninstall`/`update`, `auth …`, `hook …`, the commands that can read a local file and upload it (`doc create/update/patch/append/diff`, `task artifact add`, `task template create/edit`, `task testcase run`, `crossing explain`, `milestone testcase run`, `usage resync` — a prefix rule cannot exclude `--file`), plus the human-only `crossing disposition` / `task testcase disposition` (local-only `whoami` / `doctor` run fine sandboxed). For those, request Codex's approval to run outside the sandbox (the user is asked) or have the user run them. Source of truth: `CODEX_SERVER_ONLY_COMMANDS` in `cli/src/lib/codex-rules.ts`. The rules match the words right after `lumo`, so run `lumo …` as its own command with flags after the subcommand — `lumo a && lumo b` is fine, but `lumo … | head` / `> file` / `lumo --no-hints task …` runs sandboxed and fails with `could not reach Lumo API … (fetch failed)`. On that failure inside the sandbox the CLI appends a `Hint:`: for a server-only command it says re-run `lumo init` and restart Codex (a project's rule loads only in a trusted project); for a sandboxed-on-purpose command it says approve it in Codex instead — relay it. Hooks run outside the sandbox either way.

- **Session id.** Codex sets `CODEX_THREAD_ID` in every shell; it wins over a `CLAUDE_CODE_SESSION_ID` inherited from a parent Claude Code session. The session is `CODEX_SESSION_ID`. Inside a Codex subagent the two differ and the CLI uses the child session `<CODEX_SESSION_ID>:<CODEX_THREAD_ID>` — the same id the hooks build from the payload's `session_id` + `agent_id` — so a subagent's `session attach` is deterministic (no Claude-style ambiguity errors).
- **Hook trust self-check.** Codex skips untrusted hooks with no error. When the server has no hook event for this Codex session, `session attach` (after the bind line) and `session status` (on stderr) print `no hook events have reached Lumo from this Codex session …` — relay it: the user must run `lumo init` (or `lumo init --agent codex`) and trust the `lumo hook …` entries. Until then nothing of the session is recorded. When events do arrive but some Lumo events have no trust entry in `~/.codex/config.toml` for the user or repo `.codex/hooks.json` (LUM-1112 — typically events added or changed by re-running `lumo init`), both print `these Lumo hook events may not be trusted in Codex: <events>` instead — relay it: trust those entries in Codex (`/hooks`). The check is a text scan (hash not verified), so it is worded as "may"; it stays silent when no Lumo event looks trusted at all, and never lists events of a hooks file whose trust it cannot read (the scan can't be relied on there) and never runs in Claude Code.
- **Session-start context.** The `[Lumo] session_id=…` line, the no-task / detected-task prompt and the task context arrive as developer context (one `additionalContext` JSON object — Codex rejects text mixed with JSON). If the hook list shows `hook: SessionStart Failed` and no `[Lumo] session_id=` line is in context, the installed CLI predates 1.102.0: have the user update it; `lumo session status` still works.
- **Events.** Captured: SessionStart/End, UserPromptSubmit, Pre/PostToolUse, PermissionRequest, SubagentStart/Stop, Stop, plus Codex-only PreCompact / PostCompact / Interrupt (shown on the timeline). Codex has no PostToolUseFailure (a failed command is a normal PostToolUse without exit code), PermissionDenied (a declined approval shows as Interrupt), PostToolBatch, Worktree*, FileChanged, ConfigChange, Task*, Notification, Elicitation\*, CwdChanged or InstructionsLoaded — those signals are absent for Codex sessions.
- **Tools.** Codex writes files only through `apply_patch`; it counts as a write tool (collision warnings, sensitive-path and secret checks, deleted-test detection) with its paths read from the patch headers. Reads go through `Bash`. `collaborationspawn_agent` / `collaborationwait_agent` are its subagent tools.
- **Token usage** comes from the Codex rollout (`~/.codex/sessions/…/rollout-*.jsonl`) on every Stop, subagents from their own rollouts. No mid-turn live usage (no PostToolBatch); an interrupted turn's usage lands with the next Stop. `lumo usage resync` is not needed for Codex.
- **Memory.** `memory sync` / `memory push` refuse in a Codex shell (they target Claude Code's memory store, which Codex never reads; `--dir` still writes explicitly). Team memory reaches Codex through `lumo task context` and the session-start hook.

## usage resync

`lumo usage resync [--apply] [--json]` (LUM-932) recomputes Claude Code token usage from the local deduped transcripts (`$CLAUDE_CONFIG_DIR/projects/*/<sessionId>.jsonl`, default `~/.claude`) and asks the server to correct historical rows that were inflated by double counting. Only token counts are sent, never transcript content; sessions go in batches of 50 per request on a dry run and 10 with `--apply`.

**When to suggest:** the user says historical token/cost numbers look too high or asks to fix/correct past usage. Run it as a dry run first (default: prints `Dry run — nothing written.`, counts and summed before → after tokens), show the result, then re-run with `--apply` once they agree.

```bash
lumo usage resync            # dry run
lumo usage resync --apply    # write corrections
lumo usage resync --json     # merged server response
```

Output starts with `Sent X of Y session(s) with usage.`, then counts: resynced / would be resynced, not on this account / unknown (foreign or never-seen transcripts, not an error), not inflated, already resynced, active after cutoff, no usage.

Partial failures exit 1 and are safe to re-run (already corrected sessions report `already resynced`):

- `N failed — re-run later` — the server failed on those sessions or ran out of its per-request time budget before starting them; nothing was written for them.
- `N session(s) not sent — re-run` (stderr, after the error) — a batch request failed (network, 401, bad response), so it and the remaining batches were not sent; `X` in `Sent X of Y` is lower than `Y`. Results of earlier batches still print.
