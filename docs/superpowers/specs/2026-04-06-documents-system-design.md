# Documents System Design

## Overview

A document system for Lumo that enables teams to create, organize, and share rich-text documents. Documents exist as first-class entities with their own listing page, can optionally associate with Projects, and support bi-directional linking with Tasks.

## Requirements Summary

- **Independent knowledge base** with optional Project association
- **Tree hierarchy** — documents nest into sub-documents (Notion-style)
- **Enhanced editor** — slash commands, drag-to-reorder blocks, embeds, TOC outline
- **Three-tier permissions** — Personal (private), Shared (specific members), Workspace (all members)
- **Four share roles** — Owner (creator), Manager, Editor, Viewer
- **Single-user editing** — no real-time collaboration; last save wins
- **Bi-directional Task linking** — @mention tasks in docs, see related docs on Task detail

## Data Model

### New Enums

```prisma
enum DocVisibility {
  PRIVATE      // Only creator can see
  SHARED       // Visible to members in DocumentShare
  WORKSPACE    // Visible to all workspace members
}

enum DocShareRole {
  VIEWER       // Read-only
  EDITOR       // Read + edit content
  MANAGER      // Read + edit + manage shares (add/remove members, change roles)
}
```

### Document

```prisma
model Document {
  id          String        @id @default(cuid())
  title       String        @default("Untitled")
  content     String?       @db.Text  // Tiptap JSON string
  emoji       String?                 // Document icon emoji

  // Tree hierarchy
  parentId    String?
  parent      Document?     @relation("DocTree", fields: [parentId], references: [id])
  children    Document[]    @relation("DocTree")
  sortOrder   Float         @default(0)

  // Associations
  projectId   String?
  project     Project?      @relation(fields: [projectId], references: [id])
  workspaceId String
  workspace   Workspace     @relation(fields: [workspaceId], references: [id])
  createdById String
  createdBy   WorkspaceMember @relation(fields: [createdById], references: [id])

  // Permissions
  visibility  DocVisibility @default(PRIVATE)
  shares      DocumentShare[]

  // Bi-directional task linking
  mentions    DocumentMention[]

  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([workspaceId])
  @@index([parentId])
  @@index([projectId])
  @@index([createdById])
}
```

### DocumentShare

```prisma
model DocumentShare {
  id          String       @id @default(cuid())
  documentId  String
  document    Document     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  memberId    String
  member      WorkspaceMember @relation(fields: [memberId], references: [id])
  role        DocShareRole @default(VIEWER)

  createdAt   DateTime     @default(now())

  @@unique([documentId, memberId])
}
```

### DocumentMention

```prisma
model DocumentMention {
  id          String   @id @default(cuid())
  documentId  String
  document    Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  taskId      String
  task        Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)

  createdAt   DateTime @default(now())

  @@unique([documentId, taskId])
}
```

### Design Decisions

- **content storage**: Tiptap JSON string in a Text field. JSON is better than HTML for structured editing and content manipulation.
- **Tree ordering**: Siblings ordered by `sortOrder` (Float). Supports drag-to-reorder by inserting midpoint values.
- **Owner role**: The document creator (`createdById`) has implicit full control. Not stored in DocumentShare — cannot be removed.
- **Cascade deletes**: Deleting a document cascades to its shares and mentions. Child documents are NOT cascade-deleted — they become root-level documents (parentId set to null via application logic, or cascade if preferred).

## Pages & Navigation

### Sidebar

Add "Documents" entry between Projects and Inbox, using `FileText` icon from lucide-react.

### Routes

| Route                             | Page Component       | Description                   |
| --------------------------------- | -------------------- | ----------------------------- |
| `/workspace/{url}/documents`      | `DocumentsPage`      | Document listing with filters |
| `/workspace/{url}/documents/{id}` | `DocumentEditorPage` | Full-page editor with TOC     |

### Page Type

Add `'documents' | 'document-editor'` to the `Page` type union in `types.ts`.

### DocumentsPage

- **Header**: Title "Documents" + "New Document" button
- **Filter tabs**: All / Personal / Shared / Workspace
- **List columns**: Emoji + Title, Subtitle (project or visibility), Member avatars, Updated time
- **Actions**: Click to open editor, right-click menu (copy link, duplicate, delete)
- **Search**: Filter documents by title

### DocumentEditorPage

- **Layout**: Left TOC sidebar (collapsible) + right full-width editor
- **TOC sidebar**: Auto-generated from headings in content, plus list of child documents
- **Breadcrumb**: Documents > Parent Doc > Current Doc
- **Header area**: Emoji picker + editable title + metadata (project, visibility, last updated)
- **Editor**: Full DocumentEditor with slash commands, drag handles, embeds
- **Save indicator**: "Saving..." → "Saved just now" → "Saved 2m ago"

## Editor Architecture

### Shared Extension Layer

```
lib/editor/
├── extensions.ts          # Shared base extensions (Bold, Italic, List, Table, etc.)
├── slash-command.ts       # "/" command extension (uses @tiptap/suggestion API)
├── slash-command-list.tsx  # Command menu UI component
├── drag-handle.ts         # Block drag-to-reorder extension
└── embed.ts               # YouTube/URL embed extension
```

### Editor Components

```
DescriptionEditor.tsx      # Task description (imports lib/editor/extensions)
DocumentEditor.tsx         # Document editor (extensions + slash + drag + embed + TOC)
```

### DescriptionEditor (unchanged)

Continues to use `lib/editor/extensions` for its base functionality. No new features added to task descriptions.

### DocumentEditor (new)

Inherits all shared extensions plus:

| Feature           | Implementation                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slash commands    | `@tiptap/suggestion` API with `"/"` trigger character. Reuses same pattern as existing @mention. Command categories: Basic (text, headings, lists), Media (image, embed), Advanced (table, code block, blockquote, divider). |
| Drag-to-reorder   | `@tiptap/extension-drag-handle` (needs install) or custom implementation. Shows drag handle on hover left of each block.                                                                                                     |
| Embeds            | Custom Tiptap node for YouTube iframes and URL link previews. Triggered via slash command or paste detection.                                                                                                                |
| TOC outline       | Separate `DocumentTOC` component that reads editor content, extracts headings, renders as a clickable sidebar list. Syncs on content change via `onUpdate`.                                                                  |
| Auto-save         | `onUpdate` callback with 1s debounce → `PATCH /api/documents/[id]`. UI shows save state.                                                                                                                                     |
| Emoji title       | `EmojiPicker` component above the editor title. Stores selected emoji in `Document.emoji`.                                                                                                                                   |
| Full-width layout | Dedicated page layout, not a panel/drawer. Centered content with comfortable max-width.                                                                                                                                      |

### New Document Components

```
components/document/
├── DocumentTOC.tsx        # Table of contents sidebar
├── EmojiPicker.tsx        # Document icon emoji selector
└── DocumentBreadcrumb.tsx # Breadcrumb navigation for nested docs
```

## API Design

### Document CRUD

```
GET    /api/documents?workspaceId=X
  → Returns documents visible to current user (applies permission filtering)
  → Query params: visibility (filter tab), projectId, parentId, search
  → Response includes: id, title, emoji, visibility, project, createdBy, updatedAt
  → Does NOT include content (too large for list view)

POST   /api/documents
  → Body: { title, emoji?, parentId?, projectId?, workspaceId, visibility }
  → Returns created document

GET    /api/documents/[id]
  → Returns full document including content
  → Permission check: user must have access (owner, shared, or workspace visibility)

PATCH  /api/documents/[id]
  → Body: { title?, content?, emoji?, visibility?, projectId?, sortOrder? }
  → Permission check: user must be owner, manager, or editor
  → On content update: parse @mentions and sync DocumentMention table

DELETE /api/documents/[id]
  → Permission check: owner only
  → Cascades to shares and mentions
  → Child documents: set parentId to null (become root-level)
```

### Share Management

```
GET    /api/documents/[id]/shares
  → Returns list of shares with member info
  → Permission check: owner or manager

POST   /api/documents/[id]/shares
  → Body: { memberId, role }
  → Permission check: owner or manager
  → Auto-sets visibility to SHARED if currently PRIVATE

PATCH  /api/documents/[id]/shares/[shareId]
  → Body: { role }
  → Permission check: owner or manager

DELETE /api/documents/[id]/shares/[shareId]
  → Permission check: owner or manager
  → Cannot remove the owner
```

### Task Association

```
GET    /api/tasks/[id]/documents
  → Returns documents that mention this task (via DocumentMention)
  → Permission filtered: only returns docs the requesting user can access
```

### Tree Operations

```
PATCH  /api/documents/[id]/move
  → Body: { parentId, sortOrder }
  → Permission check: owner, manager, or editor
  → Updates document's position in the tree
```

## Permission Model

### Access Rules

| Action             | Owner | Manager | Editor | Viewer | Workspace Member (WORKSPACE visibility) |
| ------------------ | ----- | ------- | ------ | ------ | --------------------------------------- |
| View document      | Yes   | Yes     | Yes    | Yes    | Yes                                     |
| Edit content       | Yes   | Yes     | Yes    | No     | No                                      |
| Change title/emoji | Yes   | Yes     | Yes    | No     | No                                      |
| Change visibility  | Yes   | No      | No     | No     | No                                      |
| Add/remove shares  | Yes   | Yes     | No     | No     | No                                      |
| Change share roles | Yes   | Yes     | No     | No     | No                                      |
| Delete document    | Yes   | No      | No     | No     | No                                      |
| Move document      | Yes   | Yes     | Yes    | No     | No                                      |

### Permission Query

Documents visible to a user are resolved with a single Prisma query:

```typescript
where: {
  workspaceId,
  OR: [
    { createdById: memberId },                          // Owner
    { visibility: 'WORKSPACE' },                        // Workspace-wide
    { shares: { some: { memberId } } },                 // Shared with me
  ]
}
```

## Bi-directional Task Linking

### Document → Task

When a document is saved, the server parses the Tiptap JSON content for @mention nodes with `data-mention-type: "task"`. It diffs against existing `DocumentMention` records and creates/deletes as needed.

### Task → Document

On the Task detail page, a new "Related Documents" section queries `DocumentMention` where `taskId = current task`. Only shows documents the viewing user has permission to access.

## Auto-save Flow

```
User edits content
  → onUpdate fires
  → Debounce 1 second
  → PATCH /api/documents/[id] with { content, title }
  → Server:
      1. Update document record
      2. Parse content for @mentions
      3. Sync DocumentMention table (diff: add new, remove stale)
  → Client shows save status indicator:
      "Saving..." → "Saved just now" → "Saved Xm ago"
```

## File Structure Summary

```
prisma/
└── schema.prisma               # Add Document, DocumentShare, DocumentMention

lib/editor/
├── extensions.ts               # Shared Tiptap extensions
├── slash-command.ts            # Slash command extension
├── slash-command-list.tsx      # Slash command menu UI
├── drag-handle.ts              # Block drag handle
└── embed.ts                    # YouTube/URL embed node

app/workspace/[workspaceUrl]/
├── components/
│   ├── DocumentEditor.tsx      # Full document editor
│   ├── document/
│   │   ├── DocumentTOC.tsx     # Table of contents
│   │   ├── EmojiPicker.tsx     # Emoji icon picker
│   │   └── DocumentBreadcrumb.tsx
│   └── pages/
│       ├── DocumentsPage.tsx   # Document listing
│       └── DocumentEditorPage.tsx # Editor page wrapper
├── hooks/
│   └── useDocuments.ts         # Document data fetching hook
└── types.ts                    # Add Document types, Page union

app/api/
├── documents/
│   ├── route.ts                # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts            # GET, PATCH, DELETE
│       ├── shares/
│       │   ├── route.ts        # GET, POST
│       │   └── [shareId]/
│       │       └── route.ts    # PATCH, DELETE
│       └── move/
│           └── route.ts        # PATCH (tree move)
└── tasks/[id]/
    └── documents/
        └── route.ts            # GET (related documents)

lib/i18n/
├── en.json                     # Add document.* keys
└── zh.json                     # Add document.* keys
```

## New Dependencies

- `@tiptap/extension-drag-handle` — block drag-to-reorder (verify availability, may need custom implementation)
- No other new packages required; all other functionality built on existing Tiptap + shadcn/ui stack

## Out of Scope

- Real-time collaborative editing
- Document version history / revision tracking
- Document templates
- Export to PDF/Markdown
- Full-text search across document content
- Comments on documents (separate from task comments)

These can be added in future iterations.
