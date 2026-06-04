# LUM-201 — 任务列表 / 看板大数据量虚拟化

**Date**: 2026-06-03
**Task**: LUM-201
**Milestone**: Optimistic UI 乐观更新优化 (代码质量 & 性能线)
**Status**: Design approved, pending spec review

## 背景 / 问题

`TaskListTable.tsx` 与 `BoardView.tsx` 均用 `.map()` 全量渲染任务，无分页、无虚拟化。
数据层（`/api/tasks/me`、`/api/projects/[id]/tasks`）一次性返回全部任务（无 `take`/分页），
500+ 任务时 DOM 节点爆炸，列表滚动与看板拖拽出现卡顿（reflow/repaint 压力）。

核对结论（对照任务描述，行号已现场核对）：

- `TaskListTable.tsx:391` — `sorted.map(...)` 整表渲染，语义化 `<table>` + sticky `<thead>`，
  每列固定宽度，行内 Radix Select 编辑 + 多选 checkbox。无虚拟化。
- `BoardView.tsx:119/149` — 列循环 + 列内任务循环，各列独立滚动（`overflow-y-auto`）但全量渲染。
  泛型可复用组件 `<T extends { id: string; viewOrder: number | null }>`，被多调用方共用。
  用 `@dnd-kit/core` + `@dnd-kit/sortable` 拖拽；`viewOrder` + `orderingLabel` 表明列内手动排序（Manual）是真实功能。
- `react-window` 未安装；项目已用 `@tanstack/react-table`（headless，非 virtualizer）。

## 范围与原则

**做**：`TaskListTable` + `BoardView` 客户端虚拟化，基于 `@tanstack/react-virtual`，**超阈值才启用**。

**不做（YAGNI）**：

- 服务端分页 / 游标 —— 瓶颈是 DOM 渲染而非网络（500 个任务的 JSON 很小），不改 API/repository 层。
- 无限滚动 / 懒加载。
- 任何与虚拟化无关的重构。

**激活阈值**（集中为常量）：

- 列表：`sorted.length > 80` 才虚拟化。
- 看板：单列 `col.length > 50` 才虚拟化。
- 低于阈值走现有已验证的渲染/拖拽路径，**零行为变化**。

**决策记录**：

- 库选型 `@tanstack/react-virtual`（非任务原文的 react-window）：与已有 `@tanstack/react-table` 同生态；
  原生支持可变高度（`measureElement`）与水平/垂直；dnd-kit 官方示例即配它。
- 看板拖拽方案 A（保留列内排序）：列内手动排序是现有功能，不降级。

## 方案细节

### 列表视图（低风险）

1. **保留 `<table>` 语义** —— 新增 `<colgroup>` 承载固定列宽 + `table-layout: fixed`，
   将现有 Tailwind 列宽类（`w-10`/`min-w-[300px]`/`w-40`/`w-32`/`w-24`）迁到 colgroup，
   保证抽行后列宽不塌、sticky `<thead>` 不错位。
2. **滚动容器** —— 当前是页面级滚动，virtualizer 需要一个固定高度的 `overflow-auto` 容器作为
   `getScrollElement`。新增一层 flex 撑满高度的滚动 div 包住 table。
3. **垂直 virtualizer** —— `useVirtualizer({ count: sorted.length, estimateSize, overscan, getScrollElement })`；
   虚拟 `<tr>` 绝对定位 `translateY`，用 `measureElement` 处理标题换行造成的行高差异。
4. **不受影响项** —— 行内 Select 为 Radix portal，不随行卸载受影响；多选 `selected` 是外部 Set，
   滚动不丢；正在编辑的标题行滚出视口会卸载（可接受，符合现有 onBlur commit 行为）。

### 看板视图（方案 A，主要风险点）

1. **每列独立 virtualizer** —— 在 `BoardView` 内部，列内 `col` 超阈值时各自挂一个垂直 virtualizer。
2. **SortableContext 传整列 id** —— `items` 仍是整列全部 id（轻量），保证 dnd-kit 知道全部可排序项，
   跨虚拟边界的列内插队与跨列移动才不丢目标。
3. **overscan + autoScroll** —— `overscan` 设较大（如 6），保证拖拽起点附近节点已挂载；
   依赖 dnd-kit 自带 `autoScroll` 把视口外目标滚进来。
4. **化解 `keyedCard` 张力** —— 现有 `keyedCard` 刻意不加包裹 div（注释：会破坏拖拽计算）。
   虚拟模式需要每个 item 一个绝对定位容器，因此：
   - **非虚拟模式**：保持现有 `keyedCard`（无包裹），路径不变。
   - **虚拟模式**：每张卡用绝对定位容器包裹，key 移到容器上。
   - 两条路径由阈值切换，封装在 `BoardView` 内部；调用方 `renderCard` 契约不变。
5. **排序逻辑不变** —— `orderingLabel`/`viewOrder` 的排序在虚拟化前完成，虚拟化只改「怎么渲染已排序的这批卡片」。

## 单元拆分（SRP / 可测试性）

- 纯函数 `shouldVirtualize(count, threshold): boolean` + 阈值常量，独立可测。
- 列表/看板各自把虚拟渲染封进局部子组件或 hook，保持文件聚焦（避免主组件继续膨胀）。

## 测试与验证策略（受限环境）

环境限制（已知）：jsdom 不做真实滚动/布局测量；Radix 在 jsdom 开不了下拉；
preview 浏览器够不到本地 dev server。因此真实像素级窗口化**无法在本环境断言**。

- **单测**：
  - `shouldVirtualize` 阈值边界。
  - mock `@tanstack/react-virtual`，断言其以「全量 count + 正确 overscan」被调用；阈值以下不调用。
  - 断言 `SortableContext.items` 始终含整列全部 id（无论虚拟开关）。
- **回归**：
  - `__tests__/hooks/useBoardDrag.test.tsx` 既有测试保持绿。
  - 补「虚拟开启时 `onDragEnd` 仍收到正确 active/over id」的 mock 测试。
- **声明限制**：PR 描述显式说明真实大数据量需人工浏览器验证。
- **门禁**：`npx tsc --noEmit` 全绿；无 `console.log`；i18n 新增文案（如有空态/提示）更新所有 locale。

## 依赖 / 交付注意

- 新增依赖 `@tanstack/react-virtual` —— 必须在 PR 描述声明（CLAUDE.md 规则）。
- 不安装 `react-window`。
- 无 schema 变更，无迁移。
- 分支 `lumo/LUM-201-list-board-virtualization`；PR 标题 `feat: virtualize task list & board for large datasets [LUM-201]`。
