# Document Metadata Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate document metadata into a unified two-row layout in the editor page, and add creator info to the document list page.

**Architecture:** Pure frontend changes across two components. The editor page replaces scattered metadata + TagInput with a bordered two-row block. The list page adds a creator column to both list and table views. No backend or type changes needed — all data is already available.

**Tech Stack:** React, TypeScript, Tailwind CSS, existing shadcn/ui components

---

## File Map

| File                                                                   | Action | Responsibility                                                          |
| ---------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` | Modify | Replace metadata div (lines 283-299) with two-row metadata block        |
| `app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx`      | Modify | Add creator to list view, replace Created At with Creator in table view |

---

### Task 1: Restructure Editor Page Metadata Area

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx:240-310`

This task replaces lines 283-299 (the current metadata div + TagInput wrapper) with a unified two-row metadata block.

- [ ] **Step 1: Add formatRelativeTime helper and import CollaboratorAvatars**

At the top of `DocumentEditorPage.tsx`, add the import for `CollaboratorAvatars` and a `getInitials` import. Then add a local `formatRelativeTime` function before the component (same pattern as `DocumentsPage.tsx`):

```tsx
import { CollaboratorAvatars } from '../document/CollaboratorAvatars'
import { getInitials } from '@/lib/utils/getInitials'
```

Add this function above the `DocumentEditorPage` component:

```tsx
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}
```

- [ ] **Step 2: Replace the metadata div and TagInput wrapper**

Replace lines 283-299 (the `{/* Metadata */}` div and `{/* Tags */}` div) with the new two-row metadata block:

```tsx
{
  /* Metadata */
}
;<div className='border-t border-b border-border py-2.5 mb-4'>
  {/* Row 1: Creator · Updated · Project · Editors · Save status */}
  <div className='flex items-center gap-2.5 text-xs text-muted-foreground mb-1.5 flex-wrap'>
    {/* Creator */}
    <span className='flex items-center gap-1.5 shrink-0'>
      <span className='size-5 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0'>
        {doc.createdBy.imageUrl ? (
          <img
            src={doc.createdBy.imageUrl}
            alt={doc.createdBy.name}
            className='w-full h-full object-cover'
          />
        ) : (
          <span className='text-[9px] font-medium'>
            {getInitials(doc.createdBy.name)}
          </span>
        )}
      </span>
      <span>{doc.createdBy.name}</span>
    </span>

    <span className='text-border'>·</span>

    {/* Updated time */}
    <span className='shrink-0'>
      {intl.formatMessage({ id: 'documentEditor.updated' })}{' '}
      {formatRelativeTime(doc.updatedAt)}
    </span>

    {/* Project badge (if linked) */}
    {doc.project && (
      <>
        <span className='text-border'>·</span>
        <span className='bg-muted rounded px-2 py-0.5 shrink-0'>
          {doc.project.name}
        </span>
      </>
    )}

    {/* Editor avatars (if any) */}
    {doc.editors && doc.editors.length > 0 && (
      <>
        <span className='text-border'>·</span>
        <CollaboratorAvatars editors={doc.editors} max={3} size={22} />
      </>
    )}

    {/* Save status */}
    {saveStatus !== 'idle' && (
      <>
        <span className='text-border'>·</span>
        <span className='italic'>{getSaveStatusText()}</span>
      </>
    )}
  </div>

  {/* Row 2: Tags */}
  <TagInput tags={tags} onChange={handleTagsChange} />
</div>
```

- [ ] **Step 3: Add i18n message for "Updated" prefix**

Find the i18n messages file and add:

```json
"documentEditor.updated": "Updated"
```

Search for the file containing `"documentEditor.saving"` to find the correct messages file.

- [ ] **Step 4: Verify in browser**

Run: `npm run dev`

Open a document in the editor. Verify:

1. Two-row metadata block appears between title and editor content
2. Row 1 shows: creator avatar+name · Updated Xh ago · project badge (if linked) · editor avatars · save status
3. Row 2 shows tags with inline editing
4. Top and bottom borders are visible
5. Visibility badge is no longer shown in metadata area
6. Save status still works (edit title, see "Saving..." then "Saved")

- [ ] **Step 5: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/DocumentEditorPage.tsx
# Also add the i18n file modified in Step 3
git commit -m "feat: redesign document editor metadata to two-row layout"
```

---

### Task 2: Add Creator to Document List View

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx:195-228`

- [ ] **Step 1: Add getInitials import**

At the top of `DocumentsPage.tsx`:

```tsx
import { getInitials } from '@/lib/utils/getInitials'
```

- [ ] **Step 2: Add creator to renderListView**

In the `renderListView` function, insert the creator element after the title/subtitle `div` and before the tags section. Find this block (after the `min-w-0 flex-1` div, before the tags conditional):

```tsx
            {doc.tags && doc.tags.length > 0 && (
```

Insert before it:

```tsx
{
  /* Creator */
}
;<span className='flex items-center gap-1.5 shrink-0 hidden sm:flex'>
  <span className='size-[18px] rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0'>
    {doc.createdBy.imageUrl ? (
      <img
        src={doc.createdBy.imageUrl}
        alt={doc.createdBy.name}
        className='w-full h-full object-cover'
      />
    ) : (
      <span className='text-[8px] font-medium text-muted-foreground'>
        {getInitials(doc.createdBy.name)}
      </span>
    )}
  </span>
  <span className='text-xs text-muted-foreground'>{doc.createdBy.name}</span>
</span>
{
  /* Creator avatar only on mobile */
}
;<span className='shrink-0 sm:hidden'>
  <span className='size-[18px] rounded-full bg-muted flex items-center justify-center overflow-hidden'>
    {doc.createdBy.imageUrl ? (
      <img
        src={doc.createdBy.imageUrl}
        alt={doc.createdBy.name}
        className='w-full h-full object-cover'
      />
    ) : (
      <span className='text-[8px] font-medium text-muted-foreground'>
        {getInitials(doc.createdBy.name)}
      </span>
    )}
  </span>
</span>
```

- [ ] **Step 3: Verify list view in browser**

Run: `npm run dev`

Open the documents list page (list view). Verify:

1. Creator avatar + name appears between title and tags
2. On narrow viewport, only avatar is shown (name hidden)
3. Existing tags, collaborators, and time still display correctly

- [ ] **Step 4: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/DocumentsPage.tsx
git commit -m "feat: add creator to document list view"
```

---

### Task 3: Update Document Table View

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx:254-326`

- [ ] **Step 1: Replace Created At column header with Creator**

In the `renderTableView` function's `<thead>`, find the Created At header:

```tsx
<th className='text-left py-2 px-3'>
  {renderSortableHeader(
    intl.formatMessage({ id: 'documents.colCreatedAt' }),
    'createdAt'
  )}
</th>
```

Replace it with a static Creator header:

```tsx
<th className='text-left py-2 px-3 text-xs font-medium text-muted-foreground'>
  {intl.formatMessage({ id: 'documents.colCreator' })}
</th>
```

- [ ] **Step 2: Replace Created At column body with Creator**

In the `<tbody>`, find the Created At cell:

```tsx
<td className='py-2 px-3 text-xs text-muted-foreground whitespace-nowrap'>
  {formatRelativeTime(doc.createdAt)}
</td>
```

Replace it with a Creator cell:

```tsx
<td className='py-2 px-3'>
  <span className='flex items-center gap-1.5'>
    <span className='size-[18px] rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0'>
      {doc.createdBy.imageUrl ? (
        <img
          src={doc.createdBy.imageUrl}
          alt={doc.createdBy.name}
          className='w-full h-full object-cover'
        />
      ) : (
        <span className='text-[8px] font-medium text-muted-foreground'>
          {getInitials(doc.createdBy.name)}
        </span>
      )}
    </span>
    <span className='text-xs text-muted-foreground'>{doc.createdBy.name}</span>
  </span>
</td>
```

- [ ] **Step 3: Reorder columns — move Creator before Tags**

The current column order after step 1-2 is: Name | Tags | Collaborators | **Creator** | Updated | Menu.

We need: Name | **Creator** | Tags | Collaborators | Updated | Menu.

Move the Creator `<th>` to be right after the Name `<th>` in the header. Move the Creator `<td>` to be right after the Name `<td>` in the body.

- [ ] **Step 4: Add i18n message for Creator column header**

In the same i18n messages file from Task 1, add:

```json
"documents.colCreator": "Creator"
```

- [ ] **Step 5: Verify table view in browser**

Run: `npm run dev`

Switch to table view on the documents page. Verify:

1. Columns are: Name | Creator | Tags | Collaborators | Updated | Menu
2. Creator column shows avatar + name
3. Created At column is gone
4. Updated column still works with sorting
5. Sort dropdown still works (updatedAt, createdAt sort options still function even though createdAt column is hidden)

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/pages/DocumentsPage.tsx
# Also add the i18n file modified in Step 4
git commit -m "feat: replace Created At with Creator column in document table view"
```
