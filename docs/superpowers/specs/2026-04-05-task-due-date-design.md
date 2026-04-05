# Task Due Date — Design Spec

## Overview

Add an optional due date property to tasks. Date-only precision (no time component). Displayed across all task views: create modal, detail panel, list view, and board cards. Overdue tasks get visual indicators (red text).

## Scope

- **In scope:** Due date CRUD on tasks, display in all views, overdue styling, quick-pick shortcuts, i18n
- **Out of scope:** Recurring due dates, due date notifications/reminders, due date filters

## Data Model

### Prisma

Add to the `Task` model:

```prisma
dueDate      DateTime?
```

Migration: `npx prisma migrate dev --name add_task_due_date`

The field stores a full `DateTime` but only the date portion is meaningful. The API transmits ISO 8601 strings (e.g. `"2026-04-10T00:00:00.000Z"`).

### TypeScript Types

Add to `ApiTask`, `TaskDetail`:

```typescript
dueDate?: string | null
```

`MyTask` inherits from `ApiTask` via `Omit`, so it gets `dueDate` automatically.

### Validation Schemas

Add to both `createTaskSchema` and `updateTaskSchema`:

```typescript
dueDate: z.string().datetime().nullable().optional(),
```

## Utility Functions

### `formatDueDate(date: string | null | undefined): string`

In `app/workspace/[workspaceUrl]/utils.ts`:

- `null`/`undefined` → `""` (empty)
- Same day as today → i18n `"Today"`
- Tomorrow → i18n `"Tomorrow"`
- Same year → locale short format (e.g. `"Apr 10"`)
- Different year → locale with year (e.g. `"Apr 10, 2027"`)

### `isOverdue(date: string | null | undefined): boolean`

Returns `true` if `date` is before today (comparing date-only, ignoring time).

## UI Components

### DueDatePicker (`TaskFieldSelects.tsx`)

New component added alongside existing field selects. Uses shadcn `Popover` + `Calendar`.

**Props:**

```typescript
interface DueDatePickerProps {
  value: string | null
  onChange: (value: string | null) => void
  triggerClassName?: string
}
```

**Trigger button:**

- Uses `FIELD_TRIGGER_CLS` for consistent styling
- Icon: `CalendarDays` from lucide-react
- No value → icon only (like unset assignee)
- Has value → formatted date text, with X button to clear
- Overdue → red text color

**Popover content:**

- Quick-pick shortcuts at top (buttons):
  - Today
  - Tomorrow
  - End of this week (nearest Friday/Sunday depending on locale — use Friday)
  - In one week
- `Calendar` component below for custom date selection
- Selecting a date closes the popover

**Date conversion:** When a date is selected from Calendar or quick-pick, convert to ISO string with time zeroed: `new Date(year, month, day).toISOString()`

### NewTaskModal Integration

- Add `dueDate` state (`string | null`, default `null`)
- Add `dueDate` to `NewTaskFormData` interface
- Render `DueDatePicker` in the field row after `PrioritySelect`
- Pass `dueDate` in the submit data
- Reset `dueDate` to `null` in `reset()`

### TaskDetailPanel Integration

- Add `dueDate: string | null` to `onUpdate` data type
- Render `DueDatePicker` in the properties row (after PrioritySelect, before SeparatorDot)
- On change: `handlePatch({ dueDate: value })`
- Sync `dueDate` from `liveTask` updates

### List View (task-columns.tsx)

New sortable column between Priority and Updated:

- Header: "Due Date" (i18n)
- Cell: formatted date, red text if overdue, "—" if none
- Sort: ascending by date, `null` values sort last (use `Infinity`)

### Board Cards (SortableTaskCard.tsx)

- **ProjectTaskCard:** When `dueDate` exists, show "Due {formatted}" instead of "Created {date}" in the bottom-right corner. Red text if overdue.
- **MyTaskCard:** Same treatment in the bottom-right date area.

## API Changes

### POST `/api/projects/[id]/tasks`

- Extract `dueDate` from `parsed.data`
- Pass `dueDate: dueDate ?? null` to `prisma.task.create()`

### PATCH `/api/tasks/[id]`

- Extract `dueDate` from `parsed.data` (already handles partial updates)
- Pass to `prisma.task.update()`

### GET responses

- Add `dueDate` to all task `select` queries that currently return task data:
  - `/api/projects/[id]/tasks` (list)
  - `/api/tasks/[id]` (detail)
  - `/api/tasks/me` (my tasks)

## i18n

Add to `en.json` / `zh.json`:

| Key                   | EN               | ZH          |
| --------------------- | ---------------- | ----------- |
| `dueDate.label`       | Due date         | 截止日期    |
| `dueDate.today`       | Today            | 今天        |
| `dueDate.tomorrow`    | Tomorrow         | 明天        |
| `dueDate.endOfWeek`   | End of this week | 本周末      |
| `dueDate.inOneWeek`   | In one week      | 一周后      |
| `dueDate.noDueDate`   | No due date      | 无截止日期  |
| `dueDate.due`         | Due {date}       | {date} 截止 |
| `taskColumns.dueDate` | Due Date         | 截止日期    |

## New Files

None — all changes go into existing files.

## Modified Files

| File                                                                  | Change                                   |
| --------------------------------------------------------------------- | ---------------------------------------- |
| `prisma/schema.prisma`                                                | Add `dueDate DateTime?` to Task model    |
| `app/workspace/[workspaceUrl]/types.ts`                               | Add `dueDate` to `ApiTask`, `TaskDetail` |
| `lib/validation/schemas.ts`                                           | Add `dueDate` to create/update schemas   |
| `app/workspace/[workspaceUrl]/utils.ts`                               | Add `formatDueDate`, `isOverdue`         |
| `app/workspace/[workspaceUrl]/components/TaskFieldSelects.tsx`        | Add `DueDatePicker` component            |
| `app/workspace/[workspaceUrl]/components/modals/NewTaskModal.tsx`     | Add dueDate field to form                |
| `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`         | Add dueDate to detail view               |
| `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx` | Add Due Date column                      |
| `app/workspace/[workspaceUrl]/components/board/SortableTaskCard.tsx`  | Show due date on cards                   |
| `app/api/projects/[id]/tasks/route.ts`                                | Handle dueDate in create                 |
| `app/api/tasks/[id]/route.ts`                                         | Handle dueDate in update, include in GET |
| `app/api/tasks/me/route.ts`                                           | Include dueDate in response              |
| `lib/i18n/en.json`                                                    | Add dueDate translation keys             |
| `lib/i18n/zh.json`                                                    | Add dueDate translation keys             |

## Error Handling

- Invalid date string → Zod validation rejects at API level
- Past dates allowed (user may intentionally set overdue tasks)
- `null` clears the due date
