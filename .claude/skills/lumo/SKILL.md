---
name: lumo
description: 'Use the Lumo CLI to load task context, manage session bindings, inspect projects and milestones, and create/update/list/show/comment on tasks from the terminal. Activate when: user mentions a Lumo task identifier (LUM-42, LUM-12, etc.), asks to load task background or context, wants to bind, check, or detach a Claude Code session''s task binding, is about to start development work on a specific task, wants to create a new task, list their tasks, view a task, comment on a task, list projects, list milestones, attach a task to a milestone, or update a task''s status/title/description/priority/assignee/milestone. Triggers on: "LUM-", "task context", "load context", "session start", "session attach", "session status", "session detach", "bind session", "unbind session", "which task", "what task am I on", "work on LUM", "create task", "new task", "add task", "file a task", "log a task", "list tasks", "my tasks", "show task", "view task", "comment on task", "leave a comment", "list projects", "what projects", "update task", "change task status", "rename task", "reassign task", "mark task as done", "milestone", "里程碑", "list milestones", "set milestone", "挂到 milestone", "attach milestone", "unbind milestone", "create milestone", "new milestone", "update milestone", "change milestone status", "delete milestone", "show milestone", "view milestone", "tasks in milestone", "milestone tasks", "新建里程碑", "更新里程碑", "删除里程碑", "查看里程碑", "auth login", "log in", "login", "auth logout", "log out", "logout", "sign out", "switch account", "switch identity", "whoami", "who am I", "current identity", "current user", "current workspace", "登录", "登出", "切换账号", "当前身份", "create doc", "new doc", "new document", "write doc", "写文档", "新建文档", "update doc", "edit doc", "修改文档", "更新文档", "list docs", "my docs", "我的文档", "show doc", "view doc", "查看文档", "delete doc", "删除文档", "bind doc", "attach doc to task", "把文档关联到任务", "文档绑定到任务", "unbind doc", "解绑文档", "personal doc", "workspace doc", "个人文档", "workspace 文档", "doc scope", "tag", "add tag", "remove tag", "标签", "添加标签", "移除标签", "doc tag", "task tag", "share doc", "doc share", "share document", "分享文档", "文档分享", "unshare doc", "remove share", "取消分享", "share list", "list doc shares", "who has access", "viewer", "editor", "manager", "shared with", "doc tree", "doc move", "move doc", "reparent doc", "文档树", "移动文档", "sprint", "start sprint", "close sprint", "add to sprint", "active sprints", "冲刺", "迭代", "开始冲刺", "关闭冲刺", "create sprint", "new sprint", "list sprints", "show sprint", "update sprint", "delete sprint", "sprint summary", "sprint retro", "把任务挂到冲刺", "冲刺里有什么", "lumo update", "update cli", "upgrade lumo", "update lumo", "upgrade cli", "升级 lumo", "更新 cli", "new lumo version", "是否有新版本", "lumo setup", "install lumo skill", "install lumo hooks", "wire up lumo", "set up lumo", "onboard lumo", "npx @lumoai/cli", "安装 lumo", "配置 lumo", "lumo 初始化", "task artifact", "artifact add", "artifact list", "artifact show", "artifact rm", "artifact delete", "artifact update", "update artifact", "edit artifact", "change artifact kind", "change artifact source", "remove artifact", "delete artifact", "spec artifact", "record spec", "attach spec", "attach plan", "记录 spec", "挂 spec", "查看 artifact", "编辑 artifact", "修改 artifact", "删除 artifact", figma, attach figma, figma link, 关联 figma, 设计稿, figma design.'
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

### `lumo setup [--user|--project] [--force]` — install skill + hooks

Bootstraps Lumo into a Claude Code installation. Copies the bundled `SKILL.md` into `<scope>/.claude/skills/lumo/` and idempotently merges 25 hook entries into `<scope>/.claude/settings.json`. Existing user permissions and non-Lumo hook entries are preserved.

```bash
npx @lumoai/cli setup           # interactive: prompts user/project
npx @lumoai/cli setup --user    # write to ~/.claude/
npx @lumoai/cli setup --project # write to ./.claude/
npx @lumoai/cli setup --force   # overwrite SKILL.md if it differs from bundled
```

Use when:

- The user asks "how do I set up lumo", "install the lumo skill", "wire up lumo hooks"
- A fresh checkout of a project that uses Lumo doesn't have `.claude/skills/lumo/SKILL.md` yet
- After `npm install -g @lumoai/cli`, before the first `lumo auth login`

If stdin is not a TTY (CI, piped invocation), the default scope is `project` and no prompt is shown.

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
3. **Previous sessions** — ordered newest-first, each with:
   - A headline summary of what was done
   - Unresolved items (carry-over TODOs from that session)

### How to use the context

- **Unresolved items** from the most recent session are the highest-priority carry-overs — address them before starting new work unless the user says otherwise
- **Memory section** provides validated context that persists across sessions — use it to avoid re-learning decisions or constraints
- Focus on the **most recent 1–2 sessions** for relevant state; older sessions are for historical reference only
- If there are **no prior sessions**, this is a fresh start — read the task description carefully and ask clarifying questions if needed

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

Milestone updates (`--milestone`) and sprint binding (`--sprint`) both work. Full milestone CRUD is available via `lumo milestone create / show / update / delete` (see below). Full sprint CRUD is available via `lumo sprint create / show / update / delete / start / close / add / remove` (see below).

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

#### `lumo task artifact add <task> --kind <kind> --title <title> --file <path> --source <source>`

Attaches an artifact to a task. `--kind`, `--title`, `--source` are stored verbatim — **`kind` is opaque** (no enumeration; `spec` / `plan` / `requirements` / anything is accepted). `--source` is **required** and names the spec-generation framework that produced the artifact, written as its **formal name** (`Superpowers` / `Spec Kit` / `BMad` / `OpenSpec` / `GSD` / …) — it is also opaque (no enumeration), but there is **no default**, so you must pass it. Quote names that contain spaces (`--source "Spec Kit"`). `--file` supplies the body (file contents). Each call appends to the end of the task's artifact list — call once per artifact (e.g. Superpowers: one `spec`, one `plan`). The `<task>` (e.g. `LUM-42`) is resolved server-side.

```bash
lumo task artifact add LUM-42 --kind spec --title "Spec" --file docs/spec.md --source Superpowers
lumo task artifact add LUM-42 --kind plan --title "Implementation plan" --file docs/plan.md --source "Spec Kit"
```

Output: `Added [spec] "Spec" to LUM-42`

#### `lumo task artifact update <task> <artifact-id> [--kind <kind>] [--title <title>] [--source <source>]`

Patches an existing artifact's metadata in place. Editable fields are **`kind`, `title`, and `source`** only — **content is immutable** (to change the body, `rm` the artifact and `add` it again). At least one flag is required; passing none errors before any network call. Empty values (`--kind ""`) are rejected. The `<artifact-id>` is the cuid in column 1 of `artifact list`.

```bash
lumo task artifact update LUM-42 cma_xxx --kind plan              # re-classify spec → plan
lumo task artifact update LUM-42 cma_xxx --source "Spec Kit"      # fix the framework label
lumo task artifact update LUM-42 cma_xxx --title "Final spec" --source OpenSpec
```

Output: `Updated [plan] "Final spec" (OpenSpec) on LUM-42`. A 404 (task or artifact missing in this workspace) prints the server message and exits 1.

#### `lumo task artifact list <task>`

Lists artifacts on the task in order: `<id>  <kind>  <source>  <title>`. Prints `No artifacts on <task>` when there are none.

```bash
lumo task artifact list LUM-42
```

#### `lumo task artifact show <task> <artifact-id>`

Prints one artifact's key:value header (id, kind, title, source, order, task) followed by the full content body. The `<artifact-id>` is the cuid in column 1 of `artifact list`.

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

The three content channels (`--content`, `--file`, stdin) are mutually exclusive — specify at most one.

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

## Session Management

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

### When to suggest session binding

- If the user mentions a task ID (e.g., "let's work on LUM-42") and no session is currently bound, **suggest running `lumo session attach`**.
- If the user switches tasks mid-session, run `attach` with the new task ID — the server overwrites the existing binding atomically.

## Workflow Example

Typical flow when a user says "help me with LUM-42":

1. Run `lumo session attach LUM-42` to bind this session
2. Run `lumo task context LUM-42` to load background
3. Review unresolved items and task description
4. Begin working on the task
