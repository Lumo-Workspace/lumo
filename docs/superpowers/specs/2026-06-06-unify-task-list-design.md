# 统一任务列表组件设计 [LUM-251]

## 背景

应用中有三处渲染任务列表的视图，目前列、底层架构、能力都不一致：

| 视图 | 路由 | 底层组件 | 架构 | 虚拟化 |
| --- | --- | --- | --- | --- |
| 我的任务 | `/workspace/[workspaceUrl]/my-tasks` | `TaskListTable.tsx` | 自定义 CSS Grid | 有 |
| Sprint 详情 | `/workspace/[workspaceUrl]/sprints/[id]` | `TaskListTable.tsx` | 自定义 CSS Grid | 有 |
| 项目任务 tab | `/workspace/[workspaceUrl]/projects/[slug]` | `data-table.tsx` (DataTable) | TanStack React Table | 无 |

差异点：
- **列不同**：我的任务/Sprint 有「项目」列、缺 ID / 截止日期 / 行操作菜单；项目任务有 ID / 截止日期 / 行操作 / 子任务展开、缺「项目」列。
- **架构不同**：两套表格实现，列在 `TaskListTable` 里写死，在 `DataTable` 里走 `createTaskColumns` 列定义化。
- **能力不同**：只有项目任务支持子任务树（`treeConfig` + `meta.expanded/toggleExpand`）和里程碑分组；只有我的任务/Sprint 支持虚拟化。

已经共享的部分：`ViewToggle`、`DisplayOptionsMenu`、字段编辑器（`StatusSelect`/`PrioritySelect`/`AssigneeSelect`/`ProjectSelect`/`DueDatePicker`）、`BulkActionBar`(Sprint/My Tasks) 与 `TaskSelectionBar`(项目)。

## 目标

三处任务列表收敛到**同一个列表组件 + 同一套列定义**，列与交互按上下文配置显隐，体验一致。

非目标：不改看板（board）视图；不改后端 API / 数据获取；不动「新建任务」按钮位置；不引入新的设计 token。

## 决策（已与用户确认）

1. **方向 A — 向最全的「项目任务」看齐**。我的任务 / Sprint 补上 ID、截止日期、行操作菜单（`⋯`），三处列体验完全一致。
2. **「项目」列纳入统一组件**，作为可配置列；项目任务上下文（单项目）隐藏它。
3. **基座 = TanStack DataTable + 叠加虚拟化**。以 `data-table.tsx` 为底座（已有列定义化/树/排序/选择），叠加 `@tanstack/react-virtual`，把我的任务/Sprint 迁移过来。
4. **子任务展开 + 里程碑分组保持「项目任务」专属**，作为可配置开关；我的任务/Sprint 不启用。
5. **统一 Toolbar**：左槽放上下文专属过滤器（仅当前冲刺 / 里程碑下拉 / 空），右槽是共享的「显示 + 列表/看板切换」（Sprint 额外的侧栏折叠按需）。「新建任务」留在页面 header。

## 统一列模型

完整列集合（按顺序）及各上下文显隐：

| 列 | 我的任务 | Sprint | 项目任务 | 备注 |
| --- | :---: | :---: | :---: | --- |
| 选择框 select | ✓ | ✓ | ✓ | |
| ID identifier | ✓(新增) | ✓(新增) | ✓ | 子任务展开 chevron 寄生在 ID 列 |
| 标题 title | ✓ | ✓ | ✓ | 内联编辑 |
| 项目 project | ✓ | ✓ | — | 单项目隐藏 |
| 状态 status | ✓ | ✓ | ✓ | 内联编辑 |
| 优先级 priority | ✓ | ✓ | ✓ | 内联编辑 |
| 截止日期 dueDate | ✓(新增) | ✓(新增) | ✓ | 内联编辑 |
| 负责人 assignee | ✓ | ✓ | ✓ | 内联编辑 |
| 更新时间 updatedAt | ✓ | ✓ | ✓ | 只读 |
| 行操作 actions (`⋯`) | ✓(新增) | ✓(新增) | ✓ | 打开/删除 |

子任务展开（ID 列内的 chevron）只在项目任务出现，由 `treeConfig` 驱动。

## 架构设计

### 组件单元与职责

```
TaskListView (新, 编排层)
  ├─ TaskListToolbar (新, 统一工具栏：左槽 children + 右槽共享控件)
  └─ DataTable (改造：叠加虚拟化)
        └─ columns ← createTaskColumns(config) (改造：可配置列 + 新增 project 列)
```

- **`createTaskColumns(options)`** — 唯一的列定义工厂。当前签名是位置参数，改为配置对象：
  ```ts
  createTaskColumns({
    onTaskClick, onDeleteTask, members, intl, updateTask,
    visibleColumns,   // 哪些列出现（按上下文传入）
  }): ColumnDef<ApiTask>[]
  ```
  新增 **project 列**（复用 `ProjectSelect`，只读时显示项目名）。列工厂内部按 `visibleColumns` 过滤输出，保证「项目」列可被项目任务上下文排除。

- **`DataTable`** — 现有 TanStack 实现，改造点：
  - 用 `@tanstack/react-virtual` 对 `table.getRowModel().rows` 做行虚拟化。HTML `<table>` 不便虚拟化，参照现有 `TaskListTable` 与 memory《虚拟化 list 改 display:grid 需 role=table/rowgroup》，渲染层改为 `role="table"/"rowgroup"/"row"/"cell"` 的 div + CSS grid，保留 sticky header、a11y 角色、`stopPropagation` cell 行为、子任务缩进/底色。
  - 虚拟化**阈值门控**：行数低于阈值时直接渲染（与现有 list 行为一致），避免小列表的虚拟化开销。
  - 列宽从 `meta.headerClassName` 的 Tailwind 宽度迁移到统一的 grid `COLUMN_TEMPLATE`（每个可见列一段轨道），由可见列集合推导。

- **`TaskListToolbar`** — 统一工具栏。右槽固定渲染 `DisplayOptionsMenu` + `ViewToggle`；左槽通过 `children`（或 `leftSlot` prop）注入上下文控件（`MyTasksToolbar` 的「仅当前冲刺」、项目任务的里程碑下拉）；`onCollapseSidebar?` 可选渲染 Sprint 的折叠按钮。

- **`TaskListView`** — 三个页面共用的编排组件，接收 `tasks / members / updateTask / onTaskClick / onDeleteTask / visibleColumns / treeConfig? / toolbar 左槽 / selection 状态`，组合 Toolbar + DataTable。三个页面各自决定传入哪些列、是否传 `treeConfig`、左槽放什么。

### 数据流（不变）

`Component → API Client → API Route → Service → Repository → Prisma`。本次只动 Component 层（渲染与列配置）；任务数据仍由各页面现有的 React Query hooks 提供，`updateTask` 仍走现有乐观更新 mutation。`ApiTask` 已含 `project` 关系（我的任务/Sprint 已渲染项目列，数据已具备），project 列只是消费已有字段。

### 选择 / 批量操作

`DataTable` 已支持 `enableSelection` + `rowSelection`。统一后三处都用 TanStack 的 `rowSelection`，批量操作栏沿用现有 `BulkActionBar`（含 `BulkDeleteConfirm`），把项目任务的 `TaskSelectionBar` 收敛到同一个（二者能力基本一致：状态/优先级/负责人/删除）。

### 错误处理

- 内联编辑失败：沿用各页面现有 mutation 的乐观更新 + 回滚（见 memory《RQ 乐观更新》），组件层不新增错误处理。
- 列配置缺失：`visibleColumns` 默认给出全集；非法/未知列名忽略。
- 虚拟化测量：参照 memory，`@tanstack/react-virtual` 在 jsdom 下行为有限，相关断言放到能力层（阈值门控、可见列推导）而非真实滚动。

## 测试策略

- `createTaskColumns`：给定 `visibleColumns`，断言输出的列 id 集合与顺序正确（含「project 列在排除时不出现」「ID/dueDate/actions 在我的任务集时出现」）。
- 可见列 → `COLUMN_TEMPLATE` 推导函数：纯函数单测（轨道数量与可见列数一致）。
- 虚拟化阈值门控：纯函数 / hook 单测（行数 < 阈值返回全量，≥ 阈值进入虚拟化分支），不依赖真实滚动。
- `TaskListToolbar`：jsdom 渲染，断言右槽共享控件存在、左槽 children 透传、`onCollapseSidebar` 缺省时不渲染折叠按钮。
- 三处页面：渲染冒烟 + 关键列存在性断言（我的任务有项目列且有 ID 列；项目任务无项目列但有子任务 chevron）。
- 跑 `npm test` 与 `npx tsc --noEmit`（注意 memory：`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 只有 tsc 能抓）。

## i18n

新增列在我的任务/Sprint 出现，复用已有 key（`task.title`/`task.status`/`task.priority`/`taskColumns.dueDate`/`common.updated` 等）。如需新增任何 user-facing key，必须**同 PR 补齐全部 16 个 locale**（memory：strict locale-parity test 会因缺 key 变红）。project 列表头复用现有「项目」key。

## 实施顺序（高层）

1. `createTaskColumns` 改为配置对象 + 新增 project 列 + `visibleColumns` 过滤（含单测）。
2. `DataTable` 叠加虚拟化（div+role+grid 渲染，阈值门控，保留树/排序/选择/sticky header）。
3. 抽出 `TaskListToolbar`（左槽/右槽）。
4. 抽出 `TaskListView` 编排组件。
5. 三处页面接入 `TaskListView`，删除 `TaskListTable.tsx` 与重复的列/工具栏代码。
6. `tsc --noEmit` + `npm test` + 视觉回归（preview 受限，靠 jsdom 组件测 + 类型）。

## 风险

- 虚拟化 + TanStack 行模型 + 子任务树三者组合是本次最大复杂点；分步落地（先列、后虚拟化）降低风险。
- 把 HTML `<table>` 改成 div+grid 可能影响现有项目任务页的样式/a11y；需保留 ARIA 角色与 sticky header。
- 删除 `TaskListTable.tsx` 前确认无其它引用。
