# Global Document Tree — Design Spec

## Overview

Replace the current "follow-mode" DocumentTOC sidebar with a global document tree in the Feishu/Lark style. The tree lives in the second column (same position as today) and is independent of the currently open document. It shows the complete workspace document hierarchy, supports lazy loading, cross-parent drag-and-drop, and optimistic updates.

## Architecture

### Layout

```
┌──────────┬──────────────┬─────────────────────────┐
│ Main Nav │ Global Tree  │ Document Editor          │
│ (180px)  │ (220px)      │ (flex-1)                │
│          │              │                          │
│ Tasks    │ PAGES        │ Breadcrumb               │
│ Inbox    │ ▼ 项目计划   │ Title                    │
│ Projects │ │ Q1 目标    │ Content...               │
│ Docs ◀── │ │ Q2 目标 ◀──│                          │
│          │ │  └ 排期    │                          │
│          │ ▶ 设计规范 5 │                          │
│          │ + 新建文档   │                          │
└──────────┴──────────────┴─────────────────────────┘
```

- Tree sidebar position: replaces current DocumentTOC location (second column, right of main nav)
- Tree state is managed at WorkspaceApp level, independent of DocumentEditorPage
- Tree is visible on both the documents list page and document editor page

### State Lifting

Current state lives in DocumentEditorPage and only knows about ancestors + children of the open doc. New design:

- `WorkspaceApp` owns the global tree state: `treeNodes: Map<string | null, TreeNode[]>` (parentId → children)
- `WorkspaceApp` owns expanded node set: `expandedIds: Set<string>` (persisted to localStorage)
- `DocumentEditorPage` no longer manages tree data or ancestors — it receives only the `documentId` and editor-related callbacks
- Tree sidebar is rendered by `WorkspaceApp` directly, not inside `DocumentEditorPage`

## Data Model

### TreeNode

```typescript
interface TreeNode {
  id: string
  title: string
  emoji: string | null
  parentId: string | null
  sortOrder: number
  childCount: number // from _count.children
  children?: TreeNode[] // populated when expanded/loaded
  isLoading?: boolean // true while lazy-loading children
}
```

### API

#### `GET /api/documents/tree`

Returns the initial tree: root nodes, their children (depth 2), plus the full ancestor path of a specified document.

**Query params:**

- `expandedDocId` (optional) — current document ID; server returns the full path from root to this doc with all intermediate nodes expanded

**Response:**

```json
{
  "roots": [
    {
      "id": "...",
      "title": "项目计划",
      "emoji": "📋",
      "parentId": null,
      "sortOrder": 0,
      "childCount": 3,
      "children": [
        { "id": "...", "title": "Q1", "childCount": 0, "children": [] },
        {
          "id": "...",
          "title": "Q2",
          "childCount": 2,
          "children": [{ "id": "...", "title": "排期", "childCount": 0 }]
        },
        { "id": "...", "title": "Q3", "childCount": 0, "children": [] }
      ]
    },
    {
      "id": "...",
      "title": "设计规范",
      "emoji": "🎯",
      "parentId": null,
      "sortOrder": 1,
      "childCount": 5
      // no children — collapsed, only childCount
    }
  ]
}
```

**Logic:**

1. Fetch all root documents (`parentId: null`) with their immediate children
2. If `expandedDocId` is provided, walk up to find its root, then include all nodes along the path with their children expanded
3. Nodes not along the expanded path return only `childCount`, no `children` array

#### `GET /api/documents?parentId=xxx` (existing, unchanged)

Used for lazy loading when a node is expanded. Returns flat list of children for the given parentId. Add `_count.children` to the response if not already present.

#### `PATCH /api/documents/[id]/move` (existing, unchanged)

Used for cross-parent drag-and-drop. Accepts `{ parentId, sortOrder }`.

### Caching

- Cache key: `CACHE_KEY.documentTree` — stores the full tree structure
- On first load: read cache → render immediately → fetch `/api/documents/tree` in background → merge
- On lazy expand: cache the loaded children into the tree cache
- On create/delete/move/rename: optimistically update cached tree

## Visual Design

### Style (Feishu/Lark)

- **Indentation:** `depth * 16px` left padding per level
- **Level connector:** `border-left: 1.5px solid border-color` on each nested group, creating a continuous vertical line showing hierarchy
- **Current document:** Blue background highlight (`bg-accent` / `bg-blue-50`), blue text, font-weight medium
- **Collapsed with children:** Show child count badge on the right (small gray pill: `bg-muted text-muted-foreground rounded-full px-1.5 text-[10px]`)
- **Hover:** Show `+` icon on the right side of the row
- **Expand/collapse chevron:** `ChevronRight` rotates 90° when expanded, transition animation
- **Leaf node (no children):** No chevron, extra left padding to align with siblings that have chevrons

### Tree Item Row

```
[chevron] [emoji/icon] [title...                ] [badge/+]
```

- Row height: `py-1.5` (~32px)
- Font size: `text-xs` (12px)
- Truncate long titles with `truncate`

## Drag and Drop

### Same-level reorder

- Drag a node up/down within its siblings
- Show blue insertion line between nodes indicating drop position
- On drop: reorder `sortOrder` values, call `PATCH /api/documents/[id]` with `childOrder`

### Cross-parent drag

- Drag a node onto another node to make it a child
- When hovering over a collapsed node for 500ms, auto-expand it
- Drop zones:
  - **Between nodes:** Insert as sibling at that position (blue line indicator)
  - **On a node:** Insert as last child of that node (node gets blue border/highlight)
- On drop: call `PATCH /api/documents/[id]/move` with new `parentId` and `sortOrder`
- Prevent dropping a node onto itself or its own descendants (circular reference check)

### Visual feedback

- Dragged item: `opacity-40`
- Drop target (on node): `ring-2 ring-blue-400 bg-blue-50/50`
- Drop target (between): 2px blue horizontal line at insertion point

## Optimistic Updates

### Create document

1. Generate `temp-{uuid}`, insert into tree at correct position
2. Navigate to new doc immediately
3. Background: POST to API, on success swap temp ID with real ID in tree + URL

### Delete document

1. Remove node and all descendants from tree immediately
2. If deleting current/ancestor doc, navigate to parent or docs list
3. Background: DELETE API call

### Rename document

1. Update title in tree immediately
2. Background: PATCH API call

### Move document (drag-and-drop)

1. Remove from old parent's children, insert into new parent's children at drop position
2. Update `parentId` and `sortOrder` in local tree
3. Background: PATCH move API call

## Expanded State Persistence

- Store `expandedIds: string[]` in `localStorage` under `CACHE_KEY.treeExpanded`
- On page load: restore expanded state, lazy-load children for any expanded nodes not in cache
- When navigating to a document: auto-expand its ancestor path (add ancestor IDs to expanded set)

## Component Structure

```
WorkspaceApp
├── MainNav (existing)
├── GlobalDocTree (new, replaces DocumentTOC)
│   ├── TreeHeader ("PAGES" + new doc button)
│   └── TreeNode (recursive)
│       ├── TreeItemRow (chevron + icon + title + badge/+)
│       └── TreeChildren (indented group with border-left)
└── DocumentEditorPage (simplified, no tree props)
    ├── DocumentBreadcrumb
    └── DescriptionEditor
```

### Files to create/modify

- **New:** `app/workspace/[workspaceUrl]/components/document/GlobalDocTree.tsx`
- **New:** `app/api/documents/tree/route.ts`
- **Modify:** `app/workspace/[workspaceUrl]/WorkspaceApp.tsx` — add tree state, render GlobalDocTree
- **Modify:** `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` — remove tree props/rendering
- **Modify:** `app/workspace/[workspaceUrl]/constants.ts` — add `API.documents.tree`, `CACHE_KEY.documentTree`, `CACHE_KEY.treeExpanded`
- **Delete:** `app/workspace/[workspaceUrl]/components/document/DocumentTOC.tsx` (replaced by GlobalDocTree)

## Edge Cases

- **Empty workspace:** Show "No documents yet" message with prominent "Create first document" button
- **Deep nesting (5+ levels):** Cap visual indentation at depth 5, horizontal scroll if needed
- **Drag to root:** Allow dragging a nested doc to the root level (parentId = null)
- **Concurrent edits:** Background refresh on window focus to catch changes from other users
- **Temp ID in tree:** During optimistic create, if user clicks the temp node before API returns, show the optimistic doc with empty content
