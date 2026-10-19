# Audit log

### `lumo audit list` — the workspace audit log (LUM-907, OWNER only)

Sensitive actions in the workspace, newest first: member role changes and departures, invitations, workspace / security / retention settings and the logo, data export and deletion requests, AI-derived content and session-record deletion, task templates, integration connect / disconnect (workspace-level and personal: GitHub, Slack, Sentry and its project mappings, Figma, Google Drive), personal API key creation and revocation, document visibility and public-link changes, permanent deletion from the trash, human rulings on boundary crossings, security findings and test-case defects (and revoked suppression rules), and audit log CSV exports. Events from GitHub itself (App removed or suspended) show actor `system` with source `WEBHOOK`, or `SYSTEM` when the daily recheck found it. Each row is `time  action  actor  target  source  ip`; the time is UTC ISO 8601 (`2026-10-04T15:54:12Z`) when piped and local time with its UTC offset on a terminal (on a TTY a header row comes first; piped output has none and nothing is truncated). A boundary-crossing target prints its ref (`boundary_crossing LUM-X482`), other targets their id (LUM-1232). Only workspace **owners** can read it — anyone else gets `Error: Only workspace owners can view the audit log` (HTTP 403, exit 1). Events are kept 365 days.

```bash
lumo audit list
lumo audit list --since 7d --action invite
lumo audit list --actor alice@example.com --since 2026-10-01 --until 2026-10-04
lumo audit list --action member.role_changed --target-type member --target <memberId>
lumo audit list --limit 200 --json
lumo audit list --since 30d --csv > audit.csv
```

```
2026-10-04T15:54:12Z  member.role_changed  Alice Chen <alice@example.com>  member cm1abc  WEB  203.0.113.9
2026-10-04T15:50:03Z  invite.created       Alice Chen <alice@example.com>  invite cm1def  CLI  203.0.113.9

Showing 1-50.
Next page: lumo audit list --cursor eyJ…
```

Flags:

- `--action` — an exact key (`member.role_changed`, `data_export.downloaded`, …) or an area (`member`, `invite`, `workspace`, `data_export`, `task_template`, `github_app`, `slack`, `sentry`, `api_key`, `document`, `trash`, `boundary_crossing`, `security_finding`, `test_case_defect`, `audit_log`, …) matching every key under it. Unknown values are rejected (HTTP 400).
- `--actor` — `me`, `system`, a current member's email or display name, a member id, or a Clerk user id (`user_…`, the only way to find a former member's events). An ambiguous name is rejected — use the email.
- `--since` / `--until` — `7d` (days back from now), a date `2026-10-01` (UTC; `--until` includes that whole day) or an ISO date-time with an offset.
- `--target-type` (`workspace | member | invite | data_export | session | task_template | integration | api_key | document | task | boundary_crossing | suppression_rule | security_finding | test_case_run | sentry_mapping | audit_log`, case-insensitive) and `--target <id>`.
- `--limit` (1–200, default 50) and `--cursor` (from the `Next page: …` footer line or `nextCursor` in `--json`) page through older events.
- `--json` prints `{ version, events: [{ id, createdAt, action, actorType, actorId, actorMemberId, actorName, actorEmail, source, targetType, targetId, targetRef, ip, userAgent, metadata }], nextCursor, total }` (`targetRef` = the human-readable ref when the target has one, else null); `total` is always `null` (the log is paged by cursor and not counted). `source` is `WEB` (browser), `CLI` (any API-key request: CLI, MCP, scripts), `WEBHOOK` or `SYSTEM`.
- `--csv` (also from the web page's Export CSV) is itself recorded as an `audit_log.exported` event; plain listing is not. It writes the whole filtered log (not one page; `--limit` / `--cursor` are ignored) to stdout, newest first, capped at 10,000 rows — a stderr warning says when the cap cut it off; narrow the dates for the rest. Cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` so spreadsheets do not run them as formulas. `--json` and `--csv` are mutually exclusive.

### When to suggest `audit list`

- "Who changed X / removed Y / invited Z", "when was this integration disconnected", "who exported the workspace", "who made this document public", "who revoked that API key" — and the user is a workspace owner.
- Compliance or security reviews that ask for an access / change log — use `--csv` for a file to hand over.
