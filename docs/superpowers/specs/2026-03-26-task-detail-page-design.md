# Task Detail Page — Design Spec

**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Replace the TaskDrawer's "Expand" button (which widens the drawer to full-screen) with an "Open" button that navigates to a dedicated full-page task detail view. The page keeps the application sidebar, uses a two-column layout, and supports dynamic breadcrumb navigation based on the entry point.

---

## URL Structure

```
/workspace/[workspaceUrl]/tasks/[identifier]
```

- `[identifier]` = team identifier + number, e.g. `ENG-42`
- Parsed server-side with regex `/^([A-Z]+)-(\d+)$/`. If the pattern does not match, call `notFound()` immediately.

### Source Context (breadcrumb)

A `?from=` query param carries the entry point so the breadcrumb reflects where the user came from:

| Param                       | Breadcrumb label (source side)                                   |
| --------------------------- | ---------------------------------------------------------------- |
| `?from=my-tasks`            | "My Tasks"                                                       |
| `?from=project-[projectId]` | `task.project.name` (fetched with the task via Prisma `include`) |
| _(absent)_                  | `task.project.name` (fall back to the task's own project)        |

---

## Page Layout

The application sidebar is preserved. The main content area contains:

```
┌─ Sidebar ──┬─ Main content ──────────────────────────────────┐
│            │ Breadcrumb bar                                   │
│            ├──────────────────────────┬──────────────────────┤
│            │ Left (flex-1)            │ Right (w-72)         │
│            │                          │                      │
│            │ Title (editable)         │ Properties           │
│            │ Description Editor       │  · Status            │
│            │ Sub-tasks                │  · Assignee          │
│            │                          │  · Priority          │
│            │                          │  · Project           │
│            │                          │  · Reviewer          │
│            │                          │                      │
│            │                          │ Comments             │
│            │                          │  (threaded)          │
└────────────┴──────────────────────────┴──────────────────────┘
```

### Left column

- Editable task title (contentEditable, same pattern as project name)
- `DescriptionEditor` (rich text, full width)
- Sub-tasks list (read-only, placeholder only for now)

### Right column

- Properties section: Status, Assignee, Priority, Project, Reviewer — all editable inline (reuse existing field select components from `TaskFieldSelects`)
- Comments section: full threaded comment UI (duplicate from `TaskDetailPanel`)

### Breadcrumb bar

- Back chevron + source label (clickable)
- Separator + task identifier + title (read-only)
- Back navigation: use `router.back()` for all cases. This covers the primary flow (user opens drawer → clicks Open → lands on page → clicks back → returns). Known limitation: if the user opens the URL in a new tab with no history, `router.back()` exits the app. This is acceptable for the initial implementation; a fallback href can be added later.

---

## Sidebar

The task detail page is a sibling route — it does **not** render `WorkspaceApp`. It wraps `AppSidebar` directly inside `SidebarProvider`.

`AppSidebar` has five required props. On the task detail page, supply them as follows:

| Prop               | Value on task detail page                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currentPage`      | `'task-detail'` (add this literal to the `Page` union in `types.ts`; no sidebar nav item checks for it, so nothing is highlighted)                                                                      |
| `onNavigate`       | A handler that calls `router.push(\`/workspace/${workspaceUrl}\`)` for any page. Navigation via the sidebar always goes to the workspace root — this is an accepted tradeoff for this standalone route. |
| `isDarkMode`       | Read from localStorage on mount: `localStorage.getItem(CACHE_KEY.darkMode) === 'true'` (same pattern as `WorkspaceApp`); manage with local `useState`                                                   |
| `onToggleDarkMode` | Toggle local state + `localStorage.setItem(CACHE_KEY.darkMode, String(!isDarkMode))` + toggle `document.documentElement.classList`                                                                      |
| `unreadCount`      | `0` (inbox count is not fetched on this standalone page)                                                                                                                                                |

---

## Type Changes

### `types.ts` — extend `Page` union

```ts
export type Page =
  | 'my-tasks'
  | 'projects'
  | 'project-detail'
  | 'inbox'
  | 'task-detail'
```

### `types.ts` — extend `TaskDetail` with optional `children`

```ts
export interface TaskDetail {
  // ...existing fields unchanged...
  children?: { id: string; title: string; number: number }[]
}
```

---

## Drawer Changes

### Button replacement

Remove the `ArrowLeftToLine` / `ArrowRightToLine` expand toggle. Replace with a single icon button using the `SquareArrowOutUpRight` icon from Lucide.

```
Header: [SquareArrowOutUpRight]  ···  [X]
         Open full page              Close
```

- Style: identical to the existing X button (`variant='ghost' size='icon' h-7 w-7`)
- `title="Open full page"`
- Position: left side of header (where expand button was)

### New props on `TaskDrawer`

Add one new required prop:

```ts
source: 'my-tasks' | `project-${string}`
```

No `onOpenPage` callback — navigation is handled entirely inside `TaskDrawer` using `useRouter` from `next/navigation`.

### Click behaviour

1. Call `onClose()` to close the drawer
2. `router.push(\`/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}?from=${source}\`)`

`task.teamIdentifier` and `task.number` come from the `ApiTask` type already on the `initialTask` prop — no additional lookup required.

`workspaceUrl` is read via `useParams<{ workspaceUrl: string }>()`.

---

## Files

| File                                                               | Action                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/types.ts`                            | **Modify** — add `'task-detail'` to `Page` union; add optional `children` to `TaskDetail`                                                                                                                                                         |
| `app/workspace/[workspaceUrl]/tasks/[identifier]/page.tsx`         | **Create** — thin async server component, resolves task by identifier, passes `initialTask` + `workspaceUrl` to `TaskDetailPage`                                                                                                                  |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` | **Create** — `'use client'` two-column layout; duplicates properties + comments from `TaskDetailPanel`; manages sidebar state locally                                                                                                             |
| `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`           | **Modify** — remove expand toggle; add `source` prop; add `useRouter` + `useParams`; replace button with `SquareArrowOutUpRight` open-page button; add `reviewerId` to `onUpdate` signature (fixing pre-existing mismatch with `TaskDetailPanel`) |
| `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`                    | **Modify** — derive and pass `source` prop to `TaskDrawer`                                                                                                                                                                                        |

### Reuse strategy

`TaskDetailPanel` is a large monolithic component used inside the drawer. Rather than refactor it, `TaskDetailPage` will **duplicate the relevant parts** (properties panel + comments) at a smaller scope — the two-column layout warrants different composition than the drawer's single-column panel. This avoids destabilising the existing drawer flow.

---

## Data Fetching

### `page.tsx` server component

Follow the existing `page.tsx` pattern exactly:

```ts
export default async function TaskIdentifierPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; identifier: string }>
}) {
  const { workspaceUrl, identifier } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Verify workspace membership (same pattern as WorkspaceAppPage)
  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
  })
  if (!workspace) redirect('/onboarding')

  // Parse and validate identifier
  const match = identifier.match(/^([A-Z]+)-(\d+)$/)
  if (!match) notFound()
  const [, teamIdentifier, numStr] = match
  const number = parseInt(numStr, 10)

  // Fetch task (workspaceId provides the security boundary)
  const rawTask = await prisma.task.findFirst({
    where: { number, team: { identifier: teamIdentifier, workspaceId: workspace.id } },
    include: {
      project: { select: { id: true, name: true, defaultReviewerId: true } },
      assignee: { select: { id: true, clerkId: true } },
      children: { select: { id: true, title: true, number: true } },
    },
  })
  if (!rawTask) notFound()

  // Serialize Dates before passing to client component (Next.js requirement)
  const task = {
    ...rawTask,
    updatedAt: rawTask.updatedAt.toISOString(),
  }

  return <TaskDetailPage initialTask={task} workspaceUrl={workspaceUrl} />
}
```

Note: `assignee` selects only `{ id, clerkId }` — matching the existing `TaskDetail` type. Display names and avatars for assignee/reviewer come from the `members` list, which `TaskDetailPage` fetches on mount (see below).

### `TaskDetailPage` client component — props

```ts
interface TaskDetailPageProps {
  initialTask: TaskDetail & {
    children?: { id: string; title: string; number: number }[]
  }
  workspaceUrl: string
}
```

### `TaskDetailPage` client component — data fetches on mount

On mount, fetch in parallel:

1. **Live task detail** via `GET API.tasks.byId(taskId)` — same endpoint `TaskDetailPanel` uses; updates description and any field changes since server render
2. **Members list** via `GET API.workspaces.members` — needed to resolve assignee/reviewer display names (same as `WorkspaceApp`)
3. **Projects list** via `GET API.projects.list` — needed for the Project field select

Use `localStorage` cache for immediate hydration before the fetches resolve (same cache keys: `CACHE_KEY.members`, `CACHE_KEY.projects`).

### `TaskDetailPage` client component — field mutations

`TaskDetailPage` owns its own `onUpdate` handler. It calls `API.tasks.byId` directly and updates local state:

```ts
const onUpdate = async (
  taskId: string,
  data: Partial<{
    title: string
    status: ApiStatus
    assigneeId: string | null
    reviewerId: string | null
    description: string | null
    projectId: string
    priority: ApiPriority
  }>
) => {
  await fetch(API.tasks.byId(taskId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  setTask(prev => (prev ? { ...prev, ...data } : prev))
}
```

---

## `WorkspaceApp.tsx` — `source` derivation

Derive `source` from `currentPage` and `selectedProject` when rendering `TaskDrawer`:

```ts
const drawerSource: 'my-tasks' | `project-${string}` =
  currentPage === 'my-tasks'
    ? 'my-tasks'
    : selectedProject
      ? `project-${selectedProject.id}`
      : 'my-tasks' // fallback for inbox/projects pages where drawer is not normally shown
```

Pass `source={drawerSource}` to `<TaskDrawer />`.

---

## Navigation & Back Button

Use `router.back()` for all cases — `?from` is only used to determine the breadcrumb label, not the back URL.

---

## Out of Scope

- Deep-link sharing without `?from`: back button falls back to `router.back()` (may exit app if no history)
- Keyboard shortcut to open full page from drawer
- Sub-tasks as clickable links (placeholder only)
- Mobile layout optimisation for the two-column page
- Surfacing unread count in the sidebar on the task detail page
