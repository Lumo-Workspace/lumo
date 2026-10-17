# Inbox, drafts and overviews (read-only)

What the web shows on the Inbox, the composer drafts and a project's page, from the terminal (LUM-1192). All three commands only read: none marks a notification read, deletes a draft or generates a summary. Everything is scoped to the workspace your API key belongs to.

### `lumo inbox list [--json]` — your notifications

Same order and sections as the web inbox: **Needs your response** (an agent asked a question / needs approval and you have not answered) first, then **Other**; the server returns at most the 50 newest. `•` marks unread. A `TASK_MENTIONED` row shows the comment preview under it.

```bash
lumo inbox list
lumo inbox list --json
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

`--json` prints `{ notifications: [...], unreadCount }` — each notification has `id, type, read, requiresAction, actionTakenAt, createdAt, actor, task {teamIdentifier, number, title}, sprint, project, milestone, document, commentPreview`. Mark read / delete stays in the web inbox.

### `lumo draft list [--json]` — your drafts

Your own task / project drafts the web composer saved (never another member's), newest first: `TYPE  UPDATED  TITLE` (header on a TTY only; no command takes a draft id, so none is printed — `--json` keeps it).

```bash
lumo draft list
lumo draft list --json
```

A blank draft shows `(untitled)`. `--json` prints `{ drafts: [{ id, type, data, createdAt, updatedAt }] }` — `data` is the form snapshot (`title`, `description`, `status`, `priority`, … for TASK; `name`, `description` for PROJECT). Finish or discard a draft in the web.

### `lumo project overview [project] [--report] [--json]` — a project's health

```bash
lumo project overview apollo
lumo project overview "Apollo Moon" --report
lumo project overview apollo --json
```

`<project>` is the name or slug (`lumo project list`); omit it when the workspace has one project. Prints total / completed / overdue tasks, average completion time (a duration — `12h 21m`, or days and hours from 48 hours on such as `54d 5h`; `-` when nothing is done), the status distribution (BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE, then any other status), member workload and completions per day for the last 7 days that had any, plus the project page's health row — **Stalled · High stakes · Stale PRs · Overdue** counts, then the high-stakes and stalled tasks (`LUM-3  title  idle 10d`) and the stale PRs (`#42  opened <day>  <url>`) — and the latest stored project summary. A project in another workspace answers like a missing one.

`--json` prints `{ project: { id, name }, stats, summary }`.

### When to suggest

- "What's in my inbox", "did anyone mention me / assign me something" → `inbox list`.
- "Did I leave a draft", "what was I writing" → `draft list`.
- "Is project X healthy", "what's stalled in X", "any stale PRs" → `project overview X`.
