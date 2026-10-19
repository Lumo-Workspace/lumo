# Status, inbox, drafts and overviews (read-only)

What the web shows on the Inbox, the composer drafts and a project's page, from the terminal (LUM-1192). None of these commands writes: none marks a notification read, deletes a draft or generates a summary. Everything is scoped to the workspace your API key belongs to.

### `lumo status [--inbox [--all]] [--drafts] [--next [--claimable] [-n, --limit N]] [--json]` — me across the workspace

One call for "what is on my plate" (LUM-1233 Q1; it replaced `inbox list`, `draft list` and `next`, which now print `was removed. Use: lumo status --inbox|--drafts|--next …` and exit 2). Without a section flag it prints the team's current priority as one line (`Priority: <statement> (since <day>)`, or `Priority: none declared`), then the sections **Inbox**, **Drafts** and **Next**. `--inbox`, `--drafts` and `--next` print only those sections; one flag prints exactly that section's own output (no heading) and, with `--json`, its own envelope (below). It never takes a task ref — for one task use `lumo task status`; for this session's binding, `lumo session status`.

```bash
lumo status
lumo status --inbox
lumo status --inbox --all
lumo status --next --limit 5 --claimable
lumo status --json
```

- The Inbox shows **unread** notifications only (LUM-1233); `--all` brings back the read ones too. `--all` shapes only the Inbox: with section flags that leave Inbox out it exits 2.
- `--claimable` and `-n, --limit <N>` shape the Next section ([tasks.md](tasks.md#lumo-status---next---claimable--n---limit-n--recommend-the-next-task-to-work-on)); with section flags that leave Next out they exit 2. `--limit` must be a positive integer.
- `--json` with no section flag (or with two) prints `{ version, priority, inbox, drafts, next }` — `priority` only in the full view (the current declaration or `null`), and each section is the single-section envelope without its own `version`.
- A section whose request fails prints its error on stderr; the other sections still print (in `--json` the failed key is `null`) and the command exits 1.

### `lumo status --inbox [--all] [--json]` — your notifications

Same order and sections as the web inbox: **Needs your response** (an agent asked a question / needs approval and you have not answered) first, then **Other**; `•` marks unread. A `TASK_MENTIONED` row shows the comment preview under it.

By default only **unread** notifications are listed: the CLI asks `GET /api/notifications?unread=1`, which filters before the server's 50-row cap, so read ones never crowd unread ones out. The first line is `N unread notification(s)` (`50+ unread notifications (newest 50 shown)` at the cap); with nothing unread the whole output is one line, `No unread notifications.` A server that predates `unread=1` returns read rows too — the CLI drops them locally, no error. `--all` lists the newest 50 read or not, as below.

```bash
lumo status --inbox
lumo status --inbox --all
lumo status --inbox --json
```

```
$ lumo status --inbox --all
3 notifications, 1 unread

Needs your response
  2026-10-16T01:00:00Z  Claude Code has a question about LUM-7 Fix login

Other
• 2026-10-16T00:12:00Z  Alice Chen assigned you to LUM-9 Add OAuth
  2026-10-15T09:40:00Z  Bob mentioned you in LUM-7 Fix login
    "can you look at this?"
```

A notification about a task that has since been deleted reads `… a deleted task` (LUM-1232).

`--json` prints `{ version, notifications: [...], unreadCount, total, nextCursor, filter }` — `filter` is `"unread"` (default: `notifications` holds unread rows only) or `"all"` (`--all`). The server returns the newest 50, unpaged: `nextCursor` is always `null`, `total` is the row count, or `null` when 50 came back and older ones may exist; `unreadCount` counts the unread rows returned. Each notification has `id, type, read, requiresAction, actionTakenAt, createdAt, actor, task {teamIdentifier, number, title}, sprint, project, milestone, document, commentPreview`. Mark read / delete stays in the web inbox.

### `lumo status --drafts [--json]` — your drafts

Your own task / project drafts the web composer saved (never another member's), newest first: `TYPE  UPDATED  TITLE` (header on a TTY only; no command takes a draft id, so none is printed — `--json` keeps it).

```bash
lumo status --drafts
lumo status --drafts --json
```

A blank draft shows `(untitled)`. `--json` prints `{ version, drafts: [{ id, type, data, createdAt, updatedAt }], total, nextCursor }` — `data` is the form snapshot (`title`, `description`, `status`, `priority`, … for TASK; `name`, `description` for PROJECT). Finish or discard a draft in the web.

### `lumo project show [project] [--report] [--json]` — a project's health

```bash
lumo project show apollo
lumo project show "Apollo Moon" --report
lumo project show apollo --json
```

`<project>` is the name or slug (`lumo project list`); omit it when the workspace has one project. Prints total / completed / overdue tasks, average completion time (hours and minutes — `12h 21m`, `1301h 6m`, never days; `-` when nothing is done), the status distribution (BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE, then any other status), member workload and completions per day for the last 7 days that had any, plus the project page's health row — **Stalled · High stakes · Stale PRs · Overdue** counts, then the high-stakes and stalled tasks (`LUM-3  title  idle 10d`) and the stale PRs (`#42  opened <day>  <url>`) — and the latest stored project summary. A project in another workspace answers like a missing one.

`--json` prints `{ version, project: { id, name }, stats, summary }`.

### When to suggest

- "What's on my plate", "where was I", starting a day or a session with no task named → `lumo status`.
- "What's in my inbox", "did anyone mention me / assign me something" → `status --inbox` (unread); "show everything / including read" → `status --inbox --all`.
- "Did I leave a draft", "what was I writing" → `status --drafts`.
- "What should I work on next" → `status --next` (details in [tasks.md](tasks.md)).
- "Is project X healthy", "what's stalled in X", "any stale PRs" → `project show X`.
