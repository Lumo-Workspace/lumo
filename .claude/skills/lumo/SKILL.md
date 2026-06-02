---
name: lumo
description: 'Use the Lumo CLI to load task context, manage session bindings, inspect projects and milestones, and create/update/list/show/comment on tasks from the terminal. Activate when: user mentions a Lumo task identifier (LUM-42, LUM-12, etc.), asks to load task background or context, wants to bind, check, or detach a Claude Code session''s task binding, is about to start development work on a specific task, wants to create a new task, list their tasks, view a task, comment on a task, list projects, list milestones, attach a task to a milestone, or update a task''s status/title/description/priority/assignee/milestone. Triggers on: "LUM-", "task context", "load context", "session start", "session attach", "session status", "session detach", "bind session", "unbind session", "which task", "what task am I on", "work on LUM", "create task", "new task", "add task", "file a task", "log a task", "list tasks", "my tasks", "show task", "view task", "comment on task", "leave a comment", "list projects", "what projects", "update task", "change task status", "rename task", "reassign task", "mark task as done", "milestone", "里程碑", "list milestones", "set milestone", "挂到 milestone", "attach milestone", "unbind milestone", "create milestone", "new milestone", "update milestone", "change milestone status", "delete milestone", "show milestone", "view milestone", "tasks in milestone", "milestone tasks", "新建里程碑", "更新里程碑", "删除里程碑", "查看里程碑", "milestone summary", "milestone retro", "summarize milestone", "里程碑总结", "里程碑复盘", "milestone add", "milestone remove", "add tasks to milestone", "remove tasks from milestone", "batch milestone", "bulk milestone", "挂任务到里程碑", "批量挂里程碑", "从里程碑移除任务", "auth login", "log in", "login", "auth logout", "log out", "logout", "sign out", "switch account", "switch identity", "whoami", "who am I", "current identity", "current user", "current workspace", "登录", "登出", "切换账号", "当前身份", "create doc", "new doc", "new document", "write doc", "写文档", "新建文档", "update doc", "edit doc", "修改文档", "更新文档", "list docs", "my docs", "我的文档", "show doc", "view doc", "查看文档", "delete doc", "删除文档", "bind doc", "attach doc to task", "把文档关联到任务", "文档绑定到任务", "unbind doc", "解绑文档", "personal doc", "workspace doc", "个人文档", "workspace 文档", "doc scope", "tag", "add tag", "remove tag", "标签", "添加标签", "移除标签", "doc tag", "task tag", "share doc", "doc share", "share document", "分享文档", "文档分享", "unshare doc", "remove share", "取消分享", "share list", "list doc shares", "who has access", "viewer", "editor", "manager", "shared with", "doc tree", "doc move", "move doc", "reparent doc", "文档树", "移动文档", "sprint", "start sprint", "close sprint", "add to sprint", "active sprints", "冲刺", "迭代", "开始冲刺", "关闭冲刺", "create sprint", "new sprint", "list sprints", "show sprint", "update sprint", "delete sprint", "sprint summary", "sprint retro", "把任务挂到冲刺", "冲刺里有什么", "lumo update", "update cli", "upgrade lumo", "update lumo", "upgrade cli", "升级 lumo", "更新 cli", "new lumo version", "是否有新版本", "lumo setup", "install lumo skill", "install lumo hooks", "wire up lumo", "set up lumo", "onboard lumo", "npx @lumoai/cli", "安装 lumo", "配置 lumo", "lumo 初始化", "task artifact", "artifact add", "artifact list", "artifact show", "artifact rm", "artifact delete", "artifact update", "update artifact", "edit artifact", "change artifact kind", "change artifact source", "remove artifact", "delete artifact", "spec artifact", "record spec", "attach spec", "attach plan", "记录 spec", "挂 spec", "查看 artifact", "编辑 artifact", "修改 artifact", "删除 artifact", figma, attach figma, figma link, 关联 figma, 设计稿, figma design, "memory", "记忆", "remember", "record a memory", "记一条", "promote memory", "promote to project", "沉淀", "task memory", "project memory", "lumo memory", "retrieval", "取全文", "load full content", "拉全文", "task slack show", "看 thread", "看 slack thread", "show slack thread", "slack 全文", "task web show", "show web link body", "web 正文", "抓网页正文", "task figma context", "figma metadata", "figma 元数据", "figma 设计上下文", "task comments list", "list comments", "看评论", "评论流", "task pr show", "查看 PR", "show pr", "PR 详情", "pr metadata", "import google doc", "sync google doc", "google drive", "doc import-gdoc", "doc sync", "导入 google 文档", "同步 google 文档", "session wrap", "wrap up session", "收尾", "post progress", "把进度发出去", "progress comment", "进度评论".'
---

## Prerequisites

Before running any `lumo` command, verify the CLI is available and authenticated:

```bash
which lumo && lumo whoami
```

- If `lumo` is not found: tell the user to install it (`npm install -g @lumoai/cli`; for monorepo dev, `cd cli && npm install && npm link` also works)
- If `lumo whoami` fails with an auth error: tell the user to run `lumo auth login`
- Do NOT proceed with any lumo commands until both checks pass

## Onboarding

### `lumo setup [--user|--project] [--force] [--agent <token>]` — install skill + hooks

Bootstraps Lumo into a coding-agent installation. Copies the bundled `SKILL.md` into `<scope>/.claude/skills/lumo/` and idempotently merges 25 hook entries into `<scope>/.claude/settings.json`. Existing user permissions and non-Lumo hook entries are preserved.

On `--project` scope, setup also installs a `prepare-commit-msg` git hook that
auto-appends the branch's task ID (`[LUM-N]`, parsed from a `lumo/LUM-N-...`
branch name) to any commit subject that lacks it. The hook is pure sh + git
(no network, no `lumo` call) and is merged idempotently between
`# >>> lumo prepare-commit-msg >>>` / `# <<< lumo <<<` markers, preserving any
existing hook content. When `core.hooksPath` is set (husky or a custom hooks
dir), setup does **not** write the file — it prints the block plus instructions
to add it manually (e.g. to `.husky/prepare-commit-msg`). `--user` scope does
not touch git hooks.

`--agent <token>` records which coding agent these hooks run under and is **baked into every hook command** (`lumo hook <slug> --agent <token>`). Each hook then sends the agent to the server, where it's stored on the Session and inherited by auto-sedimented memories — so a memory is attributed to the agent that produced it instead of the default. Valid tokens: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases). **Defaults to `claude-code`.** Re-running setup with a different `--agent` rewrites the token in place (no duplicate hook entries), and a legacy flagless entry is upgraded on the next run.

```bash
npx @lumoai/cli setup                    # interactive: prompts user/project; agent=claude-code
npx @lumoai/cli setup --user             # write to ~/.claude/
npx @lumoai/cli setup --project          # write to ./.claude/
npx @lumoai/cli setup --force            # overwrite SKILL.md if it differs from bundled
npx @lumoai/cli setup --agent codex      # bake agent=codex into the hook commands
```

Use when:

- The user asks "how do I set up lumo", "install the lumo skill", "wire up lumo hooks"
- A fresh checkout of a project that uses Lumo doesn't have `.claude/skills/lumo/SKILL.md` yet
- After `npm install -g @lumoai/cli`, before the first `lumo auth login`
- Wiring Lumo into a non-Claude-Code agent (Codex / Cursor / …) — pass `--agent <token>` so its memories are attributed correctly

If stdin is not a TTY (CI, piped invocation), the default scope is `project` and no prompt is shown. An unrecognized `--agent` token aborts before writing anything.

## Authentication

### `lumo auth login` — paste an API key to log in

Walks the user through creating an API key in the web app and pasting it back. Opens the browser to the API Keys settings page, then reads the key from stdin (must start with the `lum_` prefix). On success prints `✓ Logged in as <email>` plus workspace + key name.

```bash
lumo auth login
```

Use when:

- `lumo whoami` reports "Not logged in"
- A bearer call returns 401 (`API key invalid or revoked`) and the user wants to re-auth
- The user switches workspaces / accounts

The CLI stores credentials in `~/.lumo/credentials.json`. There's no `--token` flag — the paste-from-browser flow is the only auth path, and that's intentional.

### `lumo auth logout` — remove local credentials

Wipes `~/.lumo/credentials.json`. Idempotent — running twice just prints `Not logged in` the second time.

```bash
lumo auth logout
```

Use when the user says "log out", "sign out", or wants to clear credentials before switching accounts (then run `lumo auth login` to re-auth).

### `lumo whoami` — show current identity

Prints the logged-in email, workspace name + slug, API key name + prefix, and API URL.

```bash
lumo whoami
# Logged in as cli@uselumo.ai
#   Workspace: Lumo (lumo)
#   Key: Claude Code (lum_68d4...)
#   API: https://www.uselumo.ai
```

Use when:

- The user asks "who am I", "which workspace am I in", "what account is this"
- You need to disambiguate whether `lumo task list` would hit the user's expected workspace
- Before suggesting a destructive command on a shared machine — confirm the identity is right

## Self-Update

### `lumo update` — upgrade the CLI to the latest npm release

Synchronously checks `registry.npmjs.org` for the latest published version of `@lumoai/cli`. When a newer version exists, runs `npm install -g @lumoai/cli@latest` and streams npm's output. When already on the latest, exits cleanly with a "Already on the latest version (X)" message.

```bash
lumo update
```

The CLI also performs a passive check at most once every 24 hours (a detached child process refreshes a cache at `~/.lumo/update-check.json`), and prints a one-line "Update available" notice on subsequent invocations when a newer version is in the cache.

Use when:

- The user asks "how do I update", "upgrade lumo", "is there a new version"
- A bug-fix or feature mentioned in conversation requires a newer CLI than the user is running
- The passive notice has appeared and the user wants to act on it

If `npm install -g` fails (permissions, npm not on PATH, alternative package manager), `lumo update` prints a fallback hint instructing the user to run the install command manually. Do not auto-retry; let the user resolve the environment issue first.

## Task Context Loading

When the user mentions a task identifier or asks for task background, load the context:

```bash
lumo task context <identifier>
```

Example: `lumo task context LUM-42`

### Reading the output

The command prints a markdown document to stdout containing:

1. **Task header** — identifier, title, status, description
2. **Memory section** — cross-session learnings accumulated over prior sessions; treat as trusted background context
3. **Inline source cards** — Slack / web / Figma / artifacts / documents / comments / Pull Requests (see "Context Retrieval" below)
4. **PR Review 待办** — mirrored PR review comments as a checkbox todo list: each line-level reviewer comment (shown as `` `file:line` `` + the reviewer's ask + a link to the GitHub comment) and each `changes_requested` review summary (shown as "🛑 整体要求改动"). Present only when the task's PR(s) have review comments. This same block is **auto-injected at session start** (alongside the memory section) when the session is bound to a task — so reviewer asks surface without re-running `task context`.
   - The **inline source cards** (Slack / web / Figma / PR) are likewise **auto-injected at session start** when the session is bound, under a single global token budget shared with the memory section (priority: memory > PR > Slack > Figma > web). Cards that don't fit the budget are degraded to a one-line manifest carrying just the title and its `lumo task … show` retrieval command — so you still know they exist and can pull the full content on demand.
5. **Previous sessions** — ordered newest-first, each with:
   - A headline summary of what was done
   - Unresolved items (carry-over TODOs from that session)

### How to use the context

- **Unresolved items** from the most recent session are the highest-priority carry-overs — address them before starting new work unless the user says otherwise
- **PR Review 待办** items are reviewer-requested changes — treat each unchecked box as a TODO to resolve, then reply on the PR (a Lumo comment mirrors back to GitHub)
- **Memory section** provides validated context that persists across sessions — use it to avoid re-learning decisions or constraints
- Focus on the **most recent 1–2 sessions** for relevant state; older sessions are for historical reference only
- If there are **no prior sessions**, this is a fresh start — read the task description carefully and ask clarifying questions if needed

## Context Retrieval (按需取全文)

LUM-122 split task context injection into tiers. `lumo task context <LUM-N>`
now emits a **cheap inline card** for each source — a short summary or just
metadata — instead of dumping full bodies. Slack, docs, artifacts, and comments
get an **LLM summary**; web links, Figma, and PRs get **metadata only**. Each
card ends with the **retrieval command** you run to pull the heavy content on
demand.

**How to use it:** when the inline card is not enough and you need the full
Slack thread, the web page body, the Figma metadata, the entire comment thread,
or the PR detail — run the matching command below. Pass the same identifier
(`LUM-N`) plus the id the card shows for that source (a Slack `contextId`, a web
`linkId`, a Figma `linkId`, or a PR `number`).

All five are **read-only** (no live Slack/GitHub/Figma calls except the web body
fetch). Web/Figma/PR are v1 metadata-degraded: they print a `note:` explaining
that live content needs an external integration.

### `lumo task slack show <identifier> <contextId>` — full Slack thread snapshot

Prints the **stored** thread snapshot (no live Slack call), one line per message
as `author: text`. Author falls back to `@<userId>` when the display name is
missing. Empty snapshot prints `(no messages in stored snapshot)`.

```bash
lumo task slack show LUM-42 ctx_abc123
```

### `lumo task web show <identifier> <linkId>` — fetched web link body

Fetches the page body on demand behind the SSRF guard (cached after first read)
and prints it as plain text. Empty body prints `(empty body)`. Fetch failures
(blocked host, timeout) print the server's error message.

```bash
lumo task web show LUM-42 wl_abc123
```

### `lumo task figma context <identifier> <linkId>` — Figma link metadata

**v1 metadata fallback.** Prints the cached design metadata as `file:` /
`frame:` / `url:` / `synced:` (and `syncError:` if the last sync failed) lines.
Live design context (layers, variables, code connect) requires the Figma MCP
server, so the command ends with a `note:` saying so.

```bash
lumo task figma context LUM-42 cfl_abc123
```

### `lumo task comments list <identifier>` — full comment thread

Prints the **entire** comment thread: each comment as `author · createdAt`
followed by its plain-text body (comment bodies are stored as HTML and stripped
to text). Replies are indented two spaces under their parent. Author falls back
to `unknown`. No comments prints `(no comments)`.

```bash
lumo task comments list LUM-42
```

**Plural, and distinct from `task comment`.** `task comments list` _reads_ the
whole thread (this retrieval command). `task comment <identifier> <body>`
_writes_ a single new comment (see Task Management). Don't confuse the two —
the plural `comments` is read-only.

### `lumo task pr show <identifier> <number>` — synced PR metadata

**v1 metadata fallback.** Prints the synced PR record: a `#<number> (repo)
title` header, then `state:` (with ` · draft` when draft), `ci:`, `author:`,
`branch: <head> → <base>`, and `url:` lines. The live diff + review comments
require the GitHub integration, so the command ends with a `note:` saying so.

```bash
lumo task pr show LUM-42 128
```

## Task Management

### `lumo task create <title> [flags]` — create a new task

Use this when the user wants to file a new task from the terminal. Title is positional and required (non-empty).

| Flag                     | Type   | Notes                                                                               |
| ------------------------ | ------ | ----------------------------------------------------------------------------------- |
| `-d, --description <>`   | string | Optional task description.                                                          |
| `-p, --priority <level>` | enum   | `low \| medium \| high \| urgent` (case-insensitive). Defaults to `low`.            |
| `-a, --assignee <ref>`   | string | `me`, an email, or a member name. Defaults to `me`.                                 |
| `--project <ref>`        | string | Project name or slug. **Required when the workspace has more than one project.**    |
| `--milestone <ref>`      | string | Milestone name (case-insensitive) within the resolved project. Omit for no binding. |
| `--sprint <ref>`         | string | Sprint number or UUID to bind the task to on creation. Omit for no sprint binding.  |
| `--tag <name>`           | string | Attach a tag by name (repeatable). The name is resolved to an id server-side.       |
| `--tag-id <cuid>`        | string | Attach a tag by cuid (repeatable). Combines with `--tag`.                           |

Examples:

```bash
lumo task create "Fix Slack OAuth redirect bug"
lumo task create "Refactor task service" --priority high --description "Split into smaller files"
lumo task create "Investigate slow query" --assignee teammate@example.com --project backend
lumo task create "Plan API design" --milestone "v1.0"
lumo task create "Sprint task" --sprint 3
lumo task create "Add rate limiting" --tag bug --tag urgent
lumo task create "Spike: evaluate caching options" --tag rfc --tag-id clm_abc123
```

On success the command prints one or two lines to stdout:

```
Created LUM-55 "Title"  https://www.uselumo.ai/workspace/<slug>/my-tasks/LUM-55
Tags: bug, urgent
```

The `Tags:` line is omitted when no tags were attached.

If the workspace has multiple projects and `--project` is omitted, the server will return an error naming available projects — re-run with `--project <slug>`.

### When to suggest `task create`

- The user describes wanting a new task ("create a task to ...", "file a bug for ...", "log a TODO that ...", "add a task: ...").
- After a discussion that ends in "let's track that separately" — offer to create the task with a sensible title and priority.
- For follow-ups discovered mid-work that shouldn't bloat the current change — propose `task create` rather than silently expanding scope.

### `lumo task update <identifier> [flags]` — patch a task

Pure flag-driven update. Provide at least one of:

| Flag                     | Type                | Notes                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-t, --title <text>`     | string              | Cannot be empty.                                                                                                                                                                                                                                                      |
| `-d, --description <>`   | string              | `--description ""` clears the field.                                                                                                                                                                                                                                  |
| `-s, --status <value>`   | enum                | `todo \| in_progress \| in_review \| done` (case-insensitive).                                                                                                                                                                                                        |
| `-p, --priority <lvl>`   | enum                | `low \| medium \| high \| urgent`.                                                                                                                                                                                                                                    |
| `-a, --assignee <ref>`   | string              | `me`, an email, or a member name. `--assignee ""` clears the field.                                                                                                                                                                                                   |
| `--milestone <ref>`      | string              | Milestone name (case-insensitive) within the task's project. `--milestone ""` unbinds.                                                                                                                                                                                |
| `--sprint <ref>`         | string              | Sprint number or UUID to bind the task to. `--sprint ""` clears the current sprint binding (idempotent when already unbound).                                                                                                                                         |
| `--tag <name>`           | string (repeatable) | **Bulk replace** the tag set by name. Creates tag if missing. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                                                                                                                         |
| `--tag-id <cuid>`        | string (repeatable) | **Bulk replace** the tag set by id. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                                                                                                                                                   |
| `--add-tag <name>`       | string (repeatable) | Attach tag by name (find-or-create). Max 20.                                                                                                                                                                                                                          |
| `--add-tag-id <cuid>`    | string (repeatable) | Attach tag by id. Max 20.                                                                                                                                                                                                                                             |
| `--remove-tag <name>`    | string (repeatable) | Detach tag by name. `--remove-tag <name>` resolves the name via find-or-create on the workspace. If the name was unknown, a new Tag row is created (orphan, no attachments) before the detach runs as a no-op. Use `--remove-tag-id <cuid>` to avoid orphans. Max 20. |
| `--remove-tag-id <cuid>` | string (repeatable) | Detach tag by id. Unknown ids are a no-op (no side effects). Max 20.                                                                                                                                                                                                  |

`--tag` / `--tag-id` (bulk replace) are mutually exclusive with `--add-tag` / `--add-tag-id` / `--remove-tag` / `--remove-tag-id`. The CLI errors before any network call if both families are mixed.

Examples:

```bash
lumo task update LUM-48 --status in_progress
lumo task update LUM-48 --title "Update task from CLI" --priority high
lumo task update LUM-48 --assignee me
lumo task update LUM-48 --description ""        # clear description
lumo task update LUM-48 --assignee ""           # unassign
lumo task update LUM-48 --milestone "v1.0"      # attach to milestone
lumo task update LUM-48 --milestone ""          # unbind milestone
lumo task update LUM-48 --sprint 3              # bind to sprint #3
lumo task update LUM-48 --sprint ""             # unbind from current sprint
lumo task update LUM-42 --add-tag urgent --remove-tag draft
lumo task update LUM-42 --tag final --tag approved   # replace entire tag set
lumo task update LUM-42 --tag final --add-tag oops
# Error: --tag/--tag-id are mutually exclusive with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id
```

On success the command prints one or two lines to stdout:

```
Updated LUM-48 "Title"  https://www.uselumo.ai/workspace/<slug>/my-tasks/LUM-48
Tags: urgent
```

The `Tags:` line is omitted when the resulting tag set is empty.

### When to suggest `task update`

- The user describes a state change in natural language (e.g. "mark LUM-48 as in progress", "rename LUM-12 to ...", "assign LUM-30 to me", "bump the priority on LUM-7").
- After the agent finishes a task and the user confirms — offer to move it to `done`.
- Multiple status changes in a row should each be a separate `update` invocation rather than batched.

### Sprint output format

`--sprint <ref>` prints a `Sprint:` line after the update line showing old → new binding:

```
Sprint: - → #3        # newly bound (was backlog)
Sprint: #2 → #3       # rebound (moved from sprint 2 to 3)
Sprint: #3 → -        # unbound
Task LUM-48 already in sprint #3    # noop (same sprint)
Task LUM-48 has no sprint binding   # noop (already unbound)
```

`--sprint` can be combined with other update flags. The PATCH (field updates) runs first; the sprint operation runs after. Failures on either step pass through independently without rollback.

### Out of scope

The CLI does **not** currently update due date or parent task. Those need to be edited in the web UI.

Milestone updates (`--milestone`) and sprint binding (`--sprint`) both work. Full milestone CRUD is available via `lumo milestone create / show / update / delete`, and tasks can be bound/unbound in bulk via `lumo milestone add / remove <identifier> <task...>` (see below). Full sprint CRUD is available via `lumo sprint create / show / update / delete / start / close / add / remove` (see below).

### `lumo task list [flags]` — list tasks assigned to you

Default behavior: prints every task currently assigned to the authenticated user (no project / status filter), one per line, as a fixed-width table:

```
LUM-42  IN_PROGRESS  HIGH    web        Fix Slack OAuth redirect
LUM-48  TODO         MEDIUM  backend    Investigate slow query
```

| Flag                    | Type    | Notes                                                                            |
| ----------------------- | ------- | -------------------------------------------------------------------------------- |
| `-s, --status <value>`  | enum    | Filter by status: `todo \| in_progress \| in_review \| done` (case-insensitive). |
| `-p, --project <ref>`   | string  | Filter by project name (case-insensitive match against display name).            |
| `-m, --milestone <ref>` | string  | Filter to my tasks under this milestone (name or UUID).                          |
| `-n, --limit <count>`   | integer | Cap output to the first N rows.                                                  |

When `--milestone` is set, the CLI calls `GET /api/milestones/<id>/tasks?assigned=me` instead of `/api/tasks/me`. Other filters (`--status`, `--limit`) still apply client-side to the milestone-scoped result.

Filtering is currently client-side — the server returns the full "my tasks" set and the CLI slices it. This is fine for typical workspaces (dozens of tasks); revisit if a workspace has hundreds.

### When to suggest `task list`

- The user asks "what am I working on", "what tasks do I have", "list my tasks", "show me my queue".
- Before suggesting a status change ("mark something as done"), if no task ID is in context — run `task list` first to surface candidates.

### `lumo task show <identifier>` — print one task's detail

Returns a key:value block for a single task — title, status, priority, project, assignee (with display name from Clerk), URL, and the full description below. Lighter than `task context` because it does not load prior session summaries or memory.

```bash
lumo task show LUM-42
```

Use when the user wants the current state of a task without the agent-handoff payload.

### `lumo task comment <identifier> <body>` — leave a comment

Two-step under the hood (resolve LUM-N → POST comment). Body is plain text; quote it to embed spaces or newlines.

```bash
lumo task comment LUM-42 "Reproduced the redirect bug on staging — Safari only, not Chrome."
```

The CLI does not support @-mention chip syntax. If the user wants to ping someone, they should comment from the web UI.

### Task ↔ Spec Artifacts

Record Claude Code spec-engineering products (spec / plan / design …) on a task. The artifacts show up in the task detail "规格" (definition) layer and are injected into `lumo task context`.

#### `lumo task artifact add <task> --kind <kind> --title <title> --file <path> --source <source> --agent <agent>`

Attaches an artifact to a task. `--kind`, `--title`, `--source` are stored verbatim — **`kind` is opaque** (no enumeration; `spec` / `plan` / `requirements` / anything is accepted). `--source` is **required** and names the spec-generation framework that produced the artifact, written as its **formal name** (`Superpowers` / `Spec Kit` / `BMad` / `OpenSpec` / `GSD` / …) — it is also opaque (no enumeration), but there is **no default**, so you must pass it. Quote names that contain spaces (`--source "Spec Kit"`). `--file` supplies the body (file contents). Each call appends to the end of the task's artifact list — call once per artifact (e.g. Superpowers: one `spec`, one `plan`). The `<task>` (e.g. `LUM-42`) is resolved server-side. **`--file` is sandboxed:** the CLI rejects any path that resolves **outside the current project directory** (parent-traversal, absolute paths, escaping symlinks) or that matches a **sensitive-file denylist** (`.env*`, `id_rsa`/`id_ed25519`, `*.pem`/`*.key`, `.aws`/`.ssh` contents, `credentials`, `.npmrc`, …). There is no override flag — pass only project-local, non-secret files (e.g. `docs/spec.md`). To record an out-of-tree file, copy it into the project first.

`--agent` is **required** and names the coding tool that produced the artifact (enum). Valid values: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases).

```bash
lumo task artifact add LUM-42 --kind spec --title "Spec" --file docs/spec.md --source Superpowers --agent claude-code
lumo task artifact add LUM-42 --kind plan --title "Implementation plan" --file docs/plan.md --source "Spec Kit" --agent claude-code
```

Output: `Added [spec] "Spec" to LUM-42`

#### `lumo task artifact update <task> <artifact-id> [--kind <kind>] [--title <title>] [--source <source>] [--agent <agent>]`

Patches an existing artifact's metadata in place. Editable fields are **`kind`, `title`, `source`, and `agent`** — **content is immutable** (to change the body, `rm` the artifact and `add` it again). At least one flag is required; passing none errors before any network call. Empty values (`--kind ""`) are rejected. The `<artifact-id>` is the cuid in column 1 of `artifact list`. `--agent` accepts the same valid values and aliases as `artifact add`: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases).

```bash
lumo task artifact update LUM-42 cma_xxx --kind plan              # re-classify spec → plan
lumo task artifact update LUM-42 cma_xxx --source "Spec Kit"      # fix the framework label
lumo task artifact update LUM-42 cma_xxx --title "Final spec" --source OpenSpec
lumo task artifact update LUM-42 cma_xxx --agent cursor           # fix the agent label
```

Output: `Updated [plan] "Final spec" (OpenSpec) on LUM-42`. A 404 (task or artifact missing in this workspace) prints the server message and exits 1.

#### `lumo task artifact list <task>`

Lists artifacts on the task in order: `<id>  <kind>  <agent>  <source>  <title>`. Prints `No artifacts on <task>` when there are none.

```bash
lumo task artifact list LUM-42
```

#### `lumo task artifact show <task> <artifact-id>`

Prints one artifact's key:value header (id, kind, title, agent, source, order, task) followed by the full content body. The `<artifact-id>` is the cuid in column 1 of `artifact list`.

```bash
lumo task artifact show LUM-42 cma_xxx
```

#### `lumo task artifact rm <task> <artifact-id> --yes`

Deletes an artifact from a task. Irreversible — `--yes` is required and there is no interactive prompt (agent-friendly). On success prints `Removed <artifact-id> from <task>`. A 404 (task or artifact missing in this workspace) prints the server message and exits 1.

```bash
lumo task artifact rm LUM-42 cma_xxx --yes
```

When to suggest: after running a spec/plan workflow in Claude Code, offer to record the product(s) with `task artifact add` (one call per artifact) — always pass `--source` with the framework you used. Use `task artifact list` to see what's already recorded, `task artifact show` to inspect a single artifact's content, `task artifact update` to fix a wrong kind/title/source without re-uploading, and `task artifact rm` to drop one that's wrong or stale.

### Task ↔ Figma Designs

#### `lumo task figma add <task> <url>` — attach a Figma file/frame

Fetches file name, frame name, and thumbnail via Figma OAuth and stores them
on the task.

```bash
lumo task figma add LUM-42 "https://www.figma.com/design/abc123/Onboarding?node-id=1-234"
```

If the URL omits `node-id`, the link is stored as file-level; the CLI prints
a `(file-level, thumbnail from "...")` note showing the auto-picked
representative frame.

Idempotent — re-adding the same URL within 7 days returns the existing row
without re-calling Figma.

**Not connected?** Errors with:

```
✗ You haven't connected Figma yet.
  Run: open https://www.uselumo.ai/settings/integrations
```

#### `lumo task figma list <task>` — list attachments

```
$ lumo task figma list LUM-42
cfl_xxx1  Onboarding       Welcome screen       2026-05-28
cfl_xxx2  Design System    Button / Primary     2026-05-27
cfl_xxx3  Onboarding       (file-level)         2026-05-20  ⚠ thumbnail stale
```

`⚠ thumbnail stale` appears when `thumbnailFetchedAt > 25 days`.

#### `lumo task figma rm <task> <link-id-or-url>` — remove an attachment

Accepts a `cfl_*` cuid or the original URL. Idempotent (`Not linked: ...` + exit 0 when no match).

#### `lumo task figma refresh <task>` — manual refresh

Re-fetches metadata + thumbnail for every Figma link on the task. Per-link
failures are isolated.

```
$ lumo task figma refresh LUM-42
Refreshed 3 Figma links on LUM-42
  ✓ Onboarding · Welcome screen
  ✓ Onboarding · Sign-up form
  ✗ Design System · Button (file not accessible)
```

### When to suggest the `task figma` commands

- User pastes a Figma URL or mentions a design ("here's the mock", "the
  Figma is at...").
- User asks "what designs are linked to this task" or "show me the Figma
  for LUM-42".
- After implementing a UI change, suggest `lumo task figma refresh <task>`
  if the user mentioned updating the Figma source.

OAuth connection lives in the Web UI at
`/settings/integrations`. The CLI does **not** have a `figma auth`
command; if the user tries `task figma add` without connecting, the error
message directs them to the Web UI.

### `lumo project list` — list projects in the workspace

Prints `<slug>  <Display Name>` lines. The slug column matches the `--project <ref>` argument accepted by `task create`, so users (and you) can copy a slug straight from this output into a create command.

```bash
lumo project list
```

### `lumo milestone list [--project <ref>]` — list milestones in a project

Prints fixed-width rows: `<STATUS>  <target-date or ->  <name>`, sorted by target date asc (nulls last) then created asc.

```bash
lumo milestone list                  # one-project workspace
lumo milestone list --project lumo   # multi-project workspace
```

`--project <ref>` is required when the workspace has more than one project (consistent with `task create --project`). Match is by project name or slug, case-insensitive.

### When to suggest `milestone list`

- Before suggesting `task create --milestone <ref>` or `task update --milestone <ref>` to confirm the milestone exists under the expected name.
- When the user asks "what milestones do we have", "what's on v1.0", or similar.

When to suggest: before `task create --project <ref>` when the workspace has more than one project and the user hasn't specified which one.

### `lumo milestone create <name>` — create a milestone

| Flag                   | Type   | Notes                                   |
| ---------------------- | ------ | --------------------------------------- |
| `--project <ref>`      | string | Required when workspace has >1 project. |
| `-d, --description <>` | string | Optional.                               |
| `--start <date>`       | string | YYYY-MM-DD.                             |
| `--target <date>`      | string | YYYY-MM-DD.                             |

Examples:

```bash
lumo milestone create "Q3 Launch"
lumo milestone create "Q3 Launch" --start 2026-06-01 --target 2026-08-31
```

On success: `Created milestone "Q3 Launch"  <id>`.

### `lumo milestone show <identifier>` — show milestone detail + tasks

Accepts UUID or name. With a name, `--project <ref>` is required when the workspace has >1 project.

Prints a key:value header (name, status, dates, project, description), task counts, and the full task table under the milestone.

```bash
lumo milestone show "Q3 Launch"
lumo milestone show 11111111-2222-3333-4444-555555555555
```

### `lumo milestone update <identifier>` — patch a milestone

| Flag                   | Type   | Notes                                                            |
| ---------------------- | ------ | ---------------------------------------------------------------- |
| `--project <ref>`      | string | Required when identifier is a name and workspace has >1 project. |
| `-n, --name <text>`    | string | Cannot be empty.                                                 |
| `-d, --description <>` | string | `--description ""` clears.                                       |
| `-s, --status <value>` | enum   | `planned \| active \| completed \| cancelled`.                   |
| `--start <date>`       | string | `--start ""` clears.                                             |
| `--target <date>`      | string | `--target ""` clears.                                            |

At least one field required.

```bash
lumo milestone update "Q3 Launch" --status active
lumo milestone update "Q3 Launch" --target 2026-09-15
lumo milestone update "Q3 Launch" --description ""
```

### `lumo milestone delete <identifier>` — delete a milestone

Requires `--yes`. No interactive prompt — CLI is agent-friendly. Tasks under the milestone keep their data; their `milestoneId` is cleared.

```bash
lumo milestone delete "Q3 Launch" --yes
```

### `lumo milestone add <identifier> <task...>` — bind tasks to a milestone (batch)

Binds **one or more** tasks to a milestone in a single call — the batch counterpart of `task update --milestone <ref>` (which only takes one task at a time). `<identifier>` accepts a milestone name or UUID; each `<task>` accepts `LUM-N` or a task UUID. `--project <ref>` is required when the identifier is a name and the workspace has >1 project.

Task refs are deduped (case-insensitive, order preserved). Each task is PATCHed independently — **partial failures do not roll back**: a task that fails (e.g. not found, or its project has no milestone of that name) is reported on its own line while the rest still bind. Exit code is non-zero if **any** task failed.

```bash
lumo milestone add "Q3 Launch" LUM-1 LUM-2 LUM-3
lumo milestone add 11111111-2222-3333-4444-555555555555 LUM-1 LUM-2
```

Output — a tally header (zero categories omitted) plus one line per task:

```
Q3 Launch: 2 added, 1 failed
  ✓ LUM-1
  ✓ LUM-2
  ✗ LUM-3  no milestone matches "Q3 Launch" in this project. Try `lumo milestone list`.
```

### `lumo milestone remove <identifier> <task...>` — unbind tasks from a milestone (batch)

Unbinds **one or more** tasks from a milestone in one call. A task that is **not currently in this milestone is skipped** (idempotent) — it is never reassigned away from a different milestone. `<identifier>` accepts a name or UUID; each `<task>` accepts `LUM-N` or a task UUID. `--project <ref>` is required when the identifier is a name and the workspace has >1 project.

```bash
lumo milestone remove "Q3 Launch" LUM-1 LUM-5
```

Output — `✓` removed, `-` skipped (not in milestone), `✗` failed:

```
Q3 Launch: 1 removed, 1 skipped
  ✓ LUM-1
  - LUM-5  not in this milestone
```

### When to suggest `milestone add` / `milestone remove`

- The user wants to attach/detach **several** tasks to a milestone at once ("挂这几个任务到 Q3", "把 LUM-1 LUM-2 LUM-3 都放进里程碑", "remove these from the milestone"). For a single task, `task update --milestone <ref>` (or `--milestone ""` to clear) is equally fine.
- `remove` only clears the binding for tasks actually in the named milestone, so it's safe to pass a broad list — anything not in it is reported as skipped, not clobbered.
- For one-at-a-time sprint binding see `lumo sprint add / remove` (sprint batch is not yet supported).

### `lumo milestone summary <identifier> [--retry]` — fetch AI-generated milestone retro

Prints the AI-generated retrospective summary for a milestone (mirrors `sprint summary`). `<identifier>` accepts a milestone name or UUID; `--project <ref>` is required when the identifier is a name and the workspace has more than one project. When no summary exists yet the command prints `(no summary generated yet)`.

A summary is generated automatically when a milestone transitions to `COMPLETED` (e.g. via `lumo milestone update <id> --status completed`). The generated report has sections `## Summary`, `## Delivered`, `## Outstanding` plus a one-line `tldr`. Use `--retry` to queue regeneration (e.g. after a failed generation) before fetching — regeneration is async, so the printed result may still be the previous summary or `(no summary generated yet)`.

| Flag              | Type    | Notes                                                            |
| ----------------- | ------- | ---------------------------------------------------------------- |
| `--project <ref>` | string  | Project name or slug. Required when identifier is a name and the workspace has >1 project. |
| `--retry`         | boolean | Queue a regeneration (async, server returns 202) before fetching. Only valid on a COMPLETED milestone. |

```bash
lumo milestone summary "Q3 Launch"
lumo milestone summary "Q3 Launch" --retry
lumo milestone summary 11111111-2222-3333-4444-555555555555
```

When to suggest: user asks "summarize the milestone", "milestone retro", "give me a summary of the Q3 milestone", "里程碑总结", "里程碑复盘".

## Document Management

### `lumo doc create [title] [flags]` — create a new document

Use this when the user wants to write a new document from the terminal. Title is positional and optional. When omitted, the doc title defaults to empty (server renders as "Untitled" via i18n).

| Flag               | Type                | Notes                                                                                                            |
| ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--content <text>` | string              | Inline markdown body.                                                                                            |
| `--file <path>`    | string              | Read markdown body from file.                                                                                    |
| (stdin)            | —                   | Pipe markdown; treated as content when stdin is not a TTY.                                                       |
| `--scope <scope>`  | enum                | `personal` (default) or `workspace`. Maps to PRIVATE / WORKSPACE.                                                |
| `--project <ref>`  | string              | Project name or slug to file under. Default null. (Note: v1 does not server-resolve names; pass a cuid or omit.) |
| `--task <LUM-N>`   | string              | Bind to this task immediately after create.                                                                      |
| `--tag <name>`     | string (repeatable) | Attach tag by name. Creates tag if missing. Max 20 per call.                                                     |
| `--tag-id <cuid>`  | string (repeatable) | Attach tag by id. Combines with `--tag`. Max 20 per call.                                                        |
| `--parent <doc>`   | string              | cuid or case-insensitive title. Files the new doc under this parent. Omit for root.                              |

The three content channels (`--content`, `--file`, stdin) are mutually exclusive — specify at most one. **`--file` is sandboxed:** the CLI rejects a path that resolves outside the current project directory (parent-traversal, absolute, escaping symlinks) or matches a sensitive-file denylist (`.env*`, private keys, `*.pem`/`*.key`, `credentials`, `.ssh`/`.aws` contents, …). Pass only project-local, non-secret files; there is no override flag.

Examples:

```bash
lumo doc create "RFC: doc CLI" --scope workspace --file scratch/rfc.md --task LUM-66
lumo doc create "RFC: tags" --tag rfc --tag draft
lumo doc create "Design spec" --tag-id clm_abc123 --tag draft
lumo doc create "Sub-doc" --parent "RFC"
```

Success output:

```
Created cmd_xxx "RFC: doc CLI"  https://www.uselumo.ai/workspace/lumo/documents/rfc-doc-cli-42
Tags: rfc, draft
```

The cuid (`cmd_xxx`) is still printed as a stable identifier you can pass back into other `lumo doc ...` commands; the URL switched to the per-workspace slug shape (`slugify(title)-<number>`) and the cuid is no longer a valid web URL.

The `Tags:` line is omitted when no tags were attached.

### When to suggest `doc create`

- User says "write a doc", "起一篇 RFC", "新建文档", or describes a deliverable that should live as a document.
- After a discussion that needs a write-up, offer to create the doc with a title and the right scope.

### `lumo doc update <doc> [flags]` — update a document

`<doc>` accepts a cuid or a case-insensitive title. Ambiguous titles fail with a candidate list — re-run with the cuid.

| Flag                     | Type                | Notes                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--title <text>`         | string              | New title (cannot be empty).                                                                                                                                                                                                                                          |
| `--content <text>`       | string              | Replace content (inline).                                                                                                                                                                                                                                             |
| `--file <path>`          | string              | Replace content from file.                                                                                                                                                                                                                                            |
| (stdin)                  | —                   | Pipe to replace content.                                                                                                                                                                                                                                              |
| `--scope <scope>`        | enum                | `personal` / `workspace`.                                                                                                                                                                                                                                             |
| `--project <ref>`        | string              | Project name/slug. `--project ""` clears the filing.                                                                                                                                                                                                                  |
| `--tag <name>`           | string (repeatable) | **Bulk replace** the tag set by name. Creates tag if missing. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                                                                                                                         |
| `--tag-id <cuid>`        | string (repeatable) | **Bulk replace** the tag set by id. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                                                                                                                                                   |
| `--add-tag <name>`       | string (repeatable) | Attach tag by name (find-or-create). Max 20.                                                                                                                                                                                                                          |
| `--add-tag-id <cuid>`    | string (repeatable) | Attach tag by id. Max 20.                                                                                                                                                                                                                                             |
| `--remove-tag <name>`    | string (repeatable) | Detach tag by name. `--remove-tag <name>` resolves the name via find-or-create on the workspace. If the name was unknown, a new Tag row is created (orphan, no attachments) before the detach runs as a no-op. Use `--remove-tag-id <cuid>` to avoid orphans. Max 20. |
| `--remove-tag-id <cuid>` | string (repeatable) | Detach tag by id. Unknown ids are a no-op (no side effects). Max 20.                                                                                                                                                                                                  |

`--tag` / `--tag-id` (bulk replace) are mutually exclusive with `--add-tag` / `--add-tag-id` / `--remove-tag` / `--remove-tag-id`. The CLI errors before any network call if both families are mixed.

Like `doc create`, `--file` is sandboxed: the CLI rejects paths that resolve outside the project directory or match the sensitive-file denylist (`.env*`, private keys, `credentials`, …). No override flag.

Examples:

```bash
lumo doc update "RFC: doc CLI" --scope personal
lumo doc update cmd_xxx --title "RFC v2"
lumo doc update cmd_xxx --file rfc-v2.md
lumo doc update RFC --add-tag urgent --remove-tag draft
lumo doc update cmd_xxx --tag final --tag approved   # replace entire tag set
lumo doc update RFC --tag final --add-tag oops
# Error: --tag/--tag-id are mutually exclusive with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id
```

### When to suggest `doc update`

- User wants to revise an existing doc.
- After running `lumo doc list` or `doc show`, if the user wants to change a doc's scope, title, or content.

### `lumo doc show <doc>` — print one document's detail

Prints a key:value header (id, title, scope, project, created/updated timestamps, mentioned tasks) and the content rendered back to markdown.

```bash
lumo doc show "RFC: doc CLI"
```

Note: the markdown rendered by `doc show` is best-effort. Round-trip via `doc show > tmp.md && doc update --file tmp.md` is NOT guaranteed to be a no-op.

Use when the user wants the current state or content of a doc without loading full task context.

### `lumo doc list [flags]` — list documents

Default behavior: lists every document the current user can see, as fixed-width rows: `<cuid>  <SCOPE>  <project|->  <title>`.

| Flag              | Type    | Notes                                                                                  |
| ----------------- | ------- | -------------------------------------------------------------------------------------- |
| `--scope <scope>` | enum    | `personal`, `workspace`, or `all`. Default `all`.                                      |
| `--project <ref>` | string  | Filter by project.                                                                     |
| `--task <LUM-N>`  | string  | Only docs bound to this task. Routes through `GET /api/tasks/<id>/documents`.          |
| `--limit <n>`     | int     | Cap output to the first N rows.                                                        |
| `--tree`          | boolean | Render as an indented tree (two spaces per depth level) instead of the flat row table. |

`--tree` plus the existing filters work together: the CLI fetches with the filters applied, then builds the tree from whatever rows came back. Docs whose parent is **not** in the result (e.g. filtered out by `--task LUM-N`) render as top-level rows. `--limit N --tree` truncates the flat list to N rows _before_ the tree is built, so a deeply nested subtree may not appear contiguously.

When `--task` is combined with `--scope` / `--project`, those become client-side filters on the task-scoped result.

Examples:

```bash
lumo doc list --scope workspace
lumo doc list --task LUM-42
lumo doc list --scope workspace --tree
```

### When to suggest `doc list`

- The user asks "what docs do I have", "show me workspace docs", "what's on LUM-42".
- Before suggesting `doc update` or `doc delete` when no doc ID is in context — run `doc list` first to surface candidates.

### `lumo doc move <doc> [flags]` — move a doc under a different parent or to root

Reparents a doc. `<doc>` accepts a cuid or a case-insensitive title; ambiguous titles fail with a candidate list — re-run with the cuid.

| Flag             | Type    | Notes                                            |
| ---------------- | ------- | ------------------------------------------------ |
| `--parent <doc>` | string  | New parent doc (cuid or case-insensitive title). |
| `--root`         | boolean | Move to top level (`parentId = null`).           |

`--parent` and `--root` are **mutually exclusive** and one of them is **required**. CLI errors before any network call if both or neither is supplied.

The new `sortOrder` is computed CLI-side as `max(sibling.sortOrder) + 1` — the moved doc lands at the end of its new sibling list. Reordering among siblings (`--before` / `--after`) is not yet supported; for now use the Web UI to reorder.

Examples:

```bash
lumo doc move "Sub-doc" --parent "Roadmap"
lumo doc move "Sub-doc" --root
lumo doc move cmd_xxx --parent cmd_yyy
```

Output:

```
Moved cmd_xxx "Sub-doc" → "Roadmap"
Moved cmd_xxx "Sub-doc" → root
```

### When to suggest `doc move`

- User says "move doc X under Y", "把文档 X 挂到 Y 下", "reparent X to root", "promote X to top level".
- After `doc create`, if the user realizes the new doc should live elsewhere in the tree — suggest `doc move` rather than recreating.

### `lumo doc delete <doc> --yes` — delete a document

Requires `--yes`; no interactive prompt (agent-friendly).

```bash
lumo doc delete cmd_xxx --yes
```

### `lumo doc bind <doc> <task>` — bind a doc to a task

Adds an explicit DocumentMention row. Survives content edits in the Web UI. If a CONTENT-derived mention already exists for the same pair, it's upgraded to EXPLICIT so a later `unbind` can remove it.

Output:

```
Bound cmd_xxx ↔ LUM-42
Bound cmd_xxx ↔ LUM-42 (upgraded from content)   # when upgrading a CONTENT row
Already bound cmd_xxx ↔ LUM-42                   # idempotent
```

### `lumo doc unbind <doc> <task>` — unbind a doc from a task

Removes EXPLICIT mentions only. A purely CONTENT-derived mention can't be unbound from CLI — fails with 409 and a message instructing the user to remove the @LUM-N from the doc body in the Web UI.

```bash
lumo doc unbind cmd_xxx LUM-42
```

### `lumo doc share <doc> <member> [--role viewer|editor|manager]` — share with a workspace member

Adds (or updates) a DocumentShare row for the given member. `<member>` resolves the same way as `task --assignee`: `me`, an email, or a display name (case-insensitive). Role defaults to `viewer`.

**Auto-promotion**: when invoked on a PRIVATE doc, server-side transactionally flips the doc's visibility to SHARED before upserting the share row. No flag needed — sharing a doc is treated as expressing the intent that it should be SHARED.

Examples:

```bash
lumo doc share "RFC" alice@example.com --role editor
lumo doc share cmd_xxx "Alice Wong" --role manager
lumo doc share cmd_xxx me                        # share with yourself (rare; mostly for testing)
```

Output:

```
Shared cmd_xxx ↔ Alice Wong (EDITOR)
```

A second invocation with a different role updates the existing row in place (upsert semantics).

### `lumo doc unshare <doc> <member>` — remove a member's share

Idempotent. If the member has no share row, prints `Not shared with <name>` and exits 0.

```bash
lumo doc unshare "RFC" alice@example.com
# → Unshared cmd_xxx ↔ Alice Wong
```

Unshare does **not** flip visibility back to PRIVATE — that has to be done explicitly via `lumo doc update --scope personal`.

### `lumo doc share-list <doc>` — list current shares

Prints fixed-width rows: `<displayName>  <ROLE>`. Empty output means the doc has no shares (it may still be WORKSPACE-visible).

```bash
lumo doc share-list "RFC"
# Alice Wong   EDITOR
# Bob Chan     VIEWER
```

### When to suggest the doc share commands

- User says "share doc X with Y", "give Y access to X", "把文档分享给 Y"
- After `doc create --scope personal`, if the user mentions teammates needing access, suggest `doc share` rather than `doc update --scope workspace` when only specific members should see it
- Before `doc unshare`, run `doc share-list` if the user hasn't named a specific member

### `lumo doc import-gdoc <url> [--scope personal|workspace] [--task LUM-N]` — import a Google Doc

One-way import of a Google Doc into Lumo. The doc is exported from Google as markdown and turned into a native Lumo document (markdown → HTML), storing the source `googleDocId` and importer so it can be re-synced later (`lumo doc sync`). `<url>` accepts a Google Doc URL or a bare doc id.

| Flag              | Type   | Notes                                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------------------------ |
| `--scope <scope>` | enum   | `personal` (→ PRIVATE) or `workspace` (→ WORKSPACE). Omit to use the server default scope. |
| `--task <LUM-N>`  | string | Bind the imported doc to this task immediately after import.                               |

**Over-share note:** once imported, the content follows **Lumo's** sharing model (PRIVATE / SHARED / WORKSPACE) and is **no longer gated by Google permissions**. Importing a `workspace`-scoped doc can therefore expose it to everyone in the workspace even if the Google Doc was restricted — the command prints this reminder on success.

Requires a connected Google Drive integration; connect it in the Web UI at `/settings/integrations`. There is no CLI `google auth` command.

```bash
lumo doc import-gdoc "https://docs.google.com/document/d/<id>/edit"
lumo doc import-gdoc "https://docs.google.com/document/d/<id>/edit" --scope workspace --task LUM-127
```

Output:

```
Imported cmd_xxx "Quarterly Plan"  https://www.uselumo.ai/workspace/lumo/documents/quarterly-plan-42
Note: imported content follows Lumo sharing and is no longer gated by Google permissions.
Bound cmd_xxx ↔ LUM-127
```

The `Bound ... ↔ LUM-N` line appears only when `--task` is supplied.

### When to suggest `doc import-gdoc`

- User pastes a Google Doc URL or says "import this Google Doc", "pull this gdoc into Lumo", "把这篇 Google 文档导入".
- User wants a Google Doc tracked alongside Lumo tasks/docs — suggest import (with `--task LUM-N` if a task is in context) and remind them about the over-share semantics for `--scope workspace`.

### `lumo doc sync <doc>` — re-sync an imported doc from Google

Re-imports a previously imported Google Doc and **overwrites the Lumo body** with the current Google content. **One-way and destructive** — any edits made to the doc inside Lumo are discarded; Google is the source of truth for synced docs.

Sync always runs as the **importer** (owner model): it re-exports using the importer's stored Google token, not the token of whoever runs the command. If the importer has lost access to the Google Doc, sync fails with a clear error.

`<doc>` accepts a doc cuid or a case-insensitive title; ambiguous titles fail with a candidate list — re-run with the cuid.

```bash
lumo doc sync cmd_xxx
lumo doc sync "Quarterly Plan"
```

Output:

```
Synced cmd_xxx "Quarterly Plan" from Google
```

### When to suggest `doc sync`

- User says "re-sync the Google Doc", "pull the latest from Google", "refresh the imported doc", "更新一下从 Google 导入的文档".
- After the user mentions the Google Doc changed upstream. Warn first that local Lumo edits to that doc will be overwritten (one-way, destructive).

### Out of scope (CLI v1)

The CLI does **not** currently support:

- `--from-editor` (interactive $EDITOR).
- Lossless markdown round-trip.
- Reordering siblings within the same parent (`--before` / `--after`); use the Web UI for that.

### When to suggest session binding for docs

If user creates a doc with `--task LUM-N` and the current Claude Code session is not bound, suggest `lumo session attach LUM-N` so subsequent hook events also tag that task.

## Sprint Management

### `lumo sprint list [flags]` — list sprints in a team

Prints fixed-width rows: `<NUMBER>  <STATUS>  <start>  <end>  <name>`, sorted newest-first (server sort).

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

When to suggest: user says "create a sprint", "new sprint", "新建冲刺", "start a new iteration".

### `lumo sprint show <identifier> [--team <ref>]` — show sprint detail + task table

`<identifier>` accepts a sprint number (e.g. `3`) or a UUID. `--team` is required when using a number in a multi-team workspace.

Output: key:value header (number, name, status, dates, team) followed by a task table listing every task in the sprint.

```bash
lumo sprint show 3
lumo sprint show 3 --team backend
lumo sprint show 11111111-2222-3333-4444-555555555555
```

When to suggest: user asks "what's in sprint 3", "show me the current sprint", "冲刺里有什么", "what tasks are in this sprint".

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

### `lumo sprint delete <identifier> --yes` — delete a sprint (DRAFT only)

Requires `--yes`; no interactive prompt (agent-friendly). Server rejects with an error if the sprint is ACTIVE or CLOSED.

```bash
lumo sprint delete 3 --yes
```

When to suggest: user wants to remove a draft sprint that was created by mistake.

### `lumo sprint start <identifier>` — transition DRAFT → ACTIVE

No additional flags. Fails if the sprint is already ACTIVE or CLOSED.

```bash
lumo sprint start 3
```

When to suggest: user says "start the sprint", "开始冲刺", "kick off sprint 3", "activate sprint".

### `lumo sprint close <identifier> [flags]` — transition ACTIVE → CLOSED

Handles unfinished tasks based on flags. Without flags: closes only if all tasks are done; otherwise prints a list of unfinished tasks and refuses.

| Flag            | Type    | Notes                                                                            |
| --------------- | ------- | -------------------------------------------------------------------------------- |
| `--move-all`    | boolean | Move all unfinished tasks to the next sprint. Requires `--yes`.                  |
| `--backlog-all` | boolean | Remove all unfinished tasks from the sprint (send to backlog). Requires `--yes`. |
| `--yes`         | boolean | Required when `--move-all` or `--backlog-all` is given.                          |

```bash
lumo sprint close 3                          # fails if unfinished tasks exist
lumo sprint close 3 --move-all --yes         # move unfinished to next sprint
lumo sprint close 3 --backlog-all --yes      # send unfinished to backlog
```

When to suggest: user says "close the sprint", "关闭冲刺", "end sprint 3", "wrap up the sprint". If they haven't decided what to do with unfinished tasks, ask before adding `--move-all` or `--backlog-all`.

### `lumo sprint summary <identifier> [--retry]` — fetch AI-generated sprint retro

Prints the AI-generated retrospective summary for the sprint. A 404 response means no summary has been generated yet ("no summary yet").

| Flag      | Type    | Notes                                             |
| --------- | ------- | ------------------------------------------------- |
| `--retry` | boolean | Queue a regeneration (async, server returns 202). |

```bash
lumo sprint summary 3
lumo sprint summary 3 --retry
```

When to suggest: user asks "summarize the sprint", "sprint retro", "give me a summary of sprint 3", "冲刺总结".

### `lumo sprint add <identifier> <task>` — bind a task to a sprint

Adds `<task>` (e.g. `LUM-48`) to the sprint. Same-team check applies — the task's team must match the sprint's team.

```bash
lumo sprint add 3 LUM-48
```

When to suggest: user says "add LUM-48 to sprint 3", "把任务挂到冲刺", "put this task in the sprint".

### `lumo sprint remove <identifier> <task>` — unbind a task from a sprint

Removes `<task>` from the sprint. Idempotent — if the task is not in the sprint, the server returns success.

```bash
lumo sprint remove 3 LUM-48
```

When to suggest: user says "remove LUM-48 from the sprint", "take this task out of sprint 3", "move task to backlog".

## Memory management

Record and curate the long-term Memory that Claude reads on future sessions.
Memories are scoped **TASK** (useful only for one task) or **PROJECT** (useful
across the whole project). Automated extraction (layer1) and promotion (layer2,
on task→done) already run; these commands are the manual override.

### Commands

```bash
# List
lumo task memory list [LUM-N] [--category trap|decision|convention|procedural] [-n N]
lumo project memory list [<project>] [--category ...] [-n N]

# Add (per-category fields; <task>/<project> default to the session-bound task)
lumo task memory add [LUM-N] --category trap --trigger "..." --outcome "..." [--workaround "..."] [--agent <agent>]
lumo task memory add [LUM-N] --category decision --what "..." --why "..." [--alternatives "..."] [--implications "..."] [--agent <agent>]
lumo task memory add [LUM-N] --category convention --rule "..." --applies "..." [--agent <agent>]
lumo task memory add [LUM-N] --category procedural --workflow "..." --trigger "..." [--step "..." --step "..."] [--agent <agent>]
lumo project memory add [<project>] --category ... [--agent <agent>]   # same flags; records at PROJECT scope

# --agent values: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (default claude-code)
# Aliases: gemini → gemini-cli, copilot → github-copilot (case-insensitive)
# Omitting --agent records the memory as produced by Claude Code.

# Single-memory ops (memoryId from `... memory list` column 1)
lumo memory promote <memoryId>     # TASK → PROJECT
lumo memory rm <memoryId> --yes    # hard delete
```

When the session is bound (`lumo session attach <LUM-N>`), omit the identifier:
`lumo task memory add --category trap --trigger ... --outcome ...` records onto
the bound task; `lumo project memory add ...` records onto its project.

### When to record a memory (worthiness)

Record only knowledge that is **invisible in the codebase** — the _why_ behind a
choice, a gotcha that only surfaces at runtime, a rule that lives in people's
heads, a non-obvious failure cause, a non-trivial workflow. **Skip** routine work
(reading files, plain edits, normal git, successful builds) and anything a
developer could learn from the source, git log, or docs. When unsure, don't.

### Which category

- `trap` — a pitfall. Describe the PROBLEM ONLY (`--trigger`, `--outcome`); put any fix in a separate `procedural`.
- `decision` — an engineering decision (`--what` + `--why`, optional `--alternatives`/`--implications`).
- `convention` — a team rule (`--rule` + `--applies` = where it applies).
- `procedural` — a reusable workflow (`--workflow` + `--trigger` + `--step`…).

### TASK vs PROJECT (at add time)

Default to **TASK** (`lumo task memory add`). Record directly to **PROJECT**
(`lumo project memory add`) only when it helps _any_ task in the project: a
toolchain/environment trap, a team-wide convention, a cross-task decision. When
unsure → TASK.

### When to promote (TASK → PROJECT)

`lumo memory promote <id>` only when the lesson **recurs across 2+ different
tasks**, would help a _different_ task, and no equivalent PROJECT memory exists.
A wrong promotion is costly (every agent sees it forever) — prefer leaving it at TASK.

### When to reach for this

After a non-trivial debugging session, a pitfall you hit, or establishing a
convention → consider `lumo task memory add`. When you notice a lesson recurring
across multiple tasks → consider `lumo memory promote`.

## Session Management

### Auto-bind at session start (from local git)

When a session starts **without** a bound task, the `session-start` hook tries to
infer the task from local git before falling back to the "请告诉我任务编号" prompt:

- It reads the **current branch name** first (e.g. `lumo/LUM-145-...`), then the
  **most recent commit subjects** (e.g. `... [LUM-145]`), extracting the first
  `LUM-<n>`.
- On a hit it binds the session to that task automatically (same `bind-task`
  endpoint as `session attach`) and prints a single line:
  `已自动绑定 LUM-145 - <title>（依据分支名/最近 commit）。如果不对，回复"不是"我就帮你解绑。`
  The freshly-bound task's memory is injected too.
- No match (detached HEAD, a non-lumo branch with no tagged commits, not a git
  repo) or a failed bind (unknown task) → it degrades silently to the normal
  unbound prompt.

**Agent guidance:** if the user responds "不是" / "不对" / "wrong task" to an
auto-bind line, run `lumo session detach` to clear the binding (then `session
attach <LUM-N>` if they name the right one). No detach is needed when the
auto-bound task is correct.

### `lumo session attach <identifier>` — bind the current session to a task

Use this whenever the user mentions a task ID. The command is the only way to bind a session to a task.

```bash
lumo session attach LUM-42
```

What it does:

- Reads `CLAUDE_CODE_SESSION_ID` from the environment (Claude Code sets this automatically). If it is not set, the command errors out — it must run from inside a Claude Code session.
- Calls `POST /api/sessions/<session_id>/bind-task` on the Lumo server, which sets the Session row's `taskId` and re-tags previously-untagged HookEvent rows in this session.
- The binding lives entirely on the server (`Session.taskId`); subsequent hooks read it back via the session row. The CLI keeps no local sentinel.

**After attaching, always run `lumo task context <identifier>` to load the task background.**

### Parallel sessions

Each Claude Code session has its own `CLAUDE_CODE_SESSION_ID`. Two terminals running `claude code` and binding to different tasks will not interfere with each other — the bindings are scoped per session row server-side.

### `lumo session status` — show current binding

Prints which task the current Claude Code session is bound to, or "(no task)" if none. Requires `$CLAUDE_CODE_SESSION_ID` (i.e. must run inside Claude Code).

```bash
lumo session status
```

When to suggest: the user asks "which task am I on", "what's this session bound to", or you need to decide whether to suggest `session attach` for a mentioned task ID.

### `lumo session detach` — clear the current binding

Idempotent — running it twice is fine, the second call reports `already unbound`. Past hook events keep their original `taskId`; only future events on this session will be untagged.

```bash
lumo session detach
```

When to suggest: the user wants to stop tagging the current session with the active task (e.g., switching to unrelated exploratory work without binding to a different task).

### `lumo session wrap [--yes] [--dry-run]` — draft + post a progress comment at wrap-up

Session-end wrap-up panel. Reads back the current Claude Code session's per-turn
`turnSummary` rows (the one-line Chinese summaries written each STOP), aggregates
every turn **since the last progress comment** into one bulleted body, and — after
a `[y] 发送 / [e] 编辑 / [s] 跳过` confirmation — posts it as a comment on the
session's bound task. A server-side watermark (`Session.lastProgressCommentAt`)
means re-running never re-posts the same turns.

```bash
lumo session wrap            # interactive: preview draft, choose y / e / s
lumo session wrap --yes      # post the drafted body without prompting (agent-friendly)
lumo session wrap --dry-run  # print the draft only; never posts, never advances watermark
```

- Requires `$CLAUDE_CODE_SESSION_ID` (must run inside Claude Code) and a bound
  task (`lumo session attach <LUM-N>` first). With no bound task or no new turn
  summaries, the panel prints "(无内容)" and posts nothing.
- `[e] 编辑` opens `$EDITOR` (fallback vi/nano) on the drafted body; the edited
  text is posted and the watermark still advances to the turns the draft covered.
- Non-TTY without `--yes`: prints the draft and does **not** post (safe default).

When to suggest: at the end of a working session on a bound task, to record what
was done as a progress comment — offer `lumo session wrap` rather than composing
a `task comment` by hand.

### When to suggest session binding

- If the user mentions a task ID (e.g., "let's work on LUM-42") and no session is currently bound, **suggest running `lumo session attach`**.
- If the user switches tasks mid-session, run `attach` with the new task ID — the server overwrites the existing binding atomically.

## Workflow Example

Typical flow when a user says "help me with LUM-42":

1. Run `lumo session attach LUM-42` to bind this session
2. Run `lumo task context LUM-42` to load background
3. Review unresolved items and task description
4. Begin working on the task
