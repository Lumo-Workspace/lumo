---
name: lumo
description: 'Use the Lumo CLI to load task context and manage session bindings. Activate when: user mentions a Lumo task identifier (LUM-42, LUM-12, etc.), asks to load task background or context, wants to bind the current session to a task, or is about to start development work on a specific task. Triggers on: "LUM-", "task context", "load context", "session start", "session attach", "bind session", "which task", "work on LUM".'
---

## Prerequisites

Before running any `lumo` command, verify the CLI is available and authenticated:

```bash
which lumo && lumo whoami
```

- If `lumo` is not found: tell the user to install it (`cd cli && npm install && npm link`)
- If `lumo whoami` fails with an auth error: tell the user to run `lumo auth login`
- Do NOT proceed with any lumo commands until both checks pass

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
3. **Previous sessions** — ordered newest-first, each with:
   - A headline summary of what was done
   - Unresolved items (carry-over TODOs from that session)

### How to use the context

- **Unresolved items** from the most recent session are the highest-priority carry-overs — address them before starting new work unless the user says otherwise
- **Memory section** provides validated context that persists across sessions — use it to avoid re-learning decisions or constraints
- Focus on the **most recent 1–2 sessions** for relevant state; older sessions are for historical reference only
- If there are **no prior sessions**, this is a fresh start — read the task description carefully and ask clarifying questions if needed

## Session Management

Two commands for binding sessions to tasks:

### `lumo session attach <identifier>` — bind the current session

Use this when you are **inside an active Claude Code session** and the user mentions a task. This is the most common case.

```bash
lumo session attach LUM-42
```

What it does:

- Binds the current running session to the task in Lumo
- Re-tags previously-untagged hook events in this session
- Sets the task for future sessions in this terminal

**After attaching, always run `lumo task context <identifier>` to load the task background.**

### `lumo session start <identifier>` — pre-tag the next session

Use this only when the user wants to prepare **before** launching a new `claude code` session (rare from within a skill, since you are already in a session).

```bash
lumo session start LUM-42
```

What it does:

- Writes `~/.lumo/current-task.json` so the next Claude Code session's hook events are tagged with this task

### When to suggest session binding

- If the user mentions a task ID (e.g., "let's work on LUM-42") and no session is currently bound, **suggest running `lumo session attach`**
- If the user switches tasks mid-session, use `attach` with the new task ID
- Never run `session start` from inside an active session — use `attach` instead

## Workflow Example

Typical flow when a user says "help me with LUM-42":

1. Run `lumo session attach LUM-42` to bind this session
2. Run `lumo task context LUM-42` to load background
3. Review unresolved items and task description
4. Begin working on the task
