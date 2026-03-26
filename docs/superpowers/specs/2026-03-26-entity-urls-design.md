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

`project` is seeded from `initialProject` (server-rendered) and updated optimistically by `handleUpdateProject`. The cast is safe — `ApiProject.createdAt` and `updatedAt` are typed as `string` (not `Date`), matching the serialized values. `'projects'` is already a valid value in the `Page` union in `types.ts`.

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
  // onRetry intentionally only re-fetches tasks — it maps to ProjectDetailPage's inline retry button
  // which appears only when task loading fails; members/projects errors are not surfaced via this button
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

| Entity               | Trigger                                                                                                                       | File                              | URL copied                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| **Project** (list)   | Hover on project row in `WorkspaceApp`'s sidebar project list (the `<button>` items in the left nav that switch to a project) | `WorkspaceApp.tsx`                | `/workspace/[slug]/projects/[projectId]`                   |
| **Project** (page)   | Always-visible in `ProjectDetailStandalonePage` header, next to the project title                                             | `ProjectDetailStandalonePage.tsx` | `/workspace/[slug]/projects/[projectId]`                   |
| **Task** (drawer)    | Always-visible in `TaskDrawer` header, between `SquareArrowOutUpRight` and `X`                                                | `TaskDrawer.tsx`                  | `/workspace/[slug]/tasks/[identifier]`                     |
| **Task** (page)      | Always-visible in `TaskDetailPage` title area, next to the title                                                              | `TaskDetailPage.tsx`              | `/workspace/[slug]/tasks/[identifier]`                     |
| **Comment** (drawer) | Hover on individual comment → link icon appears top-right of that comment                                                     | `TaskDetailPanel.tsx`             | `/workspace/[slug]/tasks/[identifier]#comment-[commentId]` |
| **Comment** (page)   | Hover on individual comment → link icon appears top-right of that comment                                                     | `TaskDetailPage.tsx`              | `/workspace/[slug]/tasks/[identifier]#comment-[commentId]` |

### `workspaceUrl` availability in copy-link callers

- `TaskDrawer.tsx` — already calls `useParams<{ workspaceUrl: string }>()` (added in the task detail page implementation); `workspaceUrl` is in scope
- `TaskDetailPanel.tsx` — does **not** currently call `useParams`. Add `const { workspaceUrl } = useParams<{ workspaceUrl: string }>()` and `import { useParams } from 'next/navigation'` at the top of the file.
- `WorkspaceApp.tsx` — `workspaceUrl` is a prop received from its parent page
- `TaskDetailPage.tsx` and `ProjectDetailStandalonePage.tsx` — `workspaceUrl` is a prop passed from the server component

### Task identifier construction in copy-link callers

For task copy links, construct the identifier as `\`${task.teamIdentifier}-${task.number}\``(e.g.`"LUM-12"`). `teamIdentifier`is the team prefix string (e.g.`"LUM"`); `number`is the integer task number (e.g.`12`). Both are always present on `ApiTask`and`MyTask`.

### Button style

Consistent across all entities:

- `variant='ghost' size='icon' h-7 w-7`
- Icon: `Link` (Lucide) → swaps to `Check` for 1.5 s after click
- Tooltip: `"Copy link"`

---

## Comment Anchor Scroll & Highlight

### Marking comments in the DOM

`TaskDetailPage` and `TaskDetailPanel` render their own independent comment lists (they do **not** share a sub-component for comments).

**`TaskDetailPage.tsx`** — `id={`comment-${comment.id}`}` already exists on both top-level comment divs and reply divs. **No changes needed** for the `id` attributes.

**`TaskDetailPanel.tsx`** — must have `id={`comment-${comment.id}`}` added to each comment container (both top-level and replies), so the copy-link button in the drawer produces correct anchor URLs.

### Handling the hash on load (`TaskDetailPage`)

`TaskDetailPage` already has a `scrollToComment(commentId: string)` helper and `highlightedCommentId` state that apply scroll + amber highlight (light and dark mode already handled via Tailwind classes). **Reuse this existing mechanism** — do not add CSS classes or a new `globals.css` keyframe.

Use a `hasScrolled` ref to ensure the effect only fires once (prevents re-triggering when comments are updated after posting). This is safe because `TaskDetailPage` unmounts on navigation:

```ts
const hasScrolled = useRef(false)

useEffect(() => {
  if (hasScrolled.current) return
  if (!comments.length) return
  const hash = window.location.hash // e.g. "#comment-cm4abc123"
  if (!hash.startsWith('#comment-')) return
  // Strip "#comment-" to get just the comment ID
  const commentId = hash.slice('#comment-'.length)
  hasScrolled.current = true
  scrollToComment(commentId) // reuse existing helper: scrolls + sets highlightedCommentId for 1.5 s
  // If the comment doesn't exist, scrollToComment silently no-ops (it guards with getElementById)
}, [comments, scrollToComment])
```

### Drawer behaviour

The drawer (`TaskDetailPanel`) does **not** handle anchor scrolling — deep links via `#comment-[id]` only work on the standalone task detail page.

The copy link button is still added to comments inside `TaskDetailPanel` (drawer view). The URL it copies always points to the standalone task detail page (`/workspace/[slug]/tasks/[identifier]#comment-[id]`), not to the current drawer context. This is intentional — the drawer has no shareable URL of its own.

---

## Files

| File                                                                            | Action                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/workspace/[workspaceUrl]/projects/[projectId]/page.tsx`                    | **Create** — server component                                                                                                                                                  |
| `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx` | **Create** — client component with AppSidebar                                                                                                                                  |
| `app/workspace/[workspaceUrl]/utils/copyLink.ts`                                | **Create** — clipboard utility                                                                                                                                                 |
| `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`                   | **Modify** — add `useParams` + `next/navigation` import; add `id="comment-[id]"` to comment containers (top-level and replies); add hover copy link button per comment         |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`              | **Modify** — add hover copy link button per comment (top-level and replies); add copy link button to title area; add `hasScrolled` ref + `useEffect` for comment anchor scroll |
| `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`                        | **Modify** — add copy link button to header                                                                                                                                    |
| `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`                                 | **Modify** — add copy link button on project list items (hover)                                                                                                                |

### No type changes required

The existing `ApiProject`, `ApiTask`, and comment types are sufficient. No schema migrations needed — `projectId` is the existing Prisma CUID primary key.

---

## Out of Scope

- Vanity slugs / human-readable project URLs (using projectId keeps it simple and stable)
- Comment anchor scrolling inside the drawer (drawer is not a shareable URL context)
- QR codes or social share previews (og:image, etc.)
- Link expiry or access control beyond existing workspace membership
