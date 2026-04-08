# Document Metadata Display Design

## Overview

Redesign document metadata display across two surfaces: the document editor page and the document list page. The goal is to consolidate scattered metadata into a unified, compact layout and add missing metadata fields (creator info).

## Metadata Fields

The following 5 fields will be displayed:

1. **Creator** — avatar + name (from `createdBy` relation)
2. **Last updated** — relative time (from `updatedAt`)
3. **Project** — project name badge (from `project` relation, optional)
4. **Tags** — color-coded tag badges (from `tags` array)
5. **Editors** — overlapping avatar stack (from `editors` relation)

Fields not displayed: `createdAt`, `visibility` (managed via ShareDialog).

## Document Editor Page

### Layout: Two-row compact metadata area

Replaces the current scattered metadata (`div` with project/visibility/save status) and the separate `TagInput` block. Positioned between the title and the editor content, wrapped with top and bottom borders.

**Row 1:** Creator avatar+name · "Updated Xh ago" · Project badge · Editor avatars · Save status

- All items separated by `·` dot separators
- Creator shows a 20px avatar circle + name in muted text
- Updated time in muted text with "Updated" prefix
- Project badge with border, rounded corners — clickable to navigate to project
- Editor avatars as overlapping 22px circles (max 3, "+N" overflow)
- Save status (italic, muted) appears at the end when active (saving/saved/error)
- All items flow left-to-right, no right-alignment

**Row 2:** Tags (inline editable)

- Reuses existing `TagInput` component
- Color-coded pill badges with "+ Add tag" affordance

### Styling

- Container: `border-t border-b border-border py-2.5 mb-4`
- Row 1: `flex items-center gap-2.5 text-xs text-muted-foreground mb-1.5`
- Row 2: TagInput as-is

### What it replaces

- Current metadata div (lines 284-294 in DocumentEditorPage.tsx): project name, visibility button, save status
- Current TagInput wrapper (lines 297-299): standalone tag section
- Visibility badge removed from this area — already accessible via Share button + ShareDialog

## Document List Page

### List View Changes

Current order: emoji → title/subtitle → tags → collaborators → updated time → menu

New order: emoji → title/subtitle → **creator (avatar+name)** → tags → collaborators → updated time → menu

- Creator: 18px avatar + name in muted text, `flex-shrink-0`
- On mobile (`sm:` breakpoint): hide creator name, show only avatar. Tags and collaborators already hidden on mobile.

### Table View Changes

Current columns: Name | Tags | Collaborators | Created At | Updated At | Menu

New columns: Name | **Creator** | Tags | Collaborators | Updated | Menu

- New Creator column: 18px avatar + name in muted text
- Remove Created At column (not in selected metadata fields)
- Remove redundant Updated At → keep as Updated (already exists)
- Creator column is not sortable (no meaningful sort by creator name currently)

## Data Requirements

### Editor Page

The `ApiDocumentDetail` type already includes `createdBy: { id, name, imageUrl }` and `editors`. The API endpoint (`GET /api/documents/[docId]`) already returns these fields. No backend changes needed.

### List Page

The `ApiDocument` type already includes `createdBy: { id, name, imageUrl }`. The list API (`GET /api/documents`) already fetches and returns this field. No backend changes needed.

## Files to Modify

- `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` — restructure metadata area
- `app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx` — add creator column to both views

## Out of Scope

- Metadata editing (creator and editors are read-only)
- Visibility display in metadata area (handled by ShareDialog)
- Created At timestamp display
- Sidebar metadata changes
