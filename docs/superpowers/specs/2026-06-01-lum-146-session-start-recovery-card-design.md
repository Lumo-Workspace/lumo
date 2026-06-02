# LUM-146 · session-start 注入"续上次进度"恢复卡 — Design

**Date**: 2026-06-01
**Task**: LUM-146 (Milestone: Claude Code 集成体验升级)
**Status**: Design approved, pending implementation plan

## 背景

session summary 的底层能力已具备:每段 session 结束会生成 summary 并入库,带
`unresolved` 字段;`lumo task context` 也已渲染 previous sessions 的
headline / unresolved / 时长。**唯一缺口**:session-start hook 目前只注入
`memorySection` 和 `reviewTodosSection`,不注入上一段 session 的恢复信息——用户
得手动跑 `lumo task context` 才看得到"上次干到哪了"。

本任务补上"开场自动注入"这一步:当一个新 session 绑定到某任务时,在 session-start
的 `additionalContext` 里注入一张"续上次进度"恢复卡。

## 范围(v1)

**做**:item 1 —— `previousSession`(最近一条有 summary 的同任务 session 的
headline + unresolved + 时长),CLI 注入为 additionalContext。

**不做**:

- item 2「最后失败的测试/命令」—— 需要新写 `STOP_FAILURE` / `POST_TOOL_USE_FAILURE`
  payload 解析逻辑,且 `unresolved` 字段本就常含此类信息,收益重叠。另开口子。
- item 3「最后改的文件」—— 依赖 LUM-150(HookEvent 当前不存 file path)。砍掉。

## 关键设计决策

1. **范围**:v1 只做 item 1。
2. **"上一段 session"界定**:同任务最近一条**有 summary** 的 session。`listForTask`
   按 taskId 查,**天然跨分支**——覆盖 squash-merge 续做场景。最近一条若无 summary
   则往回找(取 5 条,挑第一条有 summary 的);全无则不渲染卡。**排除当前 session**
   (session-start 触发时当前 session 已入库,避免自我回显)。
3. **体量上限**:固定上限。headline 全留,`unresolved` 最多前 5 条,超出追加
   `…(+M more, 跑 lumo task context LUM-N 查看全部)`。不接 token 预算系统(不依赖
   尚不存在的 LUM-147)。
4. **渲染落点**:服务端只返回**结构化数据**,**CLI 端渲染**。复用 CLI 现成的
   `formatDuration` / `relativeTime`;headline/unresolved 是 LLM 生成的不可信自由
   文本,CLI 端渲染时走 `sanitizeField`(遵守团队记忆「CLI 必须 sanitize 服务端输出」)。

## 架构与分层

### 服务端

逻辑全部进 service,路由保持薄(遵守团队记忆「API 路由别直接调 Prisma」)。

- **新增** `taskContextService.buildPreviousSessionRecoveryForTask(taskId, currentSessionId)`:
  - 返回 `{ headline: string; unresolved: string[]; durationMs: number; lastActivityAt: string } | null`
  - 复用 `sessionRepository.listForTask(taskId, 5)`(已按 `lastActivityAt DESC` 排序)
  - 客户端过滤:排除 `currentSessionId` → 取第一条能产出 headline 的(summary 非空)
    → 没有则 `null`
  - `durationMs = lastActivityAt - startedAt`(服务端算好)
  - headline / unresolved 复用现成的 `summaryHeadline()` / `summaryUnresolved()`
- **改** `app/api/hooks/session-start/route.ts` 的 `afterRecord`:把该方法加进现有
  `Promise.all`,响应 body 多返回 `previousSession` 字段(**仅在绑定任务时构建**,与
  `memorySection` 同条件)。

响应新 shape:

```ts
{
  sessionId: string
  taskBinding: { bound: boolean; taskIdentifier?: string; taskTitle?: string }
  memorySection: string
  reviewTodosSection: string
  previousSession: { headline: string; unresolved: string[]; durationMs: number; lastActivityAt: string } | null
}
```

### CLI 端(`cli/src/lib/hook-runner.ts`)

- `SessionStartBody` 类型加 `previousSession?: { headline: string; unresolved: string[]; durationMs: number; lastActivityAt: string } | null`
- **新增渲染函数**,复用 `formatDuration` / `relativeTime` / `sanitizeField`,输出卡片:
  ```
  ## 续上次进度 (上一段 session · 2h ago · 23min)
  上次干到:<headline>
  未完成:
  - <unresolved[0]>
  - …(最多 5 条)
  - …(+3 more, 跑 lumo task context LUM-N 查看全部)
  ```
- 把卡片加进 `sessionContextEnvelope`,**排在 memorySection / reviewTodosSection 之前**
  (开场最该看到"上次干到哪")。

### 小重构(targeted)

`formatDuration` / `relativeTime` 当前是 `cli/src/commands/task-context.ts` 的私有
函数。要在 hook-runner 复用,把这两个抽到 `cli/src/lib/format.ts`,task-context.ts
改为 import。纯移动,行为不变。

## 数据流

```
新 session 启动
  → session-start hook POST(已被 handleHookRequest 记录入库)
  → afterRecord: 已绑定任务?
      ├─ 否 → previousSession 不构建(沿用现状)
      └─ 是 → Promise.all([memorySection, reviewTodos, previousSession])
  → 响应 body 多带 previousSession: {...} | null
  → CLI formatHookStdoutLines 读到 previousSession
      → null/缺省 → 不渲染卡(envelope 行为不变)
      → 有值 → 渲染卡 + sanitizeField,插到 envelope 最前
  → additionalContext 注入,Claude 开场即见
```

## 边界情况(全部静默降级,绝不报错)

| 场景                          | 行为                                                 |
| ----------------------------- | ---------------------------------------------------- |
| 未绑定任务                    | 不构建 previousSession(与 memorySection 同条件)      |
| 该任务无任何历史 session      | `null` → 不渲染卡                                    |
| 有历史 session 但都没 summary | 往回找 5 条都没 → `null` → 不渲染卡                  |
| 最近一条就是当前 session      | 按 currentSessionId 排除,不会自我回显                |
| 最近一条没 summary、更早的有  | 跳过空的,命中更早那条有 summary 的                   |
| unresolved 为空数组           | 只渲染 headline + 时长,不渲染"未完成"块              |
| unresolved > 5 条             | 取前 5,追加 `…(+M more, 跑 lumo task context LUM-N)` |

## 与 LUM-147 的关系

卡片体量固定有界(headline + ≤5 条 unresolved),不接 token 预算系统,不提前替
LUM-147 铺路——两者各自往 session-start 响应里加字段、互不挤占。

## 测试策略

遵守 CLAUDE.md「每个新函数至少一个测试」「Jest,`__tests__`,`*.test.ts`」。

**服务端**(`buildPreviousSessionRecoveryForTask`,mock `sessionRepository.listForTask`):

- 无历史 session → `null`
- 历史 session 全无 summary → `null`
- 最近一条是当前 session → 被 currentSessionId 排除,命中下一条
- 最近一条无 summary、更早一条有 → 命中更早那条
- 正常命中 → `{headline, unresolved, durationMs, lastActivityAt}`,且
  `durationMs = lastActivityAt - startedAt`

**CLI 端**(渲染函数 + format.ts 抽取):

- `previousSession` 为 `null`/缺省 → envelope 不含卡片(memory/review 不回归)
- 正常值 → 卡片含 headline + 时长,顺序排在 memorySection 之前
- unresolved > 5 → 截断且带 `+M more` 提示
- unresolved 空 → 不渲染"未完成"块
- 含 ANSI/控制字符的 headline/unresolved → 被 `sanitizeField` 清洗
- `format.ts` 抽取后:task-context.ts 既有测试仍绿

**收尾校验**(PR checklist):

- `npm test`、`npx tsc --noEmit`(跑前先 `npx prisma generate`)
- 无 console.log

## 非目标 / 注意

- **无 schema 变更** —— 纯查询 + 渲染,无 migration,无生产迁移风险。
- 不接 token 预算系统(留给 LUM-147)。
- item 2 / item 3 明确不在本任务范围。
