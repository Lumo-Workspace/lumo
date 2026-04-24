# UserPromptSubmit Hook 全链路 Design

**Date**: 2026-04-23
**Status**: Draft (awaiting user review)
**Scope tag**: Day 6（hook 观测完善 + dogfood）
**Task ID**: LUM-N（待分配）

## 1. 背景与动机

Lumo 目前在 `.claude/settings.json` 里接了三个 Claude Code hook：`PreToolUse` / `PostToolUse` / `Stop`。数据一路经 `lumo hook <path>` CLI → `/api/hooks/<path>` → `hookEventService` → Prisma `HookEvent`（`HookEventType` 枚举 3 项），最终在 `app/sessions/[id]/` 的 Timeline 上渲染。

缺失的那条是 **`UserPromptSubmit`**，也就是"人类开口说话"那个时刻。没有它意味着：

- Timeline 看起来全是 AI 的动作序列（tool 调用、最后 Stop），完全看不到每次对话起点
- session summary 的分类器拿不到最直接的意图信号（用户的原话）
- Day 6 的观察目标之一 —— "一个 session 里有几个 UserPrompt？是否代表不同 task 意图？" —— 没有数据可查

本 spec 覆盖把 `UserPromptSubmit` 加到既有 hook 链路里，**纯观测、不引入任何下游副作用**，并把它在 Timeline 上做显眼展示。dogfood（用 Lumo 做 Day 6 本身）和观察统计（item 6）是产出物之外的使用活动，不在本 spec 的构建范围，但 schema 和 UI 已足够支撑。

## 2. 目标与非目标

### 2.1 In Scope

1. **Prisma schema**：`HookEventType` 枚举新增 `USER_PROMPT_SUBMIT`，生成迁移
2. **`.claude/settings.json`**：新增 `UserPromptSubmit` 钩子配置
3. **CLI**：`lumo hook user-prompt-submit` 子命令；`hook-runner.ts` 的 `HookPath` 联合类型扩展
4. **API route**：新增 `app/api/hooks/user-prompt-submit/route.ts`（5 行，委托 `handleHookRequest`）
5. **Timeline 渲染**：
   - `merge-events.ts` 增加 `kind: 'user-prompt'` 和 `userPromptItem` 构建器
   - `stripInjectedTags` 工具函数，剥掉 `<system-reminder>` / `<command-name>` / `<command-message>` / `<command-args>`
   - `Timeline.tsx` 给 `user-prompt` 配蓝色（`text-sky-600`）、kindLabel `"You"`、可选 `font-medium`
6. **测试**：
   - merge-events 单测补 case（`kind='user-prompt'`、summary 清洗、空 prompt、原文 raw 备份 detail）
   - `stripInjectedTags` 工具函数单测（多标签混合、跨行内容）
   - API 路由按现有 hook 路由的测试惯例补一条

### 2.2 Out of Scope（本次不做，理由写明）

- **不做 session summary 失效 / 重算** —— 避免每次用户说话就触发重算；且 summary 链路正在 sprint-layer-refactor 分支改动，不耦合
- **不做 task 自动匹配** —— 单独的下游功能，超出 Day 6 目标
- **不碰 classifier / templates** —— 属未合并分支，强耦合会引入无关冲突
- **不加 `promptText` 专用列** —— YAGNI，payload JSON 已能覆盖；未来真要做 prompt 文本分析再抽列
- **不做 redaction** —— MVP 阶段用户 prompt 落在自己 workspace，无跨租户泄露；隐私治理属后续迭代

## 3. 架构 & 数据流

写路径沿现有链路，不新增层级：

```
Claude Code  ─ UserPromptSubmit (stdin JSON) ─▶
.claude/settings.json  ─ lumo hook user-prompt-submit ─▶
cli hook-runner  ─ POST /api/hooks/user-prompt-submit ─▶
route.ts  ─ handleHookRequest(req, 'USER_PROMPT_SUBMIT') ─▶   ← 已 generic
hookEventService.recordHookEvent                                 ← 已 generic
  ├─ sessionRepository.upsertForHookEvent (session_id 提取，已实现)
  └─ hookEventRepository.createHookEvent
HookEvent row { type: USER_PROMPT_SUBMIT, payload: { prompt, session_id, cwd, ... } }
```

读路径：`app/sessions/[id]/page.tsx` → `mergeEvents(rawEvents)` → 新分支产出 `kind:'user-prompt'` 的 `TimelineItem` → `Timeline.tsx` 按 kind 上色。

关键点：`_handler.ts` / `hookEventService` / `hookEventRepository` **零改动**，它们已经是对 `HookEventType` 枚举 generic 的。本次只是加一个枚举值，链路自动支持。

## 4. 详细改动

### 4.1 Prisma

`prisma/schema.prisma`：

```prisma
enum HookEventType {
  PRE_TOOL_USE
  POST_TOOL_USE
  STOP
  USER_PROMPT_SUBMIT
}
```

迁移（命名参考现有风格，日期戳由 `prisma migrate` 生成）：

```sql
ALTER TYPE "HookEventType" ADD VALUE 'USER_PROMPT_SUBMIT';
```

### 4.2 `.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "lumo hook pre-tool-use" }] }
    ],
    "PostToolUse": [
      { "hooks": [{ "type": "command", "command": "lumo hook post-tool-use" }] }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "lumo hook user-prompt-submit" }
        ]
      }
    ],
    "Stop": [{ "hooks": [{ "type": "command", "command": "lumo hook stop" }] }]
  }
}
```

### 4.3 CLI (`cli/src/`)

**`lib/hook-runner.ts`**：

```ts
export type HookPath =
  | 'pre-tool-use'
  | 'post-tool-use'
  | 'user-prompt-submit'
  | 'stop'
```

**`index.ts`**：照抄 `pre-tool-use` 的注册方式再加一条：

```ts
hook
  .command('user-prompt-submit')
  .description(
    'Forward a UserPromptSubmit hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('user-prompt-submit')))
```

### 4.4 API route

**新文件 `app/api/hooks/user-prompt-submit/route.ts`**：

```ts
import { handleHookRequest } from '@/app/api/hooks/_handler'

export async function POST(request: Request) {
  return handleHookRequest(request, 'USER_PROMPT_SUBMIT')
}
```

`_handler.ts` / `hookEventService.ts` / `hookEventRepository.ts` — **不动**。

### 4.5 Timeline (`app/sessions/[id]/`)

#### 4.5.1 `merge-events.ts`

类型扩展：

```ts
export type HookEventType =
  | 'PRE_TOOL_USE'
  | 'POST_TOOL_USE'
  | 'STOP'
  | 'USER_PROMPT_SUBMIT'

export interface TimelineItem {
  key: string
  kind: 'tool' | 'stop' | 'orphan' | 'user-prompt'
  // ... 其余字段不变
}
```

主循环：在 `if (ev.type === 'STOP')` 分支前插入：

```ts
if (ev.type === 'USER_PROMPT_SUBMIT') {
  items.push(userPromptItem(ev))
  continue
}
```

新构建器（参考 `stopItem` 的形状）：

```ts
function userPromptItem(ev: RawEvent): TimelineItem {
  const rawPrompt = getString(ev.payload, 'prompt') ?? ''
  const cleaned = stripInjectedTags(rawPrompt).trim()

  const summary = cleaned ? clip(cleaned, 100) : '(empty prompt)'
  const details: DetailBlock[] = []
  if (cleaned) {
    details.push({ label: 'prompt', variant: 'text', text: cleaned })
  }
  // 若清洗前后不同，附一个 raw block 方便调试注入内容
  if (rawPrompt && rawPrompt !== cleaned) {
    details.push({
      label: 'raw (with injected context)',
      variant: 'text',
      text: rawPrompt,
    })
  }

  return {
    key: ev.id,
    kind: 'user-prompt',
    toolName: null,
    summary,
    badge: null,
    status: 'ok',
    startAt: ev.createdAt,
    endAt: ev.createdAt,
    details,
  }
}
```

`stripInjectedTags` 工具函数（放在同文件 Helpers 区，紧挨 `clip`）：

```ts
/**
 * Remove harness-injected sections from a user prompt so the Timeline
 * summary reflects what the human actually typed. The tags below are
 * appended by Claude Code hooks, slash commands, or SessionStart.
 */
function stripInjectedTags(s: string): string {
  return s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
}
```

#### 4.5.2 `Timeline.tsx`

- `kindLabel`：

  ```ts
  const kindLabel =
    item.kind === 'stop'
      ? 'Stop'
      : item.kind === 'user-prompt'
        ? 'You'
        : (item.toolName ?? 'tool')
  ```

- `statusClass` 增加 user-prompt 分支（置于 status 判断之前或并列）：

  ```ts
  const statusClass =
    item.kind === 'user-prompt'
      ? 'text-sky-600 font-medium'
      : item.status === 'error'
        ? 'text-red-600'
        : item.status === 'pending'
          ? 'text-amber-600'
          : 'text-emerald-600'
  ```

- 不改行高，不改结构 —— 保持 (a) "彩色一行"的约定

## 5. 错误处理 & 边界

- Hook 投递复用现有 "永远 exit 0 + `~/.lumo/hook.log`" 契约（`hook-runner.ts` 无需修改，只是多一个合法 `HookPath`）
- payload 缺 `prompt` 字段 → summary `'(empty prompt)'`、details `[]`，仍然创建 TimelineItem（和现有 orphan/pending 的"允许不完整"态度一致）
- 极长 prompt（如 /loop 或大段 system-reminder） → `clipBlock` / `clip` 已经承担截断职责；raw block 同样会在超 maxLines 时显示 "showing N of M"
- 用户手动调用 `lumo hook user-prompt-submit` 但未管道喂入 stdin → 走既有 TTY 分支，POST `{}`，service 层照常落一条空 payload；Timeline 看到空 prompt（符合 "宽容摄入" 原则）

## 6. 测试

### 6.1 新增 / 扩展单测

- **`__tests__/app/sessions/merge-events.test.ts`**（已存在）补：
  - UserPromptSubmit 事件 → `kind='user-prompt'`，summary 是清洗后前 100 字符
  - payload 含 `<system-reminder>…</system-reminder>` 混合用户文本 → summary 只含用户文本；details 中带 raw block
  - 纯注入标签、无用户文字的 payload → summary `'(empty prompt)'`
  - UserPromptSubmit 与 tool、Stop 混合时排序正确（按 `createdAt`）

- **`stripInjectedTags` 单测**（同文件或新建 helper 测试）：
  - 剥 `<system-reminder>`、`<command-message>`、`<command-name>`、`<command-args>` 各独立覆盖
  - 跨多行标签
  - 多个标签交替出现
  - 无标签 → 原样返回

- **`__tests__/app/api/hooks/route.integration.test.ts`**（单文件集成测试，已存在）扩展一个 describe 块，按现有 pre-tool-use / post-tool-use / stop 的 pattern 加 user-prompt-submit 路由的 case（鉴权、JSON、枚举落库、session 关联）

### 6.2 手动验证（Day 6 dogfood 自带）

用 Lumo 自己开一次 Claude Code session 处理 Day 6 剩余工作，进 `app/sessions/[id]`：

- Timeline 出现蓝色 "You" 行
- summary 是自己当时输入的话，前 100 字
- 点开能看到完整 prompt；若原文包含 `<system-reminder>` 等，能看到 raw 对照
- 一个 session 中多个 UserPrompt 显示位置正确（按时间穿插在 tool 流里）

## 7. 观察议题（item 6，非构建）

dogfood 后可直接在 Prisma Studio 或 `app/sessions/[id]` 页面肉眼回答：

- 一个 session 里有几个 UserPrompt？`SELECT "sessionId", COUNT(*) FROM "hook_events" WHERE type = 'USER_PROMPT_SUBMIT' GROUP BY "sessionId"`
- 它们代表相同还是不同的 task 意图？扫 Timeline 上的蓝色行逐条看；或把几条 UserPrompt 文本聚在一起人读

若观察下来发现"一个 session 常含多 prompt 且意图不同"，下一步应把 summary 分类器改为**按 UserPrompt 切段**——但这是下迭代的事，本 spec 不做。

## 8. 分层合规性（CLAUDE.md 自检）

| 层         | 本次改动                                                    | 合规 |
| ---------- | ----------------------------------------------------------- | ---- |
| Repository | 不改 `hookEventRepository` / `sessionRepository`            | ✓    |
| Service    | 不改 `hookEventService`                                     | ✓    |
| API Route  | 新文件 5 行，仅委托 `handleHookRequest`                     | ✓    |
| API Client | 不涉及（hook 链路不走 apiClient，走 CLI `hook-runner.ts`）  | ✓    |
| Component  | `Timeline.tsx` 只做渲染，`merge-events.ts` 纯函数，无副作用 | ✓    |

## 9. 迁移与回滚

- Postgres 枚举 `ADD VALUE` 不可 `DROP VALUE`（PG 限制），回滚需要完整 down 迁移重建类型。本次选择**不写 down**（和仓库既有迁移一致，参考 `prisma/migrations/` 里历次 enum 扩展）。若必须回退，只需把 `.claude/settings.json` 的 `UserPromptSubmit` 去掉——停止写入即可，旧枚举值留在数据库里无害。
- CLAUDE.md 规定 "Never delete files in prisma/migrations/" —— 本次只新增迁移目录，不触碰既有文件。
