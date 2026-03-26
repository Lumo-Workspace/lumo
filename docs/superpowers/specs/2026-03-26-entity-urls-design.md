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

- Manages `isDarkMode` via localStorage (`CACHE_KEY.darkMode`) — same pattern as `TaskDetailPage`
- Supplies all 5 required `AppSidebar` props:
  - `currentPage`: `'projects'` (highlights Projects in the sidebar nav)
  - `onNavigate`: `router.push(\`/workspace/${workspaceUrl}\`)` for all pages
  - `isDarkMode` / `onToggleDarkMode`: local state + localStorage + classList toggle
  - `unreadCount`: `0`
- On mount, fetches in parallel: members, projects, project tasks
- Breadcrumb: Back chevron → "Projects" (clickable, `router.back()`) → separator → project name
- Renders the existing `ProjectDetailPage` component directly (no duplication)

---

## Copy Link

### Utility

New file: `app/workspace/[workspaceUrl]/utils/copyLink.ts`

```ts
export async function copyLink(url: string): Promise<void> {
  await navigator.clipboard.writeText(url)
}
```

Callers show a toast ("Link copied") and briefly swap the icon to a checkmark (1.5 s).

### Per-entity placement

| Entity      | Trigger                                                                                                          | URL copied                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Project** | Hover on project card in sidebar/list; always-visible on standalone project page header                          | `/workspace/[slug]/projects/[projectId]`                   |
| **Task**    | Always-visible in TaskDrawer header (next to SquareArrowOutUpRight); always-visible on TaskDetailPage title area | `/workspace/[slug]/tasks/[identifier]`                     |
| **Comment** | Hover on individual comment → link icon appears top-right                                                        | `/workspace/[slug]/tasks/[identifier]#comment-[commentId]` |

### Button style

Consistent across all entities:

- `variant='ghost' size='icon' h-7 w-7`
- Icon: `Link` (Lucide) → swaps to `Check` for 1.5 s after click
- Tooltip: `"Copy link"`

---

## Comment Anchor Scroll & Highlight

### Marking comments in the DOM

Each comment container in `TaskDetailPanel` (and `TaskDetailPage`) receives:

```tsx
<div id={`comment-${comment.id}`} ...>
```

### Handling the hash on load (`TaskDetailPage`)

In `TaskDetailPage`, after the comments have loaded:

```ts
useEffect(() => {
  if (!comments.length) return
  const hash = window.location.hash // e.g. "#comment-cm4abc123"
  if (!hash.startsWith('#comment-')) return
  const id = hash.slice('#comment-'.length)
  const el = document.getElementById(`comment-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('comment-highlight')
  setTimeout(() => el.classList.remove('comment-highlight'), 1500)
}, [comments])
```

### Highlight style

```css
/* globals.css or tailwind safelist */
.comment-highlight {
  animation: highlight-fade 1.5s ease-out forwards;
}
@keyframes highlight-fade {
  0% {
    background-color: rgb(254 249 195);
  } /* yellow-100 */
  100% {
    background-color: transparent;
  }
}
```

Dark mode variant uses `rgb(78 63 0 / 0.3)` (amber-tinted dark).

### Drawer behaviour

The drawer (`TaskDetailPanel`) does **not** handle anchor scrolling — deep links via `#comment-[id]` only work on the standalone task detail page.

---

## Files

| File                                                                            | Action                                                                                             |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/projects/[projectId]/page.tsx`                    | **Create** — server component                                                                      |
| `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx` | **Create** — client component with AppSidebar                                                      |
| `app/workspace/[workspaceUrl]/utils/copyLink.ts`                                | **Create** — clipboard utility                                                                     |
| `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`                   | **Modify** — add `id="comment-[id]"` to comment containers; add hover copy link button per comment |
| `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`              | **Modify** — add copy link button to title area; add comment anchor scroll+highlight effect        |
| `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`                        | **Modify** — add copy link button to header                                                        |
| `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`                                 | **Modify** — add copy link button on project list items (hover)                                    |
| `app/globals.css`                                                               | **Modify** — add `.comment-highlight` animation                                                    |

### No type changes required

The existing `ApiProject`, `ApiTask`, and comment types are sufficient. No schema migrations needed — `projectId` is the existing Prisma CUID primary key.

---

## Out of Scope

- Vanity slugs / human-readable project URLs (using projectId keeps it simple and stable)
- Comment anchor scrolling inside the drawer (drawer is not a shareable URL context)
- QR codes or social share previews (og:image, etc.)
- Link expiry or access control beyond existing workspace membership
