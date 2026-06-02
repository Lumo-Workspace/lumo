# LUM-147 · session-start 关联资料(Slack/Figma/PR)按预算自动带入上下文 — Design

**Date**: 2026-06-01
**Task**: LUM-147 (Milestone: Claude Code 集成体验升级)
**Status**: Design approved, pending implementation plan

## 背景

session-start hook 当前只把 `memorySection` + `reviewTodosSection` 注入到
Claude Code 的 `additionalContext`。各关联资源(Slack / web / Figma / PR)的
inline card 渲染函数(`lib/context/render/`)和 token 预算机制
(`applyTokenBudget`)**都已就位**,但只有手动跑 `lumo task <kind> show` 才拿得
到——session-start 不会自动带入。

本任务补上"开场自动注入"这一步:新 session 绑定到某任务时,在 session-start 的
`additionalContext` 里按全局预算自动注入 Slack / web / Figma / PR 的 inline
card,超额的降级成"清单"行。

## 现状核对(2026-06-01 代码审计)

三条 session-start 相关注入路径,当前都只注入 memory:

1. `app/api/hooks/session-start/route.ts` — 已绑定时返回 `memorySection` +
   `reviewTodosSection`,已是 `Promise.all` 并行。
2. `app/api/sessions/[sessionId]/bind-task/route.ts` →
   `sessionService.bindSessionToTask` — 只返回 `memorySection`
   (`lumo session attach` 和 CLI auto-bind 都走这条)。
3. CLI `cli/src/lib/hook-runner.ts` — `formatHookStdoutLines` 把各 section 拼进
   一个 `additionalContext` envelope(`sessionContextEnvelope`)。

渲染层:`lib/context/render/{slack,web-link,figma,pr,...}.ts`,每个签名是
`(cards) => string`,渲染整段(含 heading)。每张卡末尾已带"↳ 全文"检索命令。

预算:`lib/memory/render.ts` 的 `applyTokenBudget(memories, maxTokens=1000)`,
**只吃 `RenderableMemory[]`**,按尾部丢弃。

约束:
- `getContextForIdentifier`(`lumo task context` 全文路径)是**串行 await** 各
  资源——它不在乎延迟。session-start 走 **3s 超时**,必须并行 fetch。
- CLI 侧 `TIMEOUT_MS = 3000`。
- LUM-146 要往同一条 session-start 加 `previousSessionSummary`,跟本任务**抢同一
  份预算**。146 还是 TODO,实现未动工(仅有 docs spec)。

## 范围

**做**:
- Slack / web / Figma / PR 四类资源,按全局预算注入 session-start。
- 全局 token 预算覆盖 `memory + PR + Slack + Figma + web`;card-level 纳入,超额
  只列清单。
- 通用、section 可插拔的预算分配器(为 LUM-146 预留接入点)。

**不做(明确排除)**:
- artifacts / docs / comments 不进 linkedResources(范围限 Slack/web/Figma/PR)。
- `reviewTodosSection` 不进预算——它是 reviewer 硬要求,继续独立、永远注入。
- `bind-task` 路径(`lumo session attach` / auto-bind)**不注入** linked
  resources,保持只返回 `memorySection`(自带 1000 预算),避免 attach 变慢。
- LUM-146 的 `previousSessionSummary` 本任务不实现,只预留分配器接入点。

## 决策(brainstorm 已确认)

| 维度 | 选择 |
| --- | --- |
| 资源范围 | Slack / web / Figma / PR |
| 预算降级模型 | card-level 纳入 + 超额"清单"兜底 |
| 注入路径 | 仅 session-start hook(bind-task 保持轻量) |
| 分配器形态 | section 可插拔的统一分配器(146 直接接入) |
| 跨类型优先级 | `memory > PR > Slack > Figma > web` |
| 全局预算 | 2500 tokens |

## 架构

```
session-start route (已绑定时)
  └─ Promise.all([
       taskContextService.buildSessionStartSections(taskId, wsId),  ← 新
       taskContextService.buildReviewTodosSectionForTask(taskId),   ← 不变
     ])
       │
       └─ buildSessionStartSections:
            ├─ Promise.all 并行 fetch: memory(task+project) / slack / web / figma / pr
            ├─ 各类组装成 BudgetSection(cards: full + manifest + tokens)
            ├─ assembleWithinBudget([memory, pr, slack, figma, web], 2500)
            └─ 返回 { memorySection, linkedResourcesSection }
                 ├─ memorySection      = memory 那段(裹 untrusted 边界)
                 └─ linkedResourcesSection = pr/slack/figma/web 那几段(裹 untrusted 边界)
```

`bind-task` 路径不变:仍调 `buildMemorySectionForTask`(memory-only,自带 1000
预算)。memory 因此有两套预算 regime——session-start 走全局 2500,bind-task 走旧
的 1000。两个入口职责不同,可接受。

### 1. 预算分配器 `lib/context/budget.ts`(新)

纯函数模块,不依赖 `@ai-sdk/gateway`(规避 jest 陷阱)。

```ts
export interface BudgetCard {
  /** 预估 token,= full.length / 4 向上取整 */
  tokens: number
  /** 整张卡片正文(不含 section heading) */
  full: string
  /** 一行清单:简短标签 + 检索命令(复用卡片末尾那条 lumo task <kind> show) */
  manifest: string
}

export interface BudgetSection {
  /** 例如 "## Slack Context" */
  heading: string
  /** 该 section 的卡片,按 section 内顺序(如 newest-first) */
  cards: BudgetCard[]
}

/**
 * 按 sections 数组顺序(= 跨类型优先级)贪心纳入 full 卡片;累计 token 超
 * maxTokens 后,该卡及其后所有卡片降级为 manifest 行。
 *
 * 返回每个 section 渲染好的字符串(heading + full 卡片们 + 溢出清单)。空
 * section(无卡片,或全空字符串)整段省略。
 */
export function assembleWithinBudget(
  sections: BudgetSection[],
  maxTokens: number
): { byHeading: Map<string, string> }
```

分配逻辑:
1. 跨 section 按数组顺序展平所有卡片,贪心累加 `tokens`,首次超 `maxTokens` 的卡
   及其后全部标记为 "manifest"。
2. 渲染:对每个 section,若它有 full 卡片或 manifest 卡片才输出。结构:
   ```
   <heading>

   <full card 1>

   <full card 2>

   其余 N 条(仅清单):
   - <manifest 行>
   - <manifest 行>
   ```
   只有 full 卡片 → 无"其余"块;只有 manifest → heading + "其余"块(或直接清单)。
3. 空 section 不进 `byHeading`,调用方据此省略。

### 2. 复用现成 renderer(card-level 拆分)

把 4 个 renderer 各拆出两个纯函数 + 保留 section 入口:
- `renderSlackContextSection(cards)` → 内部用 `slackCard(card)` 拼;新增
  `slackCard(card): string`(full body,无 heading)、`slackManifest(card): string`
  (一行)。
- web-link / figma / pr 同样处理。

`getContextForIdentifier`(`lumo task context` 全文路径)继续调
`renderXSection`,**行为完全不变**——只是内部改用 `xCard` 拼接。

manifest 行复用各 renderer 已有的检索命令字符串(如
`lumo task slack show <id> <ctxId>`),格式:`- <标签> — <检索命令>`。

### 3. service 层 `buildSessionStartSections`

新增 `taskContextService.buildSessionStartSections(workspaceId, taskId)`:
- `Promise.all` 并行 fetch:`[taskMemories, projectMemories]`(已并行)、
  `slackContexts`、`webLinks`、`figmaLinks`、`prs`。
- 各类映射成 `BudgetSection`:
  - memory:复用 `RenderableMemory` → 每条一张 `BudgetCard`(full = 现有
    `renderMemoryItem`;manifest = 简短 trigger/what/rule/workflow 一行)。
  - pr / slack / figma / web:用上面的 `xCard` / `xManifest`。
- 调 `assembleWithinBudget([memory, pr, slack, figma, web], 2500)`。
- 从 `byHeading` 取出 memory 段 → `memorySection`;其余拼成
  `linkedResourcesSection`。各自裹 untrusted 边界。
- 返回 `{ memorySection, linkedResourcesSection }`。

figma 的 lazy refresh(`scheduleLazyRefresh`)和 doc summary refresh 在
session-start 路径**按需保留 / 可省略**——这两者走 `waitUntil`,不阻塞响应;为控
制冷启动 fetch 数量,session-start 路径暂不触发 figma lazy refresh(全文路径仍会触
发),作为实现细节在 plan 里定。

### 4. 信任边界

linked 资源(Slack 文本、PR 标题等)是任意人写的、进 agent 指令流,与 memory
同属 LUM-140 注入面。把 `lib/memory/render.ts` 的 `wrapUntrustedMemory` 泛化为通
用 `wrapUntrusted(section)`(或新增并存),memory 段与 linked 段**各裹一层**
`<untrusted-team-memory>` 边界。wrapper 文本开销不计入预算(~6 行,可忽略)。

### 5. CLI 注入 `cli/src/lib/hook-runner.ts`

- `SessionStartBody` 加 `linkedResourcesSection?: string`。
- `formatHookStdoutLines` 的 `sessionContextEnvelope([...])` 数组加入,顺序:
  `memorySection → linkedResourcesSection → reviewTodosSection`。
- `resolveSessionStartStdout` 的 **auto-bind 路径不变**(仍只 memory——bind-task
  服务端不返回 linked)。
- 服务端自由文本经 `sanitizeField` 的现有处理保持不变;linked 段已在服务端裹
  untrusted 边界。

### 6. LUM-146 预留

分配器由 section 数组驱动。146 之后把 `previousSessionSummary` 包成一个
`BudgetSection`,插在 `memory` 之后、`PR` 之前(高优先级),**无需改分配器结构**。

## 数据流

```
HookEvent(SESSION_START) POST
  → handleHookRequest afterRecord
  → findTaskBinding(sessionId)
  → bound? buildSessionStartSections(wsId, taskId) ∥ buildReviewTodosSectionForTask(taskId)
  → response { memorySection, linkedResourcesSection, reviewTodosSection, taskBinding }
  → CLI formatHookStdoutLines → 单个 SessionStart additionalContext envelope
  → Claude Code 注入
```

## 错误处理

- 单类资源 fetch 失败不能拖垮整段:`buildSessionStartSections` 内对各 fetch 做隔
  离(失败的类按空处理),保证 session-start 永不因某类资源异常而 5xx 或超时。
- 整体仍受 3s 超时保护(CLI 侧 AbortController);服务端尽量快返回。
- 空任务(无任何 linked 资源)→ `linkedResourcesSection = ''`,CLI 的
  `sessionContextEnvelope` 过滤空串,不输出空段。

## 测试

遵循 CLAUDE.md(Jest,`__tests__`,`*.test.ts`,每个新函数至少一个测试):
- `budget.ts`:卡片全纳入、超额降级清单、跨 section 切点落在 section 边界 / 中
  间、空 section 省略、maxTokens 极小、空输入。
- 各 `xCard` / `xManifest` renderer:full/manifest 形状、空字段回退。
- `buildSessionStartSections`:并行 fetch、memory/linked 拆分、单类 fetch 失败隔
  离、空任务返回空串、预算切分把低优先级降级。
- `hook-runner`:新增 `linkedResourcesSection` 注入顺序、空串过滤、auto-bind 路径
  不带 linked。
- 注意:不要从被广泛 import 的文件静态 import 任何会拉 `@ai-sdk/gateway` 的模块
  (jest TransformStream 陷阱);`budget.ts` 为纯函数,无此风险。

## 杂项

- **i18n**:这些是 agent-facing markdown(与现有 `## Slack Context` /
  `## Relevant Memory` 一致,硬编码),非 react-intl UI 串,不改 locale 文件。
- **SKILL.md 同步**:改动在 `cli/src/lib/`(非 `cli/src/commands/`),严格说不触
  发同步规则;但 session-start 注入内容变了,可在 SKILL.md 的 auto-inject 描述里
  补一句"关联资料(Slack/Figma/PR/web)按预算自动带入"。可选,plan 里定。
- **预算值 2500 / 优先级**:集中为常量,便于调与 146 协调。
- **CLI 发版**:本任务改了 `cli/src`(hook-runner),用户可见行为变化 → 需要
  `cli/package.json` 版本 bump(feat → minor)+ 手动 `cd cli && npm publish`。
- **DB**:无 schema 变更,无 migration。

## 工作量

中。零新能力,纯组合 + 预算抽象 + 4 个 renderer 的 card-level 拆分。
