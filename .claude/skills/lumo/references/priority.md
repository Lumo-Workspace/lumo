# Priority (team-level declaration)

The team **priority** is a short (1-3 sentence) plain-text statement of what the
team is currently focused on. It is **team-level** — scoped to the caller's
workspace default team, with no project or milestone binding.

Priority is **append-only by design**: every declaration inserts a new row.
A newer statement supersedes an older one by a later `effectiveFrom`; the
history is **never mutated or deleted**. There is deliberately no edit/remove
command — to change the priority, declare a new one.

## `lumo priority create <text>`

Declare the current team priority (LUM-1233 Q2; formerly `lumo priority [text]`):

```bash
lumo priority create "Ship the billing MVP; defer SSO to next quarter."
```

On success it prints `Recorded priority: <statement>`. There is no interactive prompt: an empty or blank `<text>` exits 2 and records nothing, and a missing one is a usage error. The old `lumo priority "<text>"` prints `was removed. Use: lumo priority create '<text>'` and exits 2; bare `lumo priority` prints the group's help.

## `lumo priority list`

`--json` prints `{ version, priorities, total, nextCursor, current }` (history newest-first).

Print the append history, newest-first. The current declaration (the row with
the latest `effectiveFrom`) is marked with a leading `*`:

```bash
lumo priority list
```

```
* 2026-02-01  Now focus on onboarding conversion
  2026-01-01  Ship the billing MVP
```

Prints `No priorities declared yet.` when the team has none.

## When to suggest

- The user wants to **set or change the team's focus/priority** in plain words → `lumo priority create "<text>"`
  ("我们现在的重点是…", "set our team priority to…", "记录一下当前优先级").
- The user asks **what the team is currently prioritizing** → `lumo priority list` (or the first line of `lumo status`).
- Do **not** confuse this with task priority (`lumo task update --priority
low|medium|high|urgent`), which is a per-task enum, not a team declaration.

## Under the hood

- `POST /api/priorities` `{ statement }` → 201 `{ priority }` (append).
- `GET /api/priorities` → `{ current, history }` (history newest-first).
- Dual-auth (bearer or Clerk); the team is resolved as the caller's workspace
  default team. Layers: `priority.repository` → `priority.service` → route → CLI.
