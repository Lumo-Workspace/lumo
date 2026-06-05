# 文档模板库（PRD/RFC/会议纪要/周报）— 设计 [LUM-225]

- **任务**: LUM-225 · 文档模板库（PRD/RFC/会议纪要）
- **里程碑**: 文档编辑器优化
- **状态**: 设计已对齐，待写实现计划
- **日期**: 2026-06-04

## 1. 背景与目标

护城河 feature（对标飞书 / Notion Tier3）。新建文档时可选模板，一键带入结构化骨架（预置 content），并复用现有「checkbox → 任务抽取」链路，使会议纪要的 Action Items 可一键转 Lumo 任务。

**v1 范围**：内置 4 个系统模板（PRD、RFC、会议纪要、周报），新建文档时弹模板选择器。不含团队自定义模板的 CRUD UI（数据模型预留口子）。

**非目标（v1 明确不做）**：

- 团队 / 用户自定义模板的增删改 UI
- AI 自动抽取 Action Items（继续用现有「手动勾选 → 抽取」能力）
- 模板正文的多语言版本（正文单一中文；仅选择器名/描述走 react-intl）
- slash command 内联插入模板

## 2. 关键决策（已与用户对齐）

| 维度         | 决定                                                         | 理由                                                  |
| ------------ | ------------------------------------------------------------ | ----------------------------------------------------- |
| 模板存储     | DB 表 `DocumentTemplate`，内置模板由 seed 落地               | 留团队自定义模板口子；可查询                          |
| 模板正文来源 | 代码常量 `lib/editor/templates/*.ts`，seed 幂等 upsert 进 DB | 版本可控、可 code review；改模板 = 改常量 + 重跑 seed |
| 抽取规则     | 复用现有 checkbox→任务抽取，模板正文塞 task-list 节点        | 零新后端，最快交付                                    |
| 选模板入口   | 新建文档时弹模板选择器（空白 + 各模板卡片）                  | 最贴近 Notion / 飞书体验                              |
| v1 模板集    | PRD、RFC、会议纪要、周报（全四个）                           | 任务描述点名全集                                      |
| 骨架正文     | 单一中文 HTML；选择器名/描述走 react-intl                    | 数据模型简单；避免 N 语言正文维护                     |

## 3. 数据模型

新增 Prisma 模型（additive，非破坏）：

```prisma
model DocumentTemplate {
  id          String     @id @default(cuid())
  key         String     @unique          // "prd" | "rfc" | "meeting-notes" | "weekly-report"
  emoji       String?
  content     String     @db.Text         // 骨架 HTML，与 Document.content 同格式
  sortOrder   Float
  isSystem    Boolean    @default(true)    // 内置系统模板
  workspaceId String?                      // null = 全局系统模板；非 null = 预留团队自定义
  workspace   Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@index([workspaceId])
}
```

- `Workspace` 模型加反向关系 `documentTemplates DocumentTemplate[]`。
- 系统模板：`isSystem = true`、`workspaceId = null`。v1 仅有系统模板。
- `content` 与 `Document.content` 一样存 HTML（不是 ProseMirror JSON）。

### Seed

- 模板正文写在 `lib/editor/templates/{prd,rfc,meeting-notes,weekly-report}.ts`，每文件导出 `{ key, emoji, content, sortOrder }`。
- 一个 barrel `lib/editor/templates/index.ts` 汇总为 `SYSTEM_TEMPLATES` 数组。
- `prisma/seed.ts` 对每个按 `key` 做 `upsert`（update content/emoji/sortOrder，create 同字段，`workspaceId: null`）。幂等：重跑不产生重复。

## 4. 分层架构

数据流遵循 `Component → API Client → API Route → Service → Repository → Prisma`。

### Repository — `lib/repositories/document-template.repository.ts`

- `listVisible(workspaceId: string)`：返回系统模板（`workspaceId = null`）+ 本 workspace 自定义模板，按 `sortOrder` 排序。
- `findById(id: string)`：单条。
- 只用 `select` 取需要字段，不含业务逻辑、不做权限判断。

### Service — `lib/services/document-template.service.ts`

- `listTemplates(workspaceId)`：调用 repo，返回领域模型给路由。
- `getTemplateForCreation(workspaceId, templateId)`：取模板，校验可见性（系统或属于该 workspace），返回 `{ content, emoji }`；找不到/不可见 → `throw Object.assign(new Error('Template not found'), { status: 404 })`。

### Service 改动 — `lib/services/document.service.ts`

- `createDocument` 入参加可选 `templateId?: string | undefined`（注意 `exactOptionalPropertyTypes`，声明为 `| undefined`）。
- 逻辑：当 `templateId` 存在且未显式传 `contentMarkdown` 时，调用 `documentTemplateService.getTemplateForCreation` 取 `content`（已是 HTML，直接作为初始 content，跳过 markdown→html 转换）；若模板有 `emoji` 且入参未指定 emoji，则采用模板 emoji。
- `templateId` 与 `contentMarkdown` 同时传时，以显式 `contentMarkdown` 为准（templateId 忽略），避免歧义。

### API Route

- 新 `app/api/document-templates/route.ts`：`GET` → 鉴权 → `documentTemplateService.listTemplates(workspaceId)` → 200。瘦路由，无 Prisma。
- 现有 `app/api/documents/route.ts` POST：`createDocumentSchema` 加 `templateId: z.string().cuid().optional()`；路由把 `templateId` 透传给 service。

### API Client — `lib/api-client/`

- `documents.create` 已支持任意 body，前端调用时带 `templateId`。
- 新增 `documentTemplates.list()`（或在 documents client 加 `listTemplates()`），封装 `GET /api/document-templates`。
- 在 `lib/api/endpoints`（或等价常量）加 `documentTemplates.list` 路径。

## 5. UI 流程

```
点「新建文档」（DocumentsPage 按钮 / GlobalDocTree 的「+」/「Add sub-page」）
   → 弹 DocumentTemplatePicker（卡片网格：空白文档 + PRD + RFC + 会议纪要 + 周报）
   → 选「空白」：create({ parentId })，无 templateId（现有逻辑）
   → 选模板：create({ templateId, parentId })，服务端注入骨架 HTML
   → 跳转编辑器，正文已带骨架
```

### 组件 — `DocumentTemplatePicker.tsx`

- shadcn `Dialog` + 卡片网格。每卡：emoji + 名称 + 一句描述。
- 模板数据来自 `useQuery` → `GET /api/document-templates`。
- 名称 / 描述用 react-intl 按 `key` 渲染（见 §6），不依赖 DB 文案。
- 「空白文档」是固定首卡，不来自 DB。
- 选中 → 调用传入的 `onSelect(templateId | null)`，由父组件发起 create + 跳转。

### 接入点

- `DocumentsPage` 的「新建文档」按钮：打开 picker。
- `GlobalDocTree` 的「+」/「Add sub-page」：打开 picker，透传 `parentId`。
- 三个入口统一走 picker，保持体验一致。

## 6. i18n

新增 key（**所有 16 个 locale 文件都补，禁止英文兜底**）：

```
documents.selectTemplate              // 弹窗标题，如「选择模板」
documents.templateBlank               // 「空白文档」
documents.templateBlankDesc           // 「从空白开始」
documents.template.prd                // 「PRD」
documents.template.prdDesc            // 描述
documents.template.rfc
documents.template.rfcDesc
documents.template.meetingNotes
documents.template.meetingNotesDesc
documents.template.weeklyReport
documents.template.weeklyReportDesc
```

## 7. 模板内容（单一中文 HTML 骨架）

- **PRD**：背景 / 目标 / 非目标 / 用户故事 / 方案 / 里程碑 / 风险
- **RFC**：摘要 / 动机 / 详细设计 / 备选方案 / 影响面 / 未决问题
- **会议纪要**：时间·地点·参会人 / 议程 / 讨论记录 / **Action Items（task-list）** / 下次会议
  - Action Items 用 `<ul data-type="taskList"><li data-type="taskItem" data-checked="false">…</li></ul>`，被现有 `document-task-extraction.service` 识别，用户可一键转任务。
- **周报**：本周完成 / 进行中 / 下周计划 / 阻塞 / 指标

所有骨架 HTML 必须是 `getBaseExtensions()` 能正确解析的合法结构（headings、lists、taskList、table 等）。

## 8. 测试（Jest，`__tests__/`，每新函数至少一个测试）

- `document-template.repository.test.ts` — 可见性过滤（系统 + 本 workspace；排除他 workspace）。
- `document-template.service.test.ts` — `listTemplates` / `getTemplateForCreation`（命中、404、跨 workspace 拒绝）。
- `document.service.test.ts`（扩充）— 传 `templateId` → 新文档 content = 模板 content；`templateId` + `contentMarkdown` 同传 → 以 contentMarkdown 为准。
- `api/document-templates.test.ts` — GET 路由（鉴权 + 返回列表）。
- `DocumentTemplatePicker` jsdom 组件测试 — Radix Dialog 在 jsdom 无法真正 open（无 hasPointerCapture polyfill），在 props/hook 层断言 onSelect 调用参数，不模拟真实开合。
- seed 幂等 — 重跑 upsert 不产生重复（按 key）。

## 9. 迁移与部署

- 新表 `DocumentTemplate`，additive，**无数据删除**。
- PR 描述需注明：
  - 「需要下次部署执行 `prisma migrate deploy`」；
  - seed 需执行以灌入 4 个系统模板（说明执行方式）。
- 按团队迁移漂移教训：合并 ≠ prod 已迁移；部署后用 `prisma migrate status`（对 prod URL）核实，并确认 seed 已跑。
- 未装新 npm 包；如有需在 PR 注明。

## 10. 风险与边界

- **seed 执行时机**：系统模板靠 seed 落地。若 prod 部署不跑 seed，则模板列表为空、picker 只剩「空白文档」（不崩，但功能缺失）。需在部署流程明确 seed 步骤。
- **content 信任**：模板正文是代码内置常量，非用户输入，但仍须是合法 HTML，避免污染编辑器。
- **抽取耦合**：会议纪要 Action Items 依赖现有抽取的 `data-type="taskItem"` 选择器；若该约定变更，模板需同步。
