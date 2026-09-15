# Ideas (team-level capture pool)

An **idea** is an un-triaged spark parked above the project layer — not yet actionable work. Ideas are team-scoped (no project); the workspace's default team owns them. Ids are **I-prefixed** (`LUM-I42`) so they cannot collide with task ids (`LUM-42`) in the same team namespace.

The unprocessed (`CAPTURED`) pool is what the `lumo plan` converter consumes — see [plan-runs.md](plan-runs.md).

## `lumo idea "<statement>" [--context <text>]`

Capture an idea into the pool in under 10 seconds. Provenance is grabbed opportunistically and **never blocks the capture**: the current `CLAUDE_CODE_SESSION_ID` (→ `sourceSessionId`) and the session's bound task (→ `sourceTaskId`, null when nothing is bound). Prints `✓ 想法 LUM-I42 已入池`.

**When to suggest**: the user has a stray idea / thought / improvement they want to park without derailing the current task ("记一下这个想法", "capture this idea", "add to the backlog of ideas"). Prefer this over `task create` for un-triaged sparks — an idea is above projects and isn't yet actionable work.

```bash
lumo idea "Add a quick-capture keyboard shortcut" --context "raised in standup"
```

## `lumo idea list`

Print the pool **newest-first**, one line per idea: the `LUM-I<n>` id, status and statement. Reads `GET /api/ideas`, which returns the **whole** pool (every status), not just the unprocessed slice. Empty pool prints `No ideas.`

The same pool is browsable/searchable in web at `/workspace/<slug>/ideas` (sidebar → Ideas), where a `PLANNED` idea links to the plan run that materialised it and the status filter hides `DROPPED` by default.

**When to suggest**: the user wants to see what's parked ("看看想法池", "list the ideas"), or is triaging before running `lumo plan`.

```bash
lumo idea list
```

## `lumo idea update <id> --status <captured|developing|planned|dropped>`

Move an idea through its lifecycle (LUM-679). `<id>` is the `LUM-I<n>` id (a bare number also resolves); `--status` is case-insensitive.

| State        | Meaning                          |
| ------------ | -------------------------------- |
| `CAPTURED`   | pooled, un-triaged               |
| `DEVELOPING` | in triage / pre-work             |
| `PLANNED`    | consumed by an initiative / plan |
| `DROPPED`    | terminal discard                 |

Allowed transitions: `CAPTURED ↔ DEVELOPING`, `DEVELOPING → PLANNED`, and **any non-terminal → DROPPED**. Nothing transitions out of `DROPPED`. `CAPTURED → PLANNED` is **not** a manual move — only the converter's materialisation lands an idea in `PLANNED`. An illegal move is rejected with a clear error (400); an unknown id → 404.

**When to suggest**: the user wants to triage by hand — start pre-work ("开始预研这个想法" → `developing`) or discard one ("废弃/丢掉这个想法" → `dropped`). The same control lives on the Idea detail page in web.

```bash
lumo idea update LUM-I42 --status developing
lumo idea update LUM-I42 --status dropped
```

## Evidence on an idea — `slack` / `web` / `figma`

`lumo idea slack add|show|rm`, `lumo idea web add|show|rm`, `lumo idea figma add|list|rm|refresh|context` (LUM-681) attach and inspect supporting evidence, mirroring the `task slack/web/figma` source-card commands but hitting `/api/ideas/:id/...`. `<idea>` is the `LUM-I<n>` id.

`show` / `context` are **Tier-2 retrieval** (stored snapshot / fetched body / cached design metadata — no live re-fetch) and stamp the disclosure funnel like their task-side counterparts. `figma refresh` re-fetches metadata for every link on the idea. `slack show` / `web show` redact registry secrets server-side before printing and end with a `⚠ N suspected credential(s) were redacted before injection …` line when any were (LUM-784, same as the task-side commands).

**When to suggest**: the user wants to attach evidence (a Slack discussion, a spec link, a Figma mock) to an idea **before** it goes through `lumo plan` — the converter carries that evidence forward into the resulting task/initiative. Prefer attaching to the idea over waiting until after conversion.

```bash
lumo idea web add LUM-I42 https://example.com/spec
lumo idea web show LUM-I42 wl_1
lumo idea web rm LUM-I42 wl_1
lumo idea slack add LUM-I42 https://myteam.slack.com/archives/C1/p123
lumo idea slack show LUM-I42 ctx_1
lumo idea slack rm LUM-I42 ctx_1
lumo idea figma add LUM-I42 https://www.figma.com/file/abc/Mock
lumo idea figma list LUM-I42
lumo idea figma context LUM-I42 cfl_1
lumo idea figma refresh LUM-I42
lumo idea figma rm LUM-I42 cfl_1
```

## Comments — `lumo idea comment` / `lumo idea comments list`

`lumo idea comment <id> <body>` posts a comment (LUM-680). `<id>` is the `LUM-I<n>` id (a bare number or a cuid also resolves); the body is plain text — quote it to pass spaces/newlines. Ideas reuse the task `Comment` model via a polymorphic `ideaId`; the thread is **flat** (no replies). Posting also records a `COMMENT_ADDED` entry on the idea's activity timeline.

`lumo idea comments list <id> [--full]` prints the thread oldest-first, capped to the output budget like `task comments list`; `--full` prints every comment. Empty thread → `(no comments)`.

**When to suggest**: the user wants to discuss or annotate a parked idea ("给这个想法加条评论"), or review its discussion/history ("看看这个想法的评论/活动"). For the **activity timeline** (status changes, statement edits, materialisation) there is no CLI reader — it renders on the Idea detail slide-over in web.

```bash
lumo idea comment LUM-I42 "Let's scope this for next sprint"
lumo idea comments list LUM-I42
```
