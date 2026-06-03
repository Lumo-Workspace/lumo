# 详情页三栏布局重构 — 设计文档

- **Task**: LUM-179 — Sprint 和 Milestone 详情页布局重构为三栏
- **Date**: 2026-06-03
- **Branch**: `lumo/LUM-179-detail-page-three-column-layout`

## 目标

把 Sprint 详情页和 Milestone 详情页统一成同一套三栏布局：

1. 顶部面包屑（breadcrumb）
2. 中间正文（主内容区）
3. 右侧属性栏（properties sidebar）

并抽出一个两个页面共用的布局骨架组件，满足 OCP/DRY、ISP/LoD。

## 现状

- **Sprint 详情页** (`app/workspace/[workspaceUrl]/sprints/[sprintId]/SprintDetailClient.tsx`)
  已是三栏：手写的 `flex flex-col` 外层 + `PageBreadcrumb` + `grid grid-cols-[1fr_320px]`（正文 `SprintTasksView` + 右栏 `SprintSidebar`/Burndown，可折叠）。骨架是写死在页面里的，未抽成可复用组件。
- **Milestone 详情页** (`app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`)
  单列瀑布流：**无面包屑**；header 把标题+状态徽章+Edit/Archive/Delete 挤在一行；竖排 日期 → 描述 → `MilestoneSprintCoverage` → `TaskListByMilestone`；**无右侧属性栏**。

## 设计决策（已与用户对齐）

1. **共享范围**：抽公共骨架 `DetailLayout`，Milestone 与 Sprint 两页都改用。
2. **Milestone 属性栏内容**：状态 / 日期 / 描述 / 归档标记放属性栏；操作按钮（Edit/Archive/Delete）放面包屑右侧；SprintCoverage + TaskList 留在正文。
3. **折叠/响应式**：`DetailLayout` 只负责响应式（宽屏三栏、窄屏右栏堆到正文下方）；折叠状态由各页自治，以 prop 传入，组件本身不持有 toggle。

## 架构

### 1. 共享组件 `DetailLayout`

新建 `app/workspace/[workspaceUrl]/components/DetailLayout.tsx` —— 纯展示组件，无业务逻辑（SRP）。

```tsx
interface DetailLayoutProps {
  breadcrumb: ReactNode // 面包屑内容（多级）
  actions?: ReactNode // 面包屑右侧操作槽
  sidebar?: ReactNode // 右侧属性栏内容
  sidebarCollapsed?: boolean // 折叠由各页控制，默认 false
  children: ReactNode // 正文主内容
}
```

骨架：

```
<div flex flex-col h-full overflow-hidden>
  <PageBreadcrumb actions={actions}>{breadcrumb}</PageBreadcrumb>
  <div {响应式 body}>
     {children}                          ← 正文
     {sidebar && !sidebarCollapsed && <aside>...</aside>}  ← 属性栏
  </div>
</div>
```

响应式规则（CSS 写在 DetailLayout）：

- **宽屏 (`lg:`)**：`grid grid-cols-[1fr_320px]`，正文与属性栏各自内部滚动（沿用 Sprint 现有的固定高度 + 内部 overflow 模型）。
- **窄屏 (`< lg`)**：`flex flex-col`，属性栏堆到正文下方，整页滚动，无横向滚动。
- `sidebarCollapsed === true` 或未传 `sidebar` → 单列 `[1fr]`，不渲染 `<aside>`。

复用现有 `PageBreadcrumb`（已含移动端 `SidebarTrigger` + 底部 `Separator`），不重复造。

### 2. Milestone 详情页改造

`MilestoneDetailPage.tsx` 改用 `DetailLayout`：

- **面包屑**（三级，新增）：
  `项目名(→ /workspace/{url}/projects/{slug})  /  Milestones(→ 项目页里程碑入口)  /  <里程碑名>(当前页, 非链接)`
  - 中间 "Milestones" 级链到项目页（里程碑现为项目页的一个 tab）。**实现时确认**项目页是否有可直达里程碑 tab 的 URL；若无，退化为两级 `项目名 / <里程碑名>`。
- **actions 槽**：Edit / Archive·Unarchive / Delete，从原 header 搬到面包屑右侧。
- **属性栏**：新建 `app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar.tsx`，按 ISP/LoD 只收扁平 props：

  ```tsx
  interface MilestoneSidebarProps {
    status: ApiMilestone['status']
    startDate: string | null
    targetDate: string | null
    description: string | null
    archived: boolean
  }
  ```

  内容：状态徽章（复用 `STATUS_CLASS`）、`start → target` 日期（复用 `fmtDate` + `DATE_OPTS`）、归档标记（archived 时）、描述（`whitespace-pre-wrap`）。

- **正文**：`MilestoneSprintCoverage` + `TaskListByMilestone`，顺序与现状一致。
- `MilestoneFormDialog`（编辑弹窗）继续挂最外层条件渲染，不进布局栏。
- loading / notFound 两个早返回分支也包进 `DetailLayout`（带面包屑骨架），与 Sprint loading 态一致。

### 3. Sprint 详情页改造（保功能不回退）

`SprintDetailClient.tsx` 把手写外层骨架换成 `DetailLayout`，**内部零件一个不动**：

- `breadcrumb` = 现有 `breadcrumb(sprint.name)`
- `actions` = `<SprintActionsMenu>`（从面包屑 children 挪到专用 actions 槽，视觉位置不变）
- `sidebar` = 现有 `sidePanel`（SprintSidebar + Burndown），原封不动
- `sidebarCollapsed` = 现有 `sidebarCollapsed` state
- `children` = 现有 `workspace`（SprintTasksView）
- loading / notFound 早返回分支同样换成 `DetailLayout` 包裹。

**保活点（回测重点）**：

- 折叠开关仍在 `SprintTasksView` 工具栏，经 `onToggleSidebar` 回调驱动 state，`DetailLayout` 只读 boolean —— 折叠能力不丢。
- 折叠状态的 cache key 持久化不动。
- 320px 宽、内部滚动模型、视觉位置不变。

净效果：Sprint 页视觉与行为零变化，仅骨架换成共享组件。

## i18n

- 面包屑中间级 "Milestones" 的 label：优先复用现成 key（如 `sidebar.milestones` / `milestones.title`）；无则新增并更新**全部** locale 文件（不止 en/zh-CN，且不拿英文兜底）。
- 状态、日期、Edit/Archive/Delete 均为搬运现有带 key 零件，不引入新文案。
- 属性栏若加小标题（如"日期""描述"），同样走 react-intl + 全 locale。

## 测试

Jest + jsdom，置于对应 `__tests__` 目录：

- `DetailLayout.test.tsx`：渲染 breadcrumb / children / sidebar；`sidebarCollapsed` 或无 sidebar 时不渲染 `<aside>`；actions 槽渲染。
- `MilestoneSidebar.test.tsx`：status / 日期区间 / 描述 / archived 标记各自渲染；缺省字段（null date / 无描述）不崩。
- 跑现有 milestone / sprint 相关测试确认不回归。

## 验收 / 完成标准

- [ ] 两页采用同一 `DetailLayout` 骨架，间距/对齐一致
- [ ] Milestone 面包屑展示完整层级、可逐级跳转、当前页非链接
- [ ] 正文为主内容、占主要宽度；属性栏放元信息、视觉清晰分隔
- [ ] 窄屏属性栏堆到正文下方、无横向滚动；宽屏三栏比例稳定
- [ ] 面包屑、属性栏为独立可复用组件，props 只收所需扁平字段
- [ ] 文案走 react-intl，全 locale 更新
- [ ] `npx tsc --noEmit` 无错误，无 console.log
- [ ] 新增组件各带至少一个测试
- [ ] Sprint 页折叠/任务视图行为无回退

## 影响范围 / 风险

- 触及文件：新增 `DetailLayout.tsx`、`MilestoneSidebar.tsx`、两个测试；修改 `SprintDetailClient.tsx`、`MilestoneDetailPage.tsx`、可能的 locale 文件。
- 无 schema 变更、无新依赖。
- 主要风险：Sprint 折叠/滚动行为回归 → 以保活点清单 + 现有测试回测覆盖。
