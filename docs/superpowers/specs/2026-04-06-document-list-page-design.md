# Document List Page Redesign

## Overview

Redesign the document list page (`DocumentsPage`) to improve information density, visual style, layout flexibility, and interaction quality. Add two switchable view modes (list + table), sorting controls, document tags, and collaborator avatars.

## Current State

The existing page shows documents as simple cards with: emoji, title, subtitle (project or visibility category), creator avatar, and relative update time. No sorting, no tags, no collaborator display, no view switching.

## Design Decisions

| Decision        | Choice                                                           |
| --------------- | ---------------------------------------------------------------- |
| Core purpose    | Quick document finding + at-a-glance status                      |
| View modes      | Two: list (default) + table, switchable                          |
| List style      | Compact single-row (option A)                                    |
| Table style     | Simple 5-column (option A)                                       |
| New data fields | Tags, collaborator avatars, created time                         |
| Sort options    | Recently updated (default), recently created, title alphabetical |

## View Modes

### List View (Default)

Compact single-row layout. Each row contains all information in one line:

```
[emoji] [title]                    [tag badges] [collaborator avatars] [relative time]
```

- Emoji: document icon, fallback `📄`
- Title: truncated with `text-ellipsis`, medium weight
- Tags: colored badge pills, max 3 visible ("+N" overflow)
- Collaborators: stacked avatars (initials fallback), max 3 visible ("+N" overflow)
- Time: relative format ("3 分钟前", "昨天", etc.) — shows `updatedAt`
- Hover: subtle background highlight, show action menu (⋯)
- Row click navigates to document editor

### Table View

5-column table with sortable headers:

| Column   | Content                           | Sortable                       |
| -------- | --------------------------------- | ------------------------------ |
| 文档名称 | emoji + title                     | No (use title sort in toolbar) |
| 标签     | colored badge pills               | No                             |
| 协作者   | stacked avatars                   | No                             |
| 创建时间 | date format (MM-DD or YYYY-MM-DD) | Yes (click header)             |
| 更新时间 | relative time format              | Yes (click header)             |

- Active sort column header is bold with direction arrow (↑/↓)
- Inactive sortable headers show ↕ on hover
- Row click navigates to document editor
- Row hover: subtle background highlight

## Toolbar

Layout: filter tabs on the left, sort + view switch on the right.

```
[全部] [个人] [已分享] [工作区]          排序: [最近更新 ▾]  [☰ | ⊞]
[🔍 搜索文档...]
```

### Filter Tabs

Unchanged from current: ALL, PRIVATE, SHARED, WORKSPACE. Active tab gets dark background.

### Sort Control

Dropdown or segmented selector with three options:

- **最近更新** (default) — sort by `updatedAt` desc
- **最近创建** — sort by `createdAt` desc
- **标题** — sort by `title` asc (alphabetical)

In table view, clicking a sortable column header also changes the active sort and toggles asc/desc.

### View Switch

Two icon buttons (list ☰ / table ⊞), active view highlighted. User preference persisted to localStorage.

### Search

Unchanged from current: text input that filters documents by title match. Positioned below the toolbar row.

## Tag System (New Feature)

### Data Model

Add a `tags` field to the Document model as a JSON string array:

```prisma
model Document {
  // ... existing fields
  tags  String[]  @default([])
}
```

Using a simple string array (not a Tag relation table) because:

- Tags are lightweight labels, not structured entities
- No need for tag descriptions, permissions, or cross-workspace sharing
- Simpler queries and no join overhead
- Good enough for small team use case

### Tag Display

- Colored badge pills with rounded corners
- Color auto-assigned based on tag string hash (deterministic, no manual color picking)
- Preset palette: 8 colors (blue, green, yellow, purple, pink, orange, teal, red)
- Max 3 tags visible in list/table row, "+N" pill for overflow
- Full tag list visible on hover tooltip

### Tag Color Assignment

```typescript
const TAG_COLORS = [
  { bg: '#dbeafe', text: '#1d4ed8' }, // blue
  { bg: '#dcfce7', text: '#166534' }, // green
  { bg: '#fef3c7', text: '#92400e' }, // yellow
  { bg: '#e0e7ff', text: '#3730a3' }, // indigo
  { bg: '#fce7f3', text: '#9d174d' }, // pink
  { bg: '#ffedd5', text: '#9a3412' }, // orange
  { bg: '#ccfbf1', text: '#115e59' }, // teal
  { bg: '#fee2e2', text: '#991b1b' }, // red
]

function getTagColor(tag: string) {
  const hash = tag.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return TAG_COLORS[hash % TAG_COLORS.length]
}
```

### Tag Editing

- In document editor page: add a tag input area in the metadata section (below title, near visibility badge)
- Type to add tags, click X to remove
- Autocomplete from existing tags in the workspace (query distinct tags)
- No separate tag management page (YAGNI)

## Collaborator Avatars

Display people who have actually edited the document, not just share members.

### Data Model

Add a many-to-many relation to track editors:

```prisma
model Document {
  // ... existing fields
  editors        DocumentEditor[]
}

model DocumentEditor {
  id           String          @id @default(cuid())
  document     Document        @relation(fields: [documentId], references: [id], onDelete: Cascade)
  documentId   String
  member       WorkspaceMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  memberId     String
  lastEditedAt DateTime        @default(now())

  @@unique([documentId, memberId])
}
```

When a document is saved (PATCH content), upsert into `DocumentEditor` with the current member and update `lastEditedAt`. This gives us the list of everyone who has ever edited the document.

### Display

- Source: `document.editors` → member info (name, imageUrl)
- Avatar: 22px circle, image or initials fallback
- Stacked with -6px negative margin overlap
- Max 3 visible, "+N" counter badge for overflow
- Ordered by `lastEditedAt` desc (most recent editor first)
- Tooltip on hover shows full name list

## API Changes

### GET /api/documents (list endpoint)

Add to the Prisma query:

- `select` the new `tags` field
- `include` editors with member name/imageUrl (limited fields via `select`)

Response shape change per document:

```typescript
{
  // ... existing fields
  tags: string[]
  createdAt: string    // already returned
  editors: Array<{
    member: { id: string; name: string; imageUrl: string | null }
    lastEditedAt: string
  }>
}
```

### PATCH /api/documents/[id]

Add `tags` to the update validation schema:

```typescript
tags: z.array(z.string().max(30)).max(20).optional()
```

## Component Architecture

### Updated Components

- **DocumentsPage** — add sort state, view mode state, pass to children
- **DocumentListRow** — new component for list view row (replaces current card)
- **DocumentTable** — new component for table view
- **DocumentToolbar** — extracted toolbar with tabs, sort, view switch, search

### New Components

- **TagBadge** — colored tag pill component
- **TagInput** — tag editor for document editor page (autocomplete + add/remove)
- **CollaboratorAvatars** — stacked avatar group component
- **SortSelect** — sort dropdown component
- **ViewToggle** — list/table switch component

### State Management

- `viewMode: 'list' | 'table'` — persisted to localStorage (`lumo:doc-view-mode`)
- `sortBy: 'updatedAt' | 'createdAt' | 'title'` — persisted to localStorage (`lumo:doc-sort`)
- `sortDir: 'asc' | 'desc'` — derived (updatedAt/createdAt default desc, title default asc)
- Sorting is client-side (document list is already fully loaded)

## i18n Keys

```
documents.sortUpdated: "最近更新" / "Recently Updated"
documents.sortCreated: "最近创建" / "Recently Created"
documents.sortTitle: "标题" / "Title"
documents.viewList: "列表" / "List"
documents.viewTable: "表格" / "Table"
documents.colName: "文档名称" / "Document"
documents.colTags: "标签" / "Tags"
documents.colCollaborators: "协作者" / "Collaborators"
documents.colCreatedAt: "创建时间" / "Created"
documents.colUpdatedAt: "更新时间" / "Updated"
documents.tagPlaceholder: "添加标签..." / "Add tag..."
documents.moreCollaborators: "+{count}" / "+{count}"
documents.moreTags: "+{count}" / "+{count}"
```

## Migration

```sql
-- Add tags array to Document
ALTER TABLE "Document" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Create DocumentEditor table for tracking editors
CREATE TABLE "DocumentEditor" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "lastEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentEditor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentEditor_documentId_memberId_key" ON "DocumentEditor"("documentId", "memberId");
ALTER TABLE "DocumentEditor" ADD CONSTRAINT "DocumentEditor_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentEditor" ADD CONSTRAINT "DocumentEditor_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "WorkspaceMember"("id") ON DELETE CASCADE;
```

## Out of Scope

- Tag-based filtering in toolbar (can add later)
- Drag-to-reorder in list view (tree handles ordering)
- Bulk operations (select multiple, batch delete/tag)
- Column resizing or column visibility settings in table view
