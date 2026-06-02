# LUM-152 — memory 沉淀可审：session wrap 列出本次新增 + 一键 curate

**Date**: 2026-06-02
**Task**: LUM-152
**Milestone**: Claude Code 集成体验升级
**Status**: Design approved

## 问题

自动沉淀（layer1 在 STOP、layer2 在 task→done）写库即终态，没有任何审阅环节。用户想在收尾时看到"本次会话新增了哪些 memory"，并能一键删掉噪音 / 把有价值的提升到项目级——但不能破坏 auto-sediment 的零摩擦（审阅必须可选，默认全保留）。

`lumo session wrap`（LUM-151）已经是一个多 section 的收尾面板，且在 `cli/src/lib/wrap-panel.ts` 的注释里明确预留了本任务的插槽。`lumo memory rm` / `promote` 已能 curate。缺的只是"在收尾时把本次新增摊出来 + 一键处理"。

## 范围

**做**：Layer1（任务级）memory 在 `lumo session wrap` 的一个新 section 里审阅。

**不做（YAGNI / 已拆分）**：

- Memory `status` / `reviewedAt` 字段、Web 端 memory inbox。
- Layer2（项目级）memory 审阅 —— 因时序竞态（task→done 时异步 LLM 合并，wrap 同步读时大概率未落库）和归属缺失（`sourceSessionId=null`），拆到 **LUM-165**（在下次 session-start 审）。
- session-end hook 的 server handler —— SessionEnd 无法注入上下文 / 无法交互，审阅走显式 `lumo session wrap`，与 LUM-151 一致。

## 关键设计决策

| 决策点                | 选择                                                           | 理由                                                                                                                |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 去重机制              | **Session watermark**：`Session.lastMemoryReviewAt`            | 复用 LUM-151 的 `lastProgressCommentAt` 模式，零 Memory schema 迁移                                                 |
| 审阅范围              | **v1 只 Layer1**（`sourceSessionId==session`）                 | Layer2 是不同生命周期，拆到 LUM-165                                                                                 |
| 交互形态              | **列表 + 批量指令**（`d 1,3` / `p 2` / 回车全保留 / `s` 跳过） | memory 多时逐条太碎；一行指令可组合                                                                                 |
| 入口                  | **只做 wrap 面板 section**，session-end hook 保持空            | 审阅需 TTY 交互；SessionEnd 无法注入                                                                                |
| 删除/提升的 HTTP 路径 | **单一批量端点** `POST /api/sessions/[id]/memory-review`       | 原子、一次往返、authz 收敛到 session 作用域（防止借端点删任意 memory）；优于循环打 N 次 per-id `/api/memories/{id}` |

## 架构

完全镜像 LUM-151 的 progress-comment 链：

```
lumo session wrap
  └─ MemoryReviewSection.prepare() / run()              cli/src/commands/wrap/memory-review-section.ts
       ├─ GET  /api/sessions/[id]/session-memories      → sessionService.getSessionMemoryDraft
       │        → memoryRepository.findBySourceSessionId(sessionId, since)
       │        → sessionRepository.findProgressContextForMember(+ lastMemoryReviewAt)
       └─ POST /api/sessions/[id]/memory-review          → sessionService.applyMemoryReview
                → memoryRepository (delete + promote in $transaction)
                → sessionRepository.setLastMemoryReviewAt(watermark)
```

### 数据流分层（遵循 CLAUDE.md 的 Component→API Client→Route→Service→Repository）

- **Route**（薄）：解析、Zod 校验、调 service、返回。
- **Service**（`session.service.ts`）：编排 + authz。
- **Repository**（`memory.repository.ts` / `session.repository.ts`）：Prisma 查询，`select` 只取所需字段。

## 组件清单

### 1. Schema 迁移（只动 Session）

`prisma/schema.prisma` 的 `Session` model 加：

```prisma
lastMemoryReviewAt DateTime?
```

一个 nullable、additive 列，与已有的 `lastProgressCommentAt` 同构，无 backfill。

**生产注意**（团队 memory 两条迁移踩坑）：PR 描述注明"需在下次 deploy 跑 `prisma migrate deploy`"；列是 nullable 且旧代码不读它，新旧代码顺序无关，无 500 风险。

### 2. Repository

**`memoryRepository.findBySourceSessionId(sessionId: string, since?: Date)`**（`lib/repositories/memory.repository.ts`）

```
where: { sourceSessionId: sessionId, ...(since ? { createdAt: { gt: since } } : {}) }
select: MEMORY_ROW_SELECT        // 已含 id/scope/category/content/createdByMemberId/createdAt
orderBy: { createdAt: 'asc' }
```

Layer2 的 `sourceSessionId=null` 天然被排除。

**`sessionRepository.setLastMemoryReviewAt(sessionId: string, at: Date)`**（`lib/repositories/session.repository.ts`）—— 与 `setLastProgressCommentAt` 同构。

**`sessionRepository.findProgressContextForMember`**：select 增补 `lastMemoryReviewAt`，复用同一个 member-scoped 读，避免第二次查询。（该方法已被 progress-comment 复用，新增字段不影响既有调用方。）

### 3. Service（`lib/services/session.service.ts`）

**`getSessionMemoryDraft({ identity, sessionId })`** → `{ taskIdentifier, taskTitle, memories: MemoryRow[], watermark }`

镜像 `getSessionProgressDraft`：member 鉴权 → `findProgressContextForMember` → `findBySourceSessionId(sessionId, lastMemoryReviewAt ?? undefined)` → watermark = 最新一条的 `createdAt.toISOString()`（空则 null）。session 不存在/不属于该 member 时返回空 payload。

**`applyMemoryReview({ identity, sessionId, watermark, deleteIds, promoteIds })`** → `{ deleted: number, promoted: number }`

1. member 鉴权 + `findProgressContextForMember`（session 必须属于该 member）。
2. **authz 收敛**：`findBySourceSessionId(sessionId)` 拿到本 session 的合法 id 集合；`deleteIds` / `promoteIds` 与之取交集，**丢弃不属于本 session 的 id**（防止借此端点删/改任意 memory）。
3. 在一个 `$transaction` 里：对交集内的 deleteIds 调 `memoryRepository.delete`，对 promoteIds 调 `memoryRepository.update(id, { scope: 'PROJECT' })`。
4. 成功后 `setLastMemoryReviewAt(new Date(watermark))`。watermark **只在事务成功后推进**，失败则本次新增仍可被下次 wrap 捞到（无静默丢失，对齐 progress-comment 的 watermark 语义）。

### 4. API routes（`app/api/sessions/[sessionId]/`）

- **`session-memories/route.ts`** GET — 薄 handler，镜像 `turn-summaries/route.ts`。
- **`memory-review/route.ts`** POST — Zod 校验 `{ watermark: string (ISO), deleteIds: string[], promoteIds: string[] }`，镜像 `progress-comment/route.ts`。401（key 失效）/ 404（session 不存在/不属于 member）。不需要任务绑定校验——审阅按 `sourceSessionId` 查，与任务绑定无关。

### 5. CLI

- **`cli/src/lib/session-memory-api.ts`**：`fetchMemoryDraft(creds, sessionId)` + `applyMemoryReview(creds, sessionId, payload)`，镜像 `progress-comment-api.ts`（401 → 提示重新登录；非 2xx 抛 server message）。
- **`cli/src/lib/memory-content.ts`**：新增 `formatMemoryReviewList(rows)` —— 编号 + 复用现有 `headline(category, content)`。
- **`cli/src/commands/wrap/memory-review-section.ts`**：`MemoryReviewSection implements WrapSection`，`title = '记忆审阅'`。
  - `prepare()`：拉 draft，`memories.length === 0` → 返回 `false`（runner 打印"(无内容)"）。
  - `run(opts)`：
    ```
    将记入这 3 条 memory（本次会话新增）：
      1. [TASK] TRAP        worktree 缺 node_modules 软链…
      2. [TASK] DECISION    用 dynamic import 断开 @ai-sdk/gateway…
      3. [TASK] CONVENTION  CLI 字符串走 sanitizeField…
    [回车] 全部保留   [d 1,3] 删除   [p 2] 提升到项目级   [s] 跳过本节 >
    ```

    - 解析一行指令，可组合（`d 1,3 p 2`）。索引越界/非法 token → 提示并重问（或跳过）。
    - 调 `applyMemoryReview`，回显 `已删除 N 条 / 已提升 N 条到项目级`。
    - `--yes`：全部保留 + 推进 watermark（语义="看过了，都留下"），不删不改。
    - `--dry-run`：只列出，不 mutate、不推进 watermark。
  - 所有 server free-text 经 `sanitizeField`（团队约定，防 ANSI 注入）。
- **`cli/src/commands/session-wrap.ts`**：`sections = [new ProgressCommentSection(...), new MemoryReviewSection(...)]`（先汇报进度，再审记忆）。

### 6. 文档（CLAUDE.md 强约束）

`cli/src/commands/` 动了 → 更新 `.claude/skills/lumo/SKILL.md` 的 `session wrap` 章节，加上记忆审阅 section 的行为（指令语法、--yes/--dry-run 语义、watermark 去重）。

## 测试（每个新函数至少一个，对齐既有镜像）

| 层      | 文件                                                           | 覆盖                                                                                                                                       |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| repo    | `__tests__/lib/repositories/memory.repository.test.ts`（追加） | `findBySourceSessionId`：since 过滤、排除 null-session、orderBy                                                                            |
| service | `__tests__/lib/services/session-memory-review.test.ts`（新建） | `getSessionMemoryDraft`（watermark 计算、空 payload）；`applyMemoryReview`（authz 丢弃外来 id、delete+promote 事务、watermark 仅成功推进） |
| route   | `__tests__/api/sessions/memory-review-route.test.ts`（新建）   | Zod 校验、401/404                                                                                                                          |
| cli     | `__tests__/cli/session-memory-api.test.ts`（新建）             | fetch/apply 的 200/401/非 2xx                                                                                                              |
| cli     | `__tests__/cli/memory-review-section.test.ts`（新建）          | 指令解析（`d`/`p`/`s`/回车/组合/越界）、--yes、--dry-run、空 draft 跳过                                                                    |

镜像参照：`__tests__/cli/wrap-panel.test.ts`、`progress-comment-section.test.ts`、`progress-comment-api.test.ts`、`__tests__/lib/services/session-progress-comment.test.ts`、`__tests__/api/sessions/progress-comment-route.test.ts`。

## 错误处理

- session 不存在 / 不属于 member → 空 draft（GET）/ 404（POST），CLI 友好提示。
- 无绑定任务：memory 审阅按 `sourceSessionId` 查，不强依赖任务绑定；但本次新增 memory 本就挂在任务上，无绑定时 draft 自然为空 → 跳过该 section。
- 网络 / 401：CLI 抛 server message，提示 `lumo auth login`。
- 事务失败：watermark 不推进，本次新增下次 wrap 仍可见。

## 验收

1. session 内产生过 Layer1 memory 后跑 `lumo session wrap` → 记忆审阅 section 列出本次新增，可 `d`/`p`/回车/`s`。
2. 处理后 watermark 推进；再次 `wrap` 不重复列出已处理的。
3. `--dry-run` 只列不改、不推进；`--yes` 全留 + 推进。
4. 无新增 memory → section 打印"(无内容)"。
5. `npx tsc --noEmit` 无错（注意 `exactOptionalPropertyTypes`：可选字段声明 `field?: T | undefined`）；`npm test` 绿；无 `console.log`。
6. `.claude/skills/lumo/SKILL.md` 的 `session wrap` 章节已更新。
