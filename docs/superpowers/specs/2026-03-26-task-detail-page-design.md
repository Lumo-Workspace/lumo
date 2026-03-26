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
- Parsed server-side: split on last `-` → `teamIdentifier=ENG`, `number=42`
- DB query: `prisma.task.findFirst({ where: { team: { identifier: 'ENG' }, number: 42, team: { workspaceId } } })`

### Source Context (breadcrumb)

A `?from=` query param carries the entry point so the breadcrumb reflects where the user came from:

| Param                       | Breadcrumb                                                |
| --------------------------- | --------------------------------------------------------- |
| `?from=my-tasks`            | My Tasks › ENG-42 title                                   |
| `?from=project-[projectId]` | Project Name › ENG-42 title                               |
| _(absent)_                  | Project Name › ENG-42 title (fall back to task's project) |

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
- Sub-tasks list (read-only links for now)

### Right column

- Properties section: Status, Assignee, Priority, Project, Reviewer — all editable inline (reuse existing field selects from `TaskDetailPanel`)
- Comments section: full threaded comment UI (reuse from `TaskDetailPanel`)

### Breadcrumb bar

- Back chevron + source label (clickable, navigates back)
- Separator + task identifier + title (read-only)
- Uses `router.back()` if `from` param is present; otherwise links to source page

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

### Click behaviour

1. Call `onClose()` to close the drawer
2. `router.push(`/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}?from=${source}`)`

`source` is determined by the page the drawer was opened from:

- My Tasks page → `my-tasks`
- Project detail page → `project-${project.id}`

---

## Files

| File                                                               | Action                                                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/tasks/[identifier]/page.tsx`         | **Create** — thin server component, resolves task by identifier, passes to client component                             |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx` | **Create** — `'use client'` two-column layout, reuses field selects + DescriptionEditor + comments from TaskDetailPanel |
| `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`           | **Modify** — replace expand button, add `onOpenPage` prop + `source` prop                                               |
| `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`                    | **Modify** — pass `onOpenTaskPage` handler and `source` context to TaskDrawer                                           |

### Reuse strategy

`TaskDetailPanel` is a large monolithic component used inside the drawer. Rather than refactor it, `TaskDetailPage` will **duplicate the relevant parts** (properties panel + comments) at a smaller scope — the two-column layout warrants different composition than the drawer's single-column panel. This avoids destabilising the existing drawer flow.

---

## Data Fetching

The `page.tsx` server component:

1. Resolves `[identifier]` → parses teamIdentifier + number
2. Verifies the team belongs to the workspace (security boundary)
3. Fetches the full task with relations (project, assignee, reviewer)
4. Passes as `initialTask` to the client component
5. Returns 404 if not found or out of workspace

The client component fetches live updates (description, comments) the same way `TaskDetailPanel` does — via `useEffect` on mount.

---

## Navigation & Back Button

```
?from=my-tasks        →  back link: /workspace/[slug]  (My Tasks is the default page)
?from=project-[id]    →  back link: /workspace/[slug]  with project detail open
                          (or just router.back() for simplicity)
absent                →  router.back()
```

For the initial implementation, use `router.back()` for all cases — it covers the common flow (user opens drawer → clicks Open → lands on page → clicks back → returns to previous page). Explicit `href` links can be added later if direct URL sharing needs better back behaviour.

---

## Out of Scope

- Deep-link sharing (no `from` param): back button falls back to `router.back()`
- Keyboard shortcut to open full page from drawer
- Sub-tasks as clickable links (placeholder only for now)
- Mobile layout optimisation for the two-column page
