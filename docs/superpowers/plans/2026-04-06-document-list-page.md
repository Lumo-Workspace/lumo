# Document List Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the document list page with list/table view switching, sorting, tags, and editor-tracking collaborator avatars.

**Architecture:** Add `tags` (string array) to Document model and a new `DocumentEditor` join table to track who edited each document. Refactor `DocumentsPage` into a toolbar + two view components (list rows, table). Sorting and view mode are client-side state persisted to localStorage.

**Tech Stack:** Next.js 14, Prisma, TypeScript, Tailwind CSS, shadcn/ui, react-intl, Zod

---

### Task 1: Database — Add tags field and DocumentEditor table

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_tags_and_editors/migration.sql`

- [ ] **Step 1: Add `tags` field to Document model in schema.prisma**

In `prisma/schema.prisma`, add inside the `Document` model block, after the `publicToken` line:

```prisma
  tags         String[]  @default([])
  editors      DocumentEditor[]
```

- [ ] **Step 2: Add DocumentEditor model to schema.prisma**

After the `DocumentMention` model block, add:

```prisma
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

Also add `documentEdits DocumentEditor[]` to the `WorkspaceMember` model's relation fields.

- [ ] **Step 3: Create migration SQL**

Create file `prisma/migrations/20260406210000_add_tags_and_editors/migration.sql`:

```sql
-- Add tags array to Document
ALTER TABLE "Document" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Create DocumentEditor table
CREATE TABLE "DocumentEditor" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "lastEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentEditor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentEditor_documentId_memberId_key" ON "DocumentEditor"("documentId", "memberId");

ALTER TABLE "DocumentEditor" ADD CONSTRAINT "DocumentEditor_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentEditor" ADD CONSTRAINT "DocumentEditor_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "WorkspaceMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Generate Prisma client**

Run: `npx prisma generate`
Expected: "✔ Generated Prisma Client"

- [ ] **Step 5: Run migration on dev database**

Run: `DATABASE_URL_UNPOOLED="<dev-url>" npx prisma migrate dev`
Expected: Migration applied successfully.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260406210000_add_tags_and_editors/
git commit -m "feat: add tags and DocumentEditor to schema [LUM-17]"
```

---

### Task 2: API — Update document endpoints for tags and editors

**Files:**

- Modify: `lib/validation/schemas.ts`
- Modify: `app/api/documents/route.ts` (GET handler)
- Modify: `app/api/documents/[id]/route.ts` (PATCH handler)
- Modify: `app/workspace/[workspaceUrl]/types.ts`

- [ ] **Step 1: Add `tags` to validation schema**

In `lib/validation/schemas.ts`, add to `updateDocumentSchema` after the `publicToken` line:

```typescript
  tags: z.array(z.string().max(30)).max(20).optional(),
```

- [ ] **Step 2: Update ApiDocument type**

In `app/workspace/[workspaceUrl]/types.ts`, add to the `ApiDocument` interface after `_count`:

```typescript
  tags?: string[]
  editors?: Array<{
    member: { id: string; name: string; imageUrl: string | null }
    lastEditedAt: string
  }>
```

- [ ] **Step 3: Update GET /api/documents to include tags and editors**

In `app/api/documents/route.ts`, find the `prisma.document.findMany` call in the GET handler. Add `tags: true` to the `select` (or ensure it's returned if using `include`). Add editors to the include:

```typescript
editors: {
  select: {
    member: { select: { id: true, clerkId: true } },
    lastEditedAt: true,
  },
  orderBy: { lastEditedAt: 'desc' },
  take: 5,
},
```

In the response shaping function, map editors to include resolved Clerk user data (name, imageUrl) using the same `clerkUserMap` that's already built for `createdBy`:

```typescript
editors: (doc.editors || []).map((e: any) => ({
  member: {
    id: e.member.id,
    name: clerkUserMap.get(e.member.clerkId)?.name ?? 'Unknown',
    imageUrl: clerkUserMap.get(e.member.clerkId)?.imageUrl ?? null,
  },
  lastEditedAt: e.lastEditedAt.toISOString(),
})),
```

Make sure editor member clerkIds are included in the batch Clerk user fetch.

- [ ] **Step 4: Update PATCH /api/documents/[id] to handle tags and track editors**

In `app/api/documents/[id]/route.ts`, in the PATCH handler:

Add tags to the update data building:

```typescript
if (parsed.data.tags !== undefined) {
  updateData.tags = parsed.data.tags
}
```

Add editor tracking when content is updated — after the document update, upsert a DocumentEditor record:

```typescript
if (parsed.data.content !== undefined) {
  await prisma.documentEditor.upsert({
    where: {
      documentId_memberId: {
        documentId: id,
        memberId: membership.id,
      },
    },
    update: { lastEditedAt: new Date() },
    create: {
      documentId: id,
      memberId: membership.id,
    },
  })
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors (only pre-existing similarity.test.ts errors).

- [ ] **Step 6: Commit**

```bash
git add lib/validation/schemas.ts app/api/documents/route.ts app/api/documents/[id]/route.ts app/workspace/[workspaceUrl]/types.ts
git commit -m "feat: add tags and editor tracking to document API [LUM-17]"
```

---

### Task 3: Shared UI components — TagBadge and CollaboratorAvatars

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/document/TagBadge.tsx`
- Create: `app/workspace/[workspaceUrl]/components/document/CollaboratorAvatars.tsx`

- [ ] **Step 1: Create TagBadge component**

Create `app/workspace/[workspaceUrl]/components/document/TagBadge.tsx`:

```typescript
'use client'

const TAG_COLORS = [
  { bg: '#dbeafe', text: '#1d4ed8' },  // blue
  { bg: '#dcfce7', text: '#166534' },  // green
  { bg: '#fef3c7', text: '#92400e' },  // yellow
  { bg: '#e0e7ff', text: '#3730a3' },  // indigo
  { bg: '#fce7f3', text: '#9d174d' },  // pink
  { bg: '#ffedd5', text: '#9a3412' },  // orange
  { bg: '#ccfbf1', text: '#115e59' },  // teal
  { bg: '#fee2e2', text: '#991b1b' },  // red
]

function getTagColor(tag: string) {
  const hash = tag.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return TAG_COLORS[hash % TAG_COLORS.length]
}

interface TagBadgeProps {
  tag: string
}

export function TagBadge({ tag }: TagBadgeProps) {
  const color = getTagColor(tag)
  return (
    <span
      className='inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap'
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {tag}
    </span>
  )
}

interface TagListProps {
  tags: string[]
  max?: number
}

export function TagList({ tags, max = 3 }: TagListProps) {
  if (tags.length === 0) return null
  const visible = tags.slice(0, max)
  const overflow = tags.length - max

  return (
    <div className='flex items-center gap-1'>
      {visible.map(tag => (
        <TagBadge key={tag} tag={tag} />
      ))}
      {overflow > 0 && (
        <span className='text-[10px] text-muted-foreground'>+{overflow}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create CollaboratorAvatars component**

Create `app/workspace/[workspaceUrl]/components/document/CollaboratorAvatars.tsx`:

```typescript
'use client'

import { getInitials } from '@/lib/utils/getInitials'

interface Editor {
  member: { id: string; name: string; imageUrl: string | null }
  lastEditedAt: string
}

interface CollaboratorAvatarsProps {
  editors: Editor[]
  max?: number
  size?: number
}

export function CollaboratorAvatars({
  editors,
  max = 3,
  size = 22,
}: CollaboratorAvatarsProps) {
  if (editors.length === 0) return null
  const visible = editors.slice(0, max)
  const overflow = editors.length - max

  return (
    <div className='flex items-center' title={editors.map(e => e.member.name).join(', ')}>
      {visible.map((editor, i) => (
        <div
          key={editor.member.id}
          className='rounded-full border-2 border-background bg-muted flex items-center justify-center overflow-hidden shrink-0'
          style={{
            width: size,
            height: size,
            marginLeft: i > 0 ? -6 : 0,
            zIndex: visible.length - i,
          }}
        >
          {editor.member.imageUrl ? (
            <img
              src={editor.member.imageUrl}
              alt={editor.member.name}
              className='w-full h-full object-cover'
            />
          ) : (
            <span className='text-[9px] font-medium text-muted-foreground'>
              {getInitials(editor.member.name)}
            </span>
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div
          className='rounded-full border-2 border-background bg-muted flex items-center justify-center shrink-0'
          style={{
            width: size,
            height: size,
            marginLeft: -6,
            zIndex: 0,
          }}
        >
          <span className='text-[9px] font-medium text-muted-foreground'>
            +{overflow}
          </span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/document/TagBadge.tsx app/workspace/[workspaceUrl]/components/document/CollaboratorAvatars.tsx
git commit -m "feat: add TagBadge and CollaboratorAvatars components [LUM-17]"
```

---

### Task 4: i18n — Add new translation keys

**Files:**

- Modify: `lib/i18n/zh.json`
- Modify: `lib/i18n/en.json`

- [ ] **Step 1: Add i18n keys to zh.json**

Add after the existing `documents.*` keys (before `documentEditor.*`):

```json
  "documents.sortUpdated": "最近更新",
  "documents.sortCreated": "最近创建",
  "documents.sortTitle": "标题",
  "documents.viewList": "列表",
  "documents.viewTable": "表格",
  "documents.colName": "文档名称",
  "documents.colTags": "标签",
  "documents.colCollaborators": "协作者",
  "documents.colCreatedAt": "创建时间",
  "documents.colUpdatedAt": "更新时间",
  "documents.tagPlaceholder": "添加标签...",
```

- [ ] **Step 2: Add i18n keys to en.json**

Add the same keys with English values:

```json
  "documents.sortUpdated": "Recently Updated",
  "documents.sortCreated": "Recently Created",
  "documents.sortTitle": "Title",
  "documents.viewList": "List",
  "documents.viewTable": "Table",
  "documents.colName": "Document",
  "documents.colTags": "Tags",
  "documents.colCollaborators": "Collaborators",
  "documents.colCreatedAt": "Created",
  "documents.colUpdatedAt": "Updated",
  "documents.tagPlaceholder": "Add tag...",
```

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/zh.json lib/i18n/en.json
git commit -m "feat: add document list i18n keys [LUM-17]"
```

---

### Task 5: DocumentsPage redesign — Toolbar, list view, and table view

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx` (full rewrite)
- Modify: `app/workspace/[workspaceUrl]/constants.ts` (add cache keys)

This is the main UI task. The existing `DocumentsPage.tsx` (~257 lines) will be rewritten to include:

- Extracted toolbar with filter tabs, sort dropdown, view toggle, search
- List view (compact rows with tags + collaborator avatars)
- Table view (5-column sortable table)
- Client-side sorting
- View mode + sort preference persisted to localStorage

- [ ] **Step 1: Add localStorage cache keys**

In `app/workspace/[workspaceUrl]/constants.ts`, add to the `CACHE_KEY` object:

```typescript
  docViewMode: 'lumo:doc-view-mode',
  docSort: 'lumo:doc-sort',
```

- [ ] **Step 2: Rewrite DocumentsPage.tsx**

Rewrite `app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx` with the following structure. Keep the existing props interface, `FILTERS` array, `formatRelativeTime` helper, and delete confirmation dialog. Replace the document list rendering with the new views.

Key changes:

1. Add state: `viewMode` ('list' | 'table'), `sortBy` ('updatedAt' | 'createdAt' | 'title'), both initialized from localStorage
2. Add `sortDocuments` function that sorts the filtered array client-side
3. Replace the current document card grid with two conditional views
4. Extract toolbar into its own section at the top

**Toolbar section** (replaces current filter tabs + search):

```tsx
{
  /* Toolbar */
}
;<div className='flex items-center justify-between mb-3'>
  {/* Left: filter tabs */}
  <div className='flex gap-1'>
    {FILTERS.map(f => (
      <button
        key={f.key}
        onClick={() => setFilter(f.key)}
        className={cn(
          'px-3 py-1 text-sm rounded-md transition-colors',
          filter === f.key
            ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {intl.formatMessage({ id: f.msgId })}
      </button>
    ))}
  </div>
  {/* Right: sort + view toggle */}
  <div className='flex items-center gap-2'>
    <Select
      value={sortBy}
      onValueChange={v => {
        setSortBy(v as SortKey)
        localStorage.setItem(CACHE_KEY.docSort, v)
      }}
    >
      <SelectTrigger className='h-8 w-[140px] text-xs'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='updatedAt'>
          {intl.formatMessage({ id: 'documents.sortUpdated' })}
        </SelectItem>
        <SelectItem value='createdAt'>
          {intl.formatMessage({ id: 'documents.sortCreated' })}
        </SelectItem>
        <SelectItem value='title'>
          {intl.formatMessage({ id: 'documents.sortTitle' })}
        </SelectItem>
      </SelectContent>
    </Select>
    <div className='flex border rounded-md'>
      <button
        onClick={() => {
          setViewMode('list')
          localStorage.setItem(CACHE_KEY.docViewMode, 'list')
        }}
        className={cn(
          'p-1.5',
          viewMode === 'list' ? 'bg-muted' : 'hover:bg-muted/50'
        )}
        title={intl.formatMessage({ id: 'documents.viewList' })}
      >
        <List className='h-4 w-4' />
      </button>
      <button
        onClick={() => {
          setViewMode('table')
          localStorage.setItem(CACHE_KEY.docViewMode, 'table')
        }}
        className={cn(
          'p-1.5',
          viewMode === 'table' ? 'bg-muted' : 'hover:bg-muted/50'
        )}
        title={intl.formatMessage({ id: 'documents.viewTable' })}
      >
        <TableIcon className='h-4 w-4' />
      </button>
    </div>
  </div>
</div>
```

**Sort function:**

```typescript
type SortKey = 'updatedAt' | 'createdAt' | 'title'

function sortDocuments(docs: ApiDocument[], sortBy: SortKey): ApiDocument[] {
  return [...docs].sort((a, b) => {
    switch (sortBy) {
      case 'updatedAt':
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      case 'createdAt':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case 'title':
        return a.title.localeCompare(b.title)
    }
  })
}
```

**List view** (compact rows):

```tsx
{
  viewMode === 'list' && (
    <div className='flex flex-col gap-0.5'>
      {sorted.map(doc => (
        <div
          key={doc.id}
          onClick={() => onSelectDocument(doc)}
          className='group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 cursor-pointer'
        >
          <span className='text-lg shrink-0'>{doc.emoji ?? '📄'}</span>
          <span className='flex-1 min-w-0 text-sm font-medium truncate'>
            {doc.title}
          </span>
          <TagList tags={doc.tags ?? []} max={3} />
          <CollaboratorAvatars editors={doc.editors ?? []} max={3} size={22} />
          <span className='text-xs text-muted-foreground shrink-0 w-16 text-right'>
            {formatRelativeTime(doc.updatedAt, intl)}
          </span>
          {/* Action menu (existing DropdownMenu, hidden until hover) */}
          <div className='opacity-0 group-hover:opacity-100'>
            {/* ... existing dropdown with Copy Link + Delete */}
          </div>
        </div>
      ))}
    </div>
  )
}
```

**Table view:**

```tsx
{
  viewMode === 'table' && (
    <table className='w-full text-sm'>
      <thead>
        <tr className='border-b-2 border-border'>
          <th className='text-left py-2 px-3 text-xs font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'documents.colName' })}
          </th>
          <th className='text-left py-2 px-3 text-xs font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'documents.colTags' })}
          </th>
          <th className='text-left py-2 px-3 text-xs font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'documents.colCollaborators' })}
          </th>
          <th
            className={cn(
              'text-left py-2 px-3 text-xs font-medium cursor-pointer hover:text-foreground',
              sortBy === 'createdAt'
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground'
            )}
            onClick={() => {
              setSortBy('createdAt')
              localStorage.setItem(CACHE_KEY.docSort, 'createdAt')
            }}
          >
            {intl.formatMessage({ id: 'documents.colCreatedAt' })}{' '}
            {sortBy === 'createdAt' ? '↓' : '↕'}
          </th>
          <th
            className={cn(
              'text-left py-2 px-3 text-xs font-medium cursor-pointer hover:text-foreground',
              sortBy === 'updatedAt'
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground'
            )}
            onClick={() => {
              setSortBy('updatedAt')
              localStorage.setItem(CACHE_KEY.docSort, 'updatedAt')
            }}
          >
            {intl.formatMessage({ id: 'documents.colUpdatedAt' })}{' '}
            {sortBy === 'updatedAt' ? '↓' : '↕'}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(doc => (
          <tr
            key={doc.id}
            onClick={() => onSelectDocument(doc)}
            className='border-b border-border hover:bg-muted/50 cursor-pointer'
          >
            <td className='py-2.5 px-3'>
              <div className='flex items-center gap-2'>
                <span className='text-base'>{doc.emoji ?? '📄'}</span>
                <span className='font-medium truncate'>{doc.title}</span>
              </div>
            </td>
            <td className='py-2.5 px-3'>
              <TagList tags={doc.tags ?? []} max={3} />
            </td>
            <td className='py-2.5 px-3'>
              <CollaboratorAvatars
                editors={doc.editors ?? []}
                max={3}
                size={22}
              />
            </td>
            <td className='py-2.5 px-3 text-xs text-muted-foreground'>
              {new Date(doc.createdAt).toLocaleDateString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
              })}
            </td>
            <td className='py-2.5 px-3 text-xs text-muted-foreground'>
              {formatRelativeTime(doc.updatedAt, intl)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

New imports needed:

```typescript
import { List, Table as TableIcon } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TagList } from '../document/TagBadge'
import { CollaboratorAvatars } from '../document/CollaboratorAvatars'
import { CACHE_KEY } from '../../constants'
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx app/workspace/[workspaceUrl]/constants.ts
git commit -m "feat: redesign document list page with list/table views [LUM-17]"
```

---

### Task 6: Tag editing in document editor

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/document/TagInput.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`

- [ ] **Step 1: Create TagInput component**

Create `app/workspace/[workspaceUrl]/components/document/TagInput.tsx`:

```typescript
'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { X } from 'lucide-react'
import { TagBadge } from './TagBadge'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
}

export function TagInput({ tags, onChange, suggestions = [] }: TagInputProps) {
  const intl = useIntl()
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredSuggestions = suggestions.filter(
    s => s.toLowerCase().includes(input.toLowerCase()) && !tags.includes(s)
  )

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim()
      if (trimmed && !tags.includes(trimmed)) {
        onChange([...tags, trimmed])
      }
      setInput('')
      setShowSuggestions(false)
    },
    [tags, onChange]
  )

  const removeTag = useCallback(
    (tag: string) => {
      onChange(tags.filter(t => t !== tag))
    },
    [tags, onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && input.trim()) {
        e.preventDefault()
        addTag(input)
      } else if (e.key === 'Backspace' && !input && tags.length > 0) {
        removeTag(tags[tags.length - 1])
      }
    },
    [input, tags, addTag, removeTag]
  )

  return (
    <div className='relative'>
      <div className='flex flex-wrap items-center gap-1.5'>
        {tags.map(tag => (
          <span key={tag} className='inline-flex items-center gap-0.5'>
            <TagBadge tag={tag} />
            <button
              onClick={() => removeTag(tag)}
              className='text-muted-foreground hover:text-foreground p-0.5'
            >
              <X className='h-3 w-3' />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={e => {
            setInput(e.target.value)
            setShowSuggestions(true)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={tags.length === 0 ? intl.formatMessage({ id: 'documents.tagPlaceholder' }) : ''}
          className='bg-transparent text-sm outline-none min-w-[80px] flex-1 placeholder:text-muted-foreground'
        />
      </div>
      {showSuggestions && input && filteredSuggestions.length > 0 && (
        <div className='absolute top-full left-0 mt-1 w-48 bg-popover border rounded-md shadow-md z-50 py-1'>
          {filteredSuggestions.slice(0, 5).map(s => (
            <button
              key={s}
              onMouseDown={e => e.preventDefault()}
              onClick={() => addTag(s)}
              className='block w-full text-left px-3 py-1.5 text-sm hover:bg-muted'
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add TagInput to DocumentEditorPage**

In `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`:

Add import:

```typescript
import { TagInput } from '../document/TagInput'
```

Add tag state and handler in the component (alongside existing title/content state):

```typescript
const [tags, setTags] = useState<string[]>(doc.tags ?? [])

const handleTagsChange = useCallback(
  async (newTags: string[]) => {
    setTags(newTags)
    try {
      await fetch(API.documents.byId(documentId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      })
    } catch {
      // revert on failure
      setTags(doc.tags ?? [])
    }
  },
  [documentId, doc.tags]
)
```

Add `TagInput` in the editor page's metadata area, below the title and near the visibility badge:

```tsx
<div className='mb-4'>
  <TagInput tags={tags} onChange={handleTagsChange} />
</div>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/document/TagInput.tsx app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx
git commit -m "feat: add tag editing in document editor [LUM-17]"
```

---

### Task 7: Final verification and cleanup

**Files:**

- All modified files from Tasks 1-6

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit`
Expected: No new errors (only pre-existing similarity.test.ts).

- [ ] **Step 2: Check for unused imports**

Review all new/modified files for unused imports.

- [ ] **Step 3: Check for console.log statements**

Run: `grep -r 'console\.log' app/workspace/[workspaceUrl]/components/document/TagBadge.tsx app/workspace/[workspaceUrl]/components/document/CollaboratorAvatars.tsx app/workspace/[workspaceUrl]/components/document/TagInput.tsx app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx`
Expected: No matches.

- [ ] **Step 4: Run migration on production database**

Run: `DATABASE_URL_UNPOOLED="<prod-url>" npx prisma migrate deploy`
Expected: Migration applied successfully.

- [ ] **Step 5: Manual smoke test**

Verify in browser:

1. Document list page loads with list view (default)
2. Filter tabs work (all/personal/shared/workspace)
3. Sort dropdown works (updated/created/title)
4. View toggle switches between list and table
5. View mode and sort preference persist after page refresh
6. Table view shows all 5 columns with correct headers
7. Clicking sortable column headers in table view changes sort
8. Tag badges display with correct colors
9. Collaborator avatars show for documents with multiple editors
10. Tag editing in document editor works (add/remove)
11. Tags appear in list and table view after adding
12. Editor avatar appears after editing a document

- [ ] **Step 6: Commit any cleanup**

```bash
git add -A
git commit -m "chore: final cleanup for document list redesign [LUM-17]"
```
