# Status, inbox, drafts and overviews (read-only)

What the web shows on the Inbox, the composer drafts and a project's page, from the terminal (LUM-1192). None of these commands writes: none marks a notification read, deletes a draft or generates a summary. Everything is scoped to the workspace your API key belongs to.

### `lumo status [--inbox] [--drafts] [--next [--claimable] [-n, --limit N]] [--json]` — me across the workspace

One call for "what is on my plate" (LUM-1233 Q1; it replaced `inbox list`, `draft list` and `next`, which now print `was removed. Use: lumo status --inbox|--drafts|--next …` and exit 2). Without a section flag it prints the team's current priority as one line (`Priority: <statement> (since <day>)`, or `Priority: none declared`), then the sections **Inbox**, **Drafts** and **Next**. `--inbox`, `--drafts` and `--next` print only those sections; one flag prints exactly that section's own output (no heading) and, with `--json`, its own envelope (below). It never takes a task ref — for one task use `lumo task status`; for this session's binding, `lumo session status`.

```bash
lumo status
lumo status --inbox
lumo status --next --limit 5 --claimable
lumo status --json
```

- `--claimable` and `-n, --limit <N>` shape the Next section ([tasks.md](tasks.md#lumo-status---next---claimable--n---limit-n--recommend-the-next-task-to-work-on)); with section flags that leave Next out they exit 2. `--limit` must be a positive integer.
- `--json` with no section flag (or with two) prints `{ version, priority, inbox, drafts, next }` — `priority` only in the full view (the current declaration or `null`), and each section is the single-section envelope without its own `version`.
- A section whose request fails prints its error on stderr; the other sections still print (in `--json` the failed key is `null`) and the command exits 1.

### `lumo status --inbox [--json]` — your notifications

Same order and sections as the web inbox: **Needs your response** (an agent asked a question / needs approval and you have not answered) first, then **Other**; the server returns at most the 50 newest. `•` marks unread. A `TASK_MENTIONED` row shows the comment preview under it.

```bash
lumo status --inbox
lumo status --inbox --json
```

```
3 notifications, 1 unread

Needs your response
  2026-10-16T01:00:00Z  Claude Code has a question about LUM-7 Fix login

Other
• 2026-10-16T00:12:00Z  Alice Chen assigned you to LUM-9 Add OAuth
  2026-10-15T09:40:00Z  Bob mentioned you in LUM-7 Fix login
    "can you look at this?"
```

A notification about a task that has since been deleted reads `… a deleted task` (LUM-1232).

`--json` prints `{ version, notifications: [...], unreadCount, total, nextCursor }` (the server returns the newest 50, unpaged: `nextCursor` is always `null`, `total` is the row count, or `null` when 50 came back and older ones may exist) — each notification has `id, type, read, requiresAction, actionTakenAt, createdAt, actor, task {teamIdentifier, number, title}, sprint, project, milestone, document, commentPreview`. Mark read / delete stays in the web inbox.

### `lumo status --drafts [--json]` — your drafts

Your own task / project drafts the web composer saved (never another member's), newest first: `TYPE  UPDATED  TITLE` (header on a TTY only; no command takes a draft id, so none is printed — `--json` keeps it).

```bash
lumo status --drafts
lumo status --drafts --json
```

A blank draft shows `(untitled)`. `--json` prints `{ version, drafts: [{ id, type, data, createdAt, updatedAt }], total, nextCursor }` — `data` is the form snapshot (`title`, `description`, `status`, `priority`, … for TASK; `name`, `description` for PROJECT). Finish or discard a draft in the web.

### `lumo project overview [project] [--report] [--json]` — a project's health

```bash
lumo project overview apollo
lumo project overview "Apollo Moon" --report
lumo project overview apollo --json
```

`<project>` is the name or slug (`lumo project list`); omit it when the workspace has one project. Prints total / completed / overdue tasks, average completion time (hours and minutes — `12h 21m`, `1301h 6m`, never days; `-` when nothing is done), the status distribution (BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE, then any other status), member workload and completions per day for the last 7 days that had any, plus the project page's health row — **Stalled · High stakes · Stale PRs · Overdue** counts, then the high-stakes and stalled tasks (`LUM-3  title  idle 10d`) and the stale PRs (`#42  opened <day>  <url>`) — and the latest stored project summary. A project in another workspace answers like a missing one.

`--json` prints `{ version, project: { id, name }, stats, summary }`.

### When to suggest

- "What's on my plate", "where was I", starting a day or a session with no task named → `lumo status`.
- "What's in my inbox", "did anyone mention me / assign me something" → `status --inbox`.
- "Did I leave a draft", "what was I writing" → `status --drafts`.
- "What should I work on next" → `status --next` (details in [tasks.md](tasks.md)).
- "Is project X healthy", "what's stalled in X", "any stale PRs" → `project overview X`.
