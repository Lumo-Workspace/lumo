---
name: lumo
description: 'Use the Lumo CLI to load task context, manage session bindings, and run tasks / projects / milestones / sprints / docs / memory from the terminal. Activate when: the user mentions a Lumo task identifier (LUM-42 etc.), asks to load task background/context, wants to bind/check/detach a Claude Code session''s task, is about to start work on a task, or wants to create/update/list/show/comment on tasks, projects, milestones, sprints, documents, artifacts, Figma links, or memory. Triggers on: "LUM-", "task context", "load context", "session start", "session attach", "session status", "session detach", "which task", "what task am I on", "work on LUM", "session wrap", "wrap up session", "进度评论", "卡住检测", "create task", "new task", "file a task", "list tasks", "my tasks", "show task", "view task", "comment on task", "update task", "change task status", "rename task", "reassign task", "mark task as done", "lumo next", "next task", "what should I work on", "推荐下一个任务", "list projects", "what projects", "milestone", "里程碑", "list/create/update/delete/show milestone", "set milestone", "attach/unbind milestone", "tasks in milestone", "search milestones", "find milestone", "milestone health", "at-risk", "overdue", "archive/unarchive milestone", "归档里程碑", "milestone summary", "里程碑复盘", "reorder/move milestone", "排序里程碑", "milestone add/remove", "挂任务到里程碑", "auth login", "log in", "logout", "sign out", "switch account", "whoami", "who am I", "current workspace", "登录", "切换账号", "create/update/list/show/delete doc", "write doc", "写文档", "新建文档", "修改文档", "查看文档", "bind/unbind doc", "把文档关联到任务", "doc scope", "personal/workspace doc", "tag", "add/remove tag", "标签", "share/unshare doc", "分享文档", "doc share-list", "viewer/editor/manager", "doc tree", "doc move", "move/reparent doc", "移动文档", "sprint", "冲刺", "迭代", "create/list/show/update/delete sprint", "start/close sprint", "开始/关闭冲刺", "add to sprint", "active sprints", "sprint summary", "冲刺总结", "把任务挂到冲刺", "sprint health", "sprint risk", "is this sprint at risk", "冲刺风险", "冲刺健康度", "sprint blockers", "冲刺阻塞", "lumo update", "upgrade lumo", "升级 lumo", "new lumo version", "lumo setup", "install lumo skill/hooks", "wire up lumo", "set up lumo", "安装 lumo", "配置 lumo", "task artifact", "artifact add/list/show/update/rm", "spec artifact", "record/attach spec", "attach plan", "记录 spec", "查看 artifact", figma, attach figma, figma link, 关联 figma, 设计稿, figma design, "memory", "记忆", "remember", "record a memory", "记一条", "promote memory", "promote to project", "沉淀", "task/project memory", "retrieval", "取全文", "拉全文", "task slack show", "看 thread", "show slack thread", "task web show", "web 正文", "task figma context", "figma metadata", "task comments list", "list comments", "看评论", "task pr show", "查看 PR", "show pr", "PR 详情", "import google doc", "sync google doc", "google drive", "doc import-gdoc", "doc sync", "导入/同步 google 文档", "mark blocked", "blocked tag", "标记 blocked", "stuck", "repeatedly failing", "worktree", "git worktree", "并行 worktree", "scaffold worktree", "新建 worktree", "node_modules 软链", "worktree 隔离", "lumo worktree add/rm/list", "task lineage", "lineage", "causal trail", "审计", "因果链", "成本归因", "trace context".'
---

## Prerequisites

Before running any `lumo` command, verify the CLI is available and authenticated:

```bash
which lumo && lumo whoami
```

- If `lumo` is not found: tell the user to install it (`npm install -g @lumoai/cli`; for monorepo dev, `cd cli && npm install && npm link` also works)
- If `lumo whoami` fails with an auth error: tell the user to run `lumo auth login`
- Do NOT proceed with any lumo commands until both checks pass

## How this skill is organized

The command catalog below is a **map**: it lists every command grouped by domain with a one-line summary. **Detailed flags, examples, output formats, and "when to suggest" guidance live in the `references/` files** — when a user request lands in a domain, **Read the matching reference file before composing the command**. Don't run a command from memory if its flags/edge-cases matter; open the reference first.

| Domain                                                                            | Read this reference                                            |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `setup`, `auth login/logout`, `whoami`, `update`                                  | [references/onboarding.md](references/onboarding.md)           |
| `task context`, retrieval (`slack/web/figma context`, `comments list`, `pr show`) | [references/task-context.md](references/task-context.md)       |
| `task create/update/list/show/comment`, `next`                                    | [references/tasks.md](references/tasks.md)                     |
| `task artifact*`, `task figma*`                                                   | [references/artifacts-figma.md](references/artifacts-figma.md) |
| `project list`, `milestone*`                                                      | [references/milestones.md](references/milestones.md)           |
| `doc*`                                                                            | [references/docs.md](references/docs.md)                       |
| `sprint*`                                                                         | [references/sprints.md](references/sprints.md)                 |
| `task/project memory`, `memory promote/rm`                                        | [references/memory.md](references/memory.md)                   |
| `session attach/status/detach/wrap`, git-suggest on start, Layer-2 review         | [references/sessions.md](references/sessions.md)               |
| `worktree add/rm/list` (local dev tooling)                                        | [references/worktree.md](references/worktree.md)               |

## Command catalog

**Onboarding / auth / update** — see [onboarding.md](references/onboarding.md)

- `lumo setup [--user|--project] [--force] [--agent <token>]` — install skill files + hooks
- `lumo auth login` / `lumo auth logout` — paste an API key / clear credentials
- `lumo whoami` — show current identity (email, workspace, key)
- `lumo update` — upgrade the CLI to the latest npm release

**Task context & retrieval** — see [task-context.md](references/task-context.md)

- `lumo task context <id>` — load task background (memory, source cards, PR review todos, prior sessions)
- `lumo task slack show <id> <contextId>` — full stored Slack thread
- `lumo task web show <id> <linkId>` — fetched web link body
- `lumo task figma context <id> <linkId>` — Figma link metadata (v1)
- `lumo task comments list <id>` — full comment thread (read-only; ≠ `task comment`)
- `lumo task pr show <id> <number>` — synced PR metadata (v1)
- `lumo task lineage <id>` — show the causal trail: fragments that fed the task + each one's outcome + the run's token/loop cost (read-only audit view)

**Tasks** — see [tasks.md](references/tasks.md)

- `lumo task create <title> [flags]` — create a task
- `lumo task update <id> [flags]` — patch status/title/priority/assignee/milestone/sprint/tags
- `lumo task list [flags]` — list tasks assigned to you
- `lumo next [--count N]` — recommend the next task to work on (read-only)
- `lumo task show <id>` — print one task's detail
- `lumo task comment <id> <body>` — leave a comment

**Artifacts & Figma** — see [artifacts-figma.md](references/artifacts-figma.md)

- `lumo task artifact add/update/list/show/rm` — record spec/plan products on a task
- `lumo task figma add/list/rm/refresh` — attach & manage Figma designs

**Projects & milestones** — see [milestones.md](references/milestones.md)

- `lumo project list` — list projects (slugs feed `--project`)
- `lumo milestone list/create/show/update/delete` — milestone CRUD (`show` includes a Sprint-coverage section)
- `lumo milestone archive/unarchive` — soft-archive / restore
- `lumo milestone add/remove <id> <task...>` — batch bind/unbind tasks
- `lumo milestone summary [--retry]` — AI retro
- `lumo milestone reorder/move` — manual ordering

**Documents** — see [docs.md](references/docs.md)

- `lumo doc create/update/show/list/delete` — document CRUD
- `lumo doc move` — reparent under a parent / to root
- `lumo doc bind/unbind <doc> <task>` — task linkage
- `lumo doc share/unshare/share-list` — member sharing
- `lumo doc import-gdoc` / `lumo doc sync` — Google Doc import & re-sync

**Sprints** — see [sprints.md](references/sprints.md)

- `lumo sprint list/create/show/update/delete` — sprint CRUD (`show` includes Progress / Health / Blockers)
- `lumo sprint start/close` — status transitions (no `--status` flag)
- `lumo sprint add/remove <id> <task>` — bind/unbind a task
- `lumo sprint summary [--retry]` — AI retro

**Memory** — see [memory.md](references/memory.md)

- `lumo task memory add/list` · `lumo project memory add/list` — record/curate Memory (TASK vs PROJECT)
- `lumo memory promote <id>` / `lumo memory rm <id> --yes` — TASK→PROJECT / delete

**Sessions** — see [sessions.md](references/sessions.md)

- `lumo session attach <id>` — bind this session to a task (then run `task context`)
- `lumo session status` / `lumo session detach` — show / clear binding
- `lumo session wrap [--yes] [--dry-run]` — end-of-session panel: progress comment + memory review + blocked-tag prompt
- Git-suggest at session start (suggests `session attach`, never auto-binds) + Layer-2 project-memory review — see the reference

**Worktrees (local dev tooling)** — see [worktree.md](references/worktree.md)

- `lumo worktree add <LUM-N> [slug]` — scaffold `.worktrees/<LUM-N>` + node_modules symlink off origin/main; run from the main checkout
- `lumo worktree rm <LUM-N> --yes` — remove a worktree (keeps the branch unless `--delete-branch`)
- `lumo worktree list` — list `.worktrees/` worktrees (task id, branch, dirty, node_modules link)

## Core workflow

Typical flow when a user says "help me with LUM-42":

1. `lumo session attach LUM-42` — bind this session
2. `lumo task context LUM-42` — load background
3. Review unresolved items, PR-review todos, and the task description
4. Begin working on the task

**Git-suggest at start:** when the session is unbound, session-start may infer the task from the git branch / recent commits and print a suggestion — `检测到 LUM-N … 运行 lumo session attach LUM-N 绑定。` — **without** binding. Confirm it's the right task, then run `lumo session attach <LUM-N>` yourself (binding only happens on an explicit attach). See [sessions.md](references/sessions.md) for the full session-start behavior.
