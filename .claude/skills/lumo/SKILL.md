---
name: lumo
description: 'Use the Lumo CLI to load task context, manage session bindings, inspect projects, and create/update/list/show/comment on tasks from the terminal. Activate when: user mentions a Lumo task identifier (LUM-42, LUM-12, etc.), asks to load task background or context, wants to bind, check, or detach a Claude Code session''s task binding, is about to start development work on a specific task, wants to create a new task, list their tasks, view a task, comment on a task, list projects, or update a task''s status/title/description/priority/assignee. Triggers on: "LUM-", "task context", "load context", "session start", "session attach", "session status", "session detach", "bind session", "unbind session", "which task", "what task am I on", "work on LUM", "create task", "new task", "add task", "file a task", "log a task", "list tasks", "my tasks", "show task", "view task", "comment on task", "leave a comment", "list projects", "what projects", "update task", "change task status", "rename task", "reassign task", "mark task as done".'
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

### `lumo task create <title> [flags]` — create a new task

Use this when the user wants to file a new task from the terminal. Title is positional and required (non-empty).

| Flag                     | Type   | Notes                                                                            |
| ------------------------ | ------ | -------------------------------------------------------------------------------- |
| `-d, --description <>`   | string | Optional task description.                                                       |
| `-p, --priority <level>` | enum   | `low \| medium \| high \| urgent` (case-insensitive). Defaults to `low`.         |
| `-a, --assignee <ref>`   | string | `me`, an email, or a member name. Defaults to `me`.                              |
| `--project <ref>`        | string | Project name or slug. **Required when the workspace has more than one project.** |

Examples:

```bash
lumo task create "Fix Slack OAuth redirect bug"
lumo task create "Refactor task service" --priority high --description "Split into smaller files"
lumo task create "Investigate slow query" --assignee teammate@example.com --project backend
```

On success the command prints one line to stdout:

```
Created LUM-55 "Title"  https://www.uselumo.ai/workspace/<slug>/my-tasks/LUM-55
```

If the workspace has multiple projects and `--project` is omitted, the server will return an error naming available projects — re-run with `--project <slug>`.

### When to suggest `task create`

- The user describes wanting a new task ("create a task to ...", "file a bug for ...", "log a TODO that ...", "add a task: ...").
- After a discussion that ends in "let's track that separately" — offer to create the task with a sensible title and priority.
- For follow-ups discovered mid-work that shouldn't bloat the current change — propose `task create` rather than silently expanding scope.

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

### `lumo task list [flags]` — list tasks assigned to you

Default behavior: prints every task currently assigned to the authenticated user (no project / status filter), one per line, as a fixed-width table:

```
LUM-42  IN_PROGRESS  HIGH    web        Fix Slack OAuth redirect
LUM-48  TODO         MEDIUM  backend    Investigate slow query
```

| Flag                   | Type    | Notes                                                                            |
| ---------------------- | ------- | -------------------------------------------------------------------------------- |
| `-s, --status <value>` | enum    | Filter by status: `todo \| in_progress \| in_review \| done` (case-insensitive). |
| `-p, --project <ref>`  | string  | Filter by project name (case-insensitive match against display name).            |
| `-n, --limit <count>`  | integer | Cap output to the first N rows.                                                  |

Filtering is currently client-side — the server returns the full "my tasks" set and the CLI slices it. This is fine for typical workspaces (dozens of tasks); revisit if a workspace has hundreds.

### When to suggest `task list`

- The user asks "what am I working on", "what tasks do I have", "list my tasks", "show me my queue".
- Before suggesting a status change ("mark something as done"), if no task ID is in context — run `task list` first to surface candidates.

### `lumo task show <identifier>` — print one task's detail

Returns a key:value block for a single task — title, status, priority, project, assignee (with display name from Clerk), URL, and the full description below. Lighter than `task context` because it does not load prior session summaries or memory.

```bash
lumo task show LUM-42
```

Use when the user wants the current state of a task without the agent-handoff payload.

### `lumo task comment <identifier> <body>` — leave a comment

Two-step under the hood (resolve LUM-N → POST comment). Body is plain text; quote it to embed spaces or newlines.

```bash
lumo task comment LUM-42 "Reproduced the redirect bug on staging — Safari only, not Chrome."
```

The CLI does not support @-mention chip syntax. If the user wants to ping someone, they should comment from the web UI.

### `lumo project list` — list projects in the workspace

Prints `<slug>  <Display Name>` lines. The slug column matches the `--project <ref>` argument accepted by `task create`, so users (and you) can copy a slug straight from this output into a create command.

```bash
lumo project list
```

When to suggest: before `task create --project <ref>` when the workspace has more than one project and the user hasn't specified which one.

## Session Management

### `lumo session attach <identifier>` — bind the current session to a task

Use this whenever the user mentions a task ID. The command is the only way to bind a session to a task.

```bash
lumo session attach LUM-42
```

What it does:

- Reads `CLAUDE_CODE_SESSION_ID` from the environment (Claude Code sets this automatically). If it is not set, the command errors out — it must run from inside a Claude Code session.
- Calls `POST /api/sessions/<session_id>/bind-task` on the Lumo server, which sets the Session row's `taskId` and re-tags previously-untagged HookEvent rows in this session.
- The binding lives entirely on the server (`Session.taskId`); subsequent hooks read it back via the session row. The CLI keeps no local sentinel.

**After attaching, always run `lumo task context <identifier>` to load the task background.**

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

### When to suggest session binding

- If the user mentions a task ID (e.g., "let's work on LUM-42") and no session is currently bound, **suggest running `lumo session attach`**.
- If the user switches tasks mid-session, run `attach` with the new task ID — the server overwrites the existing binding atomically.

## Workflow Example

Typical flow when a user says "help me with LUM-42":

1. Run `lumo session attach LUM-42` to bind this session
2. Run `lumo task context LUM-42` to load background
3. Review unresolved items and task description
4. Begin working on the task
