# 任务上下文注入重构:分层 inline 卡片 + 按需 retrieval [LUM-122]

- **状态**:Design / 待实现
- **日期**:2026-05-29
- **任务**:[LUM-122](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-122)

## 1. 背景与动机

`lumo task context <LUM-N>` 通过 `lib/services/task-context.service.ts` 的
`getContextForIdentifier()` 装配任务上下文,把每个来源在**加载时**渲染成一段
Markdown,拼成 `TaskContext` 返回,CLI verbatim inline 进 Claude Code 会话。

当前问题:

- **几乎不限长**。只有 Memory 有 1000-token 预算,长 Slack thread、长 artifact、
  长文档会把上下文撑大。
- **agent 自己取不到原文**。Slack 需 token、Figma 需 token、内部 weblink 有 SSRF
  守卫、PR 需 gh——agent 无法自行 fetch,所以一个 bare link 对 agent 等于没给。
- 因此 Lumo 必须充当**统一检索代理**:每个来源给一张便宜的 inline 卡片,再提供
  一个按需取全文的 retrieval 命令。

## 2. 核心模型:两层

> 每个来源 = **便宜的 inline 卡片**(身份 + 总结/元数据 + 一条 retrieval 命令原文)
>
> - **一个 retrieval 命令**(按需取全文/重内容)。

- inline 卡片的**丰富度按来源变**:自由文本的长内容(Slack/文档/Artifact/评论)用
  **LLM 总结**;已有便宜元数据的(WebLink/Figma/PR)直接用元数据,不调 LLM。
- retrieval 命令对**所有来源通用**,且**命令原文直接打印在卡片里**,agent 照抄即可,
  不用猜命令。
- 总结一律在**写入/刷新时生成并缓存**,绝不在 load 热路径现算(session start 频繁
  命中)。这与项目既有约束一致:任务状态流转触发的长耗时副作用必须 `waitUntil()`
  异步、不阻塞响应。

## 3. 范围

### 3.1 本期范围

- **管线**:仅 Web/CLI 管线(`task-context.service.ts` → `lumo task context`)。
- **来源**(7 个走两层 + 2 个不变):

| 源       | inline 卡片来源                | retrieval 命令                   | 命令状态 |
| -------- | ------------------------------ | -------------------------------- | -------- |
| Slack    | **LLM 总结**(缓存)             | `lumo task slack show <id>`      | 新增     |
| 文档     | **LLM 总结**(缓存)             | `lumo doc show <id>`             | 已存     |
| Artifact | **LLM 总结**(缓存)             | `lumo task artifact show <id>`   | 已存     |
| 评论     | **LLM 总结**(>3 条时)/否则全文 | `lumo task comment list <LUM-N>` | 新增     |
| WebLink  | OG title/desc(免费)            | `lumo task web show <id>`        | 新增     |
| Figma    | 文件名/帧名/缩略图(免费)       | `lumo task figma context <id>`   | 新增     |
| PR       | #N/title/state/CI(免费)        | `lumo task pr show <#>`          | 新增     |
| Memory   | 不变(已是精简卡片)             | —                                | —        |
| Sessions | 不变                           | —                                | —        |

### 3.2 非目标(本期不做)

- **不重构沙箱管线** `agent-server/src/agent/context-builder.ts`。它现在自行渲染
  评论/PR;本期 PR + 评论只进 Web/CLI 管线。为避免逻辑漂移,新的 render 函数抽到
  共享模块(见 §6),沙箱管线**后续**直接复用——本期不接线。
- 不动 Figma/PR 的重内容缓存(retrieval 实时调集成 API,v1 不落库)。
- 不引入全局 token 预算重写;inline 缩小后 Memory 现有 1000-token 预算保留即可。

## 4. 数据模型变更(`prisma/schema.prisma`)

| 模型               | 新增字段                                                 | 说明                                        |
| ------------------ | -------------------------------------------------------- | ------------------------------------------- |
| `TaskSlackContext` | `summary String?`、`summaryGeneratedAt DateTime?`        | thread 总结,link/refresh 时生成             |
| `TaskArtifact`     | `summary String?`                                        | content 不可变 → add 时生成一次,永不过期    |
| `TaskWebLink`      | `body String? @db.Text`、`bodyFetchedAt DateTime?`       | retrieval 用;卡片仍用现有 OG title/desc     |
| `Document`         | `summary String?`、`summaryGeneratedAt DateTime?`        | 只描述 doc 本身,跨任务复用一份              |
| `Task`             | `commentsSummary String?`、`commentsSummaryAt DateTime?` | 评论流没有独立实体,缓存挂 Task;新评论时重算 |

- `TaskFigmaLink`、`PullRequest`:无 schema 变更(retrieval 实时取)。
- 迁移按项目 §Database Migrations 规约用 `prisma migrate dev`;若遇 P3008/P3012
  checksum drift,走手写 SQL + `db execute` + `migrate resolve --applied` 流程
  (见 [[feedback_prisma_drift_workaround]]),**不** reset DB。
- PR 描述需注明:本迁移仅加可空列,无数据破坏,部署时 `migrate deploy` 即可。

## 5. 总结生成服务(`lib/services/summary.service.ts`,新建)

- 统一入口 `summarize(text: string, kind: SummaryKind): Promise<string>`,
  `kind` ∈ `slack | artifact | document | comments`,按 kind 选 prompt 模板。
- 走 AI SDK。**关键坑**:`@ai-sdk/gateway` 静态 import 会经 TransformStream 炸
  jest([[project_ai_sdk_gateway_jest_trap]])。本服务**必须**用 `await import()`
  动态引入 gateway/模型层,避免被广泛 import 的文件静态拉入。
- 失败处理:总结失败不阻断上下文加载——记录 error,卡片回退到"无总结"形态
  (如 Slack 回退到前 N 条原文截断,文档回退到标题+首段)。

### 触发时机(全部写入/刷新,`waitUntil()` 异步)

| 源       | 触发点                                                                                                | 备注                                             |
| -------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Slack    | `linkSlackPermalink` / `refreshContext`                                                               | 写 snapshot 后异步生成                           |
| Artifact | `task artifact add`                                                                                   | 一次性(content 不可变)                           |
| 文档     | `doc create` / `doc update` 后台;**load 时若 `updatedAt > summaryGeneratedAt` 用 `waitUntil` 懒刷新** | 本次先用旧值,不阻塞(照搬 Figma 缩略图先例)       |
| 评论     | 新评论写入时                                                                                          | 仅当评论数 > 3 才调 LLM;否则卡片直接 inline 全文 |

## 6. 渲染层(`lib/services/task-context.service.ts` + 共享模块)

- 把 render 函数抽到共享模块 `lib/context/render/`(每源一文件),供 Web/CLI 管线
  使用,并为沙箱管线后续复用预留。
- **改造**现有 4 个:`renderSlackContextSection`、`renderWebLinkSection`、
  `renderFigmaSection`、`renderArtifactSection`——输出统一为
  「卡片 = 身份 + 总结/元数据 + `↳ 全文: <retrieval 命令原文>`」。
- **新增** 3 个:`renderDocumentSection`(数据来自 `DocumentMention`,EXPLICIT +
  CONTENT 关联的 doc)、`renderCommentsSection`、`renderPRSection`。
- `TaskContext` 接口新增 `docSection`、`commentsSection`、`prSection` 三个
  pre-rendered 字符串字段。

### 卡片样例

```
### Slack · #design (thread, 24 条 · 刷新于 2026-05-28 10:12 UTC)
  <一段话 LLM 总结>
  ↳ 全文: lumo task slack show clx_abc

### [spec] Onboarding 重构 · Claude Code
  <一段话 LLM 总结>
  ↳ 全文: lumo task artifact show cma_xyz

- [Stripe Webhooks 文档](https://stripe.com/docs/...) — stripe.com
  > <OG description>
  ↳ 正文: lumo task web show clw_def
```

## 7. Retrieval 命令(CLI)与 API routes

新增 CLI 命令(扁平 `cli/src/commands/task-<noun>-<verb>.ts`,沿用现有约定):

| 命令                        | 行为                                              | API route                                    |
| --------------------------- | ------------------------------------------------- | -------------------------------------------- |
| `task slack show <id>`      | 返回存储的完整 thread snapshot(Markdown)          | `GET /api/tasks/<id>/slack/<ctxId>`          |
| `task web show <id>`        | 返回 `body`;缺失则现抓并回填,复用写入时 SSRF 守卫 | `GET /api/tasks/<id>/web/<linkId>`           |
| `task figma context <id>`   | 实时调 Figma API 出 design context                | `GET /api/tasks/<id>/figma/<linkId>/context` |
| `task comment list <LUM-N>` | 返回完整评论流(作者 + 时间 + 全文)                | `GET /api/tasks/<id>/comments`               |
| `task pr show <#>`          | 实时取 PR diff + review comments                  | `GET /api/tasks/<id>/pr/<number>`            |

- `doc show`、`task artifact show` 已存在,不动。
- 每个 route 走 §Layered Architecture:auth → Zod 校验 → service → response,
  Prisma 只在 repository,业务逻辑只在 service。

## 8. 权限与安全

- 所有 retrieval route 复用写入时的鉴权(workspace + member 身份)与 **SSRF 守卫**
  (`lib/integrations/og-metadata/ssrf.ts`),不开绕过 fetch 的后门。
- Figma/PR 实时取依赖对应集成的 OAuth/token;未连接时返回明确错误(照
  `task figma add` 未连接时的错误文案风格)。

## 9. 测试(Jest,`__tests__/*.test.ts`)

- `summary.service`:各 kind 的 prompt 选择、失败回退;**dynamic import** 不破坏
  jest(回归 [[project_ai_sdk_gateway_jest_trap]])。
- 每个 render 函数:有/无总结、有/无元数据、retrieval 命令原文正确拼接、空集返回
  空串。
- 评论 >3 / ≤3 的分支(总结 vs 全文 inline)。
- 文档懒刷新:`updatedAt > summaryGeneratedAt` 时触发 `waitUntil`,本次返回旧值。
- 各 retrieval API route:鉴权、404、SSRF 拒绝、未连接集成的错误。
- 每个新函数至少一个测试(项目硬要求)。

## 10. 迁移与部署

- `prisma migrate dev` 生成迁移(仅加可空列,无破坏)。
- PR 描述注明:`需在部署时 migrate deploy`;无数据删除。
- 合并后按规约验证 prod 迁移已应用([[project_prod_db_env_split]] / `migrate status`)。

## 11. 风险与后续

- **双管线漂移**:评论/PR 渲染本期只在 Web/CLI;沙箱仍有自己的一份。已通过抽共享
  render 模块缓解,**后续任务**让 `context-builder.ts` 改用同一模块。
- **文档总结成本**:文档编辑频繁时后台总结会累计 LLM 调用;靠"load 时按
  staleness 懒刷新 + 编辑后台触发"控制,必要时加 debounce。
- **评论总结缓存挂 Task**:若未来评论需要更细粒度(按 thread)再开侧表。

## 12. 实现顺序(供 writing-plans 细化)

1. Schema 迁移(5 模型加列)。
2. `summary.service.ts`(dynamic import gateway)+ 单测。
3. 各源写入/刷新路径接 `waitUntil` 总结生成(Slack/Artifact/文档/评论)。
4. 共享 render 模块:改 4 个 + 新增 3 个 render 函数;扩 `TaskContext` 接口。
5. retrieval API routes(slack/web/figma-context/comments/pr)+ service/repository。
6. CLI 命令(slack-show/web-show/figma-context/comment-list/pr-show)。
7. 同步 `.claude/skills/lumo/SKILL.md`(新增命令 + 触发词)。
8. 端到端验证 `lumo task context` 输出 + 各 retrieval 命令。

## 13. PR Checklist 提醒

- 测试通过、`npx tsc --noEmit` 无错(先 `prisma generate`,见
  [[project_prisma_client_reset_before_tsc]])、无 `console.log`。
- 分支 `lumo/LUM-122-context-injection-tiering`、PR 标题含 `[LUM-122]`。
- `cli/src/commands/` 改了 → `SKILL.md` 同步。
- i18n:retrieval 命令若有面向用户字符串,所有 locale 文件都要补。
