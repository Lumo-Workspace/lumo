# Sprint Management

## Sprint Management

### `lumo sprint list [flags]` — list sprints in a team

Prints fixed-width rows: `<NUMBER>  <STATUS>  <start>  <end>  <name>`, sorted newest-first (server sort).

| Flag                   | Type    | Notes                                                 |
| ---------------------- | ------- | ----------------------------------------------------- |
| `--team <ref>`         | string  | Team name or slug. Required in multi-team workspaces. |
| `-s, --status <value>` | enum    | `draft \| active \| closed`.                          |
| `-n, --limit <count>`  | integer | Cap output to the first N rows.                       |

```bash
lumo sprint list
lumo sprint list --status active
lumo sprint list --team backend --limit 5
```

When to suggest: user asks "what sprints do we have", "which sprint is active", "list sprints", "show me the current sprint", "active sprints".

### `lumo sprint create [flags]` — create a sprint

| Flag             | Type   | Notes                                                 |
| ---------------- | ------ | ----------------------------------------------------- |
| `--team <ref>`   | string | Team name or slug. Required in multi-team workspaces. |
| `--start <date>` | string | **Required.** YYYY-MM-DD.                             |
| `--end <date>`   | string | **Required.** YYYY-MM-DD.                             |
| `-n, --name <>`  | string | Optional. Server fills a default name when omitted.   |

```bash
lumo sprint create --start 2026-06-01 --end 2026-06-14
lumo sprint create --name "Sprint 4" --start 2026-06-01 --end 2026-06-14 --team backend
```

On success: `Created sprint #<number> "<name>"  <id>`.

When to suggest: user says "create a sprint", "new sprint", "start a new iteration".

### `lumo sprint show <identifier> [--team <ref>]` — show sprint detail + task table

`<identifier>` accepts a sprint number (e.g. `3`) or a UUID. `--team` is required when using a number in a multi-team workspace.

Output: key:value header (number, name, status, dates, team), then a `Progress:` line, then a **`Health:` line** with the sprint's risk level (`HEALTHY` / `WATCH` / `AT-RISK`), then a task table listing every task in the sprint.

The risk level reuses the same engine as project/workspace stats, fed the sprint's task set (thresholds come from the workspace risk config — sprints have no per-sprint overrides). When the engine flags reasons they print as `- <detail>` lines under `Health:`, and a `Blockers:` section lists the top offenders per category (`Overdue` / `Stalled` / `Agent fail` / `Stale PRs`). A healthy sprint with no blockers shows just the `Health:` line.

```
Progress:  4 / 10
Health:    AT-RISK
  - 4/10 tasks overdue (40%)
  - 3 tasks with no progress in 7 days
Blockers:
  Overdue:   LUM-1 Fix login, LUM-8 Wire API
  Stalled:   LUM-5 Add tests
  Stale PRs: #12, #15
```

```bash
lumo sprint show 3
lumo sprint show 3 --team backend
lumo sprint show 11111111-2222-3333-4444-555555555555
```

When to suggest: user asks "what's in sprint 3", "show me the current sprint", "what tasks are in this sprint", "is this sprint at risk", "sprint health".

### `lumo sprint update <identifier> [flags]` — patch a sprint

Updates sprint metadata. At least one flag required. **No `--status` flag** — use `lumo sprint start` / `lumo sprint close` to transition status.

| Flag             | Type   | Notes                                                           |
| ---------------- | ------ | --------------------------------------------------------------- |
| `--team <ref>`   | string | Required when identifier is a number in a multi-team workspace. |
| `-n, --name <>`  | string | New name. Cannot be empty.                                      |
| `--start <date>` | string | YYYY-MM-DD. `--start ""` clears.                                |
| `--end <date>`   | string | YYYY-MM-DD. `--end ""` clears.                                  |

```bash
lumo sprint update 3 --name "Sprint 4 (extended)"
lumo sprint update 3 --end 2026-06-21
```

When to suggest: user wants to rename a sprint, extend dates, or fix sprint metadata.

### `lumo sprint delete <identifier> --yes` — delete a sprint (DRAFT only)

Requires `--yes`; no interactive prompt (agent-friendly). Server rejects with an error if the sprint is ACTIVE or CLOSED.

```bash
lumo sprint delete 3 --yes
```

When to suggest: user wants to remove a draft sprint that was created by mistake.

### `lumo sprint start <identifier>` — transition DRAFT → ACTIVE

No additional flags. Fails if the sprint is already ACTIVE or CLOSED.

```bash
lumo sprint start 3
```

When to suggest: user says "start the sprint", "kick off sprint 3", "activate sprint".

### `lumo sprint close <identifier> [flags]` — transition ACTIVE → CLOSED

Handles unfinished tasks based on flags. Without flags: closes only if all tasks are done; otherwise prints a list of unfinished tasks and refuses.

| Flag            | Type    | Notes                                                                            |
| --------------- | ------- | -------------------------------------------------------------------------------- |
| `--move-all`    | boolean | Move all unfinished tasks to the next sprint. Requires `--yes`.                  |
| `--backlog-all` | boolean | Remove all unfinished tasks from the sprint (send to backlog). Requires `--yes`. |
| `--yes`         | boolean | Required when `--move-all` or `--backlog-all` is given.                          |

```bash
lumo sprint close 3                          # fails if unfinished tasks exist
lumo sprint close 3 --move-all --yes         # move unfinished to next sprint
lumo sprint close 3 --backlog-all --yes      # send unfinished to backlog
```

When to suggest: user says "close the sprint", "end sprint 3", "wrap up the sprint". If they haven't decided what to do with unfinished tasks, ask before adding `--move-all` or `--backlog-all`.

### `lumo sprint summary <identifier> [--retry]` — fetch AI-generated sprint retro

Prints the AI-generated retrospective summary for the sprint. A 404 response means no summary has been generated yet ("no summary yet").

| Flag      | Type    | Notes                                             |
| --------- | ------- | ------------------------------------------------- |
| `--retry` | boolean | Queue a regeneration (async, server returns 202). |

```bash
lumo sprint summary 3
lumo sprint summary 3 --retry
```

When to suggest: user asks "summarize the sprint", "sprint retro", "give me a summary of sprint 3".

### `lumo sprint add <identifier> <task>` — bind a task to a sprint

Adds `<task>` (e.g. `LUM-48`) to the sprint. Same-team check applies — the task's team must match the sprint's team.

```bash
lumo sprint add 3 LUM-48
```

When to suggest: user says "add LUM-48 to sprint 3", "put this task in the sprint".

### `lumo sprint remove <identifier> <task>` — unbind a task from a sprint

Removes `<task>` from the sprint. Idempotent — if the task is not in the sprint, the server returns success.

```bash
lumo sprint remove 3 LUM-48
```

When to suggest: user says "remove LUM-48 from the sprint", "take this task out of sprint 3", "move task to backlog".
