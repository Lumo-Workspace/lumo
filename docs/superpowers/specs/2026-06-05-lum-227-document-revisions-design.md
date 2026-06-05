# LUM-227 · 文档历史版本 + 对比 + 恢复 — 设计文档

- **Task**: LUM-227 — 文档历史版本 + 对比 + 恢复
- **Milestone**: 文档编辑器优化
- **Date**: 2026-06-05
- **Status**: Approved (brainstorming) → ready for implementation plan

## 1. 背景与目标

当前 `Document` 模型没有任何版本/历史能力（无 revision 字段）。对标飞书/Notion 的 Tier1 协作能力，需要：

1. **快照存储** — 按"保存时节流"自动为文档内容存历史版本。
2. **版本列表** — 在文档编辑器内查看历史版本（时间 / 作者 / 命名）。
3. **差异对比** — 选中版本与当前内容（或任意两版）做 diff。
4. **一键恢复** — 把某历史版本恢复为当前内容，且动作可逆。

**核心约束**：快照需节流 / 合并相邻编辑，避免历史表膨胀。

## 2. 关键决策（brainstorming 结论）

| #   | 决策点    | 选定方案                                                                 |
| --- | --------- | ------------------------------------------------------------------------ |
| 1   | 快照策略  | 保存时节流快照                                                           |
| 2   | 合并粒度  | 同作者 **10 分钟滑动窗口**合并为一版                                     |
| 3   | 保留策略  | **时间衰减**（cron），首版 + 手动命名版永久保留                          |
| 4   | Diff 样式 | **行内 word-level**（默认），可切换左右并排（大改动用）                  |
| 5   | 历史入口  | **全屏弹窗**（左版本时间线 + 右 diff + 恢复按钮）                        |
| 6   | 恢复语义  | 走正常保存链路**再生成一条新版本**（可逆）；评论锚点复用现有 orphan 机制 |
| 7   | 手动快照  | **支持**"保存为版本"，带名称/标记（`label`）                             |

## 3. 数据模型

新增 `DocumentRevision` 模型（迁移仅建表，纯增量，无破坏性）：

```prisma
model DocumentRevision {
  id          String   @id @default(cuid())
  documentId  String
  document    Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  content     String?  @db.Text          // HTML 快照，与 Document.content 同格式
  title       String   @default("")
  emoji       String?
  label       String?                     // 手动命名；null = 自动快照
  isManual    Boolean  @default(false)    // 命名版永不被衰减清理
  authorId    String                      // 触发保存的 WorkspaceMember
  author      WorkspaceMember @relation("MemberDocumentRevisions", fields: [authorId], references: [id])
  workspaceId String                      // 反范式，便于 scoping
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  wordCount   Int?                        // 分析用，可选
  createdAt   DateTime @default(now())    // 窗口开启时间
  updatedAt   DateTime @updatedAt         // 窗口内合并时刷新
  @@index([documentId, createdAt])
}
```

`Document` 增加反向关系：`revisions DocumentRevision[]`。
`WorkspaceMember` / `Workspace` 增加对应反向关系。

**迁移注意**：纯新表，可在代码部署前安全 `migrate deploy`（不触发 memory 里"新列未迁移→500"陷阱）。PR 描述需注明 "requires `migrate deploy` on next deploy"。

## 4. 快照捕获流程（节流 + 同作者滑动窗口合并）

- 接入点：`documentService.updateDocument()` 内容**成功写入后**，若 content 发生变化，
  调用 `waitUntil(revisionService.snapshotOnSave(documentId, memberId, { content, title, emoji }))`
  —— 不阻塞 API 响应（沿用项目 waitUntil 副作用约定）。
- **合并规则**（`snapshotOnSave`）：
  1. 取该文档最新一条 revision。
  2. 若 `latest.isManual === false && latest.authorId === memberId && (now - latest.updatedAt) ≤ 10min`
     → **UPDATE** 该行：覆盖 content / title / emoji，刷新 `updatedAt`（窗口内合并）。
  3. 否则 → **INSERT** 新行。
- 纯 title / emoji 改动**不**单独建版；content 变更时顺带快照当前 title / emoji。
- `createDocument()` 时建一条**初始版 v1**作为永久基线（首版受保护）。

## 5. 保留策略（时间衰减 cron）

- 新增 `app/api/cron/prune-document-revisions/route.ts`（GET handler）。
- `vercel.json` 的 crons 数组新增条目，**每日执行一次**。
- 衰减档位（针对 `isManual = false` 的自动版）：
  - **24h 内**：全部保留。
  - **7 天内**：每个自然日保留最新一版。
  - **更早**：每个 ISO 周保留最新一版。
- **永不删除**：`isManual = true` 的命名版；每个文档最早的一条（首版）。
- 实现为按文档分组遍历，计算每档存活集合，删除其余。

## 6. Diff（行内 word-level，前端计算）

- 新增 npm 依赖 **`diff`（jsdiff）**——PR 描述需注明新增依赖（遵守 Forbidden 规则）。
- 弹窗内 client-side 对比："选中版 vs 当前内容"为默认，亦可任选两版。
- 算法：将两版 HTML token 化后 `diffWords`，渲染为行内 红色删除 / 绿色新增 span。
- 提供切换到**左右并排（B）**视图：两栏各自渲染完整 HTML，用于看格式级大改。
- **范围外（后续）**：富格式级 inline diff（加粗 / 标题等格式变化的高亮）不在本期。

## 7. 恢复（可逆 + 复用 orphan 机制）

- `revisionService.restoreRevision(docId, revId, memberId)`：
  1. 权限校验 EDITOR / MANAGER / OWNER（复用 `documentService.getUserRole`）。
  2. 把旧版 content 通过**正常 `updateDocument` 链路**写回 Document。
  3. 该写回自动触发 `snapshotOnSave` → 再生成一条新 revision（恢复动作可被再恢复）。
  4. 评论锚点走现有重算 / `isOrphaned` 检测，无需特殊处理。

## 8. API（薄路由 → revisionService）

| 方法 | 路径                                            | 用途                        | 权限       |
| ---- | ----------------------------------------------- | --------------------------- | ---------- |
| GET  | `/api/documents/[id]/revisions`                 | 版本列表（仅元数据，分页）  | 可读文档者 |
| GET  | `/api/documents/[id]/revisions/[revId]`         | 单版完整内容（diff / 预览） | 可读文档者 |
| POST | `/api/documents/[id]/revisions`                 | 手动命名快照 `{ label }`    | EDITOR+    |
| POST | `/api/documents/[id]/revisions/[revId]/restore` | 恢复                        | EDITOR+    |

cron 路由为内部触发，不在上表。

**分层落地**：

- `lib/repositories/documentRevision.repository.ts` — create / updateLatest / listByDocument(元数据 select) / findByIdWithContent / prune 辅助。
- `lib/services/documentRevision.service.ts` — snapshotOnSave / createManualSnapshot / listRevisions(权限) / getRevision / restoreRevision / pruneRevisions。
  - 不直接访问 Prisma；通过 repository。restore 通过 `documentService.updateDocument` 复用现有链路。
- `lib/validation/` — revision 相关 Zod schema（手动快照 label 校验等）。
- `lib/api-client/documents.ts` — `documentRevisionsApi`（list / get / createManual / restore）+ React Query hooks。

## 9. UI（全屏弹窗）

- `DocumentHistoryModal` 组件：
  - 入口：编辑页"…"菜单 →"历史版本"。
  - 左栏：按日分组的版本时间线（作者头像 / 时间 / 命名版 ⭐ 徽标）。
  - 右栏：diff 视图（默认行内 word-level，可切左右并排）+「恢复此版本」按钮。
  - 默认对比"选中版 vs 当前内容"；支持选两版对比。
- 编辑页工具栏新增「保存为版本」入口（弹出名称输入 → `POST .../revisions`）。
- 遵循 SRP：列表 / diff 渲染 / 数据获取拆分为独立单元（list 组件、diff 组件、`useDocumentRevisions` hook）。

## 10. i18n

- 新增 `documentHistory.*` 命名空间键。
- **16 个 locale 文件全部补真实翻译**（en, en-AU, en-GB, zh-CN, zh-TW, es, es-419, fr, de, ru, ja, ko, hi, vi, id, ms）——遵守 CLAUDE.md i18n 规则 + `__tests__/i18n-locale-parity.test.ts` 严格校验（同 PR 补齐，非英文不得用英文兜底）。

## 11. 测试

- `documentRevision.repository.test.ts` — 窗口合并三场景（同作者窗口内 UPDATE / 换人 INSERT / 超时 INSERT / 手动版始终 INSERT 且不被合并）。
- `documentRevision.service.test.ts` — snapshotOnSave 决策、restore 走 updateDocument、权限校验、prune 衰减策略（用固定注入时间戳）。
- `api/documents-revisions.test.ts` — 路由集成（鉴权 → 校验 → service → 响应）。
- diff util 单测 — word-level diff 产出预期分段。
- `DocumentHistoryModal` jsdom 轻测（参考现有组件测试模式；注意 Radix 在 jsdom 的已知限制，dropdown-open-gated 行为在 hook 层验证）。

## 12. 工程注意

- **分支**：从最新 `origin/main` 切 `lumo/LUM-227-doc-revisions`（当前会话仍在 LUM-226 分支，开工前切）。
- **迁移**：若 dev DB drift 阻塞 `migrate dev`，按 memory 流程用 `prisma migrate diff` 离线生成 SQL；prod 加表为增量，可在 PR 合并前/部署时 `migrate deploy`。
- **tsc**：`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 已开——可选字段声明 `field?: T | undefined`，数组下标先 guard；最终跑 `npx prisma generate && npx tsc --noEmit`。
- **新依赖**：`diff`(jsdiff) 需在 PR 描述注明。

## 13. 范围外（明确不做）

- 富格式级（加粗 / 标题 / 列表结构）的高亮 inline diff——本期只做文字级 word diff + 并排看格式。
- 实时协同编辑（OT/CRDT）——与本任务无关。
- 跨文档 / 评论状态随版本回滚——评论仅走现有 orphan 机制。
