# Entity URLs — Design Spec

**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Add shareable, copyable URLs for every major entity in the app: projects, tasks, and comments. Each entity gets a stable deep link. Copy-to-clipboard buttons appear contextually (hover on comments, visible on detail pages). Comment links use anchor hashes and auto-scroll + highlight the target comment on load.

---

## URL Structure

### Project detail page (new route)

```
/workspace/[workspaceUrl]/projects/[projectId]
```

Example: `/workspace/acme/projects/cmn3ofzjo000tngjpum2ft8uf`

- `[projectId]` is the Prisma CUID — canonical, never changes
- Server-side: fetch `prisma.project.findFirst({ where: { id: projectId, workspaceId: workspace.id } })`; call `notFound()` if not found

### Task detail page (existing route, unchanged)

```
/workspace/[workspaceUrl]/tasks/[identifier]
```

Example: `/workspace/acme/tasks/LUM-12`

### Comment deep link (anchor, no new route)

```
/workspace/[workspaceUrl]/tasks/[identifier]#comment-[commentId]
```

Example: `/workspace/acme/tasks/LUM-12#comment-cm4abc123`

- No dedicated route — the task detail page handles the hash on mount
- Anchor only works on the full-page task detail view (not the drawer)

---

## Project Detail Page

### Files

| File                                                                            | Action                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/projects/[projectId]/page.tsx`                    | **Create** — thin async server component                                |
| `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx` | **Create** — `'use client'` wrapper with AppSidebar + ProjectDetailPage |

### `page.tsx` — server component

Follows the exact same pattern as `tasks/[identifier]/page.tsx`:

```ts
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; projectId: string }>
}) {
  const { workspaceUrl, projectId } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const workspace = await prisma.workspace.findFirst({
    where: { slug: workspaceUrl, members: { some: { clerkId: userId } } },
  })
  if (!workspace) redirect('/onboarding')

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: workspace.id },
  })
  if (!project) notFound()

  const serialized = {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }

  return (
    <ProjectDetailStandalonePage
      initialProject={serialized}
      workspaceUrl={workspaceUrl}
    />
  )
}
```

### `ProjectDetailStandalonePage` — client component

Props:

```ts
interface Props {
  initialProject: SerializedProject // Dates as ISO strings
  workspaceUrl: string
}
```

#### Sidebar setup

- Manages `isDarkMode` via localStorage (`CACHE_KEY.darkMode`) — same pattern as `TaskDetailPage`
- Supplies all 5 required `AppSidebar` props:
  - `currentPage`: `'projects'` (highlights Projects in the sidebar nav)
  - `onNavigate`: `(page: Page) => router.push(\`/workspace/${workspaceUrl}\`)`— ignores`page`arg, always goes to workspace root. **Known limitation:** sidebar nav items all navigate to workspace root rather than their respective pages; accepted tradeoff for this standalone route (same as`TaskDetailPage`).
  - `isDarkMode` / `onToggleDarkMode`: local state + localStorage + classList toggle
  - `unreadCount`: `0`

#### Breadcrumb

Back chevron → "Projects" (clickable, calls `router.push(\`/workspace/${workspaceUrl}\`)`) → separator → project name. **Do not use `router.back()`** — direct deep links have no history, so `router.back()` would exit the app.

#### Data fetching on mount

Fetch in parallel:

1. Members via `GET API.workspaces.members` — hydrate from `CACHE_KEY.members` first
2. Projects via `GET API.projects.list` — hydrate from `CACHE_KEY.projects` first
3. Project tasks via `GET API.projects.tasks(projectId)` — hydrate from `CACHE_KEY.projectTasks(projectId)` first (note: `projectTasks` cache key is a function, call it with `projectId`). The response shape is `{ tasks: ApiTask[], kanbanViewId: string | null }` — call `setKanbanViewId(data.kanbanViewId)` after fetching

Manage local state:

```ts
const [project, setProject] = useState<ApiProject>(initialProject as ApiProject)
const [tasks, setTasks] = useState<ApiTask[]>([])
const [kanbanViewId, setKanbanViewId] = useState<string | null>(null)
const [members, setMembers] = useState<WorkspaceMemberInfo[]>([])
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)
```

`project` is seeded from `initialProject` (server-rendered) and updated optimistically by `handleUpdateProject`.

#### Wiring `ProjectDetailPage` props

`ProjectDetailStandalonePage` renders the existing `ProjectDetailPage` directly. All 16 props must be supplied:

```ts
<ProjectDetailPage
  project={project}                          // local state, seeded from initialProject
  tasks={tasks}
  setTasks={setTasks}
  viewId={kanbanViewId}
  loading={loading}
  error={error}
  onRetry={() => fetchTasks()}
  // onRetry intentionally only re-fetches tasks — that is all ProjectDetailPage's retry button controls
  onBack={() => router.push(`/workspace/${workspaceUrl}`)}
  onNewTask={(status) => handleCreateTask(status)}
  onTaskClick={(task) => router.push(`/workspace/${workspaceUrl}/tasks/${task.teamIdentifier}-${task.number}`)}
  // teamIdentifier is the team prefix (e.g. "LUM"), number is the task number (e.g. 12) → produces "LUM-12"
  onDeleteTask={handleDeleteTask}
  onTaskStatusChanged={handleTaskStatusChanged}
  onUpdateProject={handleUpdateProject}
  onDeleteProject={async (id) => { await handleDeleteProject(id); router.push(`/workspace/${workspaceUrl}`) }}
  members={members}
/>
```

Key handler implementations:

- `onTaskClick`: navigate to task detail page (no drawer on this standalone page)
- `onDeleteProject`: call `DELETE API.projects.byId(id)` then navigate to workspace root
- `handleCreateTask`: call `POST API.projects.tasks(projectId)` with `{ title, status }`, add returned task to local state
- `handleDeleteTask`: call `DELETE API.tasks.byId(taskId)`, remove from local state
- `handleTaskStatusChanged`: call `PATCH API.tasks.byId(taskId)` with `{ status }`, update local state
- `handleUpdateProject`: call `PATCH API.projects.byId(id)` with data, update local project state

---

## Copy Link

### Utility

New file: `app/workspace/[workspaceUrl]/utils/copyLink.ts`

```ts
import { toast } from 'sonner'

export async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Link copied')
  } catch {
    toast.error('Failed to copy link')
  }
}
```

Callers also briefly swap the copy icon to a `Check` for 1.5 s using local state (see button style below).

### Per-entity placement

| Entity             | Trigger                                                                                                                       | File                              | URL copied                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| **Project** (list) | Hover on project row in `WorkspaceApp`'s sidebar project list (the `<button>` items in the left nav that switch to a project) | `WorkspaceApp.tsx`                | `/workspace/[slug]/projects/[projectId]`                   |
| **Project** (page) | Always-visible in `ProjectDetailStandalonePage` header, next to the project title                                             | `ProjectDetailStandalonePage.tsx` | `/workspace/[slug]/projects/[projectId]`                   |
| **Task** (drawer)  | Always-visible in `TaskDrawer` header, between `SquareArrowOutUpRight` and `X`                                                | `TaskDrawer.tsx`                  | `/workspace/[slug]/tasks/[identifier]`                     |
| **Task** (page)    | Always-visible in `TaskDetailPage` title area, next to the title                                                              | `TaskDetailPage.tsx`              | `/workspace/[slug]/tasks/[identifier]`                     |
| **Comment**        | Hover on individual comment → link icon appears top-right of that comment                                                     | `TaskDetailPanel.tsx`             | `/workspace/[slug]/tasks/[identifier]#comment-[commentId]` |

### Button style

Consistent across all entities:

- `variant='ghost' size='icon' h-7 w-7`
- Icon: `Link` (Lucide) → swaps to `Check` for 1.5 s after click
- Tooltip: `"Copy link"`

---

## Comment Anchor Scroll & Highlight

### Marking comments in the DOM

`TaskDetailPage` and `TaskDetailPanel` render their own independent comment lists (they do **not** share a sub-component for comments). Both must have the `id` attribute added to their comment containers:

```tsx
<div id={`comment-${comment.id}`} ...>
```

This applies to:

- `TaskDetailPage.tsx` — the comment loop at the bottom of the right column
- `TaskDetailPanel.tsx` — the comment loop inside the panel (for the drawer view's copy link button; no anchor scrolling here)

### Handling the hash on load (`TaskDetailPage`)

In `TaskDetailPage`, after the comments have loaded:

Use a `hasScrolled` ref to ensure the effect only fires once (prevents re-triggering when comments are updated after posting a new comment). This is safe because `TaskDetailPage` unmounts on navigation, so the ref resets naturally on each new page load:

```ts
const hasScrolled = useRef(false)

useEffect(() => {
  if (hasScrolled.current) return
  if (!comments.length) return
  const hash = window.location.hash // e.g. "#comment-cm4abc123"
  if (!hash.startsWith('#comment-')) return
  // Strip the leading '#' only; the element id is "comment-cm4abc123"
  const el = document.getElementById(hash.slice(1))
  if (!el) return
  hasScrolled.current = true
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('comment-highlight')
  setTimeout(() => el.classList.remove('comment-highlight'), 1500)
}, [comments])
```

### Highlight style

```css
/* globals.css */
.comment-highlight {
  animation: highlight-fade 1.5s ease-out forwards;
}
@keyframes highlight-fade {
  0% {
    background-color: rgb(254 249 195); /* yellow-100 */
  }
  100% {
    background-color: transparent;
  }
}

/* Dark mode — app toggles .dark class on <html> */
.dark .comment-highlight {
  animation: highlight-fade-dark 1.5s ease-out forwards;
}
@keyframes highlight-fade-dark {
  0% {
    background-color: rgb(78 63 0 / 0.3); /* amber-tinted dark */
  }
  100% {
    background-color: transparent;
  }
}
```

### Drawer behaviour

The drawer (`TaskDetailPanel`) does **not** handle anchor scrolling — deep links via `#comment-[id]` only work on the standalone task detail page.

The copy link button is still added to comments inside `TaskDetailPanel` (drawer view). The URL it copies always points to the standalone task detail page (`/workspace/[slug]/tasks/[identifier]#comment-[id]`), not to the current drawer context. This is intentional — the drawer has no shareable URL of its own.

---

## Files

| File                                                                            | Action                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/workspace/[workspaceUrl]/projects/[projectId]/page.tsx`                    | **Create** — server component                                                                                                              |
| `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx` | **Create** — client component with AppSidebar                                                                                              |
| `app/workspace/[workspaceUrl]/utils/copyLink.ts`                                | **Create** — clipboard utility                                                                                                             |
| `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`                   | **Modify** — add `id="comment-[id]"` to comment containers; add hover copy link button per comment                                         |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`              | **Modify** — add `id="comment-[id]"` to comment containers; add copy link button to title area; add comment anchor scroll+highlight effect |
| `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`                        | **Modify** — add copy link button to header                                                                                                |
| `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`                                 | **Modify** — add copy link button on project list items (hover)                                                                            |
| `app/globals.css`                                                               | **Modify** — add `.comment-highlight` animation                                                                                            |

### No type changes required

The existing `ApiProject`, `ApiTask`, and comment types are sufficient. No schema migrations needed — `projectId` is the existing Prisma CUID primary key.

---

## Out of Scope

- Vanity slugs / human-readable project URLs (using projectId keeps it simple and stable)
- Comment anchor scrolling inside the drawer (drawer is not a shareable URL context)
- QR codes or social share previews (og:image, etc.)
- Link expiry or access control beyond existing workspace membership
