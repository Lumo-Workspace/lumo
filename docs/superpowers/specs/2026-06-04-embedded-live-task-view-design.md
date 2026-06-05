# 文档内嵌实时任务视图（query → 活任务列表） — Design

- **Task**: LUM-224
- **Milestone**: 文档编辑器优化
- **Date**: 2026-06-04
- **Status**: Design approved, pending spec review

## 1. Summary

A custom Tiptap block that users insert into a document via the slash menu. The
block stores a **query configuration** (project / milestone / status / tag /
assignee / priority filters + view mode + group-by). At render time it executes
a workspace-wide task query and renders a **live-refreshing** task list or
kanban — the PM equivalent of a Notion database view.

Only the query config is persisted (inside the document HTML). The task data is
always fetched live and never serialized into the document.

This is a "moat" feature (Tier3, 飞书/Notion 对标). It is large, so it is
decomposed into four independently shippable phases (one PR each).

## 2. Goals / Non-goals

### Goals

- Insert a "Task View" block via the slash command (`/task view`).
- Configure filters across six dimensions: **project, milestone, status, tag,
  assignee, priority**. Empty project filter = whole workspace.
- Render results as a **list** (grouped) or **kanban** (grouped by status).
- **Live refresh**: polling (`refetchInterval`, gated to page visibility) plus
  manual refresh, with **optimistic update** on kanban drag-to-change-status.
- The block renders in both the editor and the read-only / shared document
  viewer.

### Non-goals (this spec)

- Real-time push (websocket/SSE) — not in the codebase; out of scope.
- Saved/named views reusable across documents.
- Sort configuration UI beyond a sensible default order (deferred; default
  `order asc`).
- Grouping by anything other than status / project / milestone / none.
- Cross-workspace queries.

## 3. Key design decisions

### 3.1 Persistence: config as a single JSON data-attribute

The document editor stores content as **HTML** (`Document.content String? @db.Text`,
serialized via `editor.getHTML()`), not ProseMirror JSON. The `taskView` node is
an **atom block** (no editable child content). Its entire config is serialized to
one attribute:

```html
<div
  data-type="task-view"
  data-config='{"projectIds":[...],"statuses":[...],...}'
></div>
```

- `addAttributes()` declares a single `config` attribute.
- `parseHTML` reads + `JSON.parse`s `data-config`.
- `renderHTML` emits the holder `<div>` with `data-type="task-view"` and
  `data-config` = `JSON.stringify(config)`.
- The dynamic task data rendered by the React NodeView is **never** part of
  `getHTML()` output — only the holder div round-trips. (Atom + `renderHTML`
  guarantees Tiptap serializes the holder element, not the live DOM.)

A malformed / version-mismatched `data-config` must degrade gracefully: parse
failures fall back to a default config and the block renders an error/empty
state rather than throwing (which would corrupt the whole document render).

### 3.2 Backend: new workspace-wide task query, scoped to the viewer

The existing task list API is per-project (`GET /api/projects/[id]/tasks`) and the
repository supports only sprint/milestone filters — no status/tag/assignee/
priority and no cross-project query. We add a workspace-wide query.

**Permission model (security-critical):** the block stores a query, but it always
executes **as the current viewer, scoped to what that viewer can see in the
workspace** — never as the document author. A document shared with a
limited/external member must not leak tasks that member cannot otherwise access.
The service layer applies the viewer's workspace-visibility scoping; the stored
config only narrows, never widens, that scope.

### 3.3 Refresh: polling + optimistic update

- React Query `useWorkspaceTasks(config)` with `refetchInterval` (e.g. 30s),
  gated so it only polls while the document/tab is visible
  (`refetchIntervalInBackground: false`) plus `refetchOnWindowFocus`.
- A manual refresh affordance on the block.
- Kanban drag-to-change-status performs an **optimistic** cache update, then
  calls the existing task-status update mutation; on error it rolls back and
  surfaces a toast.

## 4. Architecture & data flow

Strictly follows the project's layered architecture (Component → API Client →
API Route → Service → Repository → Prisma):

```
TaskViewBlock (React NodeView)
  → useWorkspaceTasks(config)              hooks/ (React Query, polling + optimistic)
  → workspaceTasksClient.list(filters)     lib/api-client/
  → GET /api/workspaces/[workspaceUrl]/tasks?…   app/api/ (thin: auth → Zod → service → response)
  → taskService.findForWorkspace(viewer, filters)   lib/services/ (permission scoping, business logic)
  → taskRepository.findByWorkspaceWithFilters(...)   lib/repositories/ (Prisma, select only needed fields)
```

Kanban drag write-back reuses the existing task-status update path (mutation →
client → route → service → repository); no new write endpoint is introduced.

## 5. Phased decomposition (one PR per phase)

### Phase 1 — Backend: workspace-wide task query ✅ independently shippable/testable

- **Repository**: `findByWorkspaceWithFilters(workspaceId, filters, viewerActorId)`
  supporting `projectIds[]`, `milestoneIds[]`, `statuses[]`, `tagIds[]`,
  `assigneeActorIds[]`, `priorities[]`. Each filter omitted/empty = no constraint
  on that dimension. Uses `select`/`include` for only the fields the block needs.
- **Service**: `taskService.findForWorkspace(viewer, filters)` — applies viewer
  workspace-visibility scoping, validates the filter set, returns the task list.
  No Prisma in the route; throws via the `Object.assign(new Error(msg), { status })`
  pattern.
- **API route**: `GET /api/workspaces/[workspaceUrl]/tasks` — thin: auth check →
  Zod-validate query params → call service → return response.
- **Validation**: Zod schema for the filter set (`lib/validation/`).
- **API client + hook**: `workspaceTasksClient.list()` + `useWorkspaceTasks()`
  (React Query). Polling/optimistic wiring may be stubbed here and completed in P4.
- **Tests**: repository filter combinations, service permission scoping, route
  validation. (Jest; Prisma mocked per existing patterns.)

### Phase 2 — Read-only list block ✅ end-to-end vertical slice

- Custom `taskView` atom node (`lib/editor/nodes/task-view.ts`) with the single
  `config` JSON attribute + `parseHTML`/`renderHTML` round-trip + graceful parse
  fallback.
- `ReactNodeViewRenderer(<TaskViewBlock>)` (`lib/editor/nodes/task-view-block.tsx`)
  rendering a **grouped list** using `useWorkspaceTasks`.
- Slash command entry `/task view` in `getSlashCommandItems()`.
- Register the extension in `getBaseExtensions()` so it ships in editor **and**
  read-only viewer.
- Loading / empty / error states; click a row → navigate to task detail.
- Starts with a minimal/default config (full config UI lands in P3).
- **Tests**: serialization round-trip (config survives `getHTML` → reload),
  render states (jsdom component test, per existing editor test patterns).

### Phase 3 — Config panel ✅

- Inline popover config UI on the block: six-dimension filter pickers
  (project, milestone, status, tag, assignee, priority) + view mode (list/kanban)
  - group-by (status/project/milestone/none).
- `updateAttributes({ config })` persists changes; the live query re-runs on
  config change.
- **Tests**: config edits update attrs; attr changes drive the query args.

### Phase 4 — Kanban + polling + optimistic drag ✅

- Kanban rendering grouped by status, reusing **dnd-kit** (already used in the
  board — see project memory on the dnd-kit board virtualization).
- `refetchInterval` polling, visibility-gated; manual refresh button.
- Drag-to-change-status: optimistic cache update → existing status-update
  mutation → rollback + toast on error.
- **Tests**: optimistic update applies/rolls back (use `waitFor`, per the
  RQ-optimistic-test memory); polling gated to visibility.

## 6. Data shapes

### Stored config (in `data-config`)

```ts
interface TaskViewConfig {
  version: 1
  view: 'list' | 'kanban'
  groupBy: 'status' | 'project' | 'milestone' | 'none'
  filters: {
    projectIds?: string[]
    milestoneIds?: string[]
    statuses?: ApiStatus[] // 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
    tagIds?: string[]
    assigneeActorIds?: string[]
    priorities?: ApiPriority[] // 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  }
}
```

Empty/omitted filter = no constraint on that dimension. Unknown future fields are
ignored on parse; missing fields fall back to defaults.

### Query response

Reuses the existing `ApiTask` shape (id, title, status, priority, projectId,
assignee, milestoneId, number, teamIdentifier, …). Response: `{ tasks: ApiTask[] }`
(flat list; grouping is done client-side by the block).

## 7. Error handling

- **Malformed config**: fall back to default config + render an inline error
  banner; never throw during document render.
- **Query failure**: block shows an error state with a retry; the rest of the
  document is unaffected.
- **Empty result**: explicit empty state ("No tasks match these filters").
- **Permission**: viewer-scoped query simply returns fewer rows; no separate
  "forbidden" UI is needed since the config can only narrow visible scope.
- **Optimistic drag failure (P4)**: roll back the cache and toast.

## 8. i18n & tokens

- All user-facing strings via `intl.formatMessage`; add keys to **every** locale
  file in `lib/i18n/`, not just en/zh-CN.
- Use semantic Tailwind tokens (no raw zinc/gray) to pass `lint:tokens`.

## 9. Testing strategy

- Jest, `__tests__`, `*.test.ts(x)`; every new function gets at least one test.
- Repository: filter-combination coverage with Prisma mocked.
- Service: permission-scoping assertions.
- Route: Zod validation (accept/reject).
- Node: HTML round-trip of config; render states.
- Hook: polling gating + optimistic apply/rollback (`waitFor`).
- Note (project memory): run `tsc --noEmit` — `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` are on and Jest/SWC won't catch those.

## 10. Risks & open questions

- **Workspace-wide query performance**: a fully-unfiltered block lists every task
  in the workspace. P1 must paginate or cap (e.g. a sane `take` limit) and the
  block should communicate truncation rather than silently capping.
- **HTML serialization of an atom NodeView**: must verify `getHTML()` emits only
  the holder div with `data-config` and not the live React DOM — covered by the
  P2 round-trip test.
- **dnd-kit reuse in a NodeView** (P4): the board's virtualized dnd-kit setup may
  need adaptation inside an editor NodeView (contentEditable interactions); to be
  validated in P4.
