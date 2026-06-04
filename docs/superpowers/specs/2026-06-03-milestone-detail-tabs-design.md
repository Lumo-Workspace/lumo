# Milestone 详情页改造为 tab 布局（概览 + 任务）— 设计

**任务**: LUM-193
**日期**: 2026-06-03
**分支**: `lumo/LUM-193-milestone-detail-tabs`

## 目标

把里程碑详情页从「单页 + 弹窗编辑」改为「DetailLayout 内的『概览 / 任务』双 tab + 内联编辑」，对齐项目详情页的交互模式。**零 schema 改动，无新增后端**。

## 背景 / 现状

| | 项目详情页 | 里程碑详情页（现状） |
|---|---|---|
| Tab | 本地 state 切 5 个 tab | 无 tab，单页 |
| 概览编辑 | 内联编辑（contentEditable 标题、`DescriptionEditor`、`OwnerSelect`） | 弹窗 `MilestoneFormDialog` |
| 布局 | 自定义 flex | 共享 `DetailLayout` 三栏（LUM-179） |
| 可编辑字段 | name、description、owner、风险阈值、仓库 | name、description、status、startDate、targetDate |

关键事实：Prisma `Milestone` 模型**没有 ownerId、没有风险阈值**（那是项目级字段），只有
`name / slug / description / status / startDate / targetDate / completedAt / sortOrder / archivedAt`。
故本次内联编辑字段限定为里程碑实际拥有的字段。

涉及文件（现状）：

- 详情页组件：`app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`
- 只读侧栏：`MilestoneSidebar`（同目录或 milestone 子目录下）
- 编辑弹窗：`MilestoneFormDialog`
- 共享布局：`app/workspace/[workspaceUrl]/components/DetailLayout.tsx`
- API client：`lib/api-client/milestones.ts`（`milestonesClient.update`）
- API route：`PATCH /api/milestones/{id}`
- 参照：`app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectOverviewTab.tsx`

## 设计决策（已与用户确认）

1. **属性范围**：只用现有字段，不动 schema。概览可编辑字段 = 名称 + 描述 + 状态 + 开始日期 + 目标日期。
2. **编辑交互**：内联编辑，对齐项目页（即点即改）。
3. **布局壳**：方案 A —— 保留 `DetailLayout` 三栏壳，tab 放主内容区。与 Sprint 详情页保持一致（LUM-179 方向），属性常驻右侧栏可见。
4. **Sprint 覆盖分解**：放任务 tab（它本质是任务的 sprint 维度分解）。
5. **Tab 状态**：本地 `useState`，默认 `overview`，不进 URL，与项目页一致。

## 目标结构

```
MilestoneDetailPage（改造）
└─ DetailLayout（壳不变）
   ├─ breadcrumb（不变）
   ├─ actions：Archive / Unarchive、Delete（保留；移除 Edit 按钮）
   ├─ sidebar：MilestoneSidebar  ← 由只读改为内联可编辑
   └─ 主内容区：
      ├─ tab nav「概览 / 任务」（本地 useState，默认 overview）
      ├─ MilestoneOverviewTab（新）  ← 名称（内联标题）+ 描述（DescriptionEditor）
      └─ MilestoneTasksTab（新）     ← Sprint 覆盖分解 + 里程碑任务列表
```

### 单元职责

- **`MilestoneOverviewTab`**（新）：渲染内联标题 + 描述编辑器。
  - 输入：`milestone`（id/name/description）、`onUpdate(fields)`。
  - 依赖：复用项目页的 `DescriptionEditor`；标题仿 `ProjectOverviewTab` 的 contentEditable `TypographyH3`。
- **`MilestoneTasksTab`**（新）：渲染 Sprint 覆盖分解 + 里程碑任务列表。
  - 输入：`projectId`、`milestoneId`、`sprintCoverage`。
  - 依赖：复用现有 `MilestoneSprintCoverage` + `TaskListByMilestone`（仅迁移位置，不改内部）。
- **`MilestoneSidebar`**（改造）：从只读展示改为内联可编辑。
  - 输入：当前字段值 + `onUpdate(fields)`。
  - 状态用 Select（PLANNED/ACTIVE/COMPLETED/CANCELLED）；开始/目标日期用日期选择器。
  - 复用 `MilestoneFormDialog` 里已有的状态枚举与日期控件逻辑。
- **`MilestoneDetailPage`**（改造）：持 tab `useState`，组装 DetailLayout，提供统一的 `handleUpdate(fields)`。

### 数据流

```
内联编辑器 onChange/onCommit(单字段)
  → MilestoneDetailPage.handleUpdate({ field })
  → milestonesClient.update(milestoneId, { field })
  → PATCH /api/milestones/{id}
  → 成功后 invalidate react-query 缓存（milestone detail + milestone list）
```

API / service / repository 全部复用，**无后端改动**。

## 错误处理

- `update` 失败：保持现有 react-query mutation 的错误处理路径（toast/回滚），与弹窗编辑时一致；内联编辑器在失败后还原为服务端值（依赖 invalidate 后重新拉取）。
- 乐观更新：与现有 `onUpdateProject` 模式对齐；若现有里程碑 update 非乐观，则保持非乐观，不在本任务引入新模式。

## 测试（jsdom + Jest，`__tests__`）

- **Tab 切换**：默认渲染概览（描述可见）；点「任务」→ 渲染任务列表/覆盖分解；点回「概览」→ 渲染描述。
- **内联编辑回调**：
  - 改状态 → 断言 `milestonesClient.update` 以 `{ status }` 被调用。
  - 改日期 → 断言以 `{ startDate }` / `{ targetDate }` 被调用。
  - 描述提交 → 断言以 `{ description }` 被调用。
  - 注意 Radix Select 在 jsdom 开不了下拉，测受控值 / 回调入参，不模拟真实打开（见踩坑记忆）。
- 既有里程碑详情/列表测试保持通过。

## 不做（YAGNI）

- 不加 owner / 风险阈值字段（里程碑无此 schema）。
- 不加 summary / memory tab（本次只要概览 + 任务两个 tab）。
- 不改 `DetailLayout` 本身。
- 不删 `MilestoneFormDialog`（新建流程仍在用），仅详情页停止用它做编辑。

## i18n

- 新增的 tab 文案（概览 / 任务）按项目页 `project.tab.*` 模式加 `milestone.tab.*` key，并更新 `lib/i18n/` **每个** locale 文件，不用英文兜底。
```
