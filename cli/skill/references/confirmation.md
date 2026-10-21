# Confirmation protocol (`--confirm`, exit code 4)

Some `lumo` commands change or destroy state that a human should sign off on first — deleting a task, sprint, milestone, document, memory, artifact or dependency edge; closing a sprint with unfinished tasks; removing or pruning worktrees, or running a repo's `verifyCommand`; re-deriving a doc's markdown source; changing a project's status; risky security-scan settings; uninstalling; moving a task to **DONE** (unless its one-step condition holds — a status-only update, every linked PR merged and nothing blocks; see [tasks.md](tasks.md)) or to **CANCELED** (always). They all speak one protocol:

1. You run the command **without `--confirm`**.
2. The CLI computes, from real server/local state, what it would do — and **does not do it**. It prints a **confirmation envelope on stdout** and exits **4**.
3. You show the envelope's `changes` to the user, verbatim.
4. The user approves or rejects.
5. Only on approval, you re-run the envelope's `confirmCommand` — the same invocation with `--confirm` appended.

There is no interactive yes/no prompt on a TTY either: a human and an agent walk the same steps. The one exception is `lumo init` outside a git repository (a folder install): it prints the files and warnings, then asks `Install Lumo here anyway? [y/N]` on stdin (only `y`/`yes` proceeds; EOF or no answer within 60 s writes nothing and exits 0). An agent must not answer it: show the user the warnings, and run `lumo init` again with the user's answer on stdin only after they say yes.

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

- `status` — always `confirmation_required`.
- `command` — the command path, e.g. `task update`, `worktree rm`.
- `changes` — human-readable lines describing exactly what would happen, computed from the current state (titles, counts, linked PRs, dirty files…). Never empty.
- `confirmCommand` — your original argv (flags and quoting preserved) plus `--confirm` — and, when a second gate applies, that gate's flag too (`--force --confirm`).
- `statusSummary` — optional (`task update --status done` only): the task's status digest, same read as `lumo task status`. Informational, not part of what the user approves; no follow-up `task status` needed.

On a TTY the same fields are rendered as text: a header line, one `-` bullet per change, then `Re-run with --confirm once the user has approved:` and the command on its own line. Nothing goes to stderr; the envelope is the command's result, not an error. **Exit 4 is the only signal you need** — do not grep the text.

## Rules for an agent

- **Exit 4 → stop and relay.** Print every line of `changes` to the user. Do not paraphrase away a `⚠` line.
- **Wait for an explicit approval.** A user who asked you to "delete the sprint" earlier has not yet seen what the envelope says will happen; the envelope is what they approve.
- **Run `confirmCommand` unchanged.** Do not rebuild the command by hand, do not drop flags the envelope carried (`--force`, `--team`, `--project`…).
- **Never add `--confirm` (or `--force`) on your own initiative.** `--confirm` means "the user has confirmed". Passing it without that approval is the one thing this protocol exists to prevent, and it is visible in the session trail.
- A rejected envelope is not an error to retry — report the user's decision and move on.

## Flags

- `--confirm` — the user approved. Present on every gated command. There is no `--yes` (it exits 2).
- `--force` — a **second gate**, separate from `--confirm`, that only ever means "discard local edits on this machine": `worktree rm` on a dirty tree (its envelope's `confirmCommand` then carries `--force --confirm`).
- `--confirm-read` + `--receipt <token>` — the **read-acknowledgement handshake** on `crossing disposition` and `task|milestone testcase disposition`, a three-step protocol the _server_ enforces:
  - **Step 1** (no step flag) reads the item and obtains a stage-1 receipt bound to it, the ruling, your session/member and its current state; the envelope's `confirmCommand` carries `--receipt <r1> --confirm-read`.
  - **Step 2** (`--confirm-read`, after the user says they have read it) returns the stage-2 receipt and a second envelope for the ruling whose `confirmCommand` carries `--receipt <r2> --confirm`.
  - **Step 3** (`--confirm`, after the user approves the ruling) writes.
  - Confirming with the stage-1 receipt, a missing/forged/expired (10-minute TTL) receipt, one for another reader/ruling, or one older than the item's latest change is refused and nothing is written — re-run without a step flag for a fresh envelope. Each envelope lists its receipt under `receipt: { token, expiresAt }`.
  - This makes the order un-skippable; it cannot prove the user personally ticked the box — you relay each step — so the ruling is recorded as a CLI-channel disposition. **Each step flag is the user's approval of that step: never supply one yourself.**
  - **Batch:** with several crossing ids the same three steps run once for the whole batch — one envelope per step listing every crossing, receipts carried as `--receipt <ref>=<token>,<ref>=<token>…`; dropping an id from the `confirmCommand` leaves that crossing OPEN. See [task-status.md](task-status.md).

## Commands that use the protocol — what `changes` says

- **`task create <title>`** (duplicate gate, LUM-1286) — `Not created yet: "title" looks like a duplicate …` · one line per candidate `LUM-N  STATUS  score%  "title"  url` · `Re-running with --confirm creates "title" anyway`. Nothing was written; `--confirm` skips the check. See [tasks.md](tasks.md).
- **`task update <id> --status done`** — `Will move LUM-N "title" to DONE` · `Status: <current> → DONE` · one line per linked PR (`#926  MERGED   title  url`) or `Pull requests: none linked` · `⚠ N linked pull request(s) not merged: …` when any PR is open/closed/draft · `Also updates: --title, … (one-step DONE covers a status-only change)` when other flags ride along · one line per local worktree: `Will remove worktree <path> (branch … kept)` or `Keeps worktree <path>: <reason>`. **No envelope** when `--status` is the only flag, ≥1 PR is linked, every one is merged and the status digest shows nothing blocking — the PATCH runs in one step and prints `One-step DONE …`. The server's DONE gates (open boundary crossing, blocking security finding, proven test-case defect → 409) still apply after `--confirm`. See [tasks.md](tasks.md).
- **`task update <id> --status canceled [--duplicate-of <id>]`** — `Will move LUM-N "title" to CANCELED` · `Status: <current> → CANCELED` · `Duplicate of: …` · `CANCELED leaves completion metrics and the next-task lists; only the user rules it — an agent may propose it, never approve it`. **Always** an envelope.
- **`crossing disposition <id...> --false-positive | --confirmed`** — envelope 1 (read): the crossing (`[SEVERITY] CATEGORY — detail`, `Seen ×N`, every agent explanation, the note) and `⚠ Approving clears this crossing's block on moving LUM-N to DONE` (or `Advisory crossing — it never blocked DONE…`), `Step 1 of 2 — read receipt issued …`; envelope 2 (ruling): `Read acknowledged …` · `Step 2 of 2 — record the ruling: OPEN → FALSE_POSITIVE on LUM-N`. Fails closed (exit 1, no write) when a read or receipt request errors; an already-matching ruling is a no-op. Reverting to OPEN, repository suppression and steward (milestone) crossings stay web-only.
- **`finding disposition <id...> --false-positive | --accepted-risk`** — one line per finding (`<ref> [SEVERITY] <title> — <rule> at <file:line> (PR #n, blocks DONE | advisory): OPEN → <ruling>`) · the ⚠ DONE consequence. Plain `--confirm`, no read receipt. [pr-scan.md](pr-scan.md#finding-disposition)
- **`task testcase disposition`** — the three-step handshake above. [test-case-runs.md](test-case-runs.md)
- **`task delete <id>`** — `Will move LUM-N "title" (STATUS) to the trash — …` (restorable 30 days from Settings → Trash). [tasks.md](tasks.md)
- **`task dep remove <id> <edge>`** — the resolved edge. [task-deps.md](task-deps.md)
- **`task artifact delete`** — artifact ref, title, kind; "irreversible". [artifacts-figma.md](artifacts-figma.md)
- **`task comment delete`**, **`task template delete`** — the comment / template. [tasks.md](tasks.md)
- **`memory delete <memory>`** — ref, `[CATEGORY]`, a one-line summary. [memory.md](memory.md)
- **`doc delete <doc>`** — it and every nested document move to the trash. [docs.md](docs.md)
- **`doc rebuild-source <doc>`** (source exists) — the server's 409 reason; what `--confirm` would replace. [doc-editing.md](doc-editing.md)
- **`sprint delete`**, **`milestone delete`** — name; task count (tasks keep their data). [sprints.md](sprints.md), [milestones.md](milestones.md)
- **`sprint close <ref> --move-all | --backlog-all`** — every unfinished task and where it goes. Without a mode flag and with unfinished tasks it is a plain exit-1 refusal.
- **`project update <ref> --status <s>`** — old → new status and what it does to agents. [milestones.md](milestones.md)
- **`worktree add <LUM-N> --verify`** — the path, branch and the exact `verifyCommand` it would run. **`worktree rm`** — path + branch, `⚠ … uncommitted changes … discarded` when dirty (then `--force --confirm`). **`worktree prune`** — per worktree of a DONE task, removed or kept with the reason; no envelope when nothing is removable. [worktree.md](worktree.md)
- **`workspace security-scan update`** — turning a switch off and the other risky changes listed in [workspace-settings.md](workspace-settings.md).
- **`uninstall`** — every path with its action; `⚠ committed — …` for git-tracked paths. Never commits. [onboarding.md](onboarding.md)

## When the gate is human-only: `DONE_BLOCKED`, exit code 5

Not every refusal is something the user can approve on the spot. The server's DONE gates — an **undispositioned boundary crossing**, a **blocking security finding**, a **proven test-case defect** — are verdicts on the agent's own work, and the interested party may not adjudicate itself: nothing on `task update` clears them — no `--confirm`, no `--force`, nothing you can pass. Each has a terminal path, but it is a separate command and it is the user's: a **boundary crossing** through `lumo crossing disposition <id> --false-positive | --confirmed`, a **security finding** through `lumo finding disposition <findingId> --false-positive | --accepted-risk`, a **proven test-case defect** through `lumo task testcase disposition <task>/TC<n> --known-defect | --not-a-defect`. Each walks the exit-4 protocol above (you relay the blocker, the user rules, you re-run the `confirmCommand`).

When `task update <id> --status done --confirm` is refused by one of these gates, the CLI re-reads the task's status and open crossings, prints a structured error on **stdout** and exits **5** (with the `statusSummary` digest, so no follow-up `task status` is needed):

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
      "ref": "LUM-X12",
      "severity": "MEDIUM",
      "category": "TEST_FILE_DELETED",
      "detail": "deleted __tests__/cli/old.test.ts"
    }
  ],
  "unconfirmed": [],
  "remediation": [
    "BOUNDARY_CROSSING: leave a rationale with `lumo crossing explain LUM-X12 --task LUM-48 --note \"…\"` (append-only; it does not clear anything), then relay each crossing to the user. Once they rule, record it with `lumo crossing disposition LUM-X12 --false-positive` or `--confirmed` — it prints an exit-4 envelope for the user to approve; never self-approve. The web panel also works: https://…/my-tasks/LUM-48#boundary-crossings"
  ],
  "dispositionUrl": "https://…/my-tasks/LUM-48#boundary-crossings"
}
```

- `message` — the server's 409 text, verbatim.
- `blockers` — one entry per item holding the gate: `BOUNDARY_CROSSING` (id, ref, severity, category, detail), `SECURITY_FINDING` (findingId, severity, ruleId, filePath, line, prNumber, statement), `TEST_CASE_DEFECT` (ref `<task>/TC<n>`, number, title, url). Only crossings the server gate counts appear (advisory ones never; with the workspace gate off only HIGH ones).
- `nonBlocking` — open crossings the gate does NOT count — awareness only; do not ask the user to disposition them to get past DONE_BLOCKED.
- `unconfirmed` — enrichment reads that failed. Non-empty means the blocker list may be incomplete — it never silently shrinks.
- `remediation` — one line per blocker kind, naming only human-side, append-only or user-approved paths. Never a ready-to-run approval flag.
- `dispositionUrl` — where a human rules on the web (`…#dossier-tests` when every blocker is a test-case defect, else `…#boundary-crossings`).

**Exit 4 vs exit 5:** 4 means "the user must approve, then you can proceed"; 5 means "a human must adjudicate — nothing on this command moves it". On exit 5, relay `blockers` and `remediation` to the user. Do not retry `task update`, and do not look for a flag on it. The disposition commands are themselves exit-4 commands, so the user's ruling still comes through the protocol, never from you. Once every blocker is cleared, re-run the original `task update … --confirm` (its envelope was already approved). A 409 that is not a DONE gate (e.g. a permission refusal) keeps the plain exit-1 text on stderr.

## Exit codes

- **0** — success (an empty result too); stdout.
- **1** — the command failed: not found, auth, permission, server, network; stderr `Error: …` + `Hint: …`.
- **2** — usage error: unknown flag, missing / extra argument, invalid flag value; caught before any request; stderr `Error: …` + `Usage: lumo …` + `Hint: see … --help`. Fix the command — never retry it unchanged.
- **4** — confirmation required (this protocol); stdout: the envelope.
- **5** — blocked by a human-only gate (`DONE_BLOCKED`); stdout: the structured error.

With `--json`, a 1 or 2 prints nothing on stdout and exactly one JSON object on stderr: `{"error":{"code":"NOT_FOUND","message":"…","hint":"…","exitCode":1}}` (`code` is `USAGE`, `NOT_FOUND`, `AUTH`, `FORBIDDEN`, `CONFLICT`, `SERVER`, `NETWORK` or `UNKNOWN`). Exit 4 and 5 keep their stdout envelopes in every mode. Lumo's 4 is **not** gh's 4 (gh uses 4 for "authentication required"); never treat a Lumo 4 as an auth problem.

## Example exchange

(With every linked PR merged and nothing blocking, the same command would run in one step instead. Here #930 is open, so it stops.)

```bash
lumo task update LUM-48 --status done
# exit 4, stdout:
# {
#   "status": "confirmation_required",
#   "command": "task update",
#   "changes": [
#     "Will move LUM-48 \"Panel refactor\" to DONE",
#     "Status: IN_REVIEW → DONE",
#     "#926  MERGED   refactor: panel  https://github.com/o/r/pull/926",
#     "#930  open     feat: wip        https://github.com/o/r/pull/930",
#     "⚠ 1 linked pull request not merged: #930 OPEN"
#   ],
#   "confirmCommand": "lumo task update LUM-48 --status done --confirm"
# }
```

Agent → user: "Moving LUM-48 to DONE would change IN_REVIEW → DONE. PR #926 is merged, but **#930 is still open**. Confirm?" — and only after a yes:

```bash
lumo task update LUM-48 --status done --confirm
```
