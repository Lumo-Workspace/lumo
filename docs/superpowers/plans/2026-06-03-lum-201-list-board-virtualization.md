# LUM-201 任务列表 / 看板虚拟化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `TaskListTable` 和 `BoardView` 加超阈值才启用的客户端虚拟化（`@tanstack/react-virtual`），让 500+ 任务不再 DOM 爆炸卡顿。

**Architecture:** 纯函数 `shouldVirtualize(count, threshold)` 集中阈值判定。列表用 TanStack 官方 `display:grid` table 配方（固定行高，列宽数组驱动 header/row 对齐），滚动容器移进 `TaskListTable` 自身。看板每列超阈值时各挂一个垂直 virtualizer，外层包裹容器做 translateY 定位、内层保留卡片自身的 dnd-kit sortable transform，`SortableContext.items` 始终传整列 id。低于阈值走现有已验证路径，零行为变化。

**Tech Stack:** Next.js 14 / TypeScript（strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`）/ `@tanstack/react-virtual` / `@dnd-kit/core` + `@dnd-kit/sortable` / Jest + RTL（jsdom）。

**关键约束（来自项目记忆，写代码时务必遵守）:**

- `noUncheckedIndexedAccess` 开启：`getVirtualItems()` 后 `arr[vi.index]` 是 `T | undefined`，必须 guard，jest/SWC 不报、只有 `tsc --noEmit` 报。
- `exactOptionalPropertyTypes` 开启：可选 prop 取 `undefined` 要声明 `field?: T | undefined`。
- jsdom 不做真实滚动/布局测量，Radix 开不了下拉，preview 够不到本地 dev server → 虚拟化的像素级窗口化无法自动断言，测试只覆盖逻辑/契约层；真实大数据量需人工浏览器验证（PR 描述声明）。
- jest 必须在 worktree 内 `cd` 后运行（haste 冲突）；改 schema 无关，本任务无 prisma 变更。
- i18n：新增任何用户可见文案要更新 `lib/i18n/` 下**所有** locale，禁止英文兜底。

---

## File Structure

| 文件                                                                  | 职责                                                     | 动作   |
| --------------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| `lib/utils/shouldVirtualize.ts`                                       | 纯函数 + 两个阈值常量                                    | Create |
| `__tests__/lib/shouldVirtualize.test.ts`                              | 阈值边界单测                                             | Create |
| `package.json`                                                        | 新增 `@tanstack/react-virtual`                           | Modify |
| `app/workspace/[workspaceUrl]/components/task-list/TaskListTable.tsx` | 列表虚拟化（grid table + 自持滚动容器）                  | Modify |
| `app/workspace/[workspaceUrl]/components/pages/MyTasksPage.tsx`       | 去掉 list 分支多余的 `overflow-auto`（滚动改由表格自持） | Modify |
| `__tests__/components/TaskListTable.test.tsx`                         | 虚拟化契约单测（mock react-virtual）                     | Create |
| `app/workspace/[workspaceUrl]/components/board/BoardView.tsx`         | 看板每列虚拟化（双层包裹 + 整列 id）                     | Modify |
| `__tests__/components/BoardView.test.tsx`                             | 看板虚拟化契约 + SortableContext id 完整性单测           | Create |

---

## Task 1: `shouldVirtualize` 纯函数 + 阈值常量

**Files:**

- Create: `lib/utils/shouldVirtualize.ts`
- Test: `__tests__/lib/shouldVirtualize.test.ts`

- [ ] **Step 1: 写失败测试**

`__tests__/lib/shouldVirtualize.test.ts`:

```ts
import {
  shouldVirtualize,
  LIST_VIRTUALIZE_THRESHOLD,
  BOARD_COLUMN_VIRTUALIZE_THRESHOLD,
} from '@/lib/utils/shouldVirtualize'

describe('shouldVirtualize', () => {
  it('returns false at or below the threshold', () => {
    expect(shouldVirtualize(0, 80)).toBe(false)
    expect(shouldVirtualize(80, 80)).toBe(false)
  })

  it('returns true strictly above the threshold', () => {
    expect(shouldVirtualize(81, 80)).toBe(true)
    expect(shouldVirtualize(5000, 80)).toBe(true)
  })

  it('exposes list and board thresholds as constants', () => {
    expect(LIST_VIRTUALIZE_THRESHOLD).toBe(80)
    expect(BOARD_COLUMN_VIRTUALIZE_THRESHOLD).toBe(50)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/shouldVirtualize.test.ts`
Expected: FAIL — `Cannot find module '@/lib/utils/shouldVirtualize'`

- [ ] **Step 3: 写实现**

`lib/utils/shouldVirtualize.ts`:

```ts
/** Row count above which the task list switches to virtualized rendering. */
export const LIST_VIRTUALIZE_THRESHOLD = 80

/** Per-column card count above which a board column switches to virtualized rendering. */
export const BOARD_COLUMN_VIRTUALIZE_THRESHOLD = 50

/**
 * Decide whether a collection is large enough to warrant virtualization.
 * Strictly greater than the threshold so small/medium datasets keep the
 * existing, already-verified non-virtual render path (zero behavior change).
 */
export function shouldVirtualize(count: number, threshold: number): boolean {
  return count > threshold
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/lib/shouldVirtualize.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: 提交**

```bash
git add lib/utils/shouldVirtualize.ts __tests__/lib/shouldVirtualize.test.ts
git commit -m "feat: add shouldVirtualize helper + thresholds [LUM-201]"
```

---

## Task 2: 安装 `@tanstack/react-virtual`

**Files:**

- Modify: `package.json` (+ lockfile)

- [ ] **Step 1: 安装**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npm install @tanstack/react-virtual`
Expected: `package.json` 的 `dependencies` 出现 `@tanstack/react-virtual`（约 `^3.x`）。

- [ ] **Step 2: 确认类型可解析**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && node -e "require.resolve('@tanstack/react-virtual'); console.log('ok')"`
Expected: 输出 `ok`

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: add @tanstack/react-virtual dependency [LUM-201]"
```

> ⚠️ PR 描述必须声明新增 `@tanstack/react-virtual`（CLAUDE.md 规则）。不安装 react-window。

---

## Task 3: 列表视图虚拟化（`TaskListTable`）

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/task-list/TaskListTable.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/MyTasksPage.tsx:203-215`

**做法说明（必读）:** 把真正的 `<table>` 改成 TanStack 官方虚拟化配方——`table` 用 `display:grid`、`thead/tbody/tr` 用 grid/flex、列宽由共享 `COLUMNS` 宽度数组驱动，保证 header 与虚拟行对齐。`TitleCell` 用 `truncate`（单行），**行高固定**，因此用固定 `estimateSize`、不需要 `measureElement`。滚动容器移入本组件自身（持 ref），父组件去掉 `overflow-auto` 避免双滚动。低于阈值仍渲染同一套 grid 结构，只是不套 virtualizer（一次性渲染全部行）——保持单一 markup 路径、避免维护两套表格。

- [ ] **Step 1: 父组件去掉多余滚动容器**

`MyTasksPage.tsx`，把 list 分支的外层 `overflow-auto` 去掉（滚动改由表格自持），仅保留撑满高度：

找到（约 203-215 行）:

```tsx
{viewMode === 'list' ? (
  <div className='flex-1 overflow-auto'>
    <TaskListTable
```

改为:

```tsx
{viewMode === 'list' ? (
  <div className='flex-1 min-h-0 flex flex-col'>
    <TaskListTable
```

（`min-h-0` 让内部滚动区能在 flex 列中正确收缩。`TaskListTable` 自身会提供 `overflow-auto`。）

- [ ] **Step 2: 重写 `TaskListTable` 的渲染结构为虚拟化 grid table**

在 `TaskListTable.tsx`：

2a. 顶部 import 增加：

```tsx
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  shouldVirtualize,
  LIST_VIRTUALIZE_THRESHOLD,
} from '@/lib/utils/shouldVirtualize'
```

（`useRef` 若已在 `useCallback, useMemo, useRef, useState` 那行导入则无需重复。）

2b. 在 `TaskListTable` 组件体内、`return` 之前，新增列宽模型、滚动 ref、virtualizer：

```tsx
// Shared column widths drive both the header and the virtual rows so the
// grid stays aligned. Title is the flexible column; the rest are fixed px.
const COLUMN_TEMPLATE = '40px minmax(300px, 1fr) 160px 128px 96px 96px 140px'
const ROW_HEIGHT = 49 // px — rows are single-line (TitleCell truncates)

const scrollRef = useRef<HTMLDivElement>(null)
const virtualize = shouldVirtualize(sorted.length, LIST_VIRTUALIZE_THRESHOLD)

const rowVirtualizer = useVirtualizer({
  count: sorted.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => ROW_HEIGHT,
  overscan: 12,
  enabled: virtualize,
})
```

2c. 用下面整段替换现有的 `return ( <table ...> ... </table> )`（即第 289–473 行整块）。它把每个单元格抽成行内可复用渲染、用 grid 对齐、并按 `virtualize` 切换「虚拟行 / 全量行」：

```tsx
const renderRow = (task: MyTask) => (
  <div
    role='row'
    className='grid items-center hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors group border-b border-zinc-200 dark:border-zinc-800'
    style={{ gridTemplateColumns: COLUMN_TEMPLATE, height: ROW_HEIGHT }}
  >
    <div role='cell' className='px-4' onClick={e => e.stopPropagation()}>
      <Checkbox
        checked={selected.has(task.id)}
        onCheckedChange={() => toggleOne(task.id)}
        aria-label={intl.formatMessage(
          { id: 'task.selectOne', defaultMessage: 'Select {title}' },
          { title: task.title }
        )}
      />
    </div>
    <div role='cell' className='px-8 min-w-0'>
      <TitleCell
        task={task}
        onCommit={title => updateTask(task.id, { title })}
        onDetailsClick={() => onTaskClick(task)}
      />
    </div>
    <div
      role='cell'
      className='px-8 min-w-0'
      onClick={e => e.stopPropagation()}
    >
      <ProjectSelect
        value={task.projectId}
        projects={projects}
        onChange={projectId => updateTask(task.id, { projectId })}
        triggerClassName={GHOST_TRIGGER}
      />
    </div>
    <div role='cell' className='px-8' onClick={e => e.stopPropagation()}>
      <StatusSelect
        value={task.status}
        onChange={status => updateTask(task.id, { status })}
        triggerClassName={GHOST_TRIGGER}
      />
    </div>
    <div role='cell' className='px-8' onClick={e => e.stopPropagation()}>
      <PrioritySelect
        value={task.priority}
        onChange={priority => updateTask(task.id, { priority })}
        triggerClassName={GHOST_TRIGGER}
      />
    </div>
    <div role='cell' className='px-8' onClick={e => e.stopPropagation()}>
      <AssigneeSelect
        value={task.assigneeActorId}
        onChange={assigneeActorId => updateTask(task.id, { assigneeActorId })}
        members={assignableMembers}
        assignee={task.assignee ?? null}
        triggerClassName={GHOST_TRIGGER}
      />
    </div>
    <div role='cell' className='px-8 pr-8 text-xs text-zinc-400 text-right'>
      {new Date(task.updatedAt).toLocaleDateString()}
    </div>
  </div>
)

return (
  <div ref={scrollRef} className='flex-1 min-h-0 overflow-auto'>
    {/* Sticky header */}
    <div
      role='row'
      className='grid sticky top-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-10 border-b border-zinc-200 dark:border-zinc-800'
      style={{ gridTemplateColumns: COLUMN_TEMPLATE }}
    >
      <div role='columnheader' className='py-2 px-4'>
        <Checkbox
          checked={headerCheckboxState}
          onCheckedChange={toggleAll}
          aria-label={intl.formatMessage({
            id: 'task.selectAll',
            defaultMessage: 'Select all tasks',
          })}
        />
      </div>
      <SortableHeader
        col='title'
        label={intl.formatMessage({
          id: 'task.title',
          defaultMessage: 'Title',
        })}
        sort={sort}
        onToggle={toggle}
        className='text-left py-2 px-8'
        tooltip={intl.formatMessage({
          id: 'tasks.tooltip.title',
          defaultMessage: 'Task title.',
        })}
      />
      <SortableHeader
        col='project'
        label={intl.formatMessage({
          id: 'task.project',
          defaultMessage: 'Project',
        })}
        sort={sort}
        onToggle={toggle}
        className='text-left py-2 px-8'
        tooltip={intl.formatMessage({
          id: 'tasks.tooltip.project',
          defaultMessage: 'Project this task belongs to.',
        })}
      />
      <SortableHeader
        col='status'
        label={intl.formatMessage({
          id: 'task.status',
          defaultMessage: 'Status',
        })}
        sort={sort}
        onToggle={toggle}
        className='text-left py-2 px-8'
        tooltip={intl.formatMessage({
          id: 'tasks.tooltip.status',
          defaultMessage:
            'Workflow stage: To Do, In Progress, In Review, or Done.',
        })}
      />
      <SortableHeader
        col='priority'
        label={intl.formatMessage({
          id: 'task.priority',
          defaultMessage: 'Priority',
        })}
        sort={sort}
        onToggle={toggle}
        className='text-left py-2 px-8'
        tooltip={intl.formatMessage({
          id: 'tasks.tooltip.priority',
          defaultMessage: 'Priority level: Urgent, High, Medium, or Low.',
        })}
      />
      <SortableHeader
        col='assignee'
        label={intl.formatMessage({
          id: 'task.assignee',
          defaultMessage: 'Assignee',
        })}
        sort={sort}
        onToggle={toggle}
        className='text-left py-2 px-8'
        tooltip={intl.formatMessage({
          id: 'tasks.tooltip.assignee',
          defaultMessage: 'Person responsible for completing this task.',
        })}
      />
      <SortableHeader
        col='updatedAt'
        label={intl.formatMessage({
          id: 'common.updated',
          defaultMessage: 'Updated',
        })}
        sort={sort}
        onToggle={toggle}
        className='text-right py-2 px-8 pr-8'
        tooltip={intl.formatMessage({
          id: 'tasks.tooltip.updated',
          defaultMessage: 'Last time this task was modified.',
        })}
      />
    </div>

    {/* Body */}
    {virtualize ? (
      <div
        style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}
      >
        {rowVirtualizer.getVirtualItems().map(vi => {
          const task = sorted[vi.index]
          if (!task) return null
          return (
            <div
              key={task.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {renderRow(task)}
            </div>
          )
        })}
      </div>
    ) : (
      <div>
        {sorted.map(task => (
          <div key={task.id}>{renderRow(task)}</div>
        ))}
      </div>
    )}
  </div>
)
```

> 说明：原 `<table>/<thead>/<tbody>/<tr>/<td>` 全部换成带 `role` 的 div，沿用 `gridTemplateColumns` 对齐；列宽与原 Tailwind（`w-10`=40、`w-40`=160、`w-32`=128、`w-24`=96、title `min-w-[300px]`）一一对应。`noUncheckedIndexedAccess` 下 `sorted[vi.index]` 必须 `if (!task) return null` 守卫。

- [ ] **Step 3: 类型检查**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit`
Expected: 无新增报错（特别确认 `sorted[vi.index]` 的 undefined 守卫已生效）。

- [ ] **Step 4: 跑既有相关测试确保未回归**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/components`
Expected: 既有组件测试保持 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/workspace/'[workspaceUrl]'/components/task-list/TaskListTable.tsx app/workspace/'[workspaceUrl]'/components/pages/MyTasksPage.tsx
git commit -m "feat: virtualize TaskListTable for large datasets [LUM-201]"
```

---

## Task 4: 列表虚拟化契约单测

**Files:**

- Create: `__tests__/components/TaskListTable.test.tsx`

**做法说明:** jsdom 不能真实测窗口化，所以 mock `@tanstack/react-virtual`，断言：(a) 阈值以上时 virtualizer 以 `enabled:true` + 正确 `count` 被调用；(b) 阈值以下 `enabled:false`。用一个可断言的 `jest.fn()` 捕获 `useVirtualizer` 的入参。

- [ ] **Step 1: 写测试**

`__tests__/components/TaskListTable.test.tsx`:

```tsx
/** @jest-environment jsdom */
const en: Record<string, string> = {}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => en[id] ?? defaultMessage ?? id,
  }),
}))

const useVirtualizerMock = jest.fn(() => ({
  getTotalSize: () => 0,
  getVirtualItems: () => [],
}))
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: unknown) => useVirtualizerMock(opts),
}))

import { render } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TaskListTable } from '@/app/workspace/[workspaceUrl]/components/task-list/TaskListTable'
import { LIST_VIRTUALIZE_THRESHOLD } from '@/lib/utils/shouldVirtualize'
import type { MyTask } from '@/app/workspace/[workspaceUrl]/types'

function makeTasks(n: number): MyTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Task ${i}`,
    status: 'TODO',
    priority: 'MEDIUM',
    projectId: 'p1',
    project: { id: 'p1', name: 'Proj', ownerActorId: null },
    assigneeActorId: null,
    assignee: null,
    updatedAt: new Date('2026-01-01').toISOString(),
  })) as unknown as MyTask[]
}

function renderTable(count: number) {
  return render(
    <TooltipProvider>
      <TaskListTable
        tasks={makeTasks(count)}
        setTasks={jest.fn()}
        members={[]}
        projects={[]}
        onTaskClick={jest.fn()}
        onRetry={jest.fn()}
        selected={new Set()}
        setSelected={jest.fn()}
      />
    </TooltipProvider>
  )
}

describe('TaskListTable virtualization', () => {
  beforeEach(() => useVirtualizerMock.mockClear())

  it('enables the virtualizer above the threshold with the full row count', () => {
    renderTable(LIST_VIRTUALIZE_THRESHOLD + 5)
    const opts = useVirtualizerMock.mock.calls[0]?.[0] as
      | { count: number; enabled: boolean }
      | undefined
    expect(opts?.enabled).toBe(true)
    expect(opts?.count).toBe(LIST_VIRTUALIZE_THRESHOLD + 5)
  })

  it('disables the virtualizer at or below the threshold', () => {
    renderTable(LIST_VIRTUALIZE_THRESHOLD)
    const opts = useVirtualizerMock.mock.calls[0]?.[0] as
      | { enabled: boolean }
      | undefined
    expect(opts?.enabled).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/components/TaskListTable.test.tsx`
Expected: PASS（2 passing）。若因 `MyTask` 字段不全报类型错，按 `app/workspace/[workspaceUrl]/types` 的真实 `MyTask` 形状补齐 `makeTasks` 的字段（保持 `as unknown as MyTask[]` 兜底）。

- [ ] **Step 3: 提交**

```bash
git add __tests__/components/TaskListTable.test.tsx
git commit -m "test: TaskListTable virtualization threshold contract [LUM-201]"
```

---

## Task 5: 看板视图虚拟化（`BoardView`）

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/board/BoardView.tsx`

**做法说明（必读 — 本任务是最高风险点）:**

- 每列 `col` 超阈值时各挂一个垂直 virtualizer，`getScrollElement` 指向该列的 `DroppableColumn` 滚动元素。
- `SortableContext.items` **永远传整列 id**（`col.map(t => t.id)`），无论是否虚拟化——dnd-kit 必须知道全部可排序项，跨虚拟边界的列内插队/跨列移动才不丢目标。
- 卡片自身（`CardShell`）已在顶层 div 挂 `CSS.Translate` 拖拽 transform。虚拟定位**必须用外层包裹容器**做 `translateY(start)`，内层放 `renderCard` 输出的卡片（保留它自己的拖拽 transform）。两层分离，绝不可合到同一 div。
- 卡片高度可变（标题换行、badge），看板需要 `measureElement`。
- `overscan` 设 6，配合 dnd-kit 自带 autoScroll，缓解「拖到未挂载位置」。
- 必须新建一个内部子组件 `VirtualColumnBody`，因为每列要各自调用 `useVirtualizer`（Hook 不能在 `columns.map` 回调里调用 — 违反 React 规则）。
- 非虚拟模式保持现有 `keyedCard` 路径，零行为变化。

- [ ] **Step 1: 顶部 import 增加**

```tsx
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  shouldVirtualize,
  BOARD_COLUMN_VIRTUALIZE_THRESHOLD,
} from '@/lib/utils/shouldVirtualize'
```

- [ ] **Step 2: 新增 `VirtualColumnBody` 子组件**

在 `BoardView.tsx` 内、`DroppableColumn` 定义之后新增（泛型与 BoardView 一致）：

```tsx
// ─── Virtualized column body ─────────────────────────────────────────────────
// One virtualizer per column. Rendered ONLY when the column is over threshold.
// Outer wrapper handles translateY positioning; the inner card keeps its own
// dnd-kit sortable transform (the two MUST stay on separate elements).
function VirtualColumnBody<T extends { id: string }>({
  items,
  renderCard,
}: {
  items: T[]
  renderCard: (task: T, isOverlay: boolean) => React.ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96, // card height + space-y-3 gap; refined by measureElement
    overscan: 6,
  })

  return (
    <div
      ref={scrollRef}
      className='board-col-scroll flex-1 overflow-y-auto min-h-[100px] pb-2'
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(vi => {
          const task = items[vi.index]
          if (!task) return null
          return (
            <div
              key={task.id}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 12, // matches space-y-3 gap
              }}
            >
              {renderCard(task, false)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

> `items[vi.index]` 在 `noUncheckedIndexedAccess` 下是 `T | undefined`，`if (!task) return null` 守卫必须保留。

- [ ] **Step 3: 在列循环里按阈值切换渲染路径**

把现有列内渲染（第 143-165 行 `SortableContext` 那段）改为：

```tsx
{
  /* Cards — scrollable */
}
;<SortableContext
  id={column.id}
  items={col.map(t => t.id)}
  strategy={verticalListSortingStrategy}
>
  {shouldVirtualize(col.length, BOARD_COLUMN_VIRTUALIZE_THRESHOLD) ? (
    <VirtualColumnBody items={col} renderCard={renderCard} />
  ) : (
    <DroppableColumn id={column.id}>
      {col.map(task => keyedCard(task.id, renderCard(task, false)))}
      {onAddTask && (
        <Button
          variant='ghost'
          size='sm'
          onClick={() => onAddTask(column.id)}
          className='w-full justify-start gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 h-auto px-2 py-1.5'
        >
          <Plus size={16} />
          {intl.formatMessage({
            id: 'board.addTask',
            defaultMessage: 'Add task',
          })}
        </Button>
      )}
    </DroppableColumn>
  )}
</SortableContext>
```

> 注意：虚拟模式下 `VirtualColumnBody` 自身就是 droppable 的滚动容器，但它没有 `useDroppable`。为保证空列/列尾仍可放置，**虚拟模式下也要让该列可 drop**：在 `VirtualColumnBody` 的最外层 `scrollRef` div 上加 droppable。改法见 Step 4。虚拟模式暂不渲染列尾「Add task」按钮（超 50 张卡时该入口意义不大；如需保留，放到列 header 区域——本任务范围外）。

- [ ] **Step 4: 让虚拟列也成为 droppable**

修改 `VirtualColumnBody`，接收 `columnId` 并用 `useDroppable` 合并 ref：

```tsx
function VirtualColumnBody<T extends { id: string }>({
  columnId,
  items,
  renderCard,
}: {
  columnId: string
  items: T[]
  renderCard: (task: T, isOverlay: boolean) => React.ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { setNodeRef } = useDroppable({ id: columnId })
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
  })

  const setRefs = (el: HTMLDivElement | null) => {
    scrollRef.current = el
    setNodeRef(el)
  }

  return (
    <div
      ref={setRefs}
      className='board-col-scroll flex-1 overflow-y-auto min-h-[100px] pb-2'
    >
      {/* ...unchanged inner content from Step 2... */}
    </div>
  )
}
```

并把 Step 3 的调用改为 `<VirtualColumnBody columnId={column.id} items={col} renderCard={renderCard} />`。`useDroppable` 已在文件顶部 import（确认 `import { ..., useDroppable } from '@dnd-kit/core'` 已存在 — 现有 `DroppableColumn` 已用它）。

- [ ] **Step 5: 类型检查**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit`
Expected: 无新增报错（确认 `items[vi.index]` 守卫、泛型约束 `T extends { id: string }`）。

- [ ] **Step 6: 跑既有看板拖拽测试确保未回归**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/hooks/useBoardDrag.test.tsx`
Expected: PASS（既有拖拽逻辑不变）。

- [ ] **Step 7: 提交**

```bash
git add app/workspace/'[workspaceUrl]'/components/board/BoardView.tsx
git commit -m "feat: virtualize board columns above threshold [LUM-201]"
```

---

## Task 6: 看板虚拟化契约单测

**Files:**

- Create: `__tests__/components/BoardView.test.tsx`

**做法说明:** 断言两件不变量：(a) 超阈值列调用 `useVirtualizer`、未超阈值列不调用；(b) `SortableContext` 始终收到整列全部 id（虚拟化不能截断可排序集）。mock `@tanstack/react-virtual` 与 `@dnd-kit/*` 以便在 jsdom 断言入参。

- [ ] **Step 1: 写测试**

`__tests__/components/BoardView.test.tsx`:

```tsx
/** @jest-environment jsdom */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))

const useVirtualizerMock = jest.fn(() => ({
  getTotalSize: () => 0,
  getVirtualItems: () => [],
  measureElement: () => {},
}))
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: unknown) => useVirtualizerMock(opts),
}))

// Capture the items passed to every SortableContext.
const sortableItemsSeen: string[][] = []
jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({
    items,
    children,
  }: {
    items: string[]
    children: React.ReactNode
  }) => {
    sortableItemsSeen.push(items)
    return children
  },
  verticalListSortingStrategy: 'vertical',
}))
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  DragOverlay: ({ children }: { children: React.ReactNode }) => children,
  useDroppable: () => ({ setNodeRef: () => {} }),
  closestCorners: jest.fn(),
  defaultDropAnimationSideEffects: () => ({}),
}))

import { render } from '@testing-library/react'
import { BoardView } from '@/app/workspace/[workspaceUrl]/components/board/BoardView'
import { BOARD_COLUMN_VIRTUALIZE_THRESHOLD } from '@/lib/utils/shouldVirtualize'

type Task = { id: string; viewOrder: number | null; status: string }

function makeTasks(n: number, status: string): Task[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${status}-${i}`,
    viewOrder: i,
    status,
  }))
}

function renderBoard(tasks: Task[]) {
  return render(
    <BoardView<Task>
      tasks={tasks}
      sensors={[]}
      activeId={null}
      onDragStart={jest.fn()}
      onDragOver={jest.fn()}
      onDragEnd={jest.fn()}
      renderCard={t => <div data-testid={`card-${t.id}`}>{t.id}</div>}
    />
  )
}

describe('BoardView virtualization', () => {
  beforeEach(() => {
    useVirtualizerMock.mockClear()
    sortableItemsSeen.length = 0
  })

  it('virtualizes a column over the threshold and not one under it', () => {
    // TODO column over threshold; IN_PROGRESS under it.
    renderBoard([
      ...makeTasks(BOARD_COLUMN_VIRTUALIZE_THRESHOLD + 3, 'TODO'),
      ...makeTasks(2, 'IN_PROGRESS'),
    ])
    // Exactly one column (TODO) should instantiate a virtualizer.
    expect(useVirtualizerMock).toHaveBeenCalledTimes(1)
    const opts = useVirtualizerMock.mock.calls[0]?.[0] as
      | { count: number }
      | undefined
    expect(opts?.count).toBe(BOARD_COLUMN_VIRTUALIZE_THRESHOLD + 3)
  })

  it('always passes the full id list to SortableContext, even when virtualized', () => {
    const todo = makeTasks(BOARD_COLUMN_VIRTUALIZE_THRESHOLD + 3, 'TODO')
    renderBoard(todo)
    const todoIds = todo.map(t => t.id).sort()
    const seen = sortableItemsSeen.find(arr => arr.length === todo.length)
    expect(seen?.slice().sort()).toEqual(todoIds)
  })
})
```

- [ ] **Step 2: 跑测试**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest __tests__/components/BoardView.test.tsx`
Expected: PASS（2 passing）。

- [ ] **Step 3: 提交**

```bash
git add __tests__/components/BoardView.test.tsx
git commit -m "test: BoardView virtualization + full-id SortableContext contract [LUM-201]"
```

---

## Task 7: 全量校验 + 人工验证说明

- [ ] **Step 1: 全量类型检查**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 2: 全量测试**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest`
Expected: 全绿。

- [ ] **Step 3: 确认无 console.log / token-lint**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && grep -rn "console.log" app/workspace/'[workspaceUrl]'/components/task-list app/workspace/'[workspaceUrl]'/components/board || echo "no console.log"`
Run: `cd /Users/chaoli/Desktop/lumo/lumo && npm run lint:tokens`
Expected: 无 console.log；token-lint 通过（本任务新增 className 用了语义/既有 zinc 类，若新文件触发 token-lint，按记忆用语义 token 修，不要 baseline --update）。

- [ ] **Step 4: 人工浏览器验证（环境限制，无法自动化）**

在浏览器中（本地或预览部署）验证 —— 这是本计划唯一无法被测试覆盖的部分，必须人工过：

1. 列表 > 80 行：滚动流畅、sticky header 对齐、列宽与小数据量一致、行内 Select/标题编辑/多选正常、滚动后多选不丢。
2. 看板单列 > 50 卡：列内滚动流畅；**列内拖拽重排**生效并落库（`viewOrder`）；**跨列拖拽**改状态生效；拖到视口外位置时 autoScroll 把目标带入。
3. 小数据量（列表 ≤80 / 列 ≤50）行为与改动前完全一致。

> 若看板拖拽在虚拟边界出现丢目标/掉帧，先调大 `overscan`，再校准 `estimateSize`；仍不稳则回退到设计文档「方案 B」（虚拟时仅保留跨列移动）——需回到用户确认。

---

## Task 8: 开 PR

- [ ] **Step 1: 合并最新 origin/main，确认无 migration 误删**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && git fetch origin && git merge origin/main --no-edit && git status`
Expected: 干净；`git diff --name-status origin/main...HEAD` 中 **无** `prisma/migrations/` 删除（防记忆里的「陈旧分支误删 migration」）。

- [ ] **Step 2: 推分支 + 开 PR**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && git push -u origin lumo/LUM-201-list-board-virtualization
gh pr create --title "feat: virtualize task list & board for large datasets [LUM-201]" --body "$(cat <<'EOF'
## What
超阈值才启用的客户端虚拟化（@tanstack/react-virtual）：列表 >80 行、看板单列 >50 卡。低于阈值零行为变化。

## Why
TaskListTable / BoardView 全量 .map() 渲染，500+ 任务 DOM 爆炸卡顿（LUM-201）。

## How
- 纯函数 shouldVirtualize 集中阈值。
- 列表：grid table 配方 + 固定行高 + 自持滚动容器。
- 看板：每列独立 virtualizer，外层 translateY 包裹 + 内层保留卡片 dnd-kit transform，SortableContext 始终传整列 id。

## Dependencies
- 新增 @tanstack/react-virtual（未装 react-window）。

## Migration
- 无 schema 变更。

## Testing
- 单测：阈值边界、virtualizer 入参契约、SortableContext id 完整性、useBoardDrag 回归。
- ⚠️ 真实像素级窗口化无法在 jsdom 断言；列表滚动/看板虚拟拖拽已人工浏览器验证（见 plan Task 7 Step 4）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review 结论

- **Spec 覆盖**：阈值常量✓ / 列表虚拟化✓(T3) / 看板方案A双层包裹✓(T5) / shouldVirtualize 拆分✓(T1) / 受限测试策略✓(T4,T6) / 不做服务端分页✓(范围声明) / 依赖声明✓(T2,T8)。
- **占位符**：无 TBD；测试代码均为完整可跑代码。
- **类型一致**：`shouldVirtualize(count, threshold)`、`LIST_VIRTUALIZE_THRESHOLD`、`BOARD_COLUMN_VIRTUALIZE_THRESHOLD`、`VirtualColumnBody({columnId, items, renderCard})` 全计划一致。
- **已知风险**：看板 dnd-kit + 虚拟化是唯一不能自动验证的部分，T7 Step4 给了人工验证清单与回退路径（方案 B）。
