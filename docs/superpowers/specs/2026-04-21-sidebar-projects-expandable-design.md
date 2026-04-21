# Expandable Projects Menu in Sidebar

## Summary

The workspace sidebar currently shows `Projects` as a single row that navigates
to the list page. Users want to reach a specific project from anywhere without
detouring through the list. We make the row expandable (like the doc tree in
Documents), list all non-idea projects under it, support drag-to-reorder, and
highlight / auto-expand to the current project when the user is inside a
project detail page.

## Goals

- One-click entry to any project from any page.
- Stable, predictable order by default; manual override via drag.
- Respect the user's collapse preference; only auto-expand transiently when the
  current route is inside a project.
- Single, workspace-wide order (small team; no need for per-user sorting).

## Non-goals

- Project grouping / folders / nested projects.
- Starring / favoriting.
- Surfacing `isIdea` projects here (they stay in the Drafts page).
- Cross-device per-user customization.

## UX Specification

### Collapsed row

- A small caret sits at the left of the row; clicking it toggles expand.
- Clicking anywhere else on the row still navigates to the project list page
  (`/workspace/:url/projects`). The existing navigation behavior is preserved.

### Expanded row

- Lists all projects where `isIdea = false`, sorted by `order ASC, name ASC`.
- Each item: icon (`FolderKanban` or a folder dot) + project name (truncated).
  A drag grip becomes visible on hover.
- Clicking an item navigates to that project's standalone detail page
  (`/workspace/:url/project/:slug`).
- The last row is `+ New project`. On pages rendered by `WorkspaceApp`, it calls
  an `onNewProject` prop that opens the existing `NewProjectModal`. On standalone
  pages (TaskDetail, ProjectDetailStandalone) that don't host the modal, it
  navigates to `/workspace/:url/projects?new=1`; `ProjectsPage` reads the
  `new` search param on mount and opens the modal, then strips the param
  from the URL with `router.replace`. This keeps the sidebar affordance
  identical everywhere.
- Empty state: show a disabled `No projects yet` row above `+ New project`.

### Expand state persistence

- Stored in `localStorage` under `lumo:sidebarProjectsExpanded` as `"0"` / `"1"`.
- Default: collapsed.
- Toggling the caret writes to localStorage immediately.

### Auto-expand on project pages

- When the user is on `project-detail` (WorkspaceApp route) or the standalone
  `/project/:slug` / `/project/:slug/tasks/:id` routes, force the list to
  render expanded regardless of stored preference.
- Do **not** write to `localStorage`. Leaving the project page restores the
  user's last explicit collapse preference on the next paint.
- Implementation: a derived `expanded = storedExpanded || isOnProjectRoute`.

### Current project highlight

- When `pathToPage(...)` returns `page: 'project-detail'` with a `projectSlug`,
  match against `projects` by `slugify(p.name) === projectSlug` and mark that
  row with the shadcn `SidebarMenuSubButton` `isActive` variant.
- For the standalone routes (`/project/:slug`, `/project/:slug/tasks/:id`), the
  sidebar runs inside `ProjectDetailStandalonePage` and `TaskDetailPage`. It
  receives the same pathname via `usePathname()`, extracts the slug, and uses
  the same match.

### Drag-to-reorder

- Uses `@dnd-kit/sortable` (already a dependency of the board).
- Optimistic local reorder, then `PATCH /api/projects/reorder` with the new
  ordered ids. On server error, revert the local order and toast the error.
- Drag is scoped to the expanded list only — no cross-container drag.

### Sorting semantics

- DB stores an `order` integer on each `Project`. List queries order by
  `(order ASC, name ASC)`.
- Migration backfill: assign `order` values 1, 2, 3… by `name ASC` per
  workspace so the initial rendering matches the prior alphabetical list.
- New projects: insert at the end with `order = (max(order) + 1)` in the
  workspace. Matches Linear's "new items go to the bottom" convention; once a
  user drags, the list is fully user-ordered anyway.

### Multi-member sync

- After a successful reorder, the service publishes a
  `projects-reordered` event on the `workspace-{slug}` Pusher channel with
  `{ orderedIds }`. The slug (= `Workspace.slug`, which matches the
  `workspaceUrl` route param) is used instead of the workspace id so the
  sidebar can subscribe without a round-trip to resolve the id. Other
  members' sidebars merge the new order into their local `projects` state.

## Data Model

```prisma
model Project {
  // ...existing fields
  order Int @default(0)

  @@index([workspaceId, order])
}
```

- `@default(0)` is a safety default for the migration (which explicitly
  backfills); future code paths always write an explicit value.
- The composite index speeds up the per-workspace ordered list.

Migration plan:

1. Add column with `DEFAULT 0`.
2. Backfill per workspace:
   `UPDATE "Project" SET "order" = t.rn FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY "workspaceId" ORDER BY name) AS rn FROM "Project") t WHERE "Project".id = t.id;`
3. Create the index.
4. No app downtime required — old reads still work without the column;
   deploy migration, then deploy app.

## API

### `PATCH /api/projects/reorder`

- Body (Zod): `{ orderedIds: z.array(z.string().cuid()).min(1) }`.
- Auth: current user must be a member of the workspace that owns all the ids.
- Behavior:
  - Resolve all project ids, verify they belong to one single workspace and the
    user is a member.
  - In a transaction, set `order` for each id to its index in `orderedIds`
    (1-based), leaving any projects NOT in `orderedIds` with their existing
    values. (Caller always passes the full visible list; the extra projects
    case protects against stale state.)
  - Publish `projects-reordered` on `workspace-{workspaceId}`.
  - Return `{ ok: true }`.
- Errors: `400` for malformed input or mixed-workspace ids, `403` for
  non-member, `404` if any id is missing.

## Layers

| Layer      | File                                                                       | Change                                                                               |
| ---------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Repository | `lib/repositories/project.repository.ts`                                   | Add `reorder(workspaceId, orderedIds)`; update `list` to sort by `order`.            |
| Service    | `lib/services/project.service.ts`                                          | Set `order` on create; add `reorderProjects` with workspace scope check.             |
| Route      | `app/api/projects/reorder/route.ts`                                        | Thin handler: auth → Zod → service → response.                                       |
| Client     | `lib/api-client/projects.ts`                                               | Add `projectsClient.reorder(orderedIds)`.                                            |
| Realtime   | `lib/integrations/pusher.ts`                                               | Extend `WorkspaceEvent` union with `projects-reordered`.                             |
| Sidebar    | `app/workspace/[workspaceUrl]/components/Sidebar.tsx`                      | Render the new `ProjectsSidebarGroup` in place of the single row.                    |
| Sidebar    | `app/workspace/[workspaceUrl]/components/sidebar/ProjectsSidebarGroup.tsx` | New: expand/collapse, list, drag, highlight, new-project row.                        |
| Hook       | `app/workspace/[workspaceUrl]/hooks/useSidebarProjects.ts`                 | Shared read of the `lumo:projects` cache + background refresh + pusher subscription. |
| i18n       | `messages/*.json`                                                          | `sidebar.newProject`, `sidebar.noProjects`.                                          |

### Rationale for the split

- `Sidebar.tsx` is already 369 lines and handles workspace header, top-level
  items, and the workspace group. The new subcomponent owns a distinct concern
  (expand + drag + list), so it belongs in its own file.
- `useSidebarProjects` avoids hoisting `useProjects` into multiple page shells.
  Both `WorkspaceApp`-rendered pages and the standalone pages (TaskDetailPage,
  ProjectDetailStandalonePage) already render `AppSidebar`; centralizing the
  fetch/cache here keeps the sidebar self-sufficient and dedup'd by the
  existing `CACHE_KEY.projects` localStorage entry.

## Error Handling

- Reorder API failure: revert optimistic order, `toast.error('Could not save order')`.
- Pusher event for a project id we don't know about (e.g., a project created on
  another client while ours was stale): ignore the missing id in the merge.
- If `useSidebarProjects` fails to fetch and cache is empty, the expanded list
  shows the empty state; the caret is still usable.

## Testing

Jest unit tests (the project's current standard — no RTL configured):

- `__tests__/lib/repositories/project.repository.test.ts`
  - `list` returns projects ordered by `order ASC, name ASC`.
  - `reorder` writes new order values for the passed ids only.
- `__tests__/lib/services/project.service.test.ts`
  - `createProject` sets `order = max+1` per workspace.
  - `reorderProjects` rejects mixed-workspace ids.
  - `reorderProjects` rejects non-member.
  - `reorderProjects` emits the pusher event.
- `__tests__/app/api/projects/reorder/route.test.ts`
  - 400 on malformed body.
  - 403 when user is not a workspace member.
  - 200 with `{ ok: true }` on success.

Manual QA checklist (UI):

- Default: Projects collapsed on first load; caret toggles.
- Preference persists across refresh.
- Auto-expand on project detail and standalone project/task pages; current row
  highlighted; leaving the page collapses back to the stored preference.
- Drag reorders locally, persists to server, and syncs to a second tab via
  Pusher.
- `+ New project` opens the modal directly on `WorkspaceApp` pages; on
  standalone pages (task/project detail) it navigates to `/projects?new=1`
  and the list page opens the modal on mount, then strips `?new=1`.
- Empty workspace shows `No projects yet` + `+ New project`.
- `isIdea` projects are not listed.

## Rollout

- Single PR. Migration ships with the code change.
- No feature flag — the previous single-row behavior stays reachable by
  keeping the row collapsed by default, so the change is additive at worst.
