# Parent-Child Task Relationship Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display parent-child task relationships in List View (tree indentation), Board View (parent label + progress bar), and Detail Panel (breadcrumb + parent metadata field).

**Architecture:** Extend existing API responses to include parent info and children counts. Add tree-view expand/collapse logic to list view data layer. Add parent badge and progress bar UI elements to board cards. Add breadcrumb and parent field to detail panel.

**Tech Stack:** Next.js 14 App Router, TanStack React Table, Prisma, Tailwind CSS, shadcn/ui, lucide-react.

---

### Task 1: Extend API responses with parent and children data

**Files:**

- Modify: `app/api/projects/[id]/tasks/route.ts`
- Modify: `app/api/tasks/[id]/route.ts`
- Modify: `app/workspace/[workspaceUrl]/types.ts`

- [ ] **Step 1: Add parent and children info to types**

In `app/workspace/[workspaceUrl]/types.ts`, add to the `ApiTask` interface (after `project?` field at line 131):

```typescript
  parent?: { id: string; number: number; teamIdentifier: string; title: string } | null
  _count?: { children: number }
  childrenDoneCount?: number
```

In the `TaskDetail` interface (after `parentTaskId` field at line 249):

```typescript
  parent?: { id: string; number: number; teamIdentifier: string; title: string } | null
```

- [ ] **Step 2: Update project tasks GET to include parent and children counts**

In `app/api/projects/[id]/tasks/route.ts`, modify the Prisma `findMany` include (around line 67). Add after the `assignee` include:

```typescript
    parent: {
      select: {
        id: true,
        title: true,
        number: true,
        team: { select: { identifier: true } },
      },
    },
    _count: { select: { children: true } },
    children: {
      where: { status: 'DONE' },
      select: { id: true },
    },
```

Then in the response mapping (where tasks are transformed before returning), flatten the parent's team identifier. Find where tasks are mapped/returned and add to each task object:

```typescript
parent: t.parent ? {
  id: t.parent.id,
  title: t.parent.title,
  number: t.parent.number,
  teamIdentifier: t.parent.team.identifier,
} : null,
_count: t._count,
childrenDoneCount: t.children?.length ?? 0,
```

- [ ] **Step 3: Update task detail GET to include parent**

In `app/api/tasks/[id]/route.ts`, find the Prisma query for the GET handler that fetches a single task. Add to its `include`:

```typescript
    parent: {
      select: {
        id: true,
        title: true,
        number: true,
        team: { select: { identifier: true } },
      },
    },
```

And flatten in the response:

```typescript
parent: task.parent ? {
  id: task.parent.id,
  title: task.parent.title,
  number: task.parent.number,
  teamIdentifier: task.parent.team.identifier,
} : null,
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && PATH="/Users/chaoli/.nvm/versions/node/v24.14.0/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/api/projects/\[id\]/tasks/route.ts app/api/tasks/\[id\]/route.ts app/workspace/\[workspaceUrl\]/types.ts
git commit -m "feat: extend API responses with parent info and children counts"
```

---

### Task 2: List View — Tree indentation with expand/collapse

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/data-table/data-table.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx`

- [ ] **Step 1: Add expand/collapse state and tree flattening to DataTable**

The current `DataTable` receives a flat `data` array. For tree view, we need to:

1. Accept an optional `getChildCount` and `getParentId` prop
2. Manage expand/collapse state internally
3. Filter visible rows based on expand state

In `app/workspace/[workspaceUrl]/components/data-table/data-table.tsx`, update the props interface:

```typescript
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  onRowClick?: (row: TData) => void
  /** Return parent ID for tree view. If provided, enables tree indentation. */
  getParentId?: (row: TData) => string | null
  /** Return children count for showing expand toggle. */
  getChildCount?: (row: TData) => number
  /** Return unique row ID. */
  getRowId?: (row: TData) => string
}
```

Add expand state and visible-row computation inside the component:

```typescript
const [expanded, setExpanded] = useState<Set<string>>(new Set())

const toggleExpand = useCallback((id: string) => {
  setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}, [])

// Build visible rows for tree view
const visibleData = useMemo(() => {
  if (!getParentId || !getRowId) return data
  // Show root tasks + children of expanded parents
  return data.filter(row => {
    const parentId = getParentId(row)
    if (!parentId) return true // root task, always visible
    return expanded.has(parentId) // child visible only if parent expanded
  })
}, [data, getParentId, getRowId, expanded])
```

Pass `visibleData` instead of `data` to `useReactTable`. Also pass `expanded`, `toggleExpand`, `getParentId`, `getChildCount`, `getRowId` via React context or TanStack table meta so columns can access them.

Use TanStack's `meta` on the table:

```typescript
const table = useReactTable({
  data: visibleData,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  onSortingChange: setSorting,
  state: { sorting },
  meta: {
    expanded,
    toggleExpand,
    getParentId,
    getChildCount,
    getRowId,
  },
})
```

Add row styling for indented children. In the `TableRow` rendering, add conditional classes:

```typescript
<TableRow
  key={row.id}
  onClick={() => onRowClick?.(row.original)}
  className={cn(
    'cursor-pointer group',
    getParentId?.(row.original) ? 'bg-zinc-50/50 dark:bg-zinc-900/50' : ''
  )}
>
```

- [ ] **Step 2: Add expand toggle to the ID column in task-columns.tsx**

In `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx`, modify the ID column cell (around line 146). Before the existing ID display, add an expand/collapse toggle:

```typescript
{
  accessorKey: 'number',
  header: () => <span className='pl-3 text-xs text-muted-foreground'>ID</span>,
  cell: ({ row, table }) => {
    const task = row.original
    const meta = table.options.meta as {
      expanded?: Set<string>
      toggleExpand?: (id: string) => void
      getParentId?: (row: ApiTask) => string | null
      getChildCount?: (row: ApiTask) => number
      getRowId?: (row: ApiTask) => string
    } | undefined

    const parentId = meta?.getParentId?.(task)
    const childCount = meta?.getChildCount?.(task) ?? 0
    const isExpanded = meta?.expanded?.has(task.id) ?? false
    const isChild = !!parentId

    return (
      <div className={cn('flex items-center gap-1', isChild ? 'pl-7' : 'pl-3')}>
        {childCount > 0 ? (
          <button
            onClick={e => {
              e.stopPropagation()
              meta?.toggleExpand?.(task.id)
            }}
            className='p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
          >
            <ChevronRight
              className={cn(
                'size-3.5 transition-transform',
                isExpanded && 'rotate-90'
              )}
            />
          </button>
        ) : (
          <span className='w-4.5' />
        )}
        {task.number === -1 ? (
          <Spinner className='size-3 text-zinc-300 dark:text-zinc-600' />
        ) : (
          <span className='text-xs text-muted-foreground whitespace-nowrap'>
            {task.teamIdentifier}-{task.number}
          </span>
        )}
      </div>
    )
  },
  meta: { headerClassName: 'w-[100px]', cellClassName: '' },
},
```

Add `ChevronRight` to the lucide-react imports at the top of the file.

- [ ] **Step 3: Pass tree props from ProjectDetailPage**

Find where `<DataTable>` is used in `app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx`. Add the tree props:

```typescript
<DataTable
  columns={columns}
  data={sortedTasks}
  onRowClick={handleRowClick}
  getParentId={(task: ApiTask) => task.parentTaskId}
  getChildCount={(task: ApiTask) => task._count?.children ?? 0}
  getRowId={(task: ApiTask) => task.id}
/>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && PATH="/Users/chaoli/.nvm/versions/node/v24.14.0/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/workspace/\[workspaceUrl\]/components/data-table/data-table.tsx app/workspace/\[workspaceUrl\]/components/data-table/task-columns.tsx app/workspace/\[workspaceUrl\]/components/pages/ProjectDetailPage.tsx
git commit -m "feat: add tree view with expand/collapse to list view"
```

---

### Task 3: Board View — Parent label on subtask cards + progress bar on parent cards

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/board/SortableTaskCard.tsx`

- [ ] **Step 1: Add parent label to subtask cards**

In `app/workspace/[workspaceUrl]/components/board/SortableTaskCard.tsx`, modify the `ProjectTaskCard` component (around line 170). Before the title (line 209), add a parent reference label when `task.parentTaskId` is set:

```typescript
{task.parent && (
  <div className='mb-1'>
    <span className='text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded'>
      ↑ {task.parent.teamIdentifier}-{task.parent.number}
    </span>
  </div>
)}
```

Insert this between the header (ID + PriorityBadge) and the title.

- [ ] **Step 2: Add subtask progress bar to parent cards**

In the same `ProjectTaskCard`, after the title (line 211) and before the footer (line 212), add a progress bar when the task has children:

```typescript
{(task._count?.children ?? 0) > 0 && (
  <div className='flex items-center gap-1.5 mt-1.5'>
    <div className='flex-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden'>
      <div
        className='h-full bg-blue-500 rounded-full transition-all'
        style={{
          width: `${Math.round(((task.childrenDoneCount ?? 0) / (task._count?.children ?? 1)) * 100)}%`,
        }}
      />
    </div>
    <span className='text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums'>
      {task.childrenDoneCount ?? 0}/{task._count?.children ?? 0}
    </span>
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && PATH="/Users/chaoli/.nvm/versions/node/v24.14.0/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/workspace/\[workspaceUrl\]/components/board/SortableTaskCard.tsx
git commit -m "feat: add parent label and subtask progress bar to board cards"
```

---

### Task 4: Detail Panel — Breadcrumb + Parent metadata field

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

- [ ] **Step 1: Add parent breadcrumb above title**

In `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`, find the title rendering section (around line 633). Before the `<TypographyH3>` title element, add a breadcrumb when the task has a parent:

```typescript
{task.parent && (
  <button
    onClick={() => {
      // Navigate to parent task — reuse existing task open pattern
      const parentIdentifier = `${task.parent!.teamIdentifier}-${task.parent!.number}`
      const projectSlug = slugifyProjectName(task.project.name)
      router.push(
        `/${workspaceUrl}/project/${projectSlug}/tasks/${parentIdentifier}`
      )
    }}
    className='flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 mb-1 transition-colors'
  >
    <span>↑</span>
    <span>
      {task.parent.teamIdentifier}-{task.parent.number} {task.parent.title}
    </span>
  </button>
)}
```

Make sure `useRouter` from `next/navigation` is imported (it likely already is), and `slugifyProjectName` from `../utils`.

- [ ] **Step 2: Add Parent field in metadata section**

In the metadata `<div>` that contains Status, Assignee, Reviewer, Project, Priority selects (around line 662-698), add a Parent field when applicable. Add after the PrioritySelect and before the closing `</div>`:

```typescript
{task.parent && (
  <>
    <SeparatorDot />
    <button
      onClick={() => {
        const parentIdentifier = `${task.parent!.teamIdentifier}-${task.parent!.number}`
        const projectSlug = slugifyProjectName(task.project.name)
        router.push(
          `/${workspaceUrl}/project/${projectSlug}/tasks/${parentIdentifier}`
        )
      }}
      className={cn(FIELD_TRIGGER_CLS, 'gap-1')}
    >
      <span className='text-muted-foreground text-xs'>Parent</span>
      <span className='text-xs'>
        {task.parent.teamIdentifier}-{task.parent.number}
      </span>
    </button>
  </>
)}
```

- [ ] **Step 3: Verify TaskDetail API maps parent correctly**

Check that the `refreshDetail` and initial fetch in TaskDetailPanel map the `parent` field from the API response to the `task` state. In the state setter where `TaskDetail` is populated from the API, ensure `parent` is included:

```typescript
parent: t.parent ?? null,
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && PATH="/Users/chaoli/.nvm/versions/node/v24.14.0/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add app/workspace/\[workspaceUrl\]/components/TaskDetailPanel.tsx
git commit -m "feat: add parent breadcrumb and metadata field to detail panel"
```

---

### Task 5: Verify end-to-end and push

- [ ] **Step 1: Run TypeScript check**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && PATH="/Users/chaoli/.nvm/versions/node/v24.14.0/bin:$PATH" npx tsc --noEmit
```

- [ ] **Step 2: Start dev server and test**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && PATH="/Users/chaoli/.nvm/versions/node/v24.14.0/bin:$PATH" npm run dev
```

Test checklist:

- List view: parent tasks show ▶ toggle, click to expand, children indented with subtle bg
- Board view: subtask cards show `↑ LUM-X` label, parent cards show progress bar
- Detail panel: opening a subtask shows breadcrumb above title + Parent in metadata
- Clicking breadcrumb/parent label navigates to parent task

- [ ] **Step 3: Push**

```bash
cd /Users/chaoli/Desktop/lumo/lumo && git push
```
