# Sessions — `session attach` / `session status`

Binding a session to a task (or a milestone as steward), subagents, attribution. What session start injects and the automatic end-of-session passes: [session-start.md](session-start.md). Codex specifics: [codex.md](codex.md).

## `lumo session attach <identifier>` — bind the current session to a task

Use this whenever the user mentions a task ID. It is the only way to bind a session to a task.

```bash
lumo session attach LUM-42
lumo session attach LUM-42 --worktree      # also create the task's worktree if none exists
lumo session attach LUM-42 --no-worktree   # never create one, even with autoWorktree
```

What it does:

- Reads the session id from the environment: in Codex `CODEX_SESSION_ID` / `CODEX_THREAD_ID` (see [codex.md](codex.md)), otherwise `CLAUDE_CODE_SESSION_ID` (Claude Code sets it automatically); errors out when neither is set — must run from inside a Claude Code or Codex session.
- Calls `POST /api/sessions/<session_id>/bind-task`, which sets the Session row's `taskId` and re-tags previously-untagged HookEvent rows in this session.
- The binding lives entirely on the server (`Session.taskId`); subsequent hooks read it back via the session row. The CLI keeps no local sentinel.
- Prints one bind line (`Attached session … to LUM-42 "title"`, plus `· re-tagged N earlier events` when N > 0), then only the start-of-work signals: the **dependency blocker** warning, **possible duplicates** (each likely original with its confirm / not-a-duplicate commands; ask the user before working), and **undispositioned security findings**.
- Does **not** print team memory or the `## Test cases` nudge — `lumo task show --full` prints both, and attach output is re-read on every later step. Instead one line: ``Hint: run `lumo task show LUM-42 --full` for background (team memory, test cases, sources, prior sessions)``.

After attaching, always run `lumo task show <identifier> --full` to load the task background — memory and the test-case nudge live there.

### Auto-downsync on attach

A successful `session attach` (Claude Code only — skipped in Codex) also runs a **best-effort team-memory downsync** for the bound task's project — the same work as `lumo memory sync` (including the P4b code-anchor staleness check), landing the team's memory in your local Claude Code memory store without a separate command.

- **Throttle-gated:** network is skipped entirely if this repo already synced within `LUMO_SYNC_THROTTLE_HOURS` (default **12h**), so re-attaches and same-day sessions are cheap.
- **Non-blocking:** a sync failure is swallowed — it **never** changes the bind outcome.
- **Output:** on a non-trivial sync the CLI prints one extra line, `memory sync → +N ~M -K`.
- Manual `lumo memory sync` stays unthrottled.
- `LUMO_DISABLE_MEMORY_AUTO=1` turns off the auto-downsync (and the hook auto-upsync — see [memory.md](memory.md)) entirely; `--no-anchor-check` on `lumo memory sync` is unchanged.

### Worktree step

After the bind (before the `Next:` block) attach checks the task's local git worktrees — best-effort, never changes the exit code:

- **Worktree(s) exist** → every one is listed by path (never one picked silently), the one you're in is marked `← you are here`, else a `cd <path>` line.
- **You're already in some other linked worktree** (e.g. a Claude Code worktree) → it says so and creates nothing.
- **Main checkout, none yet** → with `--worktree`, or `autoWorktree: true` in `.lumo/worktree.json` (this repo sets it), it runs the same scaffold as `lumo worktree add` with a slug from the title's first words; otherwise it prints a `lumo worktree add <id>` hint. `--no-worktree` suppresses creation. A failed creation is a warning — the bind already succeeded.

After an auto-create, **move into the worktree** (`cd <path>`) before editing — the session's shell still starts in the main checkout. Details: [worktree.md](worktree.md).

### Lifetime lock

`Session.taskId` is **write-once**. Re-attaching to the **same** task is always a no-op re-bind (idempotent, re-emits context). Attaching to a **different** task is refused with HTTP 409 — the server returns `{ error, currentTaskIdentifier, currentTaskTitle }` and the CLI prints:

```
Error: this session is permanently bound to LUM-7 "Other task". A session works one task for its lifetime — start a new Claude Code session to work on LUM-42.
```

There is no `--force` and no `session detach`. To work on a different task, open a new terminal / Claude Code session and run `lumo session attach <new-task>` there. A session already bound as **STEWARD** of a milestone (below) also 409s here — it can never attach a task.

### When to suggest

If `session attach` returns 409, do not retry or look for a workaround — start a fresh Claude Code session for the target task.

### Subagents

Every subagent gets its own child session (`<parent session id>:<agent id>`); `lumo` commands run inside a subagent act on that child session automatically.

- **Parent attached** (`lumo session attach LUM-12` in the main session): the whole session belongs to LUM-12 — every subagent inherits it, including ones spawned before the attach. A subagent may re-state `LUM-12` (no-op) but attaching a different task is refused with 409.
- **Parent not attached**: each subagent may run `lumo session attach <LUM-N>` itself as its first step; its work then belongs to that task. When dispatching subagents for different tasks, put the task id in the subagent prompt and tell it to attach first.
- A subagent that attached on its own keeps its task even if the parent attaches later.
- A subagent of a **STEWARD** session cannot attach a task (409), same as the steward session itself.
- How a command finds its subagent: Lumo matches the call to the subagent's own still-running Bash command — nothing is rewritten and permissions are unchanged. If two sessions of the same family run the **identical** `lumo` command at the same moment, a write command is refused as ambiguous (just re-run it once the other finishes); a read command falls back to the main session. `lumo session attach` is stricter: if it cannot tell the main session from a subagent that is mid-command, it refuses — a subagent should run `lumo session attach <TASK>` directly (not via a script, variable or npx).
- **Inside a subagent, always pass the task id explicitly** (`lumo task status LUM-12`, `lumo task show LUM-12 --full`) — parallel subagents running the same argument-less command (`lumo task status`, `lumo session status`) cannot be told apart. When dispatching subagents, include this instruction in each subagent prompt.

When to suggest: you are about to dispatch subagents to work on **different** tasks from one session — do not attach the main session; instruct each subagent to attach its own task first. If all subagents work on the **same** task, attach the main session once instead — the subagents inherit it.

### Automatic attribution

When a session is not attached, Lumo attributes its work by inference from what the session does: the git branch (`lumo/LUM-12-…`, or a branch with a linked PR), `lumo` commands that name a task (`lumo task status LUM-12`), commit messages with `[LUM-12]`, `gh pr create` titles, task ids in your prompts, subagent dispatch prompts, and the session-start git hint. This attribution drives gates and cost: events are tagged with the inferred task at record time, boundary-crossing detectors run immediately, and the task's cost and iterations include that work. Attribution can change at the next recompute (after a turn ends, a subagent stops, or an attach); undispositioned crossings move with the work, ruled ones stay. On a task branch, work belongs to the branch's task; to switch tasks, switch branch or worktree (or attach).

Off a task branch, a turn whose commands name two or more tasks belongs to the one task its output (an `[ID]` commit or `gh pr create`) names; with no output, or output for several tasks, the turn is unattributed, and later turns without their own task signal stay unattributed instead of inheriting the earlier task. A turn opened by a background subagent's completion notice follows that subagent's task (unattributed when the subagent has none or several).

`lumo session attach` remains the explicit, highest-priority binding and is recommended at the start of task work; attaching later re-tags the session's earlier work (and its open crossings) to the attached task. Unattached task work no longer records `SESSION_BINDING_MISSING`; a session explicitly attached to a _different_ task is still refused (409). STEWARD sessions and their subagents are never inferred onto a task.

## `lumo session attach --steward <milestone>` — bind as a STEWARD (governance) session

The **second legal session form**: instead of a task, the session binds a **milestone** and becomes a governance role — it plans and accepts, it never implements.

```bash
lumo session attach --steward "Agent-Native Milestones"   # by name (case-insensitive)
lumo session attach --steward agent-native-milestones     # by slug
lumo session attach --steward cmxyz123...                 # by milestone id
```

- **Resolution:** exact id → case-insensitive name/slug across the workspace's active milestones. An **ambiguous** name is refused with 400 listing the candidates (retry with the id); no match is 404.
- **Lifetime lock, same semantics as the task form:** re-attach to the **same** milestone = idempotent no-op; attach a **task** after a steward bind → 409; attach a **different milestone** → 409; a task-bound session running `--steward` → 409. No `--force`, no detach — a different binding needs a new Claude Code session.
- **Multiple stewards per milestone are allowed** (acceptance is multi-round by nature); sessions don't conflict.
- **Prior-milestone learnings injected at attach:** the attach prints a `## Prior-milestone learnings (this project)` section — the **MILESTONE-scope** memories distilled from this project's earlier milestone-close retros (a cross-milestone learning unit), wrapped in the `<untrusted-team-memory>` boundary. Empty when the project has no prior distilled learnings; the current milestone's own rows are excluded. A resumed steward session re-gets it via the session-start hook. These memories are written automatically when a milestone closes and its retro is generated — there is no manual command to author them.

**Allowed (governance — pass through unchanged, with the session recorded as provenance):** `task create` / `task update`, `milestone testcase add/run`, `task dep confirm/dismiss`, `milestone add/remove`, and **all read operations**.

**Blocked (implementation — first layer, API gate):**

- Moving a task to `in_progress` with **yourself as the effective assignee** (whether already assigned to you or assigned in the same call) → 409. Dispatching to _someone else_ is planning and passes.
- Red line unchanged: a steward writes no PASS of any kind; DONE stays human-only.

**Backstop (second layer, detector):** commits / PR creations produced during a steward session anyway (the CLI can't stop local git) are recorded as **`STEWARD_IMPLEMENTATION_ARTIFACT` boundary crossings against the milestone** — fail-closed (an unparseable Bash payload records an _unconfirmed_ crossing rather than nothing), disposition stays **web + human-only** — `lumo crossing disposition` is task-scoped and cannot reach a milestone crossing — and there is **no CLI clear path** (`crossing explain` remains an appeal, never a clear).

### When to suggest

The user asks to "review/accept/plan a milestone", to act as reviewer/steward across tasks, or wants a governance session that must not implement. If a steward session needs code changed, dispatch the task to an implementation owner (or tell the user to open a new implementation session) — never work around the gate.

## Parallel sessions

Each Claude Code or Codex session has its own session id (`CLAUDE_CODE_SESSION_ID` / `CODEX_THREAD_ID`, see [codex.md](codex.md)). Two terminals running an agent and binding to different tasks will not interfere — bindings are scoped per session row server-side.

## `lumo session status` — show current binding

`--json` prints `{ version, session }` — the server's session record (binding, role, event count, attribution); `{ sessionId, exists: false }` before the session has any server-side state.

```bash
lumo session status
```

Prints what the current Claude Code or Codex session is bound to — `Session <id>`, then `Label:  value` rows padded to the widest label: `Bound to:  LUM-12 "<title>"`, a milestone (`Role:  STEWARD (governance — plan & accept only)` + `Bound to:  milestone "<name>"`), or `-` if none, and `Events:  <n>`. Must run inside a Claude Code or Codex session (`$CLAUDE_CODE_SESSION_ID` or `$CODEX_THREAD_ID`).

Against a server that reports attribution it also lists where the run's work is going, as headed sections with aligned tables. A subagent's own session prints a `Subagent of:  <parent session>` row first and shows its family's view.

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

### When to suggest

The user asks "which task am I on", "what's this session bound to", or you need to decide whether to suggest `session attach` for a mentioned task ID.
