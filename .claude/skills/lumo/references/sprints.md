# Sprint Management

## Sprint Management

### `lumo sprint list [flags]` — list sprints in a team

Prints table rows: `<STATUS>  #<number>  <start>..<end>  <name>`, sorted newest-first (server sort). On a terminal (stdout is a TTY) a header row is printed first and the name is cut with `…` to fit the terminal width; piped / agent output (non-TTY) has no header, is never truncated and keeps this column order.

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

Output: key:value header (number, name, status, dates, team), then a `Progress:` line, then a `Blockers:` section, then a task table listing every task in the sprint.

`Blockers:` lists the top offenders per category (`Overdue` / `Stalled` / `Agent fail` / `Stale PRs`) — a task counts as stalled after 7 days untouched, a PR as stale after 3 days awaiting review. A sprint with nothing in any category prints no `Blockers:` section at all. (There is no risk score or `Health:` line — LUM-709 removed the risk-assessment layer.)

```
Progress:  4 / 10
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

When to suggest: user asks "what's in sprint 3", "show me the current sprint", "what tasks are in this sprint", "what's blocking this sprint".

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

### `lumo sprint delete <identifier> --confirm` — delete a sprint (DRAFT only)

Without `--confirm` the CLI exits **4** with a confirmation envelope (`Will delete sprint #3 "Sprint 3"` · `N tasks under it keep their data; only sprintId is cleared`) and deletes nothing — relay it to the user, re-run `confirmCommand` on approval ([confirmation.md](confirmation.md)). `--yes` is a legacy alias. Server rejects with an error if the sprint is ACTIVE or CLOSED.

```bash
lumo sprint delete 3            # exit 4 + envelope
lumo sprint delete 3 --confirm  # after the user approved
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

| Flag            | Type    | Notes                                                                                                                                                       |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--move-all`    | boolean | Move all unfinished tasks to the next sprint. Gated by `--confirm`.                                                                                         |
| `--backlog-all` | boolean | Remove all unfinished tasks from the sprint (send to backlog). Gated by `--confirm`.                                                                        |
| `--confirm`     | boolean | The user approved the envelope. Without it a mode flag exits 4 with a confirmation envelope listing every task that would move (`--yes` is a legacy alias). |

```bash
lumo sprint close 3                               # fails (exit 1) if unfinished tasks exist — pick a mode
lumo sprint close 3 --move-all                    # exit 4 + envelope: "2 unfinished tasks move to the next sprint: LUM-3, LUM-4"
lumo sprint close 3 --move-all --confirm          # move unfinished to next sprint (after the user approved)
lumo sprint close 3 --backlog-all --confirm       # send unfinished to backlog
```

See [confirmation.md](confirmation.md) for the envelope shape and the relay rules.

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
