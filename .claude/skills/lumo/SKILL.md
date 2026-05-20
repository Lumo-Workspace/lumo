---
name: lumo
description: 'Use the Lumo CLI to load task context, manage session bindings, and update tasks from the terminal. Activate when: user mentions a Lumo task identifier (LUM-42, LUM-12, etc.), asks to load task background or context, wants to bind the current session to a task, is about to start development work on a specific task, or wants to update a task''s status/title/description/priority/assignee. Triggers on: "LUM-", "task context", "load context", "session attach", "attach session", "bind session", "which task", "work on LUM", "update task", "change task status", "rename task", "reassign task", "mark task as done".'
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

## Task Management

### `lumo task update <identifier> [flags]` — patch a task

Pure flag-driven update. Provide at least one of:

| Flag                   | Type   | Notes                                                               |
| ---------------------- | ------ | ------------------------------------------------------------------- |
| `-t, --title <text>`   | string | Cannot be empty.                                                    |
| `-d, --description <>` | string | `--description ""` clears the field.                                |
| `-s, --status <value>` | enum   | `todo \| in_progress \| in_review \| done` (case-insensitive).      |
| `-p, --priority <lvl>` | enum   | `low \| medium \| high \| urgent`.                                  |
| `-a, --assignee <ref>` | string | `me`, an email, or a member name. `--assignee ""` clears the field. |

Examples:

```bash
lumo task update LUM-48 --status in_progress
lumo task update LUM-48 --title "Update task from CLI" --priority high
lumo task update LUM-48 --assignee me
lumo task update LUM-48 --description ""        # clear description
lumo task update LUM-48 --assignee ""           # unassign
```

On success the command prints one line to stdout:

```
Updated LUM-48 "Title"  https://www.uselumo.ai/workspace/<slug>/my-tasks/LUM-48
```

### When to suggest `task update`

- The user describes a state change in natural language (e.g. "mark LUM-48 as in progress", "rename LUM-12 to ...", "assign LUM-30 to me", "bump the priority on LUM-7").
- After the agent finishes a task and the user confirms — offer to move it to `done`.
- Multiple status changes in a row should each be a separate `update` invocation rather than batched.

### Out of scope

The CLI does **not** currently update tags / labels, reviewer, sprint, due date, or parent task. Those need to be edited in the web UI. (Tags support is planned as a follow-up.)

## Session Management

### `lumo session attach <identifier>` — bind the current session to a task

Use this whenever the user mentions a task ID. The command is the only way to bind a session to a task.

```bash
lumo session attach LUM-42
```

What it does:

- Reads `CLAUDE_CODE_SESSION_ID` from the environment (Claude Code sets this automatically). If it is not set, the command errors out — it must run from inside a Claude Code session.
- Calls `POST /api/sessions/<session_id>/bind-task` on the Lumo server, which sets the Session row's `taskId` and re-tags previously-untagged HookEvent rows in this session.
- The binding is server-authoritative — there is no local sentinel file. Subsequent hook events look up the task via the session row on the server.

**After attaching, always run `lumo task context <identifier>` to load the task background.**

### Parallel sessions

Each Claude Code session has its own `CLAUDE_CODE_SESSION_ID`, and binding is stored per-session on the server. Two terminals running `claude code` and binding to different tasks will not interfere with each other.

### When to suggest session binding

- If the user mentions a task ID (e.g., "let's work on LUM-42") and no session is currently bound, **suggest running `lumo session attach`**.
- If the user switches tasks mid-session, run `attach` with the new task ID — this updates `Session.taskId` server-side.

## Workflow Example

Typical flow when a user says "help me with LUM-42":

1. Run `lumo session attach LUM-42` to bind this session
2. Run `lumo task context LUM-42` to load background
3. Review unresolved items and task description
4. Begin working on the task
