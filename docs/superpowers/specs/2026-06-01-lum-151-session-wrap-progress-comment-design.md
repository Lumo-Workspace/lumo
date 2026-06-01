# LUM-151 — 把已生成的 turnSummary 回写成任务进度评论

**Date**: 2026-06-01
**Task**: LUM-151 (Milestone: Claude Code 集成体验升级)
**Status**: Design approved

## 背景与问题

turnSummary 生成链路已现成:每轮 STOP / STOP_FAILURE hook 通过 `waitUntil` 跑一次
Haiku,把单行中文总结写进 `HookEvent.turnSummary`
([turn-summary.service.ts](../../../lib/services/turn-summary/turn-summary.service.ts) `generateAndStore()`,
[stop/route.ts](../../../app/api/hooks/stop/route.ts))。session 级结构化 summary 也已入库
(`Session.summary` / `summaryType`)。任务评论写入链路也现成
(`POST /api/tasks/{id}/comments` → [comment.service.ts](../../../lib/services/comment.service.ts))。

**缺口("最后一公里")**:turnSummary 写库后从没被读回来发成评论;`session-end` hook 是空 handler。

**关键架构现实**:Claude Code 的 hook 是非交互的 fire-and-forget POST(3s 超时,只有
`session-start` 把 stdout 喂回 agent)。`session-end` 触发时会话正在终止,没有 agent 回合能
向用户提问 "y/编辑/跳过"。因此"草拟 + 确认"不能塞进 session-end hook 本身,必须由**显式
CLI 命令**驱动。

## 决策记录

| 决策           | 选择                                         | 理由                                                        |
| -------------- | -------------------------------------------- | ----------------------------------------------------------- |
| 确认交互形态   | 显式 CLI 命令 `lumo session wrap`            | hook 不可交互;命令最可控、不受 3s 时限                      |
| 实现范围       | LUM-151 独立 + 预留"多 section 收尾面板"接缝 | 最快落地;LUM-152 的 memory 审阅 section 以后即插即用,不返工 |
| 评论正文数据源 | 汇总本会话所有 `turnSummary`                 | 信息最全、最像"进度更新";只需读回 `HookEvent.turnSummary`   |
| "编辑"实现     | 打开 `$EDITOR`(fallback vi/nano)             | 支持多行;符合"编辑进度文案"真实需求                         |
| 防重发         | 服务端 watermark(Session 加一列)             | 跨机器一致、最稳;接受一次很小的非破坏迁移                   |
| watermark 字段 | `lastProgressCommentAt DateTime?`(时间戳)    | 比 eventId 简单;STOP 事件时间戳几乎不会撞                   |
| 命令归属       | `session` 子命令下 `session wrap`            | 与 `session attach/status/detach` 一致                      |

## 数据流

```
CLI `lumo session wrap`
  → API Client (getSessionProgressDraft / postSessionProgressComment)
  → API Route (GET turn-summaries draft / POST progress-comment)
  → Service (turnSummary 读回 + session watermark)
  → Repository (HookEvent / Session)
  → Prisma
```

## 服务端设计

### Schema 迁移(非破坏性)

`Session` 增加可空列:

```prisma
lastProgressCommentAt DateTime?
```

进度评论 watermark。`migrate dev` 生成迁移;PR 描述注明 prod 需 `migrate deploy`(仅新增可空列,
无数据删除)。

### Repository

- `hookEventRepository.findTurnSummariesBySession(sessionId: string, since?: Date)`
  → 按 `createdAt` 升序返回该 session 中 `turnSummary` 非空的 STOP / STOP_FAILURE 事件
  `{ id, turnSummary, createdAt }[]`;当 `since` 给定时过滤 `createdAt > since`。
  使用 `select` 仅取需要字段。
- `sessionRepository.setLastProgressCommentAt(sessionId: string, at: Date)`。

### Service(`turnSummaryService`,turnSummary 域归属)

- `getSessionProgressDraft(sessionId: string)`:
  1. 读 session 行(取 `lastProgressCommentAt`、`taskId` + 关联 task 的 identifier/title)。
  2. 调 `findTurnSummariesBySession(sessionId, lastProgressCommentAt ?? undefined)`。
  3. 返回 `{ taskId, taskIdentifier, taskTitle, summaries: {id, turnSummary, createdAt}[], watermark }`,
     其中 `watermark` = 最新一条 summary 的 `createdAt`(ISO 字符串);无任务绑定或无新增时
     summaries 为空(由 route/CLI 处理空态)。

### Routes(thin:auth → service → response)

- `GET /api/sessions/[id]/turn-summaries`
  → 返回 draft 负载(上面的对象)。`id` = Claude Code session UUID。
- `POST /api/sessions/[id]/progress-comment`,body `{ body: string, watermark: string }`
  → **一次调用内完成**:
  1. 解析 session → 绑定 task(无绑定 → 400/422 带清晰报错)。
  2. `commentService.createCommentWithSideEffects({ body, ... })` 发评论。
  3. `sessionRepository.setLastProgressCommentAt(sessionId, new Date(watermark))` 推进 watermark。
  4. 返回 `{ commentId }`。
  - body 可能被用户在 `$EDITOR` 改过,所以服务端**不从 body 反推**覆盖了哪些 turn;watermark
    由 CLI 从 draft 原样带回(= 草拟时最新 STOP 的 `createdAt`)。
  - 评论创建 + watermark 推进尽量同事务/顺序执行,保证不出现"发了评论但 watermark 没推进"
    导致下次重复草拟的孤儿态。
  - body 走 `createCommentSchema` 校验(1–5000 字)。

## CLI 设计

### 收尾面板骨架(为 LUM-152 预留接缝)— `cli/src/lib/wrap-panel.ts`

```ts
interface WrapSectionDraft {
  // section 自描述的草稿;null 表示本 section 无内容,runner 跳过
}

interface WrapSection {
  id: string
  title: string
  collectDraft(ctx: WrapContext): Promise<WrapSectionDraft | null>
  runInteraction(draft: WrapSectionDraft, opts: WrapRunOpts): Promise<void>
}
```

`runWrapPanel(sections, ctx, opts)`:顺序遍历 sections,对每个先 `collectDraft`;为 null 则打印
"(无内容)"跳过,否则 `runInteraction`。runner 统一处理 TTY / 非 TTY / `--yes` 语义。
v1 只注册 `ProgressCommentSection`。LUM-152 以后加 `MemoryReviewSection`,零返工。

### 命令 — `cli/src/commands/session-wrap.ts`

`lumo session wrap [--task LUM-N] [--yes] [--dry-run]`

- 读 `$CLAUDE_CODE_SESSION_ID`(缺失 → 报错,必须在 Claude Code 内运行)。
- 默认对 session 绑定任务操作;`--task` 覆盖目标任务。
- 构建 section 列表(v1 = `[ProgressCommentSection]`),调 `runWrapPanel`。
- 注册到 commander 的 `session` 子命令树。

### ProgressCommentSection — `cli/src/commands/wrap/progress-comment-section.ts`

- `collectDraft`:调 `getSessionProgressDraft(sessionId)`。
  - 无绑定任务 或 无新增 summary → 返回 `null`(面板打印"无新进度可发")。
  - 否则拼装正文,返回 `{ body, watermark, taskIdentifier }`。
- 正文格式:
  ```
  本次会话进度
  - <turnSummary 1>
  - <turnSummary 2>
  ```
- `runInteraction`:
  - 打印预览(turnSummary 是服务端自由文本 → 经 `sanitizeField()` 再进 stdout,防 ANSI 注入)。
  - 提示 `[y] 发送  [e] 编辑  [s] 跳过`。
  - `y` → `postSessionProgressComment(sessionId, { body, watermark })`。
  - `e` → 打开 `$EDITOR` 编辑 → 再确认 → POST(发送时用编辑后的 body,watermark 不变)。
  - `s` → 不发,watermark 不推进。
- 发给评论 API 的 body 用**原文**(不做 sanitize;sanitize 只用于终端预览)。

### 辅助

- `cli/src/lib/editor.ts`:写临时文件 → spawn `$EDITOR`(fallback `vi` → `nano`)→ 读回 → 清理。
  非 TTY / 无可用编辑器 → 降级(打印提示,视作未编辑)。
- api-client 新增:`getSessionProgressDraft(sessionId)`、`postSessionProgressComment(sessionId, { body, watermark })`。

### 非交互 / agent 模式

| 场景                | 行为                                   |
| ------------------- | -------------------------------------- |
| `--yes`             | 直接发草拟正文(不弹 prompt),agent 友好 |
| `--dry-run`         | 只打印草稿,不发、不推进 watermark      |
| 非 TTY 且无 `--yes` | 打印草稿 + 提示,**默认不发**(安全)     |
| `--task LUM-N`      | 覆盖目标任务(默认 = session 绑定任务)  |

## 测试

- **服务端**
  - `findTurnSummariesBySession`:`since` 过滤、只取 STOP/STOP_FAILURE 且 turnSummary 非空、升序。
  - `getSessionProgressDraft`:有/无绑定任务、有/无新增、watermark 计算。
  - `GET /api/sessions/[id]/turn-summaries`、`POST /api/sessions/[id]/progress-comment`(发评论 +
    watermark 推进 + 无绑定报错)。
- **CLI**
  - 正文格式化函数。
  - `runWrapPanel` 三分支:TTY 交互、非 TTY 默认不发、`--yes` 直发(mock api-client)。
  - `ProgressCommentSection.collectDraft` 的 null 分支(无任务 / 无新增)。
- 跑测试前:`npx prisma generate` → `npx tsc --noEmit` → `npm test`。
- 注意 `exactOptionalPropertyTypes`:新增可选字段用 `field?: T | undefined`。

## 收尾事项

- **SKILL.md**:新增 `session wrap` 章节 + frontmatter 触发词(CLAUDE.md 硬性要求:
  改 `cli/src/commands/` 必须同步 `.claude/skills/lumo/SKILL.md`)。
- **PR 描述**:注明 prod 需 `migrate deploy`(新增可空列 `Session.lastProgressCommentAt`,非破坏)。

## 非目标(YAGNI)

- 不做 LUM-152 的 memory 审阅(只预留 section 接缝)。
- 不做 session-end hook 自动弹面板(hook 不可交互)。
- 不做跨会话/历史进度的回溯发送;只处理当前 session 自 watermark 以来的新增。
- 不做评论的富文本 / @-mention 标记(沿用 CLI 纯文本评论)。
