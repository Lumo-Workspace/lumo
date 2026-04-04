# Parent-Child Task Relationship Display — Design Spec

## Overview

Display parent-child task relationships across all three views: List View (tree indentation), Board View (parent label on cards + progress bar on parent), and Detail Panel (breadcrumb + metadata field).

## 1. List View — Tree Indentation

### Parent Row

- Tasks with children show a collapse/expand toggle icon (▶/▼) to the left of the status checkbox
- Tasks without children show no toggle (no wasted space)
- **Default state: collapsed**

### Child Rows (expanded)

- Indented ~28px from parent
- Subtle background tint (e.g., `bg-zinc-50 dark:bg-zinc-900/50`) to visually group with parent
- No parent badge needed — indentation communicates the relationship
- Children sorted by `order` field (same as SubtasksSection)

### Data Requirements

- Task list API must return `_count: { children: number }` (or inline `children` array) so the UI knows which rows get toggles
- When user expands a parent, children may already be in the task list (if they belong to same project) or need a fetch

### Interaction

- Click toggle to expand/collapse
- Expand state is local (not persisted)
- Subtasks can still be independently sorted/filtered — if a filter hides the parent, subtasks still appear (flat, no indent)

## 2. Board View — Cards + Progress Bar

### Subtask Cards

- Subtasks appear as regular cards in their respective status columns
- Top of card shows a small parent reference label: `↑ LUM-12` (team identifier + number)
- Label is styled as a muted pill/badge (`text-xs text-zinc-500 bg-zinc-100 dark:bg-zinc-800`)
- Clicking the label navigates to the parent task's detail

### Parent Card Progress Bar

- Parent task cards with children show a subtask progress indicator at the bottom
- Progress bar: thin horizontal bar showing ratio of DONE children to total children
- Text label: `2/3` next to the bar
- Colors: completed portion in `bg-blue-500`, remaining in `bg-zinc-200 dark:bg-zinc-700`
- If all children are DONE, bar is fully filled

### Data Requirements

- Board view tasks need `parentTaskId` to know if a task is a subtask
- Parent tasks need children count + done count for progress bar
- API should include: `parent: { id, number, teamIdentifier } | null` and `_count: { children: number }, childrenDoneCount: number`

## 3. Detail Panel — Breadcrumb + Metadata

### Breadcrumb (above title)

- When viewing a subtask (task with `parentTaskId`), show a clickable breadcrumb above the title
- Format: `↑ LUM-12 Build user authentication system`
- Styled as a link (`text-xs text-blue-500 hover:text-blue-600 cursor-pointer`)
- Clicking navigates to parent task's detail panel

### Parent Metadata Field

- Add a "Parent" field in the metadata section (alongside Status, Priority, Assignee, etc.)
- Shows parent task identifier and title as a clickable link
- Only visible when task has a `parentTaskId`

### SubtasksSection (existing)

- Already implemented — shows child tasks list + AI decomposition
- No changes needed

### Data Requirements

- TaskDetail API already returns `parentTaskId`
- Needs additional: `parent: { id, title, number, teamIdentifier } | null` in the response

## API Changes

### GET `/api/projects/[id]/tasks` (task list)

Add to Prisma include:

```
_count: { select: { children: true } },
parent: { select: { id: true, title: true, number: true, team: { select: { identifier: true } } } },
children: { select: { id: true, status: true }, where: { status: 'DONE' } }
```

This provides:

- `_count.children` — for collapse toggle in list view
- `parent` — for breadcrumb/badge display
- `children` (DONE only) — for progress bar calculation (compare with `_count.children`)

### GET `/api/tasks/[id]` (task detail)

Add `parent` to Prisma include:

```
parent: { select: { id: true, title: true, number: true, team: { select: { identifier: true } } } }
```

### Type Changes

```typescript
// ApiTask additions
interface ApiTask {
  // ... existing fields
  parent?: {
    id: string
    number: number
    teamIdentifier: string
    title: string
  } | null
  _count?: { children: number }
  childrenDoneCount?: number
}

// TaskDetail additions
interface TaskDetail {
  // ... existing fields
  parent?: {
    id: string
    number: number
    teamIdentifier: string
    title: string
  } | null
}
```

## Files to Create/Modify

| File                                                                  | Action | Purpose                                       |
| --------------------------------------------------------------------- | ------ | --------------------------------------------- |
| `app/api/projects/[id]/tasks/route.ts`                                | Modify | Add parent, \_count, children to include      |
| `app/api/tasks/[id]/route.ts`                                         | Modify | Add parent to include                         |
| `app/workspace/[workspaceUrl]/types.ts`                               | Modify | Add parent and \_count to ApiTask, TaskDetail |
| `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx` | Modify | Add expand toggle, indentation for tree view  |
| `app/workspace/[workspaceUrl]/components/board/SortableTaskCard.tsx`  | Modify | Add parent label badge + progress bar         |
| `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`         | Modify | Add breadcrumb + parent metadata field        |

## Out of Scope

- Drag-and-drop to reparent tasks
- Multi-level nesting display (only 1 level: parent → children)
- Filtering by "show only parent tasks" or "show only subtasks"
- Persisting expand/collapse state
