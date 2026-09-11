# Confirmation protocol (`--confirm`, exit code 4)

Some `lumo` commands change or destroy state that a human should sign off on first — deleting a sprint, milestone, document, memory, artifact or dependency edge; closing a sprint with unfinished tasks; removing a worktree; re-deriving a doc's markdown source; and moving a task to **DONE**. Since LUM-755 they all speak one protocol instead of prompting or hard-refusing:

1. You run the command **without `--confirm`**.
2. The CLI computes, from real server/local state, what it would do — and **does not do it**. It prints a **confirmation envelope on stdout** and exits **4**.
3. You show the envelope's `changes` to the user, verbatim.
4. The user approves or rejects.
5. Only on approval, you re-run the envelope's `confirmCommand` — the same invocation with `--confirm` appended.

There is no interactive yes/no prompt on a TTY either: a human and an agent walk the same steps.

## The envelope

When stdout is not a TTY (the agent path) the envelope is JSON:

```json
{
  "status": "confirmation_required",
  "command": "sprint delete",
  "changes": [
    "Will delete sprint #3 \"Sprint 3\"",
    "12 tasks under it keep their data; only sprintId is cleared"
  ],
  "confirmCommand": "lumo sprint delete 3 --confirm"
}
```

| Field            | Meaning                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`         | Always `confirmation_required`.                                                                                                                     |
| `command`        | The command path, e.g. `task update`, `worktree rm`.                                                                                                |
| `changes`        | Human-readable lines describing exactly what would happen, computed from the current state (titles, counts, linked PRs, dirty files…). Never empty. |
| `confirmCommand` | Your original argv (flags and quoting preserved) plus `--confirm` — and, when a second gate applies, that gate's flag too (`--force --confirm`).    |

On a TTY the same fields are rendered as text: a header line, one `-` bullet per change, then `Re-run with --confirm once the user has approved:` and the command on its own line.

Nothing goes to stderr; the envelope is the command's result, not an error. **Exit 4 is the only signal you need** — do not grep the text to decide whether a command "wants confirmation".

## Rules for an agent

- **Exit 4 → stop and relay.** Print every line of `changes` to the user. Do not paraphrase away a `⚠` line.
- **Wait for an explicit approval.** A user who asked you to "delete the sprint" earlier has not yet seen what the envelope says will happen; the envelope is what they approve.
- **Run `confirmCommand` unchanged.** Do not rebuild the command by hand, do not drop flags the envelope carried (`--force`, `--team`, `--project`…).
- **Never add `--confirm` (or `--yes`, or `--force`) on your own initiative.** `--confirm` means "the user has confirmed". Passing it without that approval is the one thing this protocol exists to prevent, and it is visible in the session trail.
- A rejected envelope is not an error to retry — report the user's decision and move on.

## Flags

- `--confirm` — the user approved. Present on every command in the table below.
- `--yes` — legacy alias of `--confirm` on the commands that took it before LUM-755. Prefer `--confirm` in new invocations. `task update` never had `--yes` and does not gain it.
- `--force` — a **second gate** that stays separate from `--confirm`: `worktree rm` uses it to acknowledge discarding uncommitted changes; `doc rebuild-source` uses it to acknowledge replacing an existing source. Missing `--force` also yields an envelope (exit 4) whose `confirmCommand` carries `--force --confirm`.

## Commands that use the protocol

| Command                                                   | `changes` describes                                                                                                                                                                                                                            | Notes                                                                                                                                                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task update <id> --status done`                          | `Will move LUM-N "title" to DONE` · `Status: <current> → DONE` · one line per linked PR (`#926  merged   title  url`) or `Pull requests: none linked` · a trailing `⚠ N linked pull request(s) not merged: …` when any PR is open/closed/draft | Only `--status done` is gated; other statuses PATCH directly. The server's own DONE gates (unresolved send-back, open boundary crossing → 409) still apply after `--confirm`. See [tasks.md](tasks.md). |
| `task deps rm <id> <edge>`                                | the resolved edge (short id, direction, other task, status, source)                                                                                                                                                                            | [task-deps.md](task-deps.md)                                                                                                                                                                            |
| `task artifact rm <task> <artifact-id>`                   | artifact id, title, kind; "irreversible"                                                                                                                                                                                                       | [artifacts-figma.md](artifacts-figma.md)                                                                                                                                                                |
| `memory rm <memoryId>`                                    | memory id, `[CATEGORY]`, a one-line content summary                                                                                                                                                                                            | [memory.md](memory.md)                                                                                                                                                                                  |
| `doc delete <doc>`                                        | doc id + title; nested documents are deleted with it                                                                                                                                                                                           | [docs.md](docs.md)                                                                                                                                                                                      |
| `sprint delete <ref>`                                     | sprint number + name; task count (tasks keep their data)                                                                                                                                                                                       | [sprints.md](sprints.md)                                                                                                                                                                                |
| `sprint close <ref> --move-all` / `--backlog-all`         | sprint; every unfinished task and where it goes                                                                                                                                                                                                | Without a mode flag and with unfinished tasks the command is a plain exit-1 refusal (pick a mode). [sprints.md](sprints.md)                                                                             |
| `milestone delete <ref>`                                  | milestone name; task count (tasks keep their data)                                                                                                                                                                                             | [milestones.md](milestones.md)                                                                                                                                                                          |
| `worktree rm <LUM-N>`                                     | path + branch; `⚠ … uncommitted changes … discarded` when dirty; whether the branch is kept or deleted                                                                                                                                         | Dirty tree → `confirmCommand` carries `--force --confirm`. [worktree.md](worktree.md)                                                                                                                   |
| `doc rebuild-source <doc>` (when a source already exists) | the server's 409 reason; what `--force` would replace                                                                                                                                                                                          | `confirmCommand` carries `--force --confirm`. [doc-editing.md](doc-editing.md)                                                                                                                          |

## When the gate is human-only: `DONE_BLOCKED`, exit code 5

Not every refusal is something the user can approve. The server's DONE gates — an **unresolved send-back**, an **undispositioned boundary crossing**, a **blocking security finding** — are verdicts on the agent's own work, and by design there is no CLI path to clear them (the interested party may not adjudicate itself). They are therefore **not** part of the confirmation protocol: no `--confirm`, no `--force`, nothing you can pass.

What the CLI does instead: when `task update <id> --status done --confirm` is refused by one of these gates, it re-reads the task's acceptance status and open crossings, prints a structured error on **stdout** and exits **5**:

```json
{
  "status": "blocked",
  "code": "DONE_BLOCKED",
  "command": "task update",
  "task": "LUM-48",
  "message": "Cannot move this task to DONE — 1 undispositioned boundary-crossing (forbidden action taken during this task): 1 TEST_FILE_DELETED. …",
  "blockers": [
    {
      "kind": "BOUNDARY_CROSSING",
      "id": "cmtw…",
      "severity": "MEDIUM",
      "category": "TEST_FILE_DELETED",
      "detail": "deleted __tests__/cli/old.test.ts"
    }
  ],
  "unconfirmed": [],
  "remediation": [
    "BOUNDARY_CROSSING: leave a rationale with `lumo crossing explain cmtw… --note \"…\"` (append-only; it does not clear anything). A human dispositions each crossing (false positive / confirmed) at https://…/my-tasks/LUM-48#boundary-crossings"
  ],
  "dispositionUrl": "https://…/my-tasks/LUM-48#boundary-crossings"
}
```

| Field         | Meaning                                                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`     | The server's 409 text, verbatim.                                                                                                                                                                                                                                                                               |
| `blockers`    | One entry per item holding the gate: `SEND_BACK` (criterionId, statement, failedAtRound, rejectionReason), `BOUNDARY_CROSSING` (id, severity, category, detail), `SECURITY_FINDING` (findingId, severity, ruleId, filePath, line, prNumber, statement). Built from the same read models as `lumo task status`. |
| `unconfirmed` | Enrichment reads that failed (`boundary-crossings read failed: HTTP 500`). Non-empty means the blocker list may be incomplete — it never silently shrinks.                                                                                                                                                     |
| `remediation` | One line per blocker kind present, naming only human-side or append-only paths: re-run `lumo verify`, `lumo crossing explain`, fix-and-push, the web disposition panel.                                                                                                                                        |

**Exit 4 vs exit 5:** 4 means "the user must approve, then you can proceed"; 5 means "a human must adjudicate elsewhere — nothing on the CLI moves this". On exit 5, relay `blockers` and `remediation` to the user. Do not retry, do not look for a flag, and do not reword or delete a failed criterion to get past a send-back (that is tampering and is audited). A 409 that is not a DONE gate (e.g. a permission refusal) keeps the plain exit-1 text on stderr.

## Example exchange

```bash
lumo task update LUM-48 --status done
# exit 4, stdout:
# {
#   "status": "confirmation_required",
#   "command": "task update",
#   "changes": [
#     "Will move LUM-48 \"Panel refactor\" to DONE",
#     "Status: IN_REVIEW → DONE",
#     "#926  merged   refactor: panel  https://github.com/o/r/pull/926",
#     "#930  open     feat: wip        https://github.com/o/r/pull/930",
#     "⚠ 1 linked pull request not merged: #930 open"
#   ],
#   "confirmCommand": "lumo task update LUM-48 --status done --confirm"
# }
```

Agent → user: "Moving LUM-48 to DONE would change IN_REVIEW → DONE. PR #926 is merged, but **#930 is still open**. Confirm?" — and only after a yes:

```bash
lumo task update LUM-48 --status done --confirm
```
