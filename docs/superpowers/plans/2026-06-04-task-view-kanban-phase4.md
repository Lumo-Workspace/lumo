# Task View Kanban (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish LUM-224 — make the task-view block an interactive kanban: a list/kanban view toggle, a status-column board where dragging a card changes its status with **optimistic update + rollback + toast**, visibility-gated **polling**, and a **truncated** banner.

**Architecture:** The drop→status decision is a **pure function** (`statusFromDropTarget`, unit-tested) — dnd-kit drag itself isn't simulated in jsdom. Status writes go through a dedicated optimistic React Query mutation (`useWorkspaceTaskStatus`, mirrors `useTaskBulkMutations`'s onMutate-snapshot / onError-rollback / sonner-toast pattern) that patches the `byWorkspace` list cache + per-task detail cache and invalidates on settle. `TaskViewKanban` is thin dnd-kit wiring (`DndContext` + `useDroppable` columns + `useDraggable` cards via `@dnd-kit/core`, already installed) that calls the pure resolver + the mutation. The block renders kanban when `config.view === 'kanban'`, else the Phase-3 grouped list. The node is switched to `draggable: false` so the ProseMirror editor doesn't fight dnd-kit.

**Tech Stack:** Next.js 14, TS strict (exactOptionalPropertyTypes + noUncheckedIndexedAccess), Tiptap, React Query, `@dnd-kit/core`, react-intl, sonner, Jest + @testing-library/react.

**Key constraints (from exploration):**
- `task-view.ts` node currently has `draggable: true` → **must become `false`** (else editor block-drag conflicts with dnd-kit card drag).
- dnd-kit drag is NOT simulatable in jsdom → extract drop→status into a pure function; test the mutation hook with a `deferred()` + `waitFor` (mirror `__tests__/hooks/useTaskBulkMutations.test.tsx`).
- Card click-to-open vs drag: `PointerSensor` with `activationConstraint: { distance: 5 }` so a plain click (no movement) navigates, only a real drag moves the card.
- New UI files: **semantic Tailwind tokens only** (lint:tokens). Reuse `StatusIcon`, `API_STATUS_LABEL`.
- Status write = `tasksClient.update(id, { status })` (PATCH `/api/tasks/{id}`). No backend change, no migration.

**Reference:** spec `docs/superpowers/specs/2026-06-04-embedded-live-task-view-design.md`; `app/workspace/[workspaceUrl]/hooks/useTaskBulkMutations.ts` (optimistic pattern); `app/workspace/[workspaceUrl]/components/board/BoardView.tsx` + `SortableTaskCard.tsx` (dnd-kit); `StatusIcon`, `app/workspace/[workspaceUrl]/utils/taskStatus.ts` (`API_STATUS_LABEL`).

**Branch:** `lumo/LUM-224-task-view-kanban` (worktree `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p4`, off origin/main — includes P1+P2+P3).

---

## File Structure

| File | Responsibility | C/M |
| --- | --- | --- |
| `lib/editor/nodes/task-view-kanban-drop.ts` | `KANBAN_STATUSES` + pure `statusFromDropTarget` | C |
| `__tests__/editor/task-view-kanban-drop.test.ts` | resolver coverage | C |
| `app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus.ts` | optimistic status mutation | C |
| `__tests__/hooks/useWorkspaceTaskStatus.test.tsx` | optimistic + rollback + toast | C |
| `app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks.ts` | add polling + `refetch` | M |
| `__tests__/hooks/useWorkspaceTasks.test.tsx` | keep green + assert `refetch` | M |
| `lib/editor/nodes/task-view-kanban.tsx` | `TaskViewKanban` dnd board | C |
| `__tests__/editor/task-view-kanban.test.tsx` | renders columns + cards | C |
| `lib/editor/nodes/task-view-config-panel.tsx` | add list/kanban view toggle | M |
| `__tests__/editor/task-view-config-panel.test.tsx` | view toggle emits config | M |
| `lib/editor/nodes/task-view.ts` | `draggable: false` | M |
| `lib/editor/nodes/task-view-block.tsx` | kanban-vs-list switch + truncated banner + `useWorkspaceTaskStatus` | M |
| `__tests__/components/TaskViewBlockViewer.test.tsx` | kanban-view render + truncated banner | M |
| `lib/i18n/*.json` (16) | 6 new `editor.taskView.*` keys | M |

**Shared identifiers:** `KANBAN_STATUSES`, `statusFromDropTarget`, `useWorkspaceTaskStatus(filters) → { updateStatus }`, `TaskViewKanban`.

All commands assume: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p4` first (jest cwd MUST be inside the worktree). Ignore pre-existing unrelated tsc errors in `document-template.repository.ts` / `prisma/seed.ts`.

---

### Task 1: `statusFromDropTarget` pure resolver

**Files:** Create `lib/editor/nodes/task-view-kanban-drop.ts`; Test `__tests__/editor/task-view-kanban-drop.test.ts`.

- [ ] **Step 1 — failing test**:
```typescript
import {
  KANBAN_STATUSES,
  statusFromDropTarget,
} from '@/lib/editor/nodes/task-view-kanban-drop'

describe('statusFromDropTarget', () => {
  it('returns the target status when dropping on a different valid column', () => {
    expect(statusFromDropTarget('DONE', 'TODO')).toBe('DONE')
  })
  it('returns null when the column equals the current status (no-op)', () => {
    expect(statusFromDropTarget('TODO', 'TODO')).toBeNull()
  })
  it('returns null for a null / unknown drop target', () => {
    expect(statusFromDropTarget(null, 'TODO')).toBeNull()
    expect(statusFromDropTarget('BOGUS', 'TODO')).toBeNull()
  })
  it('exposes the four statuses in board order', () => {
    expect(KANBAN_STATUSES).toEqual(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
  })
})
```
- [ ] **Step 2 — run, expect fail** `npx jest __tests__/editor/task-view-kanban-drop.test.ts`.
- [ ] **Step 3 — implement** `lib/editor/nodes/task-view-kanban-drop.ts`:
```typescript
import type { ApiStatus } from '@/app/workspace/[workspaceUrl]/types'

export const KANBAN_STATUSES: readonly ApiStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
]

/**
 * Resolve the new status for a card dropped on a column. Pure (dnd-kit drag
 * itself isn't simulatable in jsdom, so the decision lives here, unit-tested).
 * Returns `null` for a no-op: dropping on the same column, or on an
 * unknown / null target.
 */
export function statusFromDropTarget(
  overId: string | null | undefined,
  currentStatus: string
): ApiStatus | null {
  if (!overId) return null
  if (!(KANBAN_STATUSES as readonly string[]).includes(overId)) return null
  if (overId === currentStatus) return null
  return overId as ApiStatus
}
```
- [ ] **Step 4 — run, expect pass (4)**; `npx tsc --noEmit`.
- [ ] **Step 5 — commit**
```bash
git add lib/editor/nodes/task-view-kanban-drop.ts __tests__/editor/task-view-kanban-drop.test.ts
git commit -m "feat: pure statusFromDropTarget resolver for task view kanban [LUM-224]"
```

---

### Task 2: `useWorkspaceTaskStatus` optimistic mutation

**Files:** Create `app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus.ts`; Test `__tests__/hooks/useWorkspaceTaskStatus.test.tsx`.

FIRST read `app/workspace/[workspaceUrl]/hooks/useTaskBulkMutations.ts` (the optimistic pattern) and `useWorkspaceTasks.ts` (the `byWorkspace` queryKey it must match: `queryKeys.tasks.byWorkspace(workspaceUrl, JSON.stringify(filters))`).

- [ ] **Step 1 — failing test** `__tests__/hooks/useWorkspaceTaskStatus.test.tsx`:
```tsx
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

jest.mock('next/navigation', () => ({ useParams: () => ({ workspaceUrl: 'acme' }) }))
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ defaultMessage, id }: { id: string; defaultMessage?: string }) => defaultMessage ?? id }),
}))
const mockUpdate = jest.fn()
jest.mock('@/lib/api-client', () => ({ tasksClient: { update: (...a: unknown[]) => mockUpdate(...a) } }))
const mockToastError = jest.fn()
jest.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a) } }))

import { queryKeys } from '@/lib/query/keys'
import { useWorkspaceTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let queryClient: QueryClient
const KEY = () => queryKeys.tasks.byWorkspace('acme', JSON.stringify({}))
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
beforeEach(() => {
  jest.clearAllMocks()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(KEY(), {
    tasks: [{ id: 't1', status: 'TODO' }, { id: 't2', status: 'TODO' }],
    truncated: false,
  })
})

describe('useWorkspaceTaskStatus', () => {
  it('optimistically moves the card before the server resolves', async () => {
    const d = deferred<unknown>()
    mockUpdate.mockReturnValue(d.promise)
    const { result } = renderHook(() => useWorkspaceTaskStatus({}), { wrapper })

    act(() => { void result.current.updateStatus('t1', 'DONE') })

    await waitFor(() => {
      const data = queryClient.getQueryData<{ tasks: { id: string; status: string }[] }>(KEY())
      expect(data?.tasks.find(t => t.id === 't1')?.status).toBe('DONE')
    })
    expect(mockUpdate).toHaveBeenCalledWith('t1', { status: 'DONE' })
    await act(async () => { d.resolve({}) })
  })

  it('rolls back + toasts on failure', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useWorkspaceTaskStatus({}), { wrapper })

    await act(async () => { await result.current.updateStatus('t1', 'DONE').catch(() => {}) })

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    const data = queryClient.getQueryData<{ tasks: { id: string; status: string }[] }>(KEY())
    expect(data?.tasks.find(t => t.id === 't1')?.status).toBe('TODO')
  })
})
```
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — implement** `app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus.ts`:
```typescript
'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { tasksClient } from '@/lib/api-client'
import type { WorkspaceTaskFilterArgs } from '@/lib/api-client/tasks'
import { queryKeys } from '@/lib/query/keys'
import type { ApiStatus, ApiTask, TaskDetail } from '../types'

interface WorkspaceTasksData {
  tasks: ApiTask[]
  truncated: boolean
}
interface Vars {
  id: string
  status: ApiStatus
}
interface Ctx {
  previous: WorkspaceTasksData | undefined
  previousDetail: TaskDetail | undefined
}

/**
 * Optimistic single-task status change for the kanban. Patches the workspace
 * list cache (same key as `useWorkspaceTasks`) + the per-task detail cache,
 * rolls back + toasts on failure, and invalidates on settle to reconcile.
 */
export function useWorkspaceTaskStatus(filters: WorkspaceTaskFilterArgs) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const params = useParams<{ workspaceUrl: string }>()
  const workspaceUrl = params?.workspaceUrl ?? ''
  const listKey = queryKeys.tasks.byWorkspace(workspaceUrl, JSON.stringify(filters))

  const mutation = useMutation<unknown, Error, Vars, Ctx>({
    mutationFn: ({ id, status }) => tasksClient.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: listKey })
      const previous = queryClient.getQueryData<WorkspaceTasksData>(listKey)
      const previousDetail = queryClient.getQueryData<TaskDetail>(
        queryKeys.tasks.detail(id)
      )
      if (previous) {
        queryClient.setQueryData<WorkspaceTasksData>(listKey, {
          ...previous,
          tasks: previous.tasks.map(t =>
            t.id === id ? { ...t, status } : t
          ),
        })
      }
      if (previousDetail) {
        queryClient.setQueryData<TaskDetail>(queryKeys.tasks.detail(id), {
          ...previousDetail,
          status,
        })
      }
      return { previous, previousDetail }
    },
    onError: (_err, { id }, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous)
      if (context?.previousDetail) {
        queryClient.setQueryData(queryKeys.tasks.detail(id), context.previousDetail)
      }
      toast.error(
        intl.formatMessage({
          id: 'editor.taskView.statusUpdateError',
          defaultMessage: 'Could not move the task. Please try again.',
        })
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: listKey })
    },
  })

  return {
    updateStatus: (id: string, status: ApiStatus) =>
      mutation.mutateAsync({ id, status }),
  }
}
```
Confirm `TaskDetail`, `ApiTask`, `ApiStatus` are exported from `../types`. The `Ctx` fields are `T | undefined` (exactOptionalPropertyTypes).
- [ ] **Step 4 — run, expect pass (2)**; `npx tsc --noEmit`.
- [ ] **Step 5 — commit**
```bash
git add app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus.ts __tests__/hooks/useWorkspaceTaskStatus.test.tsx
git commit -m "feat: optimistic useWorkspaceTaskStatus mutation [LUM-224]"
```

---

### Task 3: Polling + refetch on `useWorkspaceTasks`

**Files:** Modify `app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks.ts` + its test.

- [ ] **Step 1 — update the hook**: add polling options to the `useQuery` call and return `refetch`:
```typescript
  const query = useQuery<WorkspaceTasksResponse>({
    queryKey: queryKeys.tasks.byWorkspace(workspaceUrl, JSON.stringify(filters)),
    queryFn: () => tasksClient.listWorkspace<WorkspaceTasksResponse>(filters),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
```
and add to the returned object:
```typescript
    refetch: query.refetch,
```
- [ ] **Step 2 — update the test** `__tests__/hooks/useWorkspaceTasks.test.tsx`: keep the existing assertion; add `expect(typeof result.current.refetch).toBe('function')` after the existing `await waitFor`. (The 30s `refetchInterval` does not fire within the test.)
- [ ] **Step 3 — run** `npx jest __tests__/hooks/useWorkspaceTasks.test.tsx` → pass; `npx tsc --noEmit`.
- [ ] **Step 4 — commit**
```bash
git add app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks.ts __tests__/hooks/useWorkspaceTasks.test.tsx
git commit -m "feat: visibility-gated polling + refetch on useWorkspaceTasks [LUM-224]"
```

---

### Task 4: `TaskViewKanban` board

**Files:** Create `lib/editor/nodes/task-view-kanban.tsx`; Test `__tests__/editor/task-view-kanban.test.tsx`.

FIRST read `app/workspace/[workspaceUrl]/components/StatusIcon.tsx` (props) and `app/workspace/[workspaceUrl]/utils/taskStatus.ts` (`API_STATUS_LABEL`), and `app/workspace/[workspaceUrl]/components/board/BoardView.tsx` lines ~1-60 for the `@dnd-kit/core` `PointerSensor`/`useSensor`/`useSensors` import style.

- [ ] **Step 1 — failing test** `__tests__/editor/task-view-kanban.test.tsx`:
```tsx
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ defaultMessage, id }: { id: string; defaultMessage?: string }) => defaultMessage ?? id }),
}))
import { render, screen } from '@testing-library/react'
import { TaskViewKanban } from '@/lib/editor/nodes/task-view-kanban'

const tasks = [
  { id: 't1', title: 'Alpha', teamIdentifier: 'LUM', number: 1, status: 'TODO' },
  { id: 't2', title: 'Beta', teamIdentifier: 'LUM', number: 2, status: 'DONE' },
] as any[]

it('renders the four status columns and places cards by status', () => {
  render(
    <TaskViewKanban
      tasks={tasks}
      workspaceUrl='acme'
      editable={false}
      onStatusChange={jest.fn()}
    />
  )
  expect(screen.getByText('Todo')).toBeInTheDocument()
  expect(screen.getByText('In Progress')).toBeInTheDocument()
  expect(screen.getByText('In Review')).toBeInTheDocument()
  expect(screen.getByText('Done')).toBeInTheDocument()
  expect(screen.getByText('Alpha')).toBeInTheDocument()
  expect(screen.getByText('Beta')).toBeInTheDocument()
  // read-only card links to the task detail
  expect(screen.getByRole('link', { name: /Alpha/ })).toHaveAttribute(
    'href',
    '/workspace/acme/my-tasks/LUM-1'
  )
})
```
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — implement** `lib/editor/nodes/task-view-kanban.tsx`:
```tsx
import Link from 'next/link'
import { useIntl } from 'react-intl'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { StatusIcon } from '@/app/workspace/[workspaceUrl]/components/StatusIcon'
import { API_STATUS_LABEL } from '@/app/workspace/[workspaceUrl]/utils/taskStatus'
import type { ApiStatus, ApiTask } from '@/app/workspace/[workspaceUrl]/types'
import {
  KANBAN_STATUSES,
  statusFromDropTarget,
} from './task-view-kanban-drop'

interface TaskViewKanbanProps {
  tasks: ApiTask[]
  workspaceUrl: string
  editable: boolean
  onStatusChange: (id: string, status: ApiStatus) => void
}

function KanbanCard({
  task,
  workspaceUrl,
  editable,
}: {
  task: ApiTask
  workspaceUrl: string
  editable: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status },
    disabled: !editable,
  })
  return (
    <div
      ref={setNodeRef}
      className={`task-view-kanban-card rounded-md border border-border bg-background p-2 text-sm ${
        isDragging ? 'opacity-50' : ''
      }`}
      {...(editable ? { ...listeners, ...attributes } : {})}
    >
      <Link
        href={`/workspace/${workspaceUrl}/my-tasks/${task.teamIdentifier}-${task.number}`}
        className='task-view-kanban-card-link'
      >
        <span className='text-muted-foreground'>
          {task.teamIdentifier}-{task.number}
        </span>{' '}
        <span className='text-foreground'>{task.title}</span>
      </Link>
    </div>
  )
}

function KanbanColumn({
  status,
  label,
  tasks,
  workspaceUrl,
  editable,
}: {
  status: ApiStatus
  label: string
  tasks: ApiTask[]
  workspaceUrl: string
  editable: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={`task-view-kanban-column min-w-40 flex-1 space-y-1 rounded-md p-2 ${
        isOver ? 'bg-muted' : ''
      }`}
    >
      <div className='task-view-kanban-column-header flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
        <StatusIcon status={status} size={13} />
        <span>{label}</span>
        <span>{tasks.length}</span>
      </div>
      {tasks.map(task => (
        <KanbanCard
          key={task.id}
          task={task}
          workspaceUrl={workspaceUrl}
          editable={editable}
        />
      ))}
    </div>
  )
}

/**
 * Status kanban for the task-view block. Cards are draggable only in editable
 * mode; dropping on a different column calls `onStatusChange` (the block wires
 * that to the optimistic mutation). Always grouped by status (4 fixed columns),
 * independent of `config.groupBy`.
 */
export function TaskViewKanban({
  tasks,
  workspaceUrl,
  editable,
  onStatusChange,
}: TaskViewKanbanProps) {
  const intl = useIntl()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id
    const current = (event.active.data.current?.status ?? '') as string
    const next = statusFromDropTarget(
      typeof overId === 'string' ? overId : null,
      current
    )
    if (next) onStatusChange(String(event.active.id), next)
  }

  const columns = KANBAN_STATUSES.map(status => ({
    status,
    label: API_STATUS_LABEL[status] ?? status,
    tasks: tasks.filter(t => t.status === status),
  }))

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={editable ? handleDragEnd : undefined}
    >
      <div
        className='task-view-kanban flex gap-2 overflow-x-auto'
        aria-label={intl.formatMessage({
          id: 'editor.taskView.kanbanLabel',
          defaultMessage: 'Task board',
        })}
      >
        {columns.map(col => (
          <KanbanColumn
            key={col.status}
            status={col.status}
            label={col.label}
            tasks={col.tasks}
            workspaceUrl={workspaceUrl}
            editable={editable}
          />
        ))}
      </div>
    </DndContext>
  )
}
```
Semantic tokens only (`border-border`, `bg-background`, `bg-muted`, `text-muted-foreground`, `text-foreground`). If `StatusIcon`'s import path differs, fix it (read the file).
- [ ] **Step 4 — run, expect pass**; `npx tsc --noEmit`; `npx eslint lib/editor/nodes/task-view-kanban.tsx`; `npm run lint:tokens` (green).
- [ ] **Step 5 — commit**
```bash
git add lib/editor/nodes/task-view-kanban.tsx __tests__/editor/task-view-kanban.test.tsx
git commit -m "feat: TaskViewKanban drag-to-change-status board [LUM-224]"
```

---

### Task 5: View toggle in `TaskViewConfigPanel`

**Files:** Modify `lib/editor/nodes/task-view-config-panel.tsx` + its test.

FIRST read the current panel — it already has a `groupBy` segmented row built from `GROUP_BY_ORDER` Buttons. Add a sibling **View** row above it.

- [ ] **Step 1 — add a failing test** to `__tests__/editor/task-view-config-panel.test.tsx` (the data-hook mocks already exist there):
```tsx
it('emits a view change to kanban', async () => {
  const onChange = jest.fn()
  render(<TaskViewConfigPanel config={DEFAULT_TASK_VIEW_CONFIG} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: /configure/i }))
  await userEvent.click(await screen.findByRole('button', { name: 'Kanban' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ view: 'kanban' }))
})
```
- [ ] **Step 2 — run, expect fail**.
- [ ] **Step 3 — implement**: add near the top of the file:
```typescript
import type { TaskViewConfig, TaskViewGroupBy, TaskViewMode } from './task-view-config'

const VIEW_ORDER: TaskViewMode[] = ['list', 'kanban']
```
(extend the existing type import line to include `TaskViewMode`), and add this block as the FIRST child inside `<PopoverContent>` (before the Group-by section):
```tsx
        <div className='space-y-1'>
          <p className='px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
            {intl.formatMessage({ id: 'editor.taskView.viewLabel', defaultMessage: 'View' })}
          </p>
          <div className='flex flex-wrap gap-1'>
            {VIEW_ORDER.map(v => (
              <Button
                key={v}
                type='button'
                size='sm'
                variant={config.view === v ? 'default' : 'outline'}
                className='h-6 px-2 text-xs'
                onClick={() => onChange({ ...config, view: v })}
              >
                {intl.formatMessage({
                  id: `editor.taskView.view.${v}`,
                  defaultMessage: v === 'list' ? 'List' : 'Kanban',
                })}
              </Button>
            ))}
          </div>
        </div>
```
- [ ] **Step 4 — run** `npx jest __tests__/editor/task-view-config-panel.test.tsx` → all pass (existing + new). `npx tsc --noEmit`; `npm run lint:tokens`.
- [ ] **Step 5 — commit**
```bash
git add lib/editor/nodes/task-view-config-panel.tsx __tests__/editor/task-view-config-panel.test.tsx
git commit -m "feat: list/kanban view toggle in task view config panel [LUM-224]"
```

---

### Task 6: Wire kanban + truncated banner into the block; node `draggable: false`

**Files:** Modify `lib/editor/nodes/task-view.ts`, `lib/editor/nodes/task-view-block.tsx`, `__tests__/components/TaskViewBlockViewer.test.tsx`.

- [ ] **Step 1 — node `draggable: false`**: in `lib/editor/nodes/task-view.ts`, change `draggable: true,` to `draggable: false,` (prevents the editor from drag-moving the block, which would fight dnd-kit card drag). Add a brief comment: `// false so dnd-kit card drag inside the kanban isn't hijacked by the editor`.

- [ ] **Step 2 — update `task-view-block.tsx`**: add imports + the mutation hook + the kanban/list switch + truncated banner. The block currently renders the grouped list; change the non-empty branch to switch on `config.view`. Read the current file, then:
  - add imports:
    ```tsx
    import { useWorkspaceTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus'
    import { TaskViewKanban } from './task-view-kanban'
    ```
  - after `const { tasks, loading, error } = useWorkspaceTasks(config.filters)` add `const { truncated } = useWorkspaceTasks(config.filters)` — NO; instead change that line to also pull `truncated`:
    ```tsx
    const { tasks, truncated, loading, error } = useWorkspaceTasks(config.filters)
    const { updateStatus } = useWorkspaceTaskStatus(config.filters)
    ```
  - in the non-empty render branch, BEFORE the groups, add the truncated banner:
    ```tsx
    {truncated ? (
      <p className='task-view-truncated text-xs text-muted-foreground'>
        {intl.formatMessage({
          id: 'editor.taskView.truncated',
          defaultMessage: 'Showing the first {count} tasks.',
        }, { count: tasks.length })}
      </p>
    ) : null}
    ```
  - replace the grouped-list block with a switch: when `config.view === 'kanban'`, render
    ```tsx
    <TaskViewKanban
      tasks={tasks}
      workspaceUrl={workspaceUrl}
      editable={editor.isEditable}
      onStatusChange={updateStatus}
    />
    ```
    else render the existing grouped list (unchanged).

  Concretely the non-empty branch becomes:
    ```tsx
    ) : (
      <div className='task-view-block-body space-y-2'>
        {truncated ? (
          <p className='task-view-truncated text-xs text-muted-foreground'>
            {intl.formatMessage(
              { id: 'editor.taskView.truncated', defaultMessage: 'Showing the first {count} tasks.' },
              { count: tasks.length }
            )}
          </p>
        ) : null}
        {config.view === 'kanban' ? (
          <TaskViewKanban
            tasks={tasks}
            workspaceUrl={workspaceUrl}
            editable={editor.isEditable}
            onStatusChange={updateStatus}
          />
        ) : (
          <div className='task-view-block-groups space-y-3'>
            {/* ...existing groups.map(...) unchanged... */}
          </div>
        )}
      </div>
    )
    ```

- [ ] **Step 3 — update `__tests__/components/TaskViewBlockViewer.test.tsx`**: it already mocks `useWorkspaceTasks`, `useProjects`, `useWorkspaceMilestones`, react-intl, next/navigation. The block now also calls `useWorkspaceTaskStatus` — add a jest.mock for it returning `{ updateStatus: jest.fn() }`. Keep all existing tests. Add ONE test:
  ```tsx
  it('renders the kanban board when view is kanban', async () => {
    mockUseWorkspaceTasks.mockReturnValue({
      tasks: [
        { id: 't1', title: 'Alpha', teamIdentifier: 'LUM', number: 1, status: 'TODO' },
      ],
      truncated: false,
      loading: false,
      error: null,
    })
    const stored =
      '<div data-task-view data-task-view-config=\'{"version":1,"view":"kanban","groupBy":"none","filters":{}}\'></div>'
    render(<RichTextViewer value={stored} />)
    await waitFor(() => expect(screen.getByText('In Progress')).toBeInTheDocument())
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
  ```
  And add a `truncated: true` assertion to one existing list test, or a new small test asserting the banner text appears when `truncated:true`.

- [ ] **Step 4 — run** `npx jest __tests__/components/TaskViewBlockViewer.test.tsx` → all pass. `npx tsc --noEmit`; `npx eslint lib/editor/nodes/task-view-block.tsx lib/editor/nodes/task-view.ts`; `npm run lint:tokens`.
- [ ] **Step 5 — commit**
```bash
git add lib/editor/nodes/task-view.ts lib/editor/nodes/task-view-block.tsx __tests__/components/TaskViewBlockViewer.test.tsx
git commit -m "feat: kanban view + truncated banner in task view block; node draggable false [LUM-224]"
```

---

### Task 7: i18n keys (all locales)

**Files:** Modify every `lib/i18n/*.json`.

Keys (English source):

| Key | English |
| --- | --- |
| `editor.taskView.viewLabel` | `View` |
| `editor.taskView.view.list` | `List` |
| `editor.taskView.view.kanban` | `Kanban` |
| `editor.taskView.kanbanLabel` | `Task board` |
| `editor.taskView.truncated` | `Showing the first {count} tasks.` |
| `editor.taskView.statusUpdateError` | `Could not move the task. Please try again.` |

- [ ] **Step 1** — begin EVERY shell command with `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p4 &&`; confirm `git branch --show-current` is `lumo/LUM-224-task-view-kanban`. Add all 6 keys to each locale beside the existing `editor.taskView.*` keys, translated per locale (en/en-AU/en-GB keep English). For `editor.taskView.truncated` keep the `{count}` ICU placeholder intact in every locale.
- [ ] **Step 2 — parity**:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p4
for f in lib/i18n/*.json; do node -e "const j=require('./$f'); ['editor.taskView.viewLabel','editor.taskView.view.list','editor.taskView.view.kanban','editor.taskView.kanbanLabel','editor.taskView.truncated','editor.taskView.statusUpdateError'].forEach(k=>{if(!(k in j)){console.error('MISSING',k,'in','$f');process.exit(1)}})" || exit 1; done; echo "all locales OK"
```
- [ ] **Step 3 — commit**
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p4
git add lib/i18n/*.json
git commit -m "i18n: task view kanban/view/truncated strings across all locales [LUM-224]"
```

---

### Task 8: Full verification gate

- [ ] **Step 1 — typecheck** `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p4 && npx tsc --noEmit 2>&1 | grep -vE "document-template.repository|prisma/seed"` → empty.
- [ ] **Step 2 — tests**
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p4
npx jest task-view-kanban-drop useWorkspaceTaskStatus useWorkspaceTasks task-view-kanban task-view-config-panel TaskViewBlockViewer __tests__/editor
```
all pass.
- [ ] **Step 3 — lint + tokens**
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p4
npx eslint lib/editor/nodes/task-view-kanban-drop.ts lib/editor/nodes/task-view-kanban.tsx lib/editor/nodes/task-view-block.tsx lib/editor/nodes/task-view.ts lib/editor/nodes/task-view-config-panel.tsx app/workspace/[workspaceUrl]/hooks/useWorkspaceTaskStatus.ts app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks.ts
npm run lint:tokens
```
eslint clean (callback-param `no-unused-vars` warnings excepted), lint:tokens green.
- [ ] **Step 4 — commit any incidental fixes**
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-224-p4
git add -A && git commit -m "chore: typecheck/lint fixes for task view kanban [LUM-224]" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (P4):** kanban grouped by status reusing dnd-kit → Task 4; drag-to-change-status with optimistic update + rollback + toast → Tasks 1,2,4,6; visibility-gated polling + (implicit refetch affordance) → Task 3; list/kanban view toggle → Task 5; truncated banner → Task 6. i18n → Task 7.

**Deliberate scope:** drag is status-change only (no within-column reorder — the workspace query has no per-block order). The pure `statusFromDropTarget` + the optimistic mutation are the tested core; the dnd-kit wiring is thin and verified by a render test (jsdom can't simulate drag). A manual refresh button is OPTIONAL (polling covers freshness) — `refetch` is exposed but a visible button can be a follow-up.

**Type consistency:** `useWorkspaceTaskStatus` writes the SAME `byWorkspace` cache key as `useWorkspaceTasks` (`(workspaceUrl, JSON.stringify(filters))`); `ApiStatus` flows through resolver → mutation → kanban; `Ctx` fields are `T | undefined`. Node `draggable: false` is the one-line conflict fix. No backend/Prisma/schema change.

**Constraints honored:** new UI semantic tokens only; dnd not simulated in jsdom (pure-fn + mutation tests instead); PointerSensor distance:5 keeps click-to-open working; cards draggable only when `editable`.
