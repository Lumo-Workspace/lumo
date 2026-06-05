# LUM-223 — Backlinks 双向链接：Documents 区增量增强

**Date**: 2026-06-04
**Task**: LUM-223 — Backlinks 双向链接（文档↔任务反链）
**Branch**: `lumo/LUM-223-backlinks`

## 背景与现状

护城河 feature 的原始诉求：文档正文里 `@task` 提及 `LUM-N` 时，在任务详情页反向显示「被哪些文档提到」。

调研发现这条反链链路**已在 origin/main 上实现并上线**：

| 环节 | 现状 | 出处 |
| --- | --- | --- |
| 落库 | `DocumentMention` 表（`documentId/taskId/source=CONTENT\|EXPLICIT`，`@@unique([documentId, taskId])`） | `prisma/schema.prisma:1044` |
| 正文解析 | 文档保存时 `extractTaskMentionIds()` 扫 HTML 中 `mentionType==='task'` 的 mention 节点，sync `source=CONTENT` 反链 | `lib/services/document.service.ts:535` |
| 反查 | `findDocumentMentionsByTask(taskId, workspaceId, memberId)` 返回该任务全部反链（CONTENT+EXPLICIT，**不过滤 source**），带 workspace+可见性权限过滤 | `lib/repositories/misc.repository.ts:182`（LUM-122 引入） |
| API | `GET /api/tasks/[id]/documents` | `app/api/tasks/[id]/documents/route.ts` |
| Hook | `useTaskDocuments(taskId, enabled)` | `app/workspace/[workspaceUrl]/hooks/useTaskDocuments.ts` |
| UI | 任务详情页 **Context tab → "Documents" 折叠区**，列出提到该任务的文档；有内容时默认展开；CONTENT 行不可手动 detach（触发 `CONTENT_MENTION_ONLY` 提示） | `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx` + `ContextTab.tsx:84` |

**结论**：原始诉求功能上已满足。本任务定位为**轻量增量增强**——让「正文反链（CONTENT）」与「手动绑定（EXPLICIT）」在 Documents 区一眼可分，提升反链的可读性。

## 目标

在不动 schema、不动迁移、不碰文档查看器的前提下，对现有 Context tab → Documents 区做三项轻量增强：

1. **区分来源 badge**：每行文档名后加小 badge——「正文提及」(CONTENT) /「手动绑定」(EXPLICIT)。
2. **按来源排序**：CONTENT 反链置顶、EXPLICIT 手动绑定在后；同组内保持原有顺序（稳定排序）。
3. **计数/空态文案优化**：空态与顶部说明文案改为反链语义。

## 非目标（YAGNI / 另开任务）

- **跳转/高亮到文档内 `@task` 提及位置**——需文档查看器锚点支持，超出轻量范围，建议另开任务（LUM-N）。
- 不新增独立 sidebar 面板、不新增左栏独立区块、不新增 tab——经确认保留 Context tab 内增强。
- 不重构 `GET /api/tasks/[id]/documents` route 的分层（该 route 现状直接调 repository，是其既有模式，本任务不扩散重构）。

## 设计

### 1. 后端：透传 `source`

`findDocumentMentionsByTask` 返回的每个 mention 行已含 `source`（`DocumentMention` 的标量字段，查询未用顶层 `select` 排除，默认返回），只是 route 把它丢弃了。

**改动** `app/api/tasks/[id]/documents/route.ts`（约第 62 行）：

```ts
// before
const documents = mentions.map(m => m.document)
// after
const documents = mentions.map(m => ({ ...m.document, source: m.source }))
```

不改 repository、不改 service。

### 2. API Client 类型

`lib/api-client/task-documents.ts` 的 `TaskDocumentResource` 增加 `source` 字段：

```ts
export interface TaskDocumentResource {
  id: string
  slug: string
  title: string
  emoji: string | null
  updatedAt: string
  source: 'CONTENT' | 'EXPLICIT' // 前端字面量联合，不引 Prisma enum 进 bundle
}
```

### 3. 前端：DocumentsSection 渲染

只改 `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx`：

- **排序**：在 render 前用本地派生（`useMemo` 或纯局部变量）对 `documents` 做稳定排序——`source==='CONTENT'` 在前、`'EXPLICIT'` 在后；同 source 内保持入参顺序。不在 render 中产生副作用、不 mutate props（复制后排序）。
- **来源 badge**：每行文档名后渲染一个小 badge：
  - `CONTENT` → 「正文提及」
  - `EXPLICIT` → 「手动绑定」
  - 形态采用**扁平列表 + 排序 + badge**，不做分组标题（badge 已是区分信号，分组标题会与 badge 双重编码）。
- **detach 按钮收敛**：仅 `source==='EXPLICIT'` 的行渲染 X（detach）按钮。CONTENT 行本就不可手动 detach（会触发 `CONTENT_MENTION_ONLY`），按 source 隐藏按钮避免「点了才被拒」。现有的 `CONTENT_MENTION_ONLY` 容错分支保留（防御 race）。
- **计数**：`ContextSection` 的 `count` 仍传文档总数 `documents.length`。
- **空态/说明文案**：空态文案改为反链语义（如「还没有文档提到此任务」）；顶部说明文案按反链语义微调。

### 4. i18n

新增 message key（badge ×2、空态文案、必要的说明文案），须同步**全部 16 个 locale 文件**（`lib/i18n/*.json`：de, en, en-AU, en-GB, es, es-419, fr, hi, id, ja, ko, ms, ru, vi, zh-CN, zh-TW），每种语言给真实翻译，**不用英文兜底**（CLAUDE.md i18n 硬性要求）。

建议 key（最终以实现为准）：

- `task.context.documents.source.content` → 「正文提及」
- `task.context.documents.source.explicit` → 「手动绑定」
- `task.context.documents.empty`（已存在，更新文案为反链语义）

### 5. 测试

- **Route 透传测试**（`__tests__/`）：mock `miscRepository.findDocumentMentionsByTask` 返回 CONTENT+EXPLICIT 混合，断言 `GET /api/tasks/[id]/documents` 响应每个 document 带正确 `source`。
- **DocumentsSection 组件测试**（jsdom + react-intl）：
  - 渲染两类 badge（文案正确）；
  - CONTENT 行排在 EXPLICIT 之前；
  - 仅 EXPLICIT 行有 detach 按钮，CONTENT 行无；
  - 空态文案。
- **回归证据**：上述「混合 source 下两类都渲染且 CONTENT 置顶」即作为反链可见性的回归断言（呼应团队规约：不靠读代码判定 done，要有测试证据）。

### 6. 验证关卡

- `npm test`（在 worktree cwd 内运行，避免 haste 冲突）全绿。
- `npx prisma generate && npx tsc --noEmit` 无类型错误（注意 `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess`）。
- `npm run lint:tokens`（若触及颜色类）；badge 用语义 token，不引入裸 palette 类。
- 无 `console.log`。

## 影响文件清单

- `app/api/tasks/[id]/documents/route.ts`（透传 source）
- `lib/api-client/task-documents.ts`（类型加 source）
- `app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection.tsx`（排序 + badge + detach 收敛 + 文案）
- `lib/i18n/*.json` ×16（新增/更新 key）
- `__tests__/`（route 透传 + 组件渲染测试）

## 交付与状态

- PR 标题：`feat: distinguish content vs explicit doc backlinks on task detail [LUM-223]`
- PR 描述说明：无 schema 变更、无迁移；新增 i18n key 已覆盖全部 locale；无新增 npm 依赖。
- 状态流转：PR 开启期间 LUM-223 置 `in_review`；落 origin/main 后才置 `done`（团队规约：merged PR ≠ done）。
