# LUM-226 文档选区锚定评论 — 设计文档

- **任务**: LUM-226 文档选区锚定评论
- **里程碑**: 文档编辑器优化（Tiptap 富文本编辑器一轮整改）
- **日期**: 2026-06-04
- **状态**: 设计已批准，待写实现计划

## 1. 背景与目标

当前 `Comment` 模型只锚 `taskId`，文档（Document）完全不能评论。本任务对标飞书/Notion 的 Tier1 协作能力，为文档增加**划词锚定评论**：选中正文 → 评论气泡 → 发表；正文出现高亮锚点；右栏侧边聚合所有讨论线程。

### v1 范围（全量对标飞书/Notion）

- 划词 → 气泡 → 发评论
- 正文高亮锚点，点评论 ↔ 点高亮双向联动
- 右栏侧栏聚合讨论线程
- 1 级回复线程（复用 `parentId`）
- resolve / reopen 状态
- @提及 + 通知（inbox / Slack，复用现有 @mention 管线）
- 锚点漂移自动跟随 + 孤儿（原文删除）兜底
- 可软删除评论

## 2. 关键设计决策

| 决策     | 选择                                                                                                     | 理由                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 锚点策略 | **混合 C**：mark 做视觉锚定+自动跟随，讨论/线程/resolve 存 `DocumentComment` 表，`quotedText` 做孤儿兜底 | 漂移免费（mark 在 content 内随编辑跟随）；业务与正文解耦，分层干净；对标飞书/Notion 实际做法 |
| 发表权限 | **VIEWER 也能评论**                                                                                      | 对标 Notion commenter；写 mark 做成服务端特权 content-patch，不走常规编辑权限                |
| 孤儿处理 | **保留并标"已失效"**，可手动 resolve                                                                     | 不丢讨论上下文，对标飞书/Notion                                                              |
| 线程模型 | 顶层评论即锚点+线程头，回复用 `parentId`                                                                 | 镜像现有任务评论，repo/service/component 范式直接复用                                        |
| 侧栏位置 | 右栏与 `DocumentToc` 做 tab 切换（"大纲 / 评论"）                                                        | 不另占横向空间                                                                               |

## 3. 数据模型（Prisma）

新增 `DocumentComment`，刻意镜像现有 `Comment` 形状：

```prisma
model DocumentComment {
  id                String   @id @default(cuid())   // 客户端生成 cuid，使 mark 与 DB 一致
  documentId        String                          // FK Document, onDelete: Cascade
  authorActorId     String?                         // FK Actor, onDelete: SetNull
  body              String                          // HTML，@mention 用 data-id 编码（复用现有）
  parentId          String?                         // 自引用 1 级回复（"DocCommentReplies"）
  // —— 仅顶层评论（线程锚点）填以下字段 ——
  quotedText        String?                         // 划词原文快照（孤儿兜底 + 侧栏预览）
  anchorStart       Int?                            // ProseMirror 位置快照（排序/兜底，best-effort）
  anchorEnd         Int?
  status            DocumentCommentStatus @default(OPEN)
  resolvedByActorId String?                         // FK Actor, onDelete: SetNull
  resolvedAt        DateTime?
  isOrphaned        Boolean  @default(false)        // 加载时 mark 缺失 → 置位
  type              CommentType @default(USER)      // 复用现有枚举（USER/AGENT）
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?                       // 软删除

  // relations: document, author(Actor), resolvedBy(Actor), parent/replies(self)
}

enum DocumentCommentStatus {
  OPEN
  RESOLVED
}
```

- `Document.documentComments DocumentComment[]`；`Actor` 反向关系（authored / resolved）。
- content 里的 `CommentMark` 携带的 `commentId` = 顶层评论 id。
- Notification 枚举新增 `DOCUMENT_COMMENT_MENTIONED`，复用现有 @mention 通知管线。

### 迁移注意（见项目 memory traps）

- 新列全部 nullable / 带默认值。
- **先部署能处理 / 忽略 `CommentMark` 的前端代码，再上 `migrate deploy`**，避免旧前端读不存在的列。
- PR 描述注明 prod 需 `prisma migrate deploy`；确认部署后用 `prisma migrate status` 校验。

## 4. 编辑器层（Tiptap）

- **`lib/editor/marks/comment.ts`** — `CommentMark`：属性 `commentId`，渲染 `<span data-comment-id="…" class="comment-highlight">`，`inclusive: false`（边界打字不扩展）。加入 `lib/editor/extensions.ts` 共享列表（任务描述编辑器不挂评论 UI，无副作用）。命令：`setCommentMark(range, id)` / `unsetCommentMark(id)` / 按 id 查 mark 范围（滚动定位 + 孤儿检测用）。
- **`lib/editor/plugins/comment-decorations.ts`** — ProseMirror 插件做**瞬态状态**：当前选中线程的高亮强调、hover 联动、scroll-to-flash；**孤儿检测**（加载后比对 content 中 commentId 集合 vs DB 中 OPEN 评论集合，缺失者 → `isOrphaned`）。
- **BubbleMenu** 增加"💬 评论"按钮（划词非空时已显示），点击打开锚定选区的评论输入气泡。

## 5. 权限与 content-patch（核心实现难点）

发评论 = 两次写入：① DB 建 `DocumentComment` 行；② 往 content 写 `CommentMark`。统一路径（VIEWER 与 EDITOR 同一条）：

1. 客户端在活动编辑器对选区应用 `CommentMark`（用客户端生成的 cuid），`getHTML()` 得到新 content。
2. 创建评论 POST 带 `{ id, from, to, quotedText, body, content }`。
3. 服务端：建行 → 作为**评论专用特权补丁**持久化 content（绕过常规编辑权限，仅校验调用者 ≥ VIEWER 访问权）。
4. **防滥用守卫**：服务端解析新旧 content，断言**归一化纯文本完全相同**（只允许新增带 `data-comment-id` 的 span），否则 400 拒绝——防止 VIEWER 借评论接口夹带正文修改。

> **#1 实现风险**：content 版本冲突 / 并发（评论 patch 与现有 autosave 竞争）。实现计划第一步应排一个**小 spike**，验证 server 端 text-equality 守卫的可行性，以及与 autosave 防抖的冲突窗口（理想是 server 端做定向 mark 插入，而非整文覆盖）。漂移本身免费：mark 在 content 内随正常编辑自动跟随。

## 6. 分层实现（镜像任务评论栈）

数据流：`Component → useDocumentComments → api-client/documents → /api/documents/[id]/comments → service → repository → Prisma`

| 层         | 文件                                                                                                                    | 要点                                                                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository | `lib/repositories/documentComment.repository.ts`                                                                        | `findByDocumentId`（线程+回复嵌套+作者）、`findByIdWithDocument`（带 workspaceId 鉴权）、create / update / softDelete、`setStatus`、`setOrphaned(ids)`                                                                                                                              |
| Service    | `lib/services/documentComment.service.ts`                                                                               | `createCommentWithSideEffects`（建行 + content-patch + Pusher + activity + @通知，副作用包 `waitUntil`）、update / delete、`resolve` / `reopen`、`parseMentionedActorIds`（抽公共 util 复用）、`applyCommentMarkToContent`（含 text-equality 守卫）、`requireDocAccess(min=VIEWER)` |
| API Route  | `app/api/documents/[id]/comments/route.ts`（GET / POST）+ `.../[commentId]/route.ts`（PATCH 改 body / resolve、DELETE） | 薄（~50-100 行）；Zod 校验；只调 service                                                                                                                                                                                                                                            |
| Validation | `lib/validation/`（doc 域）                                                                                             | `createDocumentCommentSchema` / `updateDocumentCommentSchema` / `resolveDocumentCommentSchema`；可选字段写 `field?: T \| undefined`（exactOptionalPropertyTypes）                                                                                                                   |
| API Client | `lib/api-client/documents.ts` + API 路由常量表                                                                          | list / create / update / delete / setStatus                                                                                                                                                                                                                                         |

## 7. UI 组件

位置：`app/workspace/[workspaceUrl]/components/document/comments/`

- **`DocumentCommentsSidebar.tsx`** — 右栏面板，聚合所有线程，可筛 OPEN / RESOLVED；与 `DocumentToc` 做 tab 切换（"大纲 / 评论"）。
- **`DocumentCommentThread.tsx`** — 单线程：引文快照 + 评论列表 + 回复输入 + resolve 按钮 + 孤儿"原文已删除"标记。
- **`NewCommentPopover.tsx`** — 划词后锚定选区的新建气泡。
- 复用：`CommentEditor`（DescriptionEditor 包装）、`CommentAvatar`、`comment-utils`、`CommentItem`。
- **`useDocumentComments` hook**（React Query）— list + 乐观 create / update / delete / resolve，仿 `useWebLinks`（乐观测试用 `waitFor`）。
- **联动**：点侧栏线程 → 编辑器滚动到 mark + flash；点正文高亮 → 侧栏定位线程；hover 双向高亮。

## 8. 实时

复用现有 Pusher document channel，广播 comment created / updated / deleted / resolved，其他在线协作者侧栏 + 高亮实时更新。

## 9. 错误处理

Service 抛 `Object.assign(new Error(msg), { status })`：

- 403 无文档访问权
- 404 文档 / 评论不存在
- 409 content 版本冲突
- 400 非法 range / content 守卫失败

孤儿不是错误，而是标记态（`isOrphaned`）。

## 10. 测试（Jest，cwd 在 worktree 内）

- **repo**：CRUD + 软删 + status。
- **service**：建评论应用 mark；**守卫拒绝篡改 content**；mention 解析；resolve 权限；孤儿检测。（mock Prisma）
- **validation**：schema 边界。
- **hook**：`useDocumentComments` 乐观 create / resolve（用 `waitFor`）。
- **组件**：侧栏渲染线程 / resolve 切换 / 孤儿标签 / bubble 有"评论"按钮（Radix popover 在 jsdom 测 hook 层或 props）。
- **api route**：handler 测试（注意 afterRecord mock 缺失陷阱）。
- 约束：每个新函数至少一个测试。

## 11. i18n

`lib/i18n/` **全 16 个 locale** 新增 key（`document.comments` / addComment / reply / resolve / reopen / resolved / orphanedAnchor「原文已删除」/ placeholder …），**每语言给真实翻译，不用英文兜底**。

## 12. 实现分期（细节留给 writing-plans）

1. 后端五层 + 测试（schema / repo / service / API / validation）
2. CommentMark + decoration 插件 + bubble action
3. 侧栏 + 线程 + composer + hook + 实时
4. resolve + 孤儿处理 + @提及通知
5. i18n + 打磨

## 13. 未决 / 风险

- **content-patch 并发一致性**（#1 风险）：需 spike 验证 server 端 text-equality 守卫与 autosave 冲突窗口；理想为定向 mark 插入而非整文覆盖。
- server 端解析 content（HTML 字符串）以做 text-equality 守卫的具体手段（`@tiptap/html` generateJSON / DOM polyfill）在 spike 中敲定。
- resolve 权限边界（仅作者 / EDITOR+ / 任意有访问权者）在写计划时确认。
