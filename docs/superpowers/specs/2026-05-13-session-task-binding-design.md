# Session-Task 绑定：session-start hook 驱动的 per-session task 关联

**Date**: 2026-05-13
**Status**: Draft (awaiting user review)

## 1. 背景与动机

当前 Lumo 的 task 绑定机制依赖全局单文件 `~/.lumo/current-task.json`。用户在终端执行 `lumo session start LUM-42` 后，所有后续 Claude Code session 的 hook event 都会被注入同一个 `task_id`。

这带来两个问题：

1. **无法多 session 并行推进不同 task** —— 用户想在 Desktop 里同时开两个对话分别处理 LUM-12 和 LUM-15，但 `current-task.json` 是全局的，切换一个就覆盖另一个
2. **流程割裂** —— 必须先到终端 `lumo session start`，再到 Desktop 开对话。用户希望在 Desktop 对话开始时直接选择 task

本 spec 实现：**session-start hook 触发时，服务端返回当前 session 的 task 绑定状态，Claude 在对话开头根据状态决定是否询问用户，用户回答后通过新 API 完成 per-session 绑定，不写 `current-task.json`，不影响其他终端/session。**

## 2. 目标与非目标

### 2.1 In Scope

1. **服务端 session-start hook route 改造**：返回 `taskBinding` 字段（含绑定状态、task identifier/title）
2. **通用 hook handler 扩展**：`handleHookRequest` 支持 `afterRecord` 返回数据合并到 response body
3. **新 API `POST /api/sessions/:sessionId/bind-task`**：指定 session ID 直接绑定 task，不写 `current-task.json`
4. **CLI hook-runner 改造**：`session-start` path 读取 response body，将 `taskBinding` 信息写到 stdout
5. **Repository 层新增**：`sessionRepository.findTaskBinding(sessionId)` 查询绑定状态
6. **测试**：各层新增/改动均需对应测试

### 2.2 Out of Scope

- **不做 task 列表展示** —— 未绑定时只提示"请告诉我任务编号"，不从服务端拉取可选 task 列表。后续迭代可加
- **不改 `lumo session start` / `lumo session attach`** —— 现有 CLI 命令保持不变，两种绑定方式共存
- **不做 CLAUDE.md 指令注入** —— 提示文案完全由服务端通过 hook stdout 控制，不依赖本地文件
- **不改 `current-task.json` 机制** —— 现有全局绑定作为 fallback 保留，新 per-session 绑定是增量能力

## 3. 架构 & 数据流

### 3.1 新 session（未绑定 task）

```
Claude Code Desktop 新开对话
    │
    ▼
SessionStart hook 触发（stdin 含 session_id）
    │
    ▼
CLI: lumo hook session-start
    │ injectCurrentTaskId() → 注入 current-task.json 的 task_id（可能为空）
    │ POST /api/hooks/session-start
    │
    ▼
服务端:
    ├─ handleHookRequest → recordHookEvent（upsert Session 行）
    ├─ afterRecord: 查询 session 是否已有 taskId
    │   ├─ 有 → { bound: true, taskIdentifier, taskTitle }
    │   └─ 无 → { bound: false }
    └─ 返回 { ok: true, taskBinding: { ... } }
    │
    ▼
CLI: 读 response body
    │ taskBinding.bound == false
    │ stdout: "[Lumo] 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。"
    │
    ▼
Claude 看到注入文本 → 询问用户
    │
    ▼
用户: "LUM-42"
    │
    ▼
Claude: 通过 Bash 调用
    curl -X POST .../api/sessions/{sessionId}/bind-task \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"taskIdentifier":"LUM-42"}'
    │
    ▼
服务端:
    ├─ resolve task identifier → task.id
    ├─ sessionRepository.updateTaskId(sessionId, task.id)
    └─ 返回 { taskId, taskIdentifier, taskTitle }
    │
    ▼
Claude: "已绑定任务 LUM-42 - {title}，开始工作。"
```

### 3.2 恢复已有 session（已绑定 task）

```
Claude Code Desktop 切换回已有对话
    │
    ▼
SessionStart hook 触发
    │
    ▼
服务端: session 已有 taskId
    └─ 返回 { ok: true, taskBinding: { bound: true, taskIdentifier: "LUM-12", taskTitle: "..." } }
    │
    ▼
CLI stdout: "[Lumo] 当前任务: LUM-12 - 添加OAuth登录"
    │
    ▼
Claude 看到 → 静默继续，不询问
```

## 4. 各层改动详情

### 4.1 `handleHookRequest` 改造（`app/api/hooks/_handler.ts`）

当前 `afterRecord` 签名：

```ts
afterRecord?: (ctx: AfterRecordContext, identity: VerifyApiKeyResult) => void
```

改为允许返回可选数据，合并到 response：

```ts
afterRecord?: (ctx: AfterRecordContext, identity: VerifyApiKeyResult) => void | Record<string, unknown> | Promise<void | Record<string, unknown>>
```

response 构造逻辑：

```ts
const base = { ok: true }
if (options.afterRecord) {
  const extra = await options.afterRecord(ctx, identity)
  if (extra) Object.assign(base, extra)
}
return NextResponse.json(base)
```

注意：`afterRecord` 失败时降级为 `{ ok: true }`（已有 try/catch），不影响 hook event 记录。

### 4.2 session-start route 改造（`app/api/hooks/session-start/route.ts`）

```ts
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const binding = await sessionRepository.findTaskBinding(ctx.sessionId)
      return { sessionId: ctx.sessionId, taskBinding: binding }
    },
  })
}
```

### 4.3 新 API：`POST /api/sessions/[sessionId]/bind-task`（`app/api/sessions/[sessionId]/bind-task/route.ts`）

```
路由: app/api/sessions/[sessionId]/bind-task/route.ts

请求体: { taskIdentifier: string }   // e.g. "LUM-42"
鉴权: Bearer token

逻辑:
  1. verifyBearer → identity
  2. 从 URL params 取 sessionId
  3. 校验 session 存在且属于该 workspace member
  4. resolve taskIdentifier → task（复用 taskRepository 已有方法）
  5. sessionRepository.updateTaskId(sessionId, task.id)
  6. 返回 { taskId: task.id, taskIdentifier: task.identifier, taskTitle: task.title }

错误:
  - 401: 鉴权失败
  - 403: session 不属于该用户
  - 404: session 或 task 不存在
```

### 4.4 Repository 层

**`sessionRepository.findTaskBinding(sessionId)`**：

```ts
async findTaskBinding(sessionId: string): Promise<{ bound: true; taskIdentifier: string; taskTitle: string } | { bound: false }> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { task: { select: { identifier: true, title: true } } },
  })
  if (!session?.task) return { bound: false }
  return { bound: true, taskIdentifier: session.task.identifier, taskTitle: session.task.title }
}
```

**`sessionRepository.findByIdForWorkspaceMember(sessionId, workspaceMemberId)`**：
用于 bind-task API 的权限校验（如果现有 `findByIdForMember` 已满足则直接复用）。

### 4.5 CLI hook-runner 改造（`cli/src/lib/hook-runner.ts`）

`runHook()` 中，仅对 `session-start` path 读取并输出 response body：

```ts
if (!res.ok) {
  logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
  return
}

// 只有 session-start 需要读 response body 并注入 stdout
if (path === 'session-start') {
  try {
    const body = await res.json()
    const binding = body?.taskBinding
    const sessionId = body?.sessionId
    if (binding && sessionId) {
      if (binding.bound) {
        process.stdout.write(
          `[Lumo] session_id=${sessionId} | 当前任务: ${binding.taskIdentifier} - ${binding.taskTitle}\n`
        )
      } else {
        process.stdout.write(
          `[Lumo] session_id=${sessionId} | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。\n`
        )
      }
    }
  } catch {
    // response body 解析失败不阻塞
  }
}
```

### 4.6 Claude 绑定 task 的调用方式

Claude 看到 `[Lumo] 当前未绑定任务...` 后询问用户。用户回答 task 编号后，Claude 通过 Bash 执行：

```bash
curl -s -X POST "${LUMO_API_URL}/api/sessions/${SESSION_ID}/bind-task" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat ~/.lumo/credentials.json | jq -r .token)" \
  -d "{\"taskIdentifier\":\"LUM-42\"}"
```

**session_id 获取方式**：CLI 在 stdout 输出中包含 `session_id`，让 Claude 能直接使用。stdout 格式改为：

- 已绑定：`[Lumo] session_id={id} | 当前任务: LUM-12 - 添加OAuth登录`
- 未绑定：`[Lumo] session_id={id} | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。`

Claude 从注入文本中解析 `session_id` 用于后续 API 调用。

**备选方案**：新增 CLI 命令 `lumo session bind <task-identifier> --session <session-id>` 封装 curl 调用，对 Claude 更友好。但这是可选优化，MVP 用 curl 即可。

**提示文案语言**：MVP 阶段硬编码中文提示。SaaS 化时可在服务端根据 workspace 语言设置返回对应文案，CLI 层只做透传。

## 5. 与现有机制的兼容性

| 场景                                            | 行为                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 用户先 `lumo session start LUM-12` 再开 Desktop | `current-task.json` 有值，hook 注入 `task_id`，Session 创建时绑定 LUM-12。session-start response 返回 `bound: true`。Claude 静默继续 |
| 用户直接开 Desktop，不做 `lumo session start`   | `current-task.json` 无值或不存在，Session 创建时 `taskId=null`。response 返回 `bound: false`。Claude 询问                            |
| 用户在对话中途 `lumo session attach LUM-15`     | 现有逻辑不变：更新 Session.taskId + 写 `current-task.json`。下次 session-start hook 触发时返回新的绑定                               |
| 多个 Desktop 对话并行                           | 每个对话有独立 session_id，绑定互不影响。`current-task.json` 不参与 per-session 绑定                                                 |

## 6. 测试计划

| 层                                         | 测试内容                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionRepository.findTaskBinding`        | 有绑定返回 `{ bound: true, ... }`；无绑定返回 `{ bound: false }`；session 不存在返回 `{ bound: false }`                                      |
| `handleHookRequest` afterRecord 返回值合并 | afterRecord 返回对象时 response 包含该对象；afterRecord 返回 void 时 response 只有 `{ ok: true }`；afterRecord 抛错时降级为 `{ ok: true }`   |
| `POST /api/hooks/session-start`            | response 包含 `taskBinding` 字段；已绑定/未绑定两种场景                                                                                      |
| `POST /api/sessions/:id/bind-task`         | 正常绑定成功；session 不存在返回 404；task 不存在返回 404；session 不属于用户返回 403                                                        |
| CLI `runHook('session-start')` stdout      | mock server 返回 `bound: true` 时 stdout 包含任务信息；返回 `bound: false` 时 stdout 包含提示文案；response 解析失败时 stdout 无输出、不报错 |
