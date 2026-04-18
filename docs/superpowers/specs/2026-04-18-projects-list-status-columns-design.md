# Projects List — Status Columns, Owner & Bulk Delete

**Date**: 2026-04-18
**Status**: Approved
**Scope**: `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx` and the data layer feeding it

## Goal

Bring the workspace **Projects list page** to parity with the new design: per-status task counts (To Do / In Progress / In Review / Done), an Owner column, row-selection checkboxes, and a bulk-delete flow.

Out of scope (explicitly deferred): grid/list view toggle, "Create Project" button rename, large `Projects` page title.

## Current State

`ProjectsPage.tsx` renders 4 columns: Project / Tasks / In Progress / Updated. The API only ships `_count.tasks` and `inProgressCount`. There is no row selection, no Owner display.

## Target Columns

| #   | Column      | Source                                    | Sortable |
| --- | ----------- | ----------------------------------------- | -------- |
| 1   | ☐ Checkbox  | local selection state                     | —        |
| 2   | Project     | `name` (+ Draft badge if `isIdea`)        | ✅       |
| 3   | Tasks       | `_count.tasks`                            | ✅       |
| 4   | To Do       | `todoCount` (⚪ dot)                      | ✅       |
| 5   | In Progress | `inProgressCount` (🔵 dot)                | ✅       |
| 6   | In Review   | `inReviewCount` (🟣 dot)                  | ✅       |
| 7   | Done        | `doneCount` (🟢 dot)                      | ✅       |
| 8   | Owner       | `defaultReviewer.user.name` (or `—`)      | ✅       |
| 9   | Updated     | `updatedAt` (+ copy-link button on hover) | ✅       |

## Data Layer

### Repository — `lib/repositories/project.repository.ts`

`findByWorkspace` is split into two concerns:

1. **Project rows + reviewer name + counts/repos**:

   ```ts
   include: {
     _count: { select: { tasks: true } },
     defaultReviewer: { include: { user: { select: { name: true } } } },
     repositories: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
   }
   ```

   Drop the existing inlined `tasks: { where: { status: 'IN_PROGRESS' }, select: { id: true } }` — it is replaced by groupBy below.

2. **Status counts** in a single grouped query:
   ```ts
   prisma.task.groupBy({
     by: ['projectId', 'status'],
     where: {
       project: {
         workspaceId,
         OR: [{ isIdea: false }, { isIdea: true, createdByMemberId: memberId }],
       },
     },
     _count: { _all: true },
   })
   ```

A new repository method `countTasksByStatus(workspaceId, memberId)` wraps the groupBy and returns `Map<projectId, { TODO, IN_PROGRESS, IN_REVIEW, DONE }>` with zeros filled for missing buckets.

### Service — `lib/services/project.service.ts`

`listProjects` orchestrates the two repository calls and produces the API shape:

```ts
const [projects, statusCounts] = await Promise.all([
  projectRepository.findByWorkspace(workspaceId, memberId),
  projectRepository.countTasksByStatus(workspaceId, memberId),
])

return projects.map(p => {
  const counts = statusCounts.get(p.id) ?? {
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
  }
  return {
    ...p,
    todoCount: counts.TODO,
    inProgressCount: counts.IN_PROGRESS,
    inReviewCount: counts.IN_REVIEW,
    doneCount: counts.DONE,
    defaultReviewer: p.defaultReviewer
      ? { id: p.defaultReviewer.id, name: p.defaultReviewer.user.name }
      : null,
  }
})
```

The `defaultReviewer` relation chain is flattened in the service (LoD: components shouldn't reach into `p.defaultReviewer.user.name`).

### Type — `app/workspace/[workspaceUrl]/types.ts`

`ApiProject` gains:

```ts
todoCount: number
inReviewCount: number
doneCount: number
defaultReviewer: { id: string; name: string } | null
```

`inProgressCount` already exists; keep it. The existing `tasks` field on the listing payload is removed since it was only used to derive `inProgressCount`.

## UI Layer

### `ProjectsPage.tsx` — Columns

- 4 new `SortableHeader`s: `todo`, `inReview`, `done`, `owner` (in addition to existing `name`, `tasks`, `inProgress`, `updatedAt`).
- `ProjectSortKey` widens accordingly. `useMemo` sort switch grows new cases:
  - status counts → `cmpNumber`
  - owner → `cmpString` on `defaultReviewer?.name ?? ''`

Each status cell renders `<dot> <count>` where dot color is:

- TODO → `bg-zinc-300 dark:bg-zinc-600` (grey)
- IN_PROGRESS → `bg-blue-500` (existing)
- IN_REVIEW → `bg-purple-500`
- DONE → `bg-green-500`

Owner cell renders plain text (`p.defaultReviewer?.name ?? '—'`). No avatar.

### Selection

```ts
const [selected, setSelected] = useState<Set<string>>(new Set())
```

- Row checkbox: toggles single id; `onClick` calls `e.stopPropagation()` so it doesn't trigger row navigation.
- Header checkbox: tri-state (none / some / all of currently-filtered rows). `Some` shown via shadcn `Checkbox` `checked="indeterminate"`.
- Selection survives sort/filter changes (it is keyed by id, not index). Selection is cleared after a successful delete.

### Bulk-Delete Bar

A sticky bar rendered above the `<table>` when `selected.size > 0`:

```
┌─────────────────────────────────────────────────────────────┐
│ {N} selected                       [Cancel] [Delete N projects] │
└─────────────────────────────────────────────────────────────┘
```

- `Cancel` → `setSelected(new Set())`
- `Delete N projects` (destructive variant) → opens shadcn `AlertDialog`:
  - Title: `Delete {N} project(s)?`
  - Body: `This action cannot be undone. All tasks, views, and documents in {N} project(s) will be permanently removed.`
  - Confirm → batch delete

### Batch Delete Execution

```ts
const results = await Promise.allSettled(
  ids.map(id => fetch(`/api/projects/${id}`, { method: 'DELETE' }))
)
```

- All-success path: clear selection, `fetchProjects()`, toast "{N} projects deleted".
- Partial failure: keep failed ids in selection, toast `Failed to delete {K} of {N} projects`.
- No new API endpoint. Reuses existing `DELETE /api/projects/[id]`.

## Optimistic-Update Maintenance

### `useWorkspaceTaskHandlers.handleProjectTaskStatusChanged`

Currently only mutates `inProgressCount`. Generalize to all 4 buckets using a status → key map:

```ts
const KEY: Record<
  TaskStatus,
  keyof Pick<
    ApiProject,
    'todoCount' | 'inProgressCount' | 'inReviewCount' | 'doneCount'
  >
> = {
  TODO: 'todoCount',
  IN_PROGRESS: 'inProgressCount',
  IN_REVIEW: 'inReviewCount',
  DONE: 'doneCount',
}
```

Decrement `KEY[oldStatus]`, increment `KEY[newStatus]` (clamped at 0 for the decrement).

### `useWorkspaceProjectHandlers`

Two call sites (`useWorkspaceProjectHandlers.ts:61`, `:87`) construct new project objects with `inProgressCount: 0`. Add `todoCount: 0`, `inReviewCount: 0`, `doneCount: 0`, `defaultReviewer: null`.

## Testing

- `__tests__/lib/services/project.service.test.ts`: extend existing `listProjects` cases:
  - Returns 0-counts for projects with no tasks.
  - Returns correct per-status counts when tasks span multiple statuses.
  - Returns `defaultReviewer: null` when project has no reviewer; returns `{id, name}` when set.
- `__tests__/lib/repositories/project.repository.test.ts` (or new file): cover `countTasksByStatus` — workspace scoping, idea visibility filter parity with `findByWorkspace`.
- No new component tests (existing testing convention is service/repository-level).

## Risks & Trade-offs

- **groupBy adds one extra DB round-trip per page load.** Acceptable: `Promise.all` parallelizes it with the project query, and grouped aggregation is cheap with the existing `(projectId, status)` access patterns.
- **Bulk delete is N parallel requests, not a single transaction.** Partial failures are surfaced to the user. Atomic batch endpoint is YAGNI for now (typical N < 20).
- **Owner = `defaultReviewer`.** This is a deliberate semantic choice (vs. creator or new field). When unset, the column shows `—`. If product later wants a true "lead" concept, that's a separate schema change.

## Out of Scope

- Grid view toggle and grid layout
- "Create Project" rename / large Projects title
- Avatars in Owner column
- Atomic batch-delete API endpoint
- Archive concept on projects
