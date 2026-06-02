# Design: `lumo next` — recommend the next task

- **Task**: LUM-154 — `lumo next`:推荐下一个任务 + attach + 载入 context
- **Date**: 2026-06-02
- **Status**: Approved (brainstorming)

## Problem

A developer starting a Claude Code session wants the CLI to tell them which task
to work on next, rather than eyeballing `lumo task list`. LUM-154 asks for a
`lumo next` command that ranks the caller's open tasks and surfaces the top few,
then lets the agent bind + load context for the chosen one.

The original task floated a "one-click open worktree" flow. That is **cut**: the
CLI never shells out to git, and `session attach` requires
`CLAUDE_CODE_SESSION_ID` (only set inside a Claude Code process). So the scope is
a pure **recommend** command; binding + context loading stay as the existing
two-step (`session attach` + `task context`) driven by the agent.

## Scope

In scope:

- A new top-level `lumo next [-n, --count <N>]` command (default N=3) that prints
  a ranked recommendation list with a per-row reason.

Out of scope (explicitly):

- Opening a git worktree (CLI never calls git).
- Auto-attaching / interactive selection. `next` only **prints**; the agent
  reads the output and runs `session attach <LUM-N>` + `task context <LUM-N>`
  itself. (Decided during brainstorming: pure recommendation, two-step.)
- carry-over weighting (would need per-task session/unresolved data — deferred).
- Any server-side endpoint or schema change.

## Interaction model

Pure recommendation, two steps:

1. `lumo next` prints the top N tasks with reasons.
2. The agent (or user) picks one and runs the existing
   `lumo session attach <LUM-N>` then `lumo task context <LUM-N>`.

No interactive prompt (the CLI is agent-driven and frequently non-TTY).

## Architecture — pure CLI orchestration

No server changes. The CLI chains two existing endpoints and does the
filter/rank/format client-side, matching the "纯编排" framing of the task.

```
read creds → GET /api/me/active-sprints      → Set<activeSprintId>
           → GET /api/tasks/me  (no sprintIds; we want ALL my tasks; sprint is
                                  only a ranking boost)
           → filter out status === 'DONE'
           → rankTasks(tasks, activeSprintIds, now) → take top N
           → formatNextOutput(ranked, totalOpen) → stdout
```

Both endpoints already exist and accept bearer tokens:

- `GET /api/me/active-sprints` → `{ sprintIds: string[] }`
- `GET /api/tasks/me` → `{ tasks: [...] }`, each task carrying at least
  `id, number, title, status, priority, teamIdentifier, project{name}, sprintId,
dueDate, updatedAt`.

The priority-sort util `app/workspace/[workspaceUrl]/utils/sortTasks.ts` lives in
the Next.js app and **cannot be imported** by the CLI (separate package). The
priority weight map (URGENT=0 … LOW=3) and the updatedAt tiebreak are small and
are reimplemented in `rank-tasks.ts`. The dueDate/sprint/status scoring is new
logic that does not exist in `sortTasks.ts`.

## Ranking — lexicographic key (explainable > magic score)

Tasks compare level by level; this honors "优先级为主":

1. **Priority** (primary): URGENT → HIGH → MEDIUM → LOW (unknown priority last).
2. **Active-sprint membership**: a task whose `sprintId` is in the active set
   ranks ahead of one that is not.
3. **dueDate**: earlier due first; tasks with no dueDate sort after tasks with
   one.
4. **Status nudge**: IN_PROGRESS / IN_REVIEW ahead of TODO (push in-flight work).
5. **Tiebreak**: `updatedAt` descending (most recently touched first), same as
   `sortTasks.ts`.

Consequence (accepted): dueDate never overrides priority — an overdue LOW task
does not outrank an URGENT task. This is intentional ("优先级为主"). If overdue
should jump the queue later, switch to a composite score; not now.

### Reason factors (per row)

The reason line shows only the factors that are "present":

- Priority — always shown (URGENT / HIGH / MEDIUM / LOW).
- `active sprint` — shown when the task's `sprintId` is in the active set.
- `due <YYYY-MM-DD>` — shown when `dueDate` is set; append `(overdue)` when the
  due date is before `now`.
- in-flight status (`in progress` / `in review`) — shown when status is
  IN_PROGRESS / IN_REVIEW.

## Output format

```
Top 3 recommended tasks (of 12 open):

1. LUM-42  IN_PROGRESS  URGENT  Fix Slack OAuth redirect
     ↳ URGENT · active sprint · due 2026-06-03 (overdue) · in progress
2. LUM-48  TODO         HIGH    Investigate slow query
     ↳ HIGH · active sprint
3. LUM-12  TODO         MEDIUM  Add rate limiting
     ↳ MEDIUM · due 2026-06-10

Next: lumo session attach LUM-42 && lumo task context LUM-42
（也可换成列表里任意一个 LUM-N）
```

- The header row reuses the same column shape as `formatTaskListTable`
  (identifier / status / priority / title) for visual consistency.
- The footer suggests the top pick's next commands and notes any listed task can
  be chosen.
- All server-derived free text (title) is passed through `sanitizeField()` before
  stdout, per the CLI's untrusted-output rule.

## Edge cases

- Not logged in / 401 / unreachable → existing standard error messages and exit
  code 1.
- **`/api/me/active-sprints` failure is non-fatal**: warn to stderr and continue
  with an empty active-sprint set (the sprint boost is simply off). The command
  must not die because the sprint lookup failed.
- No tasks assigned, or every task is DONE → print
  `No open tasks assigned to you. 🎉` and exit 0.
- `--count` not a positive integer → error (mirrors `task-list`'s `--limit`
  validation) and exit 1.
- N larger than the number of open tasks → print whatever is available.

## Files

| File                              | Change                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/src/lib/rank-tasks.ts` (new) | Pure `rankTasks(tasks, activeSprintIds, now)`, the `RankedTask`/`NextTask` types, the priority weight map, and reason-factor derivation. No I/O.    |
| `cli/src/commands/next.ts` (new)  | Command orchestration (the two fetches + wiring) and the pure `formatNextOutput(ranked, totalOpen)` formatter.                                      |
| `cli/src/index.ts`                | Register `program.command('next')` with `-n, --count <N>`.                                                                                          |
| `.claude/skills/lumo/SKILL.md`    | New `lumo next` section (CLAUDE.md hard rule: touching `cli/src/commands/` requires a SKILL.md sync — description triggers + behavior).             |
| tests                             | Unit tests for `rankTasks` (ordering, reason factors, empty/active-sprint cases) and `formatNextOutput` (header, reason rows, footer, empty state). |

## Testing

`rankTasks` and `formatNextOutput` are pure functions (a `now: Date` parameter
keeps "overdue" deterministic), so they unit-test without network or git.

Open item for the planning phase: the CLI package currently has **no test
setup**. Verify whether the root `jest.config.js` picks up `cli/**/*.test.ts`; if
not, add a minimal ts-jest config scoped to the CLI package. Either way the tests
themselves stay pure-function unit tests.

## Risks / non-goals

- Ranking is opinionated; if it feels wrong in practice it is one pure function to
  tune. Lexicographic ordering was chosen for explainability over a tunable
  weighted score.
- No caching/pagination: `task list` already fetches the full "my tasks" set
  client-side; `next` does the same. Fine for dozens of tasks; revisit only if a
  workspace has hundreds.
