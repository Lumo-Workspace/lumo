# 统一任务列表组件 实施计划 [LUM-251]

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「我的任务 / Sprint 详情 / 项目任务」三处列表收敛到同一个列表组件 + 同一套列定义，列与交互按上下文配置显隐。

**Architecture:** 以现有 TanStack 版 `DataTable` 为底座，叠加 `@tanstack/react-virtual` 虚拟化；`createTaskColumns` 改为配置对象、新增 project 列、按 `visibleColumns` 过滤；抽出统一 `TaskListToolbar`（左槽/右槽）与 `TaskListView` 编排组件；三处页面接入后删除旧的 `TaskListTable.tsx`。

**Tech Stack:** Next.js 14 App Router, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `@tanstack/react-table`, `@tanstack/react-virtual`, react-intl, Jest + React Testing Library, Tailwind.

---

## 关键设计决策（执行前先读）

- **统一行类型 = `ApiTask`**。`MyTask = Omit<ApiTask,'project'> & { project:{id,name,ownerActorId} }`，可赋值给 `ApiTask`（其 `project?: {id,name}`）。三处都以 `ApiTask[]` 喂给统一组件。
- **列显隐用 `visibleColumns: ColumnId[]`**。`createTaskColumns` 内部按此过滤输出顺序固定的列。
- **列宽改由 grid 模板驱动**。给每列 `meta.gridWidth` 一段 CSS grid 轨道；`buildColumnTemplate(visibleColumns)` 推导 `gridTemplateColumns`。`DataTable` 渲染从 `<table>` 改为 `role=table/rowgroup/row/cell` 的 div + grid（与被删除的 `TaskListTable` 同构），以便虚拟化并保留 a11y/sticky header。
- **选择模型统一为 TanStack `RowSelectionState`**（`Record<string,boolean>`）。我的任务/Sprint 从 `Set<string>` 迁移过来。
- **批量栏统一为 `BulkActionBar`**（`onBulkUpdate(patch)` / `onRequestDelete` / `onClearSelection`）；项目任务页从 `TaskSelectionBar` 迁过来。
- **子任务树 / 里程碑下拉**：仅项目任务传 `treeConfig` 与左槽里程碑控件；我的任务/Sprint 不传。
- **i18n**：列头 key 已存在（`task.project`/`task.assignee`/`taskColumns.dueDate`/`common.updated` 等），本计划**不新增 user-facing key**。若执行中确需新增，必须同 PR 补齐全部 16 个 locale（strict locale-parity test）。

## 列 id 与各上下文可见列

完整顺序：`select, identifier, title, project, status, priority, dueDate, assignee, updatedAt, actions`

| 上下文 | visibleColumns | treeConfig | 左槽 |
| --- | --- | --- | --- |
| 我的任务 | `select,identifier,title,project,status,priority,dueDate,assignee,updatedAt,actions` | 无 | 「仅当前冲刺」 |
| Sprint | 同上 | 无 | 空 |
| 项目任务 | `select,identifier,title,status,priority,dueDate,assignee,updatedAt,actions`（无 project） | 有（showSubtasks 时） | 里程碑下拉 |

## 文件结构

- 修改 `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx` — `createTaskColumns` 改配置对象、加 project 列、加 `visibleColumns` 过滤、给每列加 `meta.gridWidth`。
- 新建 `app/workspace/[workspaceUrl]/components/data-table/columnTemplate.ts` — `ColumnId` 类型、`ALL_COLUMN_IDS`、`buildColumnTemplate()`、`orderColumns()`。
- 修改 `app/workspace/[workspaceUrl]/components/data-table/data-table.tsx` — div+grid 渲染 + 虚拟化（threshold-gated）。
- 新建 `app/workspace/[workspaceUrl]/components/task-list/TaskListToolbar.tsx` — 左槽/右槽统一工具栏。
- 新建 `app/workspace/[workspaceUrl]/components/task-list/TaskListView.tsx` — 编排 Toolbar + DataTable + 选择。
- 修改三处页面调用点；删除 `app/workspace/[workspaceUrl]/components/task-list/TaskListTable.tsx`。
- 测试：`__tests__/components/task-columns.test.ts`、`__tests__/components/columnTemplate.test.ts`、`__tests__/components/TaskListToolbar.test.tsx`、`__tests__/components/data-table-virtualize.test.ts`。

> **worktree 提醒**：本计划在 `.worktrees/LUM-251`（分支 `lumo/LUM-251-unify-task-list`）执行。跑 jest/tsc 前确认 `node_modules` 软链已建好，且 **`cd` 进 worktree 再跑 jest**（memory：从主 checkout 跑 jest 会撞 cli/package.json haste collision，静默跑错树）。

---

## Task 1: `columnTemplate.ts` — 列 id 与 grid 模板工具（纯函数）

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/data-table/columnTemplate.ts`
- Test: `__tests__/components/columnTemplate.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/components/columnTemplate.test.ts
import {
  ALL_COLUMN_IDS,
  orderColumns,
  buildColumnTemplate,
  COLUMN_GRID_WIDTH,
} from '@/app/workspace/[workspaceUrl]/components/data-table/columnTemplate'

describe('columnTemplate', () => {
  it('orders an arbitrary set into canonical order, dropping unknowns', () => {
    const out = orderColumns(['actions', 'title', 'select', 'bogus' as never])
    expect(out).toEqual(['select', 'title', 'actions'])
  })

  it('builds a grid template with one track per visible column in canonical order', () => {
    const tpl = buildColumnTemplate(['select', 'title', 'updatedAt'])
    expect(tpl).toBe(
      `${COLUMN_GRID_WIDTH.select} ${COLUMN_GRID_WIDTH.title} ${COLUMN_GRID_WIDTH.updatedAt}`
    )
  })

  it('every canonical id has a grid width', () => {
    for (const id of ALL_COLUMN_IDS) {
      expect(COLUMN_GRID_WIDTH[id]).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd .worktrees/LUM-251 && npx jest __tests__/components/columnTemplate.test.ts`
Expected: FAIL — Cannot find module 'columnTemplate'

- [ ] **Step 3: 实现**

```ts
// app/workspace/[workspaceUrl]/components/data-table/columnTemplate.ts
export type ColumnId =
  | 'select'
  | 'identifier'
  | 'title'
  | 'project'
  | 'status'
  | 'priority'
  | 'dueDate'
  | 'assignee'
  | 'updatedAt'
  | 'actions'

/** Canonical left-to-right order. Column visibility is a subset of this. */
export const ALL_COLUMN_IDS: ColumnId[] = [
  'select',
  'identifier',
  'title',
  'project',
  'status',
  'priority',
  'dueDate',
  'assignee',
  'updatedAt',
  'actions',
]

/** One CSS grid track per column. `title` flexes; the rest are fixed. */
export const COLUMN_GRID_WIDTH: Record<ColumnId, string> = {
  select: '40px',
  identifier: '110px',
  title: 'minmax(280px, 1fr)',
  project: '160px',
  status: '144px',
  priority: '112px',
  dueDate: '112px',
  assignee: '120px',
  updatedAt: '132px',
  actions: '48px',
}

/** Reorder an arbitrary id list into canonical order and drop unknown ids. */
export function orderColumns(ids: ColumnId[]): ColumnId[] {
  const set = new Set(ids)
  return ALL_COLUMN_IDS.filter(id => set.has(id))
}

/** CSS `grid-template-columns` for the given visible columns. */
export function buildColumnTemplate(visible: ColumnId[]): string {
  return orderColumns(visible)
    .map(id => COLUMN_GRID_WIDTH[id])
    .join(' ')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd .worktrees/LUM-251 && npx jest __tests__/components/columnTemplate.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: 提交**

```bash
git add app/workspace/\[workspaceUrl\]/components/data-table/columnTemplate.ts __tests__/components/columnTemplate.test.ts
git commit -m "feat: column id + grid template helper for unified task list [LUM-251]"
```

---

## Task 2: `createTaskColumns` 改配置对象 + 新增 project 列 + visibleColumns 过滤 + gridWidth meta

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx`
- Modify (call site): `app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectTasksTab.tsx:138-143`
- Test: `__tests__/components/task-columns.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/components/task-columns.test.ts
import { createTaskColumns } from '@/app/workspace/[workspaceUrl]/components/data-table/task-columns'
import type { ColumnDef } from '@tanstack/react-table'
import type { ApiTask } from '@/app/workspace/[workspaceUrl]/types'

const colId = (c: ColumnDef<ApiTask>) =>
  c.id ?? ('accessorKey' in c ? String(c.accessorKey) : '')

const noop = () => {}
const asyncNoop = async () => {}

describe('createTaskColumns', () => {
  it('project context omits the project column but keeps identifier/dueDate/actions', () => {
    const cols = createTaskColumns({
      onTaskClick: noop,
      onDeleteTask: asyncNoop,
      members: [],
      visibleColumns: [
        'select',
        'identifier',
        'title',
        'status',
        'priority',
        'dueDate',
        'assignee',
        'updatedAt',
        'actions',
      ],
    })
    const ids = cols.map(colId)
    expect(ids).not.toContain('project')
    expect(ids).toContain('identifier')
    expect(ids).toContain('dueDate')
    expect(ids).toContain('actions')
  })

  it('my-tasks context includes the project column', () => {
    const cols = createTaskColumns({
      onTaskClick: noop,
      onDeleteTask: asyncNoop,
      members: [],
      projects: [],
      visibleColumns: [
        'select',
        'identifier',
        'title',
        'project',
        'status',
        'priority',
        'dueDate',
        'assignee',
        'updatedAt',
        'actions',
      ],
    })
    expect(cols.map(colId)).toContain('project')
  })

  it('emits columns in canonical order regardless of input order', () => {
    const cols = createTaskColumns({
      onTaskClick: noop,
      onDeleteTask: asyncNoop,
      members: [],
      visibleColumns: ['actions', 'title', 'select'],
    })
    expect(cols.map(colId)).toEqual(['select', 'title', 'actions'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd .worktrees/LUM-251 && npx jest __tests__/components/task-columns.test.ts`
Expected: FAIL — `createTaskColumns` 旧签名是位置参数，调用方式不匹配（TS/运行时报错）

- [ ] **Step 3: 改 `task-columns.tsx`**

3a. 扩展 `TaskPatch`（加 `projectId`）：

```ts
export type TaskPatch = Partial<{
  title: string
  status: ApiStatus
  priority: ApiPriority
  assigneeActorId: string | null
  dueDate: string | null
  projectId: string
}>
```

3b. 顶部加导入：

```ts
import { ProjectSelect } from '../fields/ProjectSelect'
import {
  type ColumnId,
  orderColumns,
  COLUMN_GRID_WIDTH,
} from './columnTemplate'
import type { ApiProject } from '../../types'
```

3c. 给 `data-table.tsx` 的 `ColumnMeta` 增加 `gridWidth`（在 Task 4 里统一加；本任务先在每列 `meta` 写入 `gridWidth`，类型增强随 Task 4 落地——若本任务先跑 tsc 会因 `gridWidth` 未声明而报错，故 **本任务只跑 jest（SWC，不校验 meta 类型）**，tsc 留到 Task 4 之后整体跑）。

3d. 重写 `createTaskColumns` 为配置对象，按 `visibleColumns` 过滤，并新增 project 列。完整新签名与函数体：

```ts
export interface CreateTaskColumnsOptions {
  onTaskClick: (task: ApiTask) => void
  onDeleteTask: (taskId: string) => Promise<void>
  members: WorkspaceMemberInfo[]
  intl?: IntlShape
  updateTask?: (id: string, patch: TaskPatch) => Promise<void> | void
  /** Which columns to render, in canonical order. */
  visibleColumns: ColumnId[]
  /** Required when 'project' is visible (for ProjectSelect editing). */
  projects?: ApiProject[]
}

export function createTaskColumns(
  options: CreateTaskColumnsOptions
): ColumnDef<ApiTask>[] {
  const {
    onTaskClick,
    onDeleteTask,
    members,
    intl,
    updateTask,
    visibleColumns,
    projects = [],
  } = options

  const memberByActorId = new Map(
    members.filter(m => m.actorId).map(m => [m.actorId!, m])
  )
  const assignableMembers = members.filter(
    (m): m is WorkspaceMemberInfo & { actorId: string } => !!m.actorId
  )

  const byId: Record<ColumnId, ColumnDef<ApiTask>> = {
    select: {
      id: 'select',
      enableSorting: false,
      meta: { gridWidth: COLUMN_GRID_WIDTH.select, cellClassName: 'px-4', headerClassName: 'px-4', stopPropagation: true },
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? 'indeterminate'
                : false
          }
          onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)}
          aria-label='Select all tasks'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={value => row.toggleSelected(!!value)}
          aria-label={`Select ${row.original.title}`}
        />
      ),
    },
    identifier: { /* 保留现有 identifier 列定义，meta 增加 gridWidth: COLUMN_GRID_WIDTH.identifier */ } as ColumnDef<ApiTask>,
    title: { /* 保留现有 title 列定义，meta.gridWidth: COLUMN_GRID_WIDTH.title */ } as ColumnDef<ApiTask>,
    project: {
      id: 'project',
      enableSorting: true,
      meta: { gridWidth: COLUMN_GRID_WIDTH.project, headerClassName: 'px-8', cellClassName: 'px-8', stopPropagation: true },
      sortingFn: (a, b) =>
        (a.original.project?.name ?? '').localeCompare(b.original.project?.name ?? ''),
      header: ({ column }) => (
        <SortableColHeader
          label={intl?.formatMessage({ id: 'task.project', defaultMessage: 'Project' }) ?? 'Project'}
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
          tooltip={intl?.formatMessage({ id: 'tasks.tooltip.project', defaultMessage: 'Project this task belongs to.' })}
        />
      ),
      cell: ({ row }) => {
        const task = row.original
        if (updateTask) {
          return (
            <ProjectSelect
              value={task.projectId}
              projects={projects}
              onChange={projectId => updateTask(task.id, { projectId })}
              triggerClassName={GHOST_TRIGGER}
            />
          )
        }
        return <span className='text-xs text-muted-foreground'>{task.project?.name ?? '—'}</span>
      },
    },
    status: { /* 保留现有 status 列定义 + meta.gridWidth */ } as ColumnDef<ApiTask>,
    priority: { /* 保留现有 priority 列定义 + meta.gridWidth */ } as ColumnDef<ApiTask>,
    dueDate: { /* 保留现有 dueDate 列定义 + meta.gridWidth */ } as ColumnDef<ApiTask>,
    assignee: { /* 保留现有 assignee 列定义 + meta.gridWidth */ } as ColumnDef<ApiTask>,
    updatedAt: { /* 保留现有 updatedAt 列定义 + meta.gridWidth */ } as ColumnDef<ApiTask>,
    actions: { /* 保留现有 actions 列定义 + meta.gridWidth: COLUMN_GRID_WIDTH.actions */ } as ColumnDef<ApiTask>,
  }

  return orderColumns(visibleColumns).map(id => byId[id])
}
```

> 实现说明：把现有 8 个列定义（select/identifier/title/status/priority/dueDate/updatedAt/assignee/actions）原样搬进 `byId`，每个 `meta` 加上 `gridWidth: COLUMN_GRID_WIDTH.<id>`；新增 `project` 列如上。**不要**改动现有列的 cell/header 逻辑。

3e. 改调用点 `ProjectTasksTab.tsx:138-143`：

```ts
const taskColumns = useMemo(
  () =>
    createTaskColumns({
      onTaskClick,
      onDeleteTask,
      members,
      intl,
      updateTask,
      visibleColumns: [
        'select', 'identifier', 'title', 'status', 'priority',
        'dueDate', 'assignee', 'updatedAt', 'actions',
      ],
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [onTaskClick, onDeleteTask, members, intl]
)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd .worktrees/LUM-251 && npx jest __tests__/components/task-columns.test.ts`
Expected: PASS (3 passing)

- [ ] **Step 5: 提交**

```bash
git add app/workspace/\[workspaceUrl\]/components/data-table/task-columns.tsx app/workspace/\[workspaceUrl\]/components/pages/project-detail/ProjectTasksTab.tsx __tests__/components/task-columns.test.ts
git commit -m "feat: config-object createTaskColumns + project column + visibleColumns [LUM-251]"
```

---

## Task 3: `DataTable` 渲染改 div+grid 并叠加虚拟化（threshold-gated）

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/data-table/data-table.tsx`
- Test: `__tests__/components/data-table-virtualize.test.ts`

- [ ] **Step 1: 写失败测试（纯函数门控）**

先把虚拟化判定抽成可测纯函数。测试：

```ts
// __tests__/components/data-table-virtualize.test.ts
import { shouldVirtualize } from '@/lib/utils/shouldVirtualize'
import { LIST_VIRTUALIZE_THRESHOLD } from '@/lib/utils/shouldVirtualize'

describe('DataTable virtualization gating', () => {
  it('does not virtualize at or below threshold', () => {
    expect(shouldVirtualize(LIST_VIRTUALIZE_THRESHOLD, LIST_VIRTUALIZE_THRESHOLD)).toBe(false)
  })
  it('virtualizes above threshold', () => {
    expect(shouldVirtualize(LIST_VIRTUALIZE_THRESHOLD + 1, LIST_VIRTUALIZE_THRESHOLD)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认通过/失败**

Run: `cd .worktrees/LUM-251 && npx jest __tests__/components/data-table-virtualize.test.ts`
Expected: PASS（`shouldVirtualize` 已存在）—— 本测试锁定门控语义，作为 Task 3 改造的回归护栏。

- [ ] **Step 3: 改 `data-table.tsx`**

3a. `ColumnMeta` 增加 `gridWidth`：

```ts
interface ColumnMeta<TData extends RowData, TValue> {
  headerClassName?: string
  cellClassName?: string
  stopPropagation?: boolean
  /** CSS grid track for this column (used by the grid renderer). */
  gridWidth?: string
}
```

3b. Props 增加可见列与虚拟化所需信息：

```ts
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  onRowClick?: (row: TData) => void
  treeConfig?: TreeConfig<TData>
  enableSelection?: boolean
  rowSelection?: RowSelectionState
  onRowSelectionChange?: (selection: RowSelectionState) => void
  getRowId?: (row: TData) => string
  /** grid-template-columns; one track per visible column. */
  columnTemplate: string
  /** Empty-state text. */
  emptyLabel?: string
}
```

3c. 渲染从 `<table>/<thead>/<tbody>` 改为 `role` + grid 的 div（与被删的 TaskListTable 同构）：
- 外层 `<div role="table" ref={scrollRef} className="flex-1 min-h-0 overflow-auto">`
- header：`<div role="rowgroup"><div role="row" className="grid sticky top-0 ..." style={{gridTemplateColumns: columnTemplate}}>` 内每个 header 用 `<div role="columnheader" className={meta.headerClassName}>`
- body：行高常量 `ROW_HEIGHT = 49`，用 `useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 12, enabled: shouldVirtualize(rows.length, LIST_VIRTUALIZE_THRESHOLD) })`
- 每行 `<div role="row" className="grid ..." style={{gridTemplateColumns: columnTemplate, height: ROW_HEIGHT}}>`；每 cell `<div role="cell" className={meta.cellClassName} onClick={meta.stopPropagation ? stop : undefined}>`
- 虚拟化分支：`position:relative` 容器 + `transform: translateY(vi.start)` 包裹层（参照旧 TaskListTable 的 renderRow 包裹模式）
- 非虚拟化分支：直接 map
- 子任务底色：`getParentId?.(row.original) != null` 时加 `bg-zinc-50/50 dark:bg-zinc-900/50`
- 空态：`rows.length === 0` 时显示 `emptyLabel ?? 'No tasks found.'`

> 关键：保留现有 `meta.stopPropagation`、tree flatten（`visibleData`）、`getSortedRowModel`、selection、ARIA 角色。**列宽来源从 Tailwind `w-*` 改为 grid 轨道**——现有列 meta 里的 `w-24/w-36` 等宽度类可保留也可清理（grid 已决定宽度，宽度类无害但建议在 Task 2 已迁移到 `gridWidth`）。

3d. 导入：

```ts
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { shouldVirtualize, LIST_VIRTUALIZE_THRESHOLD } from '@/lib/utils/shouldVirtualize'
```

- [ ] **Step 4: 跑 jest + tsc 确认通过**

Run:
```bash
cd .worktrees/LUM-251 && npx jest __tests__/components/data-table-virtualize.test.ts __tests__/components/task-columns.test.ts __tests__/components/columnTemplate.test.ts && npx tsc --noEmit
```
Expected: jest PASS；tsc 无错误（`gridWidth` 现已声明，Task 2 的 meta 写入此时类型合法）。

- [ ] **Step 5: 提交**

```bash
git add app/workspace/\[workspaceUrl\]/components/data-table/data-table.tsx __tests__/components/data-table-virtualize.test.ts
git commit -m "feat: grid+virtualized DataTable renderer [LUM-251]"
```

---

## Task 4: `TaskListToolbar` — 统一工具栏（左槽/右槽）

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/task-list/TaskListToolbar.tsx`
- Test: `__tests__/components/TaskListToolbar.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// __tests__/components/TaskListToolbar.test.tsx
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { TaskListToolbar } from '@/app/workspace/[workspaceUrl]/components/task-list/TaskListToolbar'

const wrap = (ui: React.ReactNode) =>
  render(<IntlProvider locale='en' messages={{}}>{ui}</IntlProvider>)

const baseProps = {
  completedFilter: 'all' as const,
  onCompletedFilterChange: () => {},
  ordering: 'manual' as const,
  onOrderingChange: () => {},
  showSubtasks: false,
  onShowSubtasksChange: () => {},
  viewMode: 'list' as const,
  onViewModeChange: () => {},
}

describe('TaskListToolbar', () => {
  it('renders left-slot children', () => {
    wrap(
      <TaskListToolbar {...baseProps} leftSlot={<button>仅当前冲刺</button>} />
    )
    expect(screen.getByText('仅当前冲刺')).toBeInTheDocument()
  })

  it('does not render the collapse button when onToggleSidebar is omitted', () => {
    wrap(<TaskListToolbar {...baseProps} />)
    expect(screen.queryByLabelText(/collapse sidebar/i)).toBeNull()
  })

  it('renders the collapse button when onToggleSidebar is provided', () => {
    wrap(
      <TaskListToolbar
        {...baseProps}
        sidebarCollapsed={false}
        onToggleSidebar={() => {}}
      />
    )
    expect(screen.getByLabelText(/collapse sidebar/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd .worktrees/LUM-251 && npx jest __tests__/components/TaskListToolbar.test.tsx`
Expected: FAIL — Cannot find module 'TaskListToolbar'

- [ ] **Step 3: 实现**

```tsx
// app/workspace/[workspaceUrl]/components/task-list/TaskListToolbar.tsx
'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { PanelRightClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DisplayOptionsMenu } from '../DisplayOptionsMenu'
import { ViewToggle } from '../ViewToggle'
import type { CompletedFilter, TaskOrdering } from '../../types'

interface Props {
  completedFilter: CompletedFilter
  onCompletedFilterChange: (value: CompletedFilter) => void
  ordering: TaskOrdering
  onOrderingChange: (value: TaskOrdering) => void
  showSubtasks: boolean
  onShowSubtasksChange: (value: boolean) => void
  viewMode: 'list' | 'board'
  onViewModeChange: (mode: 'list' | 'board') => void
  /** Context-specific filters rendered on the left (仅当前冲刺 / 里程碑下拉). */
  leftSlot?: ReactNode
  /** When provided, renders the sidebar-collapse button (Sprint detail). */
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}

export function TaskListToolbar({
  completedFilter,
  onCompletedFilterChange,
  ordering,
  onOrderingChange,
  showSubtasks,
  onShowSubtasksChange,
  viewMode,
  onViewModeChange,
  leftSlot,
  sidebarCollapsed,
  onToggleSidebar,
}: Props) {
  const intl = useIntl()
  return (
    <div className='flex items-center justify-between gap-2 py-2'>
      <div className='flex items-center gap-2'>{leftSlot}</div>
      <div className='flex items-center gap-2'>
        <DisplayOptionsMenu
          completedFilter={completedFilter}
          onCompletedFilterChange={onCompletedFilterChange}
          ordering={ordering}
          onOrderingChange={onOrderingChange}
          showSubtasks={showSubtasks}
          onShowSubtasksChange={onShowSubtasksChange}
        />
        <ViewToggle value={viewMode} onChange={onViewModeChange} />
        {onToggleSidebar && (
          <Button
            variant='ghost'
            size='icon'
            onClick={onToggleSidebar}
            aria-label={intl.formatMessage({
              id: 'sprint.collapseSidebar',
              defaultMessage: 'Collapse sidebar',
            })}
          >
            <PanelRightClose size={16} className={sidebarCollapsed ? 'rotate-180' : ''} />
          </Button>
        )}
      </div>
    </div>
  )
}
```

> 注意：`sprint.collapseSidebar` key 若不存在则**复用 SprintTasksToolbar 当前折叠按钮用的 key**（执行时 grep `SprintTasksToolbar.tsx` 取现有 aria-label key，避免新增 key 触发 locale-parity）。`CompletedFilter`/`TaskOrdering` 从 `types` 导入（DisplayOptionsMenu 已使用同名类型，确认导出位置）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd .worktrees/LUM-251 && npx jest __tests__/components/TaskListToolbar.test.tsx`
Expected: PASS (3 passing)

- [ ] **Step 5: 提交**

```bash
git add app/workspace/\[workspaceUrl\]/components/task-list/TaskListToolbar.tsx __tests__/components/TaskListToolbar.test.tsx
git commit -m "feat: unified TaskListToolbar with left/right slots [LUM-251]"
```

---

## Task 5: `TaskListView` — 编排组件

**Files:**
- Create: `app/workspace/[workspaceUrl]/components/task-list/TaskListView.tsx`

> 该组件无独立单测（其行为在三处页面的接入测试中覆盖）；它只是组合 Toolbar + DataTable + 列工厂，逻辑都在已测的下层。提交时附带类型检查。

- [ ] **Step 1: 实现**

```tsx
// app/workspace/[workspaceUrl]/components/task-list/TaskListView.tsx
'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import type { ReactNode } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { DataTable } from '../data-table/data-table'
import {
  createTaskColumns,
  type TaskPatch,
} from '../data-table/task-columns'
import { buildColumnTemplate, type ColumnId } from '../data-table/columnTemplate'
import { TaskListToolbar } from './TaskListToolbar'
import type {
  ApiTask,
  ApiProject,
  WorkspaceMemberInfo,
  CompletedFilter,
  TaskOrdering,
} from '../../types'

interface TreeConfig {
  getParentId: (t: ApiTask) => string | null
  getChildCount: (t: ApiTask) => number
  getRowId: (t: ApiTask) => string
}

interface Props {
  tasks: ApiTask[]
  members: WorkspaceMemberInfo[]
  projects?: ApiProject[]
  visibleColumns: ColumnId[]
  updateTask: (id: string, patch: TaskPatch) => Promise<void> | void
  onTaskClick: (task: ApiTask) => void
  onDeleteTask: (taskId: string) => Promise<void>
  rowSelection: RowSelectionState
  onRowSelectionChange: (s: RowSelectionState) => void
  treeConfig?: TreeConfig
  // toolbar
  completedFilter: CompletedFilter
  onCompletedFilterChange: (v: CompletedFilter) => void
  ordering: TaskOrdering
  onOrderingChange: (v: TaskOrdering) => void
  showSubtasks: boolean
  onShowSubtasksChange: (v: boolean) => void
  viewMode: 'list' | 'board'
  onViewModeChange: (m: 'list' | 'board') => void
  leftSlot?: ReactNode
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  /** Rendered above the table when selection is non-empty (BulkActionBar). */
  selectionBar?: ReactNode
}

export function TaskListView(props: Props) {
  const intl = useIntl()
  const columns = useMemo(
    () =>
      createTaskColumns({
        onTaskClick: props.onTaskClick,
        onDeleteTask: props.onDeleteTask,
        members: props.members,
        intl,
        updateTask: props.updateTask,
        visibleColumns: props.visibleColumns,
        projects: props.projects ?? [],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.onTaskClick, props.onDeleteTask, props.members, intl, props.visibleColumns]
  )
  const columnTemplate = useMemo(
    () => buildColumnTemplate(props.visibleColumns),
    [props.visibleColumns]
  )

  return (
    <div className='flex flex-col flex-1 min-h-0'>
      <TaskListToolbar
        completedFilter={props.completedFilter}
        onCompletedFilterChange={props.onCompletedFilterChange}
        ordering={props.ordering}
        onOrderingChange={props.onOrderingChange}
        showSubtasks={props.showSubtasks}
        onShowSubtasksChange={props.onShowSubtasksChange}
        viewMode={props.viewMode}
        onViewModeChange={props.onViewModeChange}
        leftSlot={props.leftSlot}
        {...(props.onToggleSidebar
          ? { sidebarCollapsed: props.sidebarCollapsed, onToggleSidebar: props.onToggleSidebar }
          : {})}
      />
      {props.selectionBar}
      <DataTable
        columns={columns}
        data={props.tasks}
        columnTemplate={columnTemplate}
        onRowClick={props.onTaskClick}
        enableSelection
        rowSelection={props.rowSelection}
        onRowSelectionChange={props.onRowSelectionChange}
        getRowId={(row: ApiTask) => row.id}
        {...(props.treeConfig ? { treeConfig: props.treeConfig } : {})}
      />
    </div>
  )
}
```

> 注意 `exactOptionalPropertyTypes`（memory）：可选 prop 用展开 `{...(cond ? {...} : {})}` 注入，不要传 `undefined`。

- [ ] **Step 2: 类型检查**

Run: `cd .worktrees/LUM-251 && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/workspace/\[workspaceUrl\]/components/task-list/TaskListView.tsx
git commit -m "feat: TaskListView orchestrator (toolbar + virtualized table) [LUM-251]"
```

---

## Task 6: 接入项目任务页（ProjectTasksTab）

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectTasksTab.tsx`

- [ ] **Step 1: 用 TaskListView 替换 DataTable + 工具栏 + TaskSelectionBar**

- 把现有 milestone 下拉作为 `leftSlot` 传入。
- `rowSelection`/`setRowSelection` 已存在，直接透传。
- `treeConfig`：`displayOptions.showSubtasks` 时传，否则不传（用展开注入，见 TaskListView）。
- `selectionBar`：保留现有批量栏，但改用统一 `BulkActionBar`：
  - `selectedCount = Object.keys(rowSelection).length`
  - `count > 0` 时渲染 `<BulkActionBar count={selectedCount} members={members} onBulkUpdate={runBulkUpdate} onRequestDelete={runBulkDelete-confirm} onClearSelection={() => setRowSelection({})} />`
  - `runBulkUpdate` 现有签名接收 `{status?,priority?,assigneeActorId?}`，与 `BulkActionBar` 的 `onBulkUpdate(patch)` 一致；`runBulkDelete` 现有逻辑接到确认流程。
- visibleColumns 用项目集合（无 project）：`['select','identifier','title','status','priority','dueDate','assignee','updatedAt','actions']`
- 删除 `createTaskColumns`/`DataTable`/`TaskSelectionBar`/`DisplayOptionsMenu`/`ViewToggle` 的直接渲染（改由 TaskListView 内部处理），保留 `updateTask`/`onDeleteTask`/数据 hooks/board 视图分支。

> board 视图分支（`viewMode === 'board'`）保持不变，TaskListView 只接管 list 分支。

- [ ] **Step 2: 类型检查 + 相关测试**

Run: `cd .worktrees/LUM-251 && npx tsc --noEmit && npx jest __tests__`
Expected: 无 tsc 错误；现有相关测试通过（若有 ProjectTasksTab 测试同步更新）。

- [ ] **Step 3: 提交**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/project-detail/ProjectTasksTab.tsx
git commit -m "refactor: project tasks tab uses unified TaskListView [LUM-251]"
```

---

## Task 7: 接入我的任务页（MyTasksPage）

**Files:**
- Modify: `app/workspace/[workspaceUrl]/components/pages/MyTasksPage.tsx`

- [ ] **Step 1: 把 TaskListTable 换成 TaskListView**

- 选择模型从 `selected: Set<string>` 迁到 `rowSelection: RowSelectionState`：
  - `const [rowSelection, setRowSelection] = useState<RowSelectionState>({})`
  - `selectedIds = Object.keys(rowSelection)`；`runBulkUpdate`/删除/clear 改读 `selectedIds`、clear = `setRowSelection({})`
- `updateTask`：MyTasksPage 当前没有独立 updateTask（在 TaskListTable 内）。把 TaskListTable 里的 `updateTask`（含 projectId 时刷新 `project` 嵌套对象的乐观逻辑）上移到 MyTasksPage，签名 `(id, patch: TaskPatch)`，patch 含 `projectId` 时按旧逻辑刷新 `project`。
- visibleColumns（含 project）：`['select','identifier','title','project','status','priority','dueDate','assignee','updatedAt','actions']`
- `projects` 透传给 TaskListView。
- `leftSlot`：把 MyTasksToolbar 的「仅当前冲刺」抽成一个独立小控件（或直接内联一个 Button），传入 leftSlot；其余 display/view 选项交给 TaskListView 的工具栏 props。
- `selectionBar`：`selectedIds.length > 0` 时渲染现有 `BulkActionBar`（props 不变，count = selectedIds.length，clear = setRowSelection({})）。
- list 视图用 TaskListView；board 分支不变。

- [ ] **Step 2: 类型检查 + 测试**

Run: `cd .worktrees/LUM-251 && npx tsc --noEmit && npx jest __tests__`
Expected: 无错误，测试通过。

- [ ] **Step 3: 提交**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/MyTasksPage.tsx
git commit -m "refactor: my-tasks page uses unified TaskListView [LUM-251]"
```

---

## Task 8: 接入 Sprint 详情页（SprintTasksView）

**Files:**
- Modify: `app/workspace/[workspaceUrl]/sprints/components/SprintTasksView.tsx`

- [ ] **Step 1: 把 TaskListTable 换成 TaskListView**

- 与 Task 7 相同的选择模型迁移（Set → RowSelectionState）+ updateTask 上移。
- visibleColumns 同我的任务（含 project）。
- `leftSlot`：空（Sprint 无专属过滤器）。
- `sidebarCollapsed` / `onToggleSidebar` 透传给 TaskListView（渲染折叠按钮）。
- `selectionBar`：现有 `BulkActionBar` 不变。
- board 分支不变。

- [ ] **Step 2: 类型检查 + 测试**

Run: `cd .worktrees/LUM-251 && npx tsc --noEmit && npx jest __tests__`
Expected: 无错误，测试通过。

- [ ] **Step 3: 提交**

```bash
git add app/workspace/\[workspaceUrl\]/sprints/components/SprintTasksView.tsx
git commit -m "refactor: sprint detail uses unified TaskListView [LUM-251]"
```

---

## Task 9: 删除旧 `TaskListTable.tsx` 并清理

**Files:**
- Delete: `app/workspace/[workspaceUrl]/components/task-list/TaskListTable.tsx`
- 可能修改: 引用清理

- [ ] **Step 1: 确认无引用**

Run: `cd .worktrees/LUM-251 && grep -rn "TaskListTable" app __tests__`
Expected: 仅可能命中将要删除的文件自身与（若有）其旧测试；无生产引用。

- [ ] **Step 2: 删除文件 + 删除/迁移其旧测试**

```bash
git rm "app/workspace/[workspaceUrl]/components/task-list/TaskListTable.tsx"
# 若存在 TaskListTable 的旧测试，删除或改写指向 TaskListView/DataTable
```

- [ ] **Step 3: 若 TaskSelectionBar 不再被引用，一并删除**

Run: `cd .worktrees/LUM-251 && grep -rn "TaskSelectionBar" app __tests__`
- 若无引用：`git rm "app/workspace/[workspaceUrl]/components/data-table/TaskSelectionBar.tsx"`
- 若仍被引用：保留。

- [ ] **Step 4: 全量校验**

Run: `cd .worktrees/LUM-251 && npx tsc --noEmit && npx jest && npm run lint:tokens`
Expected: tsc 无错误；jest 全绿；token-lint 通过（新组件用语义 token，不要 raw zinc——memory《copied palette classes trip token-lint》。注意搬运旧 TaskListTable 里的 `zinc-*` class 到新文件会触发，必要时换 `text-muted-foreground`/`bg-muted` 等或按需 `lint:tokens -- --update`）。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: remove legacy TaskListTable, unify on TaskListView [LUM-251]"
```

---

## Task 10: 收尾验证 + 自查

- [ ] **Step 1: 三处视觉/行为人工核对清单**（preview 受限时靠 jsdom 测 + 类型；memory《Preview browser can't reach local dev server》）
  - 我的任务：列含 项目 + ID + 截止日期 + ⋯，排序/内联编辑/批量/虚拟化正常
  - Sprint：同上但无专属左槽，折叠按钮在
  - 项目任务：无 项目 列、有子任务展开 + 里程碑左槽
- [ ] **Step 2: 全量** `cd .worktrees/LUM-251 && npx tsc --noEmit && npx jest`
- [ ] **Step 3: 确认无 `console.log`、无新 npm 包（本计划未引入新依赖，`@tanstack/react-virtual` 已在用）**
- [ ] **Step 4: 开 PR**：标题 `refactor: unify task list views into shared component [LUM-251]`；描述说明三处统一、无 schema 变更、无新依赖。

---

## 自查（Self-Review）

**Spec 覆盖：**
- 方向 A（向项目任务看齐，补 ID/截止/操作）→ Task 2 列集 + Task 7/8 visibleColumns ✓
- project 列纳入组件、项目任务隐藏 → Task 2 project 列 + Task 6 不含 project ✓
- 基座 DataTable + 虚拟化 → Task 3 ✓
- 子任务/里程碑项目任务专属 → Task 6 treeConfig + leftSlot；Task 7/8 不传 ✓
- 统一 Toolbar 左/右槽 → Task 4 + Task 5 ✓
- 测试策略（列工厂/模板/门控/toolbar）→ Task 1–4 测试 ✓
- i18n locale-parity（不新增 key）→ 全程复用现有 key，Task 4 注明折叠 key 复用 ✓
- 删除 TaskListTable → Task 9 ✓

**占位符扫描：** Task 2 的 `byId` 中 `/* 保留现有…列定义 */` 是「搬运现有代码」指令，非占位逻辑（现有定义已在 task-columns.tsx 中，原样移动 + 加 `gridWidth`）；其余步骤均有完整代码或精确编辑指令。

**类型一致性：** `TaskPatch`（含 `projectId`）、`ColumnId`、`createTaskColumns(options)`、`DataTableProps.columnTemplate`、`RowSelectionState` 在各任务间一致；`BulkActionBar` 统一契约（`onBulkUpdate/onRequestDelete/onClearSelection`）在 Task 6/7/8 一致使用。

## 风险与回滚

- 最大风险：Task 3 把 `<table>` 改 div+grid 同时叠加虚拟化。分两段降低风险（先 grid 渲染保证项目任务页不回归，再确认虚拟化门控）。每个 Task 独立提交，可单点回滚。
- 删除 `TaskListTable` 前 grep 确认零引用（Task 9 Step 1）。
- 选择模型 Set→RowSelectionState 迁移影响每页的 `runBulkUpdate`/删除路径，逐页迁移并各自跑测试。
