# Show Subtasks Toggle — Design Spec

## Overview

Add a "Show subtasks" toggle to the Display options menu. When enabled (default), subtasks appear normally in both list and board views. When disabled, all tasks with a `parentTaskId` are filtered out from both views.

## Behavior

| Toggle state | List view                                                          | Board view                                  |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------- |
| ON (default) | Subtasks visible as tree rows under parents, expand/collapse works | Subtasks visible as cards with parent label |
| OFF          | Only root tasks shown, no expand/collapse chevrons                 | Only root tasks shown, no subtask cards     |

When toggled off, parent task cards/rows still show their subtask count indicator and progress bar (existing `_count.children` and `childrenDoneCount` data). The toggle only removes child task rows/cards from the view.

## Changes

### 1. `useDisplayOptions` hook

Add `showSubtasks: boolean` to the `DisplayOptions` interface, defaulting to `true`. Add a `setShowSubtasks` setter following the same pattern as `setCompletedFilter` and `setOrdering`.

### 2. `DisplayOptionsMenu` component

Add a new section after "Completed issues" with a divider, a "Subtasks" label, and a shadcn `Switch` component to toggle `showSubtasks`. The Switch pattern is already used in the codebase (NotificationsPage).

### 3. `ProjectDetailPage`

Pass `showSubtasks` from the hook into the existing `filteredTasks` memo. When `showSubtasks` is `false`, filter out tasks where `parentTaskId !== null`. This happens after `filterCompletedTasks` and `sortTasks`, applied to both list and board views since both consume `filteredTasks`.

When `showSubtasks` is `false`, also omit the `treeConfig` prop from `DataTable` so expand/collapse chevrons don't appear on parent tasks.

## Persistence

Persisted to localStorage alongside existing display options (per-project key: `lumo:display:project:{projectId}`). Cross-tab sync via the existing `SYNC_EVENT` mechanism.

## UI Placement

```
Display popover:
├─ Ordering (radio list)
├─ ── divider ──
├─ Completed issues (radio list)
├─ ── divider ──
└─ Subtasks
    └─ [Show subtasks  ◉ ] ← Switch toggle, right-aligned
```

## Dependencies

No new packages. Uses existing `Switch` from `@/components/ui/switch`.
