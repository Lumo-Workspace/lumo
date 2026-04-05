# Task Due Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional due date property to tasks, displayed across all views with overdue indicators.

**Architecture:** Add a nullable `DateTime` column to the Task model, pass it through the existing CRUD flow, and render it via a new `DueDatePicker` component (Popover + Calendar) in the create modal, detail panel, list view, and board cards.

**Tech Stack:** Prisma migration, Zod validation, react-day-picker (already installed), shadcn Calendar + Popover, react-intl, date-fns

---

### Task 1: Database Migration + Utility Functions + i18n

**Files:**

- Modify: `prisma/schema.prisma`
- Modify: `app/workspace/[workspaceUrl]/utils.ts`
- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/zh.json`
- Test: `__tests__/due-date-utils.test.ts`

- [ ] **Step 1: Add dueDate field to Prisma schema**

In `prisma/schema.prisma`, add after `updatedAt DateTime @updatedAt` (line 284 in the Task model):

```prisma
  dueDate        DateTime?
```

- [ ] **Step 2: Run migration**

Run: `npx prisma migrate dev --name add_task_due_date`
Expected: Migration created and applied successfully.

- [ ] **Step 3: Add i18n translation keys**

Add to the end of `lib/i18n/en.json` (before the closing `}`):

```json
  "dueDate.label": "Due date",
  "dueDate.today": "Today",
  "dueDate.tomorrow": "Tomorrow",
  "dueDate.endOfWeek": "End of this week",
  "dueDate.inOneWeek": "In one week",
  "dueDate.noDueDate": "No due date",
  "dueDate.due": "Due {date}",
  "taskColumns.dueDate": "Due Date"
```

Add to the end of `lib/i18n/zh.json` (before the closing `}`):

```json
  "dueDate.label": "截止日期",
  "dueDate.today": "今天",
  "dueDate.tomorrow": "明天",
  "dueDate.endOfWeek": "本周末",
  "dueDate.inOneWeek": "一周后",
  "dueDate.noDueDate": "无截止日期",
  "dueDate.due": "{date} 截止",
  "taskColumns.dueDate": "截止日期"
```

- [ ] **Step 4: Write failing tests for utility functions**

Create `__tests__/due-date-utils.test.ts`:

```typescript
import { formatDueDate, isOverdue } from '@/app/workspace/[workspaceUrl]/utils'

describe('formatDueDate', () => {
  it('returns empty string for null', () => {
    expect(formatDueDate(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatDueDate(undefined)).toBe('')
  })

  it('returns "Today" for today', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expect(formatDueDate(today.toISOString())).toBe('Today')
  })

  it('returns "Tomorrow" for tomorrow', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    expect(formatDueDate(tomorrow.toISOString())).toBe('Tomorrow')
  })

  it('returns short date for same year', () => {
    const date = new Date()
    date.setMonth(5, 15) // Jun 15
    date.setHours(0, 0, 0, 0)
    // Skip if today or tomorrow
    const now = new Date()
    if (date.toDateString() === now.toDateString()) return
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (date.toDateString() === tomorrow.toDateString()) return
    expect(formatDueDate(date.toISOString())).toBe('Jun 15')
  })

  it('returns date with year for different year', () => {
    const date = new Date(2028, 2, 21) // Mar 21, 2028
    expect(formatDueDate(date.toISOString())).toBe('Mar 21, 2028')
  })
})

describe('isOverdue', () => {
  it('returns false for null', () => {
    expect(isOverdue(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isOverdue(undefined)).toBe(false)
  })

  it('returns false for today', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expect(isOverdue(today.toISOString())).toBe(false)
  })

  it('returns false for tomorrow', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    expect(isOverdue(tomorrow.toISOString())).toBe(false)
  })

  it('returns true for yesterday', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(0, 0, 0, 0)
    expect(isOverdue(yesterday.toISOString())).toBe(true)
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx jest __tests__/due-date-utils.test.ts --no-cache`
Expected: FAIL — functions not found

- [ ] **Step 6: Implement utility functions**

Add to the end of `app/workspace/[workspaceUrl]/utils.ts` (after the `apiFetch` function):

```typescript
/**
 * Format a due date for display.
 * Returns: "Today", "Tomorrow", "Apr 10", "Apr 10, 2027", or "" if null.
 */
export function formatDueDate(date: string | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(d, now)) return 'Today'

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameDay(d, tomorrow)) return 'Tomorrow'

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Returns true if the given due date is strictly before today.
 */
export function isOverdue(date: string | null | undefined): boolean {
  if (!date) return false
  const d = new Date(date)
  const today = new Date()
  // Compare date-only: strip time from both
  d.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest __tests__/due-date-utils.test.ts --no-cache`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ app/workspace/[workspaceUrl]/utils.ts lib/i18n/en.json lib/i18n/zh.json __tests__/due-date-utils.test.ts
git commit -m "feat: add dueDate field to Task model + utility functions + i18n"
```

---

### Task 2: Types + Validation Schemas + API Updates

**Files:**

- Modify: `app/workspace/[workspaceUrl]/types.ts`
- Modify: `lib/validation/schemas.ts`
- Modify: `app/api/projects/[id]/tasks/route.ts`
- Modify: `app/api/tasks/[id]/route.ts`
- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`

- [ ] **Step 1: Add dueDate to TypeScript types**

In `app/workspace/[workspaceUrl]/types.ts`, add `dueDate` to `ApiTask` after `updatedAt: string` (around line 125):

```typescript
  dueDate?: string | null
```

Add to `TaskDetail` after `updatedAt: string` (around line 270):

```typescript
  dueDate?: string | null
```

- [ ] **Step 2: Add dueDate to validation schemas**

In `lib/validation/schemas.ts`, add to `createTaskSchema` after `order: z.number().optional(),` (line 87):

```typescript
  dueDate: z.string().datetime().nullable().optional(),
```

Add the same to `updateTaskSchema` after `order: z.number().optional(),` (line 101):

```typescript
  dueDate: z.string().datetime().nullable().optional(),
```

- [ ] **Step 3: Update task creation API**

In `app/api/projects/[id]/tasks/route.ts`, add `dueDate` to the destructuring (after `order,` on line 184):

```typescript
const {
  title,
  description,
  status,
  priority,
  assigneeActorId,
  parentTaskId,
  repositoryId,
  order,
  dueDate,
} = parsed.data
```

Add `dueDate: dueDate ?? null,` to the `prisma.task.create()` data object (after `order: taskOrder,` on line 260):

```typescript
          dueDate: dueDate ?? null,
```

- [ ] **Step 4: Update task update API**

In `app/api/tasks/[id]/route.ts`, add after `if (rest.order !== undefined) data.order = rest.order` (line 421):

```typescript
if (rest.dueDate !== undefined) data.dueDate = rest.dueDate
```

- [ ] **Step 5: Update handleUpdateTask type in WorkspaceApp**

In `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`, add `dueDate` to the `handleUpdateTask` data type (after `priority: ApiPriority` on line 273):

```typescript
dueDate: string | null
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 7: Commit**

```bash
git add app/workspace/[workspaceUrl]/types.ts lib/validation/schemas.ts "app/api/projects/[id]/tasks/route.ts" "app/api/tasks/[id]/route.ts" app/workspace/[workspaceUrl]/WorkspaceApp.tsx
git commit -m "feat: add dueDate to types, schemas, and API routes"
```

---

### Task 3: DueDatePicker Component

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx`

- [ ] **Step 1: Add imports**

At the top of `app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx`, add to the lucide-react import (line 6):

```typescript
import {
  UserCircle2,
  Eye,
  BatteryWarning,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  Bot,
  CalendarDays,
  X,
} from 'lucide-react'
```

Add these new imports after the existing imports:

```typescript
import { useIntl } from 'react-intl'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { formatDueDate, isOverdue } from '../utils'
import { cn } from '@/lib/utils'
```

- [ ] **Step 2: Add DueDatePicker component**

Add after the `ProjectSelect` component (after line 425, at the end of the file):

```typescript
// ─── DueDatePicker ───────────────────────────────────────────────────────────

export function DueDatePicker({
  value,
  onChange,
  triggerClassName,
}: {
  value: string | null
  onChange: (v: string | null) => void
  triggerClassName?: string
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)

  const selected = value ? new Date(value) : undefined
  const overdue = isOverdue(value)
  const displayText = formatDueDate(value)

  function pickDate(date: Date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    onChange(d.toISOString())
    setOpen(false)
  }

  function quickPick(offset: 'today' | 'tomorrow' | 'endOfWeek' | 'inOneWeek') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    switch (offset) {
      case 'today':
        break
      case 'tomorrow':
        d.setDate(d.getDate() + 1)
        break
      case 'endOfWeek': {
        const day = d.getDay() // 0=Sun
        const diff = day === 0 ? 5 : 5 - day // next Friday (or this Friday)
        d.setDate(d.getDate() + (diff <= 0 ? 7 + diff : diff))
        break
      }
      case 'inOneWeek':
        d.setDate(d.getDate() + 7)
        break
    }
    onChange(d.toISOString())
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type='button'
              className={cn(
                triggerClassName,
                'inline-flex items-center gap-1.5',
                overdue && 'text-red-500'
              )}
            >
              <CalendarDays className='size-3.5 shrink-0' />
              {displayText && <span>{displayText}</span>}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {intl.formatMessage({ id: 'dueDate.label' })}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className='w-auto p-0' align='start'>
        <div className='flex flex-col'>
          {/* Quick-pick shortcuts */}
          <div className='flex flex-col gap-0.5 p-2 border-b border-zinc-200 dark:border-zinc-800'>
            {(
              [
                ['today', 'dueDate.today'],
                ['tomorrow', 'dueDate.tomorrow'],
                ['endOfWeek', 'dueDate.endOfWeek'],
                ['inOneWeek', 'dueDate.inOneWeek'],
              ] as const
            ).map(([key, msgId]) => (
              <Button
                key={key}
                variant='ghost'
                size='sm'
                className='justify-start h-8 text-xs'
                onClick={() => quickPick(key)}
              >
                {intl.formatMessage({ id: msgId })}
              </Button>
            ))}
            {value && (
              <Button
                variant='ghost'
                size='sm'
                className='justify-start h-8 text-xs text-red-500 hover:text-red-600'
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
              >
                <X className='size-3 mr-1' />
                {intl.formatMessage({ id: 'dueDate.noDueDate' })}
              </Button>
            )}
          </div>
          {/* Calendar */}
          <Calendar
            mode='single'
            selected={selected}
            onSelect={day => {
              if (day) pickDate(day)
            }}
            defaultMonth={selected ?? new Date()}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 3: Add `useState` to the React import**

At the top of `TaskFieldSelects.tsx`, update the import on line 3 to include `useState`:

```typescript
import { useMemo, useState } from 'react'
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx
git commit -m "feat: add DueDatePicker component"
```

---

### Task 4: Integrate into NewTaskModal

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx`

- [ ] **Step 1: Add import**

In `NewTaskModal.tsx`, add `DueDatePicker` to the TaskFieldSelects import:

```typescript
import {
  StatusSelect,
  AssigneeSelect,
  ProjectSelect,
  PrioritySelect,
  DueDatePicker,
  FIELD_TRIGGER_CLS,
} from '../TaskFieldSelects'
```

- [ ] **Step 2: Add dueDate to form data interface**

In the `NewTaskFormData` interface, add after `repositoryId: string | null`:

```typescript
dueDate: string | null
```

- [ ] **Step 3: Add dueDate state**

After line 82 (`const [projectRepos, setProjectRepos] = useState<ApiRepository[]>([])`), add:

```typescript
const [dueDate, setDueDate] = useState<string | null>(null)
```

- [ ] **Step 4: Add dueDate to reset function**

In the `reset()` function, add after `setProjectRepos([])`:

```typescript
setDueDate(null)
```

- [ ] **Step 5: Add dueDate to doCreate function**

In the `doCreate()` function, add `dueDate,` to the data object after `repositoryId,`:

```typescript
const data = {
  title: title.trim(),
  description: descriptionRef.current ?? '',
  status,
  priority,
  projectId: effectiveProjectId,
  assigneeId,
  repositoryId,
  dueDate,
}
```

- [ ] **Step 6: Add DueDatePicker to form JSX**

In the form fields section, add `DueDatePicker` after `PrioritySelect` and before the repository `Select`:

```typescript
              <DueDatePicker
                value={dueDate}
                onChange={setDueDate}
                triggerClassName={triggerClass}
              />
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 8: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx
git commit -m "feat: add due date to NewTaskModal form"
```

---

### Task 5: Integrate into TaskDetailPanel

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

- [ ] **Step 1: Add DueDatePicker import**

Add `DueDatePicker` to the TaskFieldSelects import:

```typescript
import {
  StatusSelect,
  AssigneeSelect,
  ReviewerSelect,
  ProjectSelect,
  PrioritySelect,
  DueDatePicker,
  SeparatorDot,
  FIELD_TRIGGER_CLS,
} from './TaskFieldSelects'
```

- [ ] **Step 2: Add dueDate to onUpdate type**

In `TaskDetailPanelProps`, add `dueDate: string | null` to the `onUpdate` data type after `priority: ApiPriority`:

```typescript
onUpdate: (
  taskId: string,
  data: Partial<{
    title: string
    status: ApiStatus
    assigneeActorId: string | null
    reviewerActorId: string | null
    description: string | null
    projectId: string
    priority: ApiPriority
    dueDate: string | null
  }>
) => Promise<void>
```

- [ ] **Step 3: Add dueDate to task state initialization**

In the `useState<TaskDetail>` initializer (around line 160), add after `updatedAt`:

```typescript
    dueDate: initialTask.dueDate ?? null,
```

- [ ] **Step 4: Sync dueDate from liveTask**

In the `useEffect` that syncs from `liveTask` (around line 209-231), add dueDate to the sync logic. Find the block that checks for field changes and add:

```typescript
if (liveTask.dueDate !== undefined) {
  updates.dueDate = liveTask.dueDate ?? null
}
```

- [ ] **Step 5: Sync dueDate from fetched task detail**

In the `Promise.all` callback (around line 296-311), add to the `setTask` updater after `parent: t.parent ?? null,`:

```typescript
            dueDate: t.dueDate ?? null,
```

- [ ] **Step 6: Add DueDatePicker to property row JSX**

In the property row (around line 726-730), add after PrioritySelect and before the parent check:

```typescript
          <SeparatorDot />
          <DueDatePicker
            value={task.dueDate ?? null}
            onChange={v => handlePatch({ dueDate: v })}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 8: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx
git commit -m "feat: add due date picker to task detail panel"
```

---

### Task 6: List View Column + Board Cards

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/board/SortableTaskCard.tsx`

- [ ] **Step 1: Add Due Date column to task-columns.tsx**

Add imports at the top of `task-columns.tsx`:

```typescript
import { formatDueDate, isOverdue } from '../../utils'
```

Add a new column after the Priority column (after line 290) and before the updatedAt column:

```typescript
    // ── Due Date ──────────────────────────────────────────────────────────
    {
      accessorKey: 'dueDate',
      meta: {
        headerClassName: 'w-28 px-8',
        cellClassName: 'px-8',
      },
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.dueDate
          ? new Date(rowA.original.dueDate).getTime()
          : Infinity
        const b = rowB.original.dueDate
          ? new Date(rowB.original.dueDate).getTime()
          : Infinity
        return a - b
      },
      header: ({ column }) => (
        <SortableColHeader
          label='Due Date'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
        />
      ),
      cell: ({ row }) => {
        const dueDate = row.original.dueDate
        if (!dueDate) {
          return (
            <span className='text-xs text-muted-foreground'>—</span>
          )
        }
        return (
          <span
            className={cn(
              'text-xs',
              isOverdue(dueDate)
                ? 'text-red-500 font-medium'
                : 'text-muted-foreground'
            )}
          >
            {formatDueDate(dueDate)}
          </span>
        )
      },
    },
```

Add `cn` import if not already present:

```typescript
import { cn } from '@/lib/utils'
```

- [ ] **Step 2: Update ProjectTaskCard in SortableTaskCard.tsx**

Add imports at the top of `SortableTaskCard.tsx`:

```typescript
import { formatDueDate, isOverdue } from '../../utils'
```

Replace the date display in `ProjectTaskCard` (around lines 304-308). Find:

```typescript
          <span className='text-[10px] text-zinc-400'>
            Created {new Date(task.updatedAt).toLocaleDateString()}
          </span>
```

Replace with:

```typescript
          <span
            className={cn(
              'text-[10px]',
              task.dueDate && isOverdue(task.dueDate)
                ? 'text-red-500 font-medium'
                : 'text-zinc-400'
            )}
          >
            {task.dueDate
              ? `Due ${formatDueDate(task.dueDate)}`
              : `Created ${new Date(task.updatedAt).toLocaleDateString()}`}
          </span>
```

- [ ] **Step 3: Update MyTaskCard in SortableTaskCard.tsx**

Replace the date display in `MyTaskCard` (around lines 370-372). Find:

```typescript
          <span className='text-[10px] text-zinc-400'>
            {new Date(task.updatedAt).toLocaleDateString()}
          </span>
```

Replace with:

```typescript
          <span
            className={cn(
              'text-[10px]',
              task.dueDate && isOverdue(task.dueDate)
                ? 'text-red-500 font-medium'
                : 'text-zinc-400'
            )}
          >
            {task.dueDate
              ? `Due ${formatDueDate(task.dueDate)}`
              : new Date(task.updatedAt).toLocaleDateString()}
          </span>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Manual test**

Start dev server. Verify:

1. Create Task modal — DueDatePicker appears, quick-picks work, calendar works, clears work
2. Task detail panel — DueDatePicker shows, can set/change/clear due date
3. List view — Due Date column appears, sorts correctly, overdue dates show red
4. Board view — Cards show "Due Apr 10" when due date set, red if overdue, fallback to created date

- [ ] **Step 6: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx app/workspace/[workspaceUrl]/components/board/SortableTaskCard.tsx
git commit -m "feat: show due date in list view column and board cards"
```
