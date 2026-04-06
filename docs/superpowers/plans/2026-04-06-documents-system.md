# Documents System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a document system where teams can create, organize, and share rich-text documents with tree hierarchy, slash commands, and bi-directional task linking.

**Architecture:** New `Document`, `DocumentShare`, and `DocumentMention` Prisma models. REST API under `/api/documents`. Frontend adds `DocumentsPage` (listing) and `DocumentEditorPage` (full-page Tiptap editor). Shared editor extensions extracted to `lib/editor/`. Sidebar gains a Documents entry.

**Tech Stack:** Next.js 14 App Router, Prisma/Neon Postgres, Tiptap v3, @tiptap/suggestion (slash commands), shadcn/ui, react-intl, Zod validation.

---

## File Structure

```
prisma/
└── schema.prisma                           # Add Document, DocumentShare, DocumentMention models + enums

lib/
├── validation/schemas.ts                   # Add document Zod schemas
├── editor/
│   ├── extensions.ts                       # Shared Tiptap base extensions (extracted from DescriptionEditor)
│   ├── slash-command.ts                    # "/" command Tiptap extension (uses suggestion API)
│   └── slash-command-list.tsx              # Slash command popup menu UI
└── i18n/
    ├── en.json                             # Add documents.* keys
    └── zh.json                             # Add documents.* keys

app/
├── api/documents/
│   ├── route.ts                            # GET (list) + POST (create)
│   └── [id]/
│       ├── route.ts                        # GET + PATCH + DELETE
│       ├── shares/
│       │   ├── route.ts                    # GET + POST
│       │   └── [shareId]/
│       │       └── route.ts                # PATCH + DELETE
│       └── move/
│           └── route.ts                    # PATCH (tree reorder)
├── api/tasks/[id]/documents/
│   └── route.ts                            # GET (related documents for a task)
└── workspace/[workspaceUrl]/
    ├── types.ts                            # Add ApiDocument, Page union
    ├── constants.ts                        # Add API.documents + CACHE_KEY.documents
    ├── hooks/useDocuments.ts               # Document data fetching hook
    ├── components/
    │   ├── pages/
    │   │   ├── DocumentsPage.tsx           # Document listing page
    │   │   └── DocumentEditorPage.tsx      # Full-page editor wrapper
    │   ├── DocumentEditor.tsx              # Rich-text editor (extends shared extensions)
    │   └── document/
    │       ├── DocumentTOC.tsx             # Table of contents sidebar
    │       ├── EmojiPicker.tsx             # Emoji icon selector
    │       └── DocumentBreadcrumb.tsx      # Breadcrumb for nested docs
    ├── WorkspaceApp.tsx                    # Add documents routing + navigation
    └── Sidebar.tsx                         # Add Documents nav item
```

---

## Task 1: Prisma Schema — Add Document Models

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums and Document model**

Add to `prisma/schema.prisma` after the existing enums:

```prisma
enum DocVisibility {
  PRIVATE
  SHARED
  WORKSPACE
}

enum DocShareRole {
  VIEWER
  EDITOR
  MANAGER
}
```

Add the `Document` model:

```prisma
model Document {
  id          String        @id @default(cuid())
  title       String        @default("Untitled")
  content     String?       @db.Text
  emoji       String?

  parentId    String?
  parent      Document?     @relation("DocTree", fields: [parentId], references: [id])
  children    Document[]    @relation("DocTree")
  sortOrder   Float         @default(0)

  projectId   String?
  project     Project?      @relation(fields: [projectId], references: [id])
  workspaceId String
  workspace   Workspace     @relation(fields: [workspaceId], references: [id])
  createdById String
  createdBy   WorkspaceMember @relation("DocumentCreator", fields: [createdById], references: [id])

  visibility  DocVisibility @default(PRIVATE)
  shares      DocumentShare[]
  mentions    DocumentMention[]

  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([workspaceId])
  @@index([parentId])
  @@index([projectId])
  @@index([createdById])
}
```

- [ ] **Step 2: Add DocumentShare model**

```prisma
model DocumentShare {
  id          String       @id @default(cuid())
  documentId  String
  document    Document     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  memberId    String
  member      WorkspaceMember @relation("DocumentShareMember", fields: [memberId], references: [id])
  role        DocShareRole @default(VIEWER)

  createdAt   DateTime     @default(now())

  @@unique([documentId, memberId])
}
```

- [ ] **Step 3: Add DocumentMention model**

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

- [ ] **Step 4: Add reverse relations to existing models**

Add to the `Workspace` model:

```prisma
documents   Document[]
```

Add to the `Project` model:

```prisma
documents   Document[]
```

Add to the `WorkspaceMember` model:

```prisma
createdDocuments  Document[]      @relation("DocumentCreator")
documentShares    DocumentShare[] @relation("DocumentShareMember")
```

Add to the `Task` model:

```prisma
documentMentions  DocumentMention[]
```

- [ ] **Step 5: Generate and apply migration**

```bash
npx prisma migrate dev --name add-documents-system
```

- [ ] **Step 6: Verify Prisma client generation**

```bash
npx prisma generate
```

- [ ] **Step 7: Commit**

```bash
git add prisma/
git commit -m "feat: add Document, DocumentShare, DocumentMention models"
```

---

## Task 2: Validation Schemas + Types + Constants

**Files:**

- Modify: `lib/validation/schemas.ts`
- Modify: `app/workspace/[workspaceUrl]/types.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`

- [ ] **Step 1: Add Zod schemas for documents**

Add to `lib/validation/schemas.ts`:

```typescript
// ── Documents ─────────────────────────────────────────────────────────────

export const createDocumentSchema = z.object({
  title: z.string().trim().max(500).optional().default('Untitled'),
  emoji: z.string().max(10).nullable().optional(),
  parentId: z.string().cuid().nullable().optional(),
  projectId: z.string().cuid().nullable().optional(),
  workspaceId: z.string().cuid(),
  visibility: z
    .enum(['PRIVATE', 'SHARED', 'WORKSPACE'])
    .optional()
    .default('PRIVATE'),
})

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  content: z.string().max(500000).nullable().optional(),
  emoji: z.string().max(10).nullable().optional(),
  visibility: z.enum(['PRIVATE', 'SHARED', 'WORKSPACE']).optional(),
  projectId: z.string().cuid().nullable().optional(),
  sortOrder: z.number().optional(),
})

export const moveDocumentSchema = z.object({
  parentId: z.string().cuid().nullable(),
  sortOrder: z.number(),
})

export const createDocumentShareSchema = z.object({
  memberId: z.string().cuid(),
  role: z.enum(['VIEWER', 'EDITOR', 'MANAGER']),
})

export const updateDocumentShareSchema = z.object({
  role: z.enum(['VIEWER', 'EDITOR', 'MANAGER']),
})
```

- [ ] **Step 2: Add TypeScript types**

Add to `app/workspace/[workspaceUrl]/types.ts`:

```typescript
// ── Documents ─────────────────────────────────────────────────────────────

export type DocVisibility = 'PRIVATE' | 'SHARED' | 'WORKSPACE'
export type DocShareRole = 'VIEWER' | 'EDITOR' | 'MANAGER'

export interface ApiDocument {
  id: string
  title: string
  emoji: string | null
  parentId: string | null
  projectId: string | null
  project?: { id: string; name: string } | null
  workspaceId: string
  createdById: string
  createdBy: { id: string; name: string; imageUrl: string | null }
  visibility: DocVisibility
  sortOrder: number
  createdAt: string
  updatedAt: string
  _count?: { children: number }
}

export interface ApiDocumentDetail extends ApiDocument {
  content: string | null
  children: ApiDocument[]
  shares: ApiDocumentShare[]
}

export interface ApiDocumentShare {
  id: string
  memberId: string
  member: { id: string; name: string; imageUrl: string | null }
  role: DocShareRole
  createdAt: string
}
```

Update the `Page` type union:

```typescript
export type Page =
  | 'my-tasks'
  | 'projects'
  | 'project-detail'
  | 'inbox'
  | 'task-detail'
  | 'documents'
  | 'document-editor'
```

- [ ] **Step 3: Add API routes and cache keys to constants**

Add to `app/workspace/[workspaceUrl]/constants.ts`:

```typescript
// Inside the API object:
documents: {
  list: '/api/documents',
  byId: (id: string) => `/api/documents/${id}`,
  shares: (id: string) => `/api/documents/${id}/shares`,
  shareById: (id: string, shareId: string) => `/api/documents/${id}/shares/${shareId}`,
  move: (id: string) => `/api/documents/${id}/move`,
},

// Inside the CACHE_KEY object:
documents: 'lumo:documents',
```

- [ ] **Step 4: Commit**

```bash
git add lib/validation/schemas.ts "app/workspace/[workspaceUrl]/types.ts" "app/workspace/[workspaceUrl]/constants.ts"
git commit -m "feat: add document types, validation schemas, and API constants"
```

---

## Task 3: Document CRUD API Routes

**Files:**

- Create: `app/api/documents/route.ts`
- Create: `app/api/documents/[id]/route.ts`

- [ ] **Step 1: Create GET (list) + POST (create) route**

Create `app/api/documents/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireUserWorkspace } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createDocumentSchema } from '@/lib/validation/schemas'

export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { searchParams } = request.nextUrl
  const visibility = searchParams.get('visibility')
  const projectId = searchParams.get('projectId')
  const parentId = searchParams.get('parentId')
  const search = searchParams.get('search')

  const memberId = ws.member.id

  // Base permission filter: user can see documents they own, shared with them, or workspace-wide
  const permissionFilter = {
    workspaceId: ws.workspaceId,
    OR: [
      { createdById: memberId },
      { visibility: 'WORKSPACE' as const },
      { shares: { some: { memberId } } },
    ],
  }

  // Additional filters
  const where: Record<string, unknown> = { ...permissionFilter }

  if (visibility === 'PRIVATE') {
    where.createdById = memberId
    where.visibility = 'PRIVATE'
    delete (where as Record<string, unknown>).OR
  } else if (visibility === 'SHARED') {
    where.visibility = 'SHARED'
  } else if (visibility === 'WORKSPACE') {
    where.visibility = 'WORKSPACE'
  }

  if (projectId) where.projectId = projectId
  if (parentId) where.parentId = parentId
  if (parentId === null || searchParams.get('rootOnly') === 'true') {
    where.parentId = null
  }
  if (search) where.title = { contains: search, mode: 'insensitive' }

  const documents = await prisma.document.findMany({
    where,
    include: {
      project: { select: { id: true, name: true } },
      createdBy: {
        select: {
          id: true,
          user: { select: { name: true, imageUrl: true } },
        },
      },
      shares: {
        include: {
          member: {
            select: {
              id: true,
              user: { select: { name: true, imageUrl: true } },
            },
          },
        },
      },
      _count: { select: { children: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  const shaped = documents.map(doc => ({
    ...doc,
    createdBy: {
      id: doc.createdBy.id,
      name: doc.createdBy.user?.name ?? 'Unknown',
      imageUrl: doc.createdBy.user?.imageUrl ?? null,
    },
    shares: doc.shares.map(s => ({
      ...s,
      member: {
        id: s.member.id,
        name: s.member.user?.name ?? 'Unknown',
        imageUrl: s.member.user?.imageUrl ?? null,
      },
    })),
  }))

  return NextResponse.json({ documents: shaped })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const body = await request.json()
  const parsed = createDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const document = await prisma.document.create({
    data: {
      title: parsed.data.title,
      emoji: parsed.data.emoji ?? null,
      parentId: parsed.data.parentId ?? null,
      projectId: parsed.data.projectId ?? null,
      workspaceId: ws.workspaceId,
      createdById: ws.member.id,
      visibility: parsed.data.visibility,
    },
    include: {
      project: { select: { id: true, name: true } },
      createdBy: {
        select: {
          id: true,
          user: { select: { name: true, imageUrl: true } },
        },
      },
      _count: { select: { children: true } },
    },
  })

  const shaped = {
    ...document,
    createdBy: {
      id: document.createdBy.id,
      name: document.createdBy.user?.name ?? 'Unknown',
      imageUrl: document.createdBy.user?.imageUrl ?? null,
    },
  }

  return NextResponse.json({ document: shaped }, { status: 201 })
}
```

- [ ] **Step 2: Create GET + PATCH + DELETE for single document**

Create `app/api/documents/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireUserWorkspace } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { updateDocumentSchema } from '@/lib/validation/schemas'

async function getDocumentWithPermission(
  documentId: string,
  memberId: string,
  workspaceId: string
) {
  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      workspaceId,
      OR: [
        { createdById: memberId },
        { visibility: 'WORKSPACE' },
        { shares: { some: { memberId } } },
      ],
    },
    include: {
      project: { select: { id: true, name: true } },
      createdBy: {
        select: {
          id: true,
          user: { select: { name: true, imageUrl: true } },
        },
      },
      children: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          title: true,
          emoji: true,
          sortOrder: true,
          updatedAt: true,
        },
      },
      shares: {
        include: {
          member: {
            select: {
              id: true,
              user: { select: { name: true, imageUrl: true } },
            },
          },
        },
      },
      _count: { select: { children: true } },
    },
  })
  return doc
}

function getUserRole(
  doc: { createdById: string; shares: { memberId: string; role: string }[] },
  memberId: string
): 'OWNER' | 'MANAGER' | 'EDITOR' | 'VIEWER' | null {
  if (doc.createdById === memberId) return 'OWNER'
  const share = doc.shares.find(s => s.memberId === memberId)
  if (share) return share.role as 'MANAGER' | 'EDITOR' | 'VIEWER'
  return null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const doc = await getDocumentWithPermission(id, ws.member.id, ws.workspaceId)
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const shaped = {
    ...doc,
    createdBy: {
      id: doc.createdBy.id,
      name: doc.createdBy.user?.name ?? 'Unknown',
      imageUrl: doc.createdBy.user?.imageUrl ?? null,
    },
    shares: doc.shares.map(s => ({
      ...s,
      member: {
        id: s.member.id,
        name: s.member.user?.name ?? 'Unknown',
        imageUrl: s.member.user?.imageUrl ?? null,
      },
    })),
  }

  return NextResponse.json({ document: shaped })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const doc = await getDocumentWithPermission(id, ws.member.id, ws.workspaceId)
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const role = getUserRole(doc, ws.member.id)
  if (!role || role === 'VIEWER') {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = updateDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  // Only owner can change visibility
  if (parsed.data.visibility && role !== 'OWNER') {
    return NextResponse.json(
      { error: 'Only the owner can change visibility' },
      { status: 403 }
    )
  }

  const updated = await prisma.$transaction(async tx => {
    const updatedDoc = await tx.document.update({
      where: { id },
      data: parsed.data,
    })

    // Sync DocumentMention if content was updated
    if (parsed.data.content) {
      await syncDocumentMentions(tx, id, parsed.data.content)
    }

    return updatedDoc
  })

  return NextResponse.json({ document: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const doc = await prisma.document.findFirst({
    where: { id, workspaceId: ws.workspaceId },
  })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }
  if (doc.createdById !== ws.member.id) {
    return NextResponse.json(
      { error: 'Only the owner can delete a document' },
      { status: 403 }
    )
  }

  await prisma.$transaction(async tx => {
    // Re-parent children to null (become root-level)
    await tx.document.updateMany({
      where: { parentId: id },
      data: { parentId: null },
    })
    await tx.document.delete({ where: { id } })
  })

  return NextResponse.json({ success: true })
}

// ── Helper: sync @mentions in content ──────────────────────────────────

async function syncDocumentMentions(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  documentId: string,
  content: string
) {
  // Parse Tiptap JSON to extract task mention IDs
  const taskIds = extractTaskMentionIds(content)

  // Get current mentions
  const existing = await tx.documentMention.findMany({
    where: { documentId },
    select: { taskId: true },
  })
  const existingIds = new Set(existing.map(m => m.taskId))
  const newIds = new Set(taskIds)

  // Delete removed mentions
  const toDelete = [...existingIds].filter(id => !newIds.has(id))
  if (toDelete.length > 0) {
    await tx.documentMention.deleteMany({
      where: { documentId, taskId: { in: toDelete } },
    })
  }

  // Create new mentions
  const toCreate = [...newIds].filter(id => !existingIds.has(id))
  if (toCreate.length > 0) {
    await tx.documentMention.createMany({
      data: toCreate.map(taskId => ({ documentId, taskId })),
    })
  }
}

function extractTaskMentionIds(content: string): string[] {
  try {
    const json = JSON.parse(content)
    const ids: string[] = []
    function walk(node: Record<string, unknown>) {
      if (
        node.type === 'mention' &&
        (node.attrs as Record<string, unknown>)?.mentionType === 'task'
      ) {
        const id = (node.attrs as Record<string, unknown>)?.id
        if (typeof id === 'string') ids.push(id)
      }
      const nodeContent = node.content
      if (Array.isArray(nodeContent)) {
        nodeContent.forEach((child: Record<string, unknown>) => walk(child))
      }
    }
    walk(json)
    return [...new Set(ids)]
  } catch {
    return []
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/documents/
git commit -m "feat: add document CRUD API routes with permission checks"
```

---

## Task 4: Share Management + Move + Task-Documents API

**Files:**

- Create: `app/api/documents/[id]/shares/route.ts`
- Create: `app/api/documents/[id]/shares/[shareId]/route.ts`
- Create: `app/api/documents/[id]/move/route.ts`
- Create: `app/api/tasks/[id]/documents/route.ts`

- [ ] **Step 1: Create shares list + add route**

Create `app/api/documents/[id]/shares/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireUserWorkspace } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createDocumentShareSchema } from '@/lib/validation/schemas'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const doc = await prisma.document.findFirst({
    where: {
      id,
      workspaceId: ws.workspaceId,
      OR: [
        { createdById: ws.member.id },
        {
          shares: {
            some: { memberId: ws.member.id, role: { in: ['MANAGER'] } },
          },
        },
      ],
    },
  })
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  const shares = await prisma.documentShare.findMany({
    where: { documentId: id },
    include: {
      member: {
        select: {
          id: true,
          user: { select: { name: true, imageUrl: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const shaped = shares.map(s => ({
    ...s,
    member: {
      id: s.member.id,
      name: s.member.user?.name ?? 'Unknown',
      imageUrl: s.member.user?.imageUrl ?? null,
    },
  }))

  return NextResponse.json({ shares: shaped })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const doc = await prisma.document.findFirst({
    where: {
      id,
      workspaceId: ws.workspaceId,
      OR: [
        { createdById: ws.member.id },
        { shares: { some: { memberId: ws.member.id, role: 'MANAGER' } } },
      ],
    },
  })
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  const body = await request.json()
  const parsed = createDocumentShareSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const share = await prisma.$transaction(async tx => {
    // Auto-set visibility to SHARED if currently PRIVATE
    if (doc.visibility === 'PRIVATE') {
      await tx.document.update({
        where: { id },
        data: { visibility: 'SHARED' },
      })
    }

    return tx.documentShare.upsert({
      where: {
        documentId_memberId: { documentId: id, memberId: parsed.data.memberId },
      },
      create: {
        documentId: id,
        memberId: parsed.data.memberId,
        role: parsed.data.role,
      },
      update: { role: parsed.data.role },
      include: {
        member: {
          select: {
            id: true,
            user: { select: { name: true, imageUrl: true } },
          },
        },
      },
    })
  })

  const shaped = {
    ...share,
    member: {
      id: share.member.id,
      name: share.member.user?.name ?? 'Unknown',
      imageUrl: share.member.user?.imageUrl ?? null,
    },
  }

  return NextResponse.json({ share: shaped }, { status: 201 })
}
```

- [ ] **Step 2: Create share update + delete route**

Create `app/api/documents/[id]/shares/[shareId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireUserWorkspace } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { updateDocumentShareSchema } from '@/lib/validation/schemas'

async function checkManagePermission(
  documentId: string,
  memberId: string,
  workspaceId: string
) {
  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      workspaceId,
      OR: [
        { createdById: memberId },
        { shares: { some: { memberId, role: 'MANAGER' } } },
      ],
    },
  })
  return doc
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id, shareId } = await params
  const doc = await checkManagePermission(id, ws.member.id, ws.workspaceId)
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  const body = await request.json()
  const parsed = updateDocumentShareSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const updated = await prisma.documentShare.update({
    where: { id: shareId },
    data: { role: parsed.data.role },
  })

  return NextResponse.json({ share: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id, shareId } = await params
  const doc = await checkManagePermission(id, ws.member.id, ws.workspaceId)
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  await prisma.documentShare.delete({ where: { id: shareId } })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 3: Create move route**

Create `app/api/documents/[id]/move/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireUserWorkspace } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { moveDocumentSchema } from '@/lib/validation/schemas'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const doc = await prisma.document.findFirst({
    where: {
      id,
      workspaceId: ws.workspaceId,
      OR: [
        { createdById: ws.member.id },
        { visibility: 'WORKSPACE' },
        {
          shares: {
            some: {
              memberId: ws.member.id,
              role: { in: ['EDITOR', 'MANAGER'] },
            },
          },
        },
      ],
    },
  })
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  const body = await request.json()
  const parsed = moveDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  // Prevent moving a document into its own subtree
  if (parsed.data.parentId) {
    let current = parsed.data.parentId
    while (current) {
      if (current === id) {
        return NextResponse.json(
          { error: 'Cannot move a document into its own subtree' },
          { status: 400 }
        )
      }
      const parent = await prisma.document.findUnique({
        where: { id: current },
        select: { parentId: true },
      })
      current = parent?.parentId ?? null
    }
  }

  const updated = await prisma.document.update({
    where: { id },
    data: {
      parentId: parsed.data.parentId,
      sortOrder: parsed.data.sortOrder,
    },
  })

  return NextResponse.json({ document: updated })
}
```

- [ ] **Step 4: Create task-documents relation route**

Create `app/api/tasks/[id]/documents/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireUserWorkspace } from '@/lib/auth'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id: taskId } = await params
  const memberId = ws.member.id

  const mentions = await prisma.documentMention.findMany({
    where: {
      taskId,
      document: {
        workspaceId: ws.workspaceId,
        OR: [
          { createdById: memberId },
          { visibility: 'WORKSPACE' },
          { shares: { some: { memberId } } },
        ],
      },
    },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          emoji: true,
          updatedAt: true,
        },
      },
    },
  })

  const documents = mentions.map(m => m.document)

  return NextResponse.json({ documents })
}
```

- [ ] **Step 5: Commit**

```bash
git add "app/api/documents/" "app/api/tasks/[id]/documents/"
git commit -m "feat: add document shares, move, and task-documents API routes"
```

---

## Task 5: i18n Keys

**Files:**

- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/zh.json`

- [ ] **Step 1: Add English translations**

Add to `lib/i18n/en.json`:

```json
"sidebar.documents": "Documents",

"documents.title": "Documents",
"documents.subtitle": "Create and share docs with your team",
"documents.newDocument": "New Document",
"documents.filterAll": "All",
"documents.filterPersonal": "Personal",
"documents.filterShared": "Shared",
"documents.filterWorkspace": "Workspace",
"documents.untitled": "Untitled",
"documents.search": "Search documents...",
"documents.empty": "No documents yet",
"documents.emptyFiltered": "No documents match this filter",
"documents.delete": "Delete",
"documents.deleteConfirm": "Are you sure you want to delete this document?",
"documents.duplicate": "Duplicate",
"documents.copyLink": "Copy link",
"documents.sharedWith": "Shared with {count} members",

"documentEditor.saving": "Saving...",
"documentEditor.saved": "Saved",
"documentEditor.savedAgo": "Saved {time}",
"documentEditor.slashPlaceholder": "Type '/' for commands...",
"documentEditor.tocTitle": "Table of Contents",
"documentEditor.childDocs": "Sub-documents",
"documentEditor.addChildDoc": "Add sub-document",
"documentEditor.visibility": "Visibility",
"documentEditor.share": "Share",
"documentEditor.project": "Project"
```

- [ ] **Step 2: Add Chinese translations**

Add to `lib/i18n/zh.json`:

```json
"sidebar.documents": "文档",

"documents.title": "文档",
"documents.subtitle": "创建和分享团队文档",
"documents.newDocument": "新建文档",
"documents.filterAll": "全部",
"documents.filterPersonal": "个人",
"documents.filterShared": "已分享",
"documents.filterWorkspace": "工作区",
"documents.untitled": "无标题",
"documents.search": "搜索文档...",
"documents.empty": "暂无文档",
"documents.emptyFiltered": "没有匹配的文档",
"documents.delete": "删除",
"documents.deleteConfirm": "确定要删除此文档吗？",
"documents.duplicate": "复制",
"documents.copyLink": "复制链接",
"documents.sharedWith": "已分享给 {count} 位成员",

"documentEditor.saving": "保存中...",
"documentEditor.saved": "已保存",
"documentEditor.savedAgo": "已保存 {time}",
"documentEditor.slashPlaceholder": "输入 '/' 打开命令菜单...",
"documentEditor.tocTitle": "目录",
"documentEditor.childDocs": "子文档",
"documentEditor.addChildDoc": "添加子文档",
"documentEditor.visibility": "可见性",
"documentEditor.share": "分享",
"documentEditor.project": "项目"
```

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/en.json lib/i18n/zh.json
git commit -m "feat: add document i18n keys for en and zh"
```

---

## Task 6: useDocuments Hook

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useDocuments.ts`

- [ ] **Step 1: Create the hook**

Create `app/workspace/[workspaceUrl]/hooks/useDocuments.ts`:

```typescript
'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ApiDocument } from '../types'
import { readCache, writeCache } from '../cache'
import { API, CACHE_KEY } from '../constants'

export function useDocuments() {
  const [documents, setDocuments] = useState<ApiDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)

  useEffect(() => {
    const cached = readCache<ApiDocument[]>(CACHE_KEY.documents)
    if (cached) {
      setDocuments(cached)
      seeded.current = true
    }
  }, [])

  const fetchDocuments = useCallback(async (visibility?: string) => {
    if (!seeded.current) setLoading(true)
    setError(null)
    try {
      const url = visibility
        ? `${API.documents.list}?visibility=${visibility}`
        : API.documents.list
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load documents')
      const data = (await res.json()) as { documents: ApiDocument[] }
      setDocuments(data.documents)
      writeCache(CACHE_KEY.documents, data.documents)
      seeded.current = true
    } catch {
      if (!seeded.current) setError('Could not load documents.')
    } finally {
      setLoading(false)
    }
  }, [])

  return { documents, setDocuments, loading, error, fetchDocuments }
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/workspace/[workspaceUrl]/hooks/useDocuments.ts"
git commit -m "feat: add useDocuments data fetching hook"
```

---

## Task 7: DocumentsPage — Listing View

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx`

- [ ] **Step 1: Create the listing page component**

Create `app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx`:

```typescript
'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { Plus, Search, MoreHorizontal, Trash2, Copy, Link } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getInitials } from '@/lib/utils/getInitials'
import { AsyncContent } from '@/components/AsyncContent'
import { ApiDocument, DocVisibility } from '../../types'
import { cn } from '@/lib/utils'

interface DocumentsPageProps {
  documents: ApiDocument[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onNewDocument: () => void
  onSelectDocument: (doc: ApiDocument) => void
  onDeleteDocument: (id: string) => void
}

const FILTERS: { key: DocVisibility | 'ALL'; msgId: string }[] = [
  { key: 'ALL', msgId: 'documents.filterAll' },
  { key: 'PRIVATE', msgId: 'documents.filterPersonal' },
  { key: 'SHARED', msgId: 'documents.filterShared' },
  { key: 'WORKSPACE', msgId: 'documents.filterWorkspace' },
]

export function DocumentsPage({
  documents,
  loading,
  error,
  onRetry,
  onNewDocument,
  onSelectDocument,
  onDeleteDocument,
}: DocumentsPageProps) {
  const intl = useIntl()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<DocVisibility | 'ALL'>('ALL')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let result = documents
    if (filter !== 'ALL') {
      result = result.filter(d => d.visibility === filter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(d => d.title.toLowerCase().includes(q))
    }
    return result
  }, [documents, filter, search])

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
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  function getSubtitle(doc: ApiDocument): string {
    if (doc.project) return `in ${doc.project.name}`
    if (doc.visibility === 'PRIVATE') return intl.formatMessage({ id: 'documents.filterPersonal' })
    if (doc.visibility === 'SHARED') {
      const count = (doc as ApiDocument & { shares?: unknown[] }).shares?.length ?? 0
      return intl.formatMessage({ id: 'documents.sharedWith' }, { count })
    }
    return intl.formatMessage({ id: 'documents.filterWorkspace' })
  }

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      <div className='px-6 pt-6 pb-4'>
        <div className='flex items-center justify-between mb-1'>
          <div>
            <h1 className='text-2xl font-bold'>
              {intl.formatMessage({ id: 'documents.title' })}
            </h1>
            <p className='text-sm text-muted-foreground'>
              {intl.formatMessage({ id: 'documents.subtitle' })}
            </p>
          </div>
          <Button size='sm' onClick={onNewDocument}>
            <Plus className='size-4 mr-1' />
            {intl.formatMessage({ id: 'documents.newDocument' })}
          </Button>
        </div>

        <div className='flex items-center gap-2 mt-4'>
          {FILTERS.map(f => (
            <button
              key={f.key}
              type='button'
              className={cn(
                'px-3 py-1 text-xs rounded-md transition-colors',
                filter === f.key
                  ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setFilter(f.key)}
            >
              {intl.formatMessage({ id: f.msgId })}
            </button>
          ))}

          <div className='ml-auto relative'>
            <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground' />
            <Input
              placeholder={intl.formatMessage({ id: 'documents.search' })}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className='pl-8 h-8 w-48 text-xs'
            />
          </div>
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-6'>
        <AsyncContent loading={loading} error={error} onRetry={onRetry}>
          {filtered.length === 0 ? (
            <div className='text-center text-muted-foreground text-sm py-12'>
              {intl.formatMessage({
                id: search || filter !== 'ALL'
                  ? 'documents.emptyFiltered'
                  : 'documents.empty',
              })}
            </div>
          ) : (
            <div className='divide-y divide-border'>
              {filtered.map(doc => (
                <div
                  key={doc.id}
                  className='flex items-center justify-between py-3 px-2 hover:bg-muted/50 rounded-md cursor-pointer transition-colors group'
                  onClick={() => onSelectDocument(doc)}
                >
                  <div className='flex items-center gap-3 min-w-0'>
                    <span className='text-lg shrink-0'>{doc.emoji ?? '📄'}</span>
                    <div className='min-w-0'>
                      <div className='font-medium text-sm truncate'>
                        {doc.title}
                      </div>
                      <div className='text-xs text-muted-foreground truncate'>
                        {getSubtitle(doc)}
                      </div>
                    </div>
                  </div>

                  <div className='flex items-center gap-3 shrink-0'>
                    <Avatar className='size-5'>
                      <AvatarImage src={doc.createdBy.imageUrl ?? undefined} />
                      <AvatarFallback className='text-[9px]'>
                        {getInitials(doc.createdBy.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className='text-xs text-muted-foreground w-16 text-right'>
                      {formatRelativeTime(doc.updatedAt)}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='size-6 opacity-0 group-hover:opacity-100'
                          onClick={e => e.stopPropagation()}
                        >
                          <MoreHorizontal className='size-3.5' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem onClick={e => { e.stopPropagation() }}>
                          <Link className='size-3.5 mr-2' />
                          {intl.formatMessage({ id: 'documents.copyLink' })}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className='text-red-500'
                          onClick={e => {
                            e.stopPropagation()
                            setDeleteId(doc.id)
                          }}
                        >
                          <Trash2 className='size-3.5 mr-2' />
                          {intl.formatMessage({ id: 'documents.delete' })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AsyncContent>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'documents.delete' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'documents.deleteConfirm' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) onDeleteDocument(deleteId)
                setDeleteId(null)
              }}
            >
              {intl.formatMessage({ id: 'documents.delete' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/DocumentsPage.tsx"
git commit -m "feat: add DocumentsPage listing component"
```

---

## Task 8: Shared Editor Extensions + Slash Commands

**Files:**

- Create: `lib/editor/extensions.ts`
- Create: `lib/editor/slash-command.ts`
- Create: `lib/editor/slash-command-list.tsx`

- [ ] **Step 1: Extract shared extensions**

Create `lib/editor/extensions.ts` — extract the shared Tiptap extensions that both DescriptionEditor and DocumentEditor will use:

```typescript
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import type { Extensions } from '@tiptap/core'

export function getBaseExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'text-blue-500 underline cursor-pointer' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Typography,
  ]
}
```

- [ ] **Step 2: Create slash command extension**

Create `lib/editor/slash-command.ts`:

```typescript
import { Extension } from '@tiptap/core'
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion'
import type { Editor } from '@tiptap/core'

export interface SlashCommandItem {
  title: string
  description: string
  icon: string
  category: string
  command: (editor: Editor) => void
}

export function getSlashCommandItems(): SlashCommandItem[] {
  return [
    // Basic
    {
      title: 'Text',
      description: 'Plain text block',
      icon: '📝',
      category: 'Basic',
      command: editor => editor.chain().focus().setParagraph().run(),
    },
    {
      title: 'Heading 1',
      description: 'Large heading',
      icon: 'H1',
      category: 'Basic',
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: 'Heading 2',
      description: 'Medium heading',
      icon: 'H2',
      category: 'Basic',
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: 'Heading 3',
      description: 'Small heading',
      icon: 'H3',
      category: 'Basic',
      command: editor =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: 'Bullet List',
      description: 'Unordered list',
      icon: '•',
      category: 'Basic',
      command: editor => editor.chain().focus().toggleBulletList().run(),
    },
    {
      title: 'Numbered List',
      description: 'Ordered list',
      icon: '1.',
      category: 'Basic',
      command: editor => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      title: 'Task List',
      description: 'Checklist with checkboxes',
      icon: '☑️',
      category: 'Basic',
      command: editor => editor.chain().focus().toggleTaskList().run(),
    },
    // Media
    {
      title: 'Image',
      description: 'Insert an image',
      icon: '🖼️',
      category: 'Media',
      command: editor => {
        const url = window.prompt('Image URL')
        if (url) editor.chain().focus().setImage({ src: url }).run()
      },
    },
    // Advanced
    {
      title: 'Table',
      description: 'Insert a table',
      icon: '📊',
      category: 'Advanced',
      command: editor =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: 'Code Block',
      description: 'Code with syntax highlighting',
      icon: '💻',
      category: 'Advanced',
      command: editor => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: 'Blockquote',
      description: 'Quoted text',
      icon: '💬',
      category: 'Advanced',
      command: editor => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      title: 'Divider',
      description: 'Horizontal line',
      icon: '—',
      category: 'Advanced',
      command: editor => editor.chain().focus().setHorizontalRule().run(),
    },
  ]
}

export type SlashCommandPopupState = {
  items: SlashCommandItem[]
  rect: DOMRect
  command: (item: SlashCommandItem) => void
}

export function buildSlashCommandSuggestion(
  onOpen: (state: SlashCommandPopupState) => void,
  onUpdate: (state: SlashCommandPopupState) => void,
  onClose: () => void,
  listRef: React.RefObject<{
    onKeyDown: (props: { event: KeyboardEvent }) => boolean
  } | null>
): Partial<SuggestionOptions> {
  const allItems = getSlashCommandItems()

  return {
    char: '/',
    items: ({ query }) => {
      if (!query) return allItems
      const q = query.toLowerCase()
      return allItems.filter(
        item =>
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
      )
    },
    render() {
      return {
        onStart(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          onOpen({
            items: props.items as SlashCommandItem[],
            rect,
            command: (item: SlashCommandItem) => {
              props.command(item)
            },
          })
        },
        onUpdate(props) {
          const rect = props.clientRect?.()
          if (!rect) return
          onUpdate({
            items: props.items as SlashCommandItem[],
            rect,
            command: (item: SlashCommandItem) => {
              props.command(item)
            },
          })
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            onClose()
            return true
          }
          return listRef.current?.onKeyDown(props) ?? false
        },
        onExit() {
          onClose()
        },
      }
    },
    command: ({ editor, range, props }) => {
      const item = props as unknown as SlashCommandItem
      editor.chain().focus().deleteRange(range).run()
      item.command(editor)
    },
  }
}

export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {} as Partial<SuggestionOptions>,
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
```

- [ ] **Step 3: Create slash command list UI**

Create `lib/editor/slash-command-list.tsx`:

```typescript
'use client'

import {
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react'
import type { SlashCommandItem } from './slash-command'

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  SlashCommandListProps
>(function SlashCommandList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index]
      if (item) command(item)
    },
    [items, command]
  )

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) return null

  // Group by category
  const grouped = items.reduce<Record<string, SlashCommandItem[]>>(
    (acc, item) => {
      if (!acc[item.category]) acc[item.category] = []
      acc[item.category].push(item)
      return acc
    },
    {}
  )

  let globalIndex = 0

  return (
    <div className='z-50 w-56 rounded-lg border bg-popover shadow-lg overflow-hidden'>
      <div className='max-h-64 overflow-y-auto p-1'>
        {Object.entries(grouped).map(([category, categoryItems]) => (
          <div key={category}>
            <div className='px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider'>
              {category}
            </div>
            {categoryItems.map((item) => {
              const idx = globalIndex++
              return (
                <button
                  key={item.title}
                  type='button'
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                    idx === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-muted'
                  }`}
                  onClick={() => selectItem(idx)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className='w-5 text-center shrink-0'>{item.icon}</span>
                  <div className='min-w-0'>
                    <div className='font-medium'>{item.title}</div>
                    <div className='text-[10px] text-muted-foreground truncate'>
                      {item.description}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
})
```

- [ ] **Step 4: Commit**

```bash
git add lib/editor/
git commit -m "feat: add shared editor extensions and slash command system"
```

---

## Task 9: DocumentEditor Component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/DocumentEditor.tsx`
- Create: `app/workspace/[workspaceUrl]/components/document/DocumentTOC.tsx`
- Create: `app/workspace/[workspaceUrl]/components/document/EmojiPicker.tsx`
- Create: `app/workspace/[workspaceUrl]/components/document/DocumentBreadcrumb.tsx`

- [ ] **Step 1: Create DocumentTOC component**

Create `app/workspace/[workspaceUrl]/components/document/DocumentTOC.tsx`:

```typescript
'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { FileText, Plus } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import type { ApiDocument } from '../../types'
import { cn } from '@/lib/utils'

interface TocHeading {
  id: string
  text: string
  level: number
}

interface DocumentTOCProps {
  editor: Editor | null
  children: ApiDocument[]
  onChildClick: (doc: ApiDocument) => void
  onAddChild: () => void
}

export function DocumentTOC({
  editor,
  children,
  onChildClick,
  onAddChild,
}: DocumentTOCProps) {
  const intl = useIntl()

  const headings = useMemo<TocHeading[]>(() => {
    if (!editor) return []
    const result: TocHeading[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const id = `heading-${pos}`
        result.push({
          id,
          text: node.textContent,
          level: node.attrs.level as number,
        })
      }
    })
    return result
  }, [editor, editor?.state.doc])

  return (
    <div className='w-52 shrink-0 border-r overflow-y-auto p-4 text-xs'>
      {headings.length > 0 && (
        <div className='mb-4'>
          <div className='text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2'>
            {intl.formatMessage({ id: 'documentEditor.tocTitle' })}
          </div>
          {headings.map((h) => (
            <button
              key={h.id}
              type='button'
              className={cn(
                'block w-full text-left py-1 text-muted-foreground hover:text-foreground truncate transition-colors',
                h.level === 1 && 'font-medium text-foreground',
                h.level === 2 && 'pl-3',
                h.level === 3 && 'pl-6'
              )}
              onClick={() => {
                const el = document.getElementById(h.id)
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {h.text || 'Untitled'}
            </button>
          ))}
        </div>
      )}

      {children.length > 0 && (
        <div>
          <div className='text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2'>
            {intl.formatMessage({ id: 'documentEditor.childDocs' })}
          </div>
          {children.map((child) => (
            <button
              key={child.id}
              type='button'
              className='flex items-center gap-1.5 w-full text-left py-1 text-muted-foreground hover:text-foreground truncate transition-colors'
              onClick={() => onChildClick(child)}
            >
              <FileText className='size-3 shrink-0' />
              <span className='truncate'>{child.emoji ? `${child.emoji} ` : ''}{child.title}</span>
            </button>
          ))}
        </div>
      )}

      <button
        type='button'
        className='flex items-center gap-1.5 w-full text-left py-1 mt-2 text-muted-foreground hover:text-foreground transition-colors'
        onClick={onAddChild}
      >
        <Plus className='size-3' />
        <span>{intl.formatMessage({ id: 'documentEditor.addChildDoc' })}</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create EmojiPicker component**

Create `app/workspace/[workspaceUrl]/components/document/EmojiPicker.tsx`:

```typescript
'use client'

import { useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const COMMON_EMOJIS = [
  '📄', '📝', '📋', '📌', '📎', '📊', '📈', '📉',
  '🎯', '🚀', '💡', '🔧', '⚙️', '🏗️', '🎨', '🖊️',
  '📦', '🗂️', '📁', '📂', '🗃️', '🗄️', '📇', '🗑️',
  '✅', '❌', '⭐', '🔥', '💎', '🏆', '🎉', '🤖',
  '🐛', '🔒', '🔑', '🌍', '⚡', '🧪', '📐', '🧩',
]

interface EmojiPickerProps {
  value: string | null
  onChange: (emoji: string | null) => void
}

export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          className='text-3xl hover:bg-muted rounded-md p-1 transition-colors'
        >
          {value || '📄'}
        </button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-2' align='start'>
        <div className='grid grid-cols-8 gap-1'>
          {COMMON_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type='button'
              className='text-xl p-1.5 rounded hover:bg-muted transition-colors'
              onClick={() => {
                onChange(emoji)
                setOpen(false)
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
        {value && (
          <button
            type='button'
            className='w-full mt-2 text-xs text-muted-foreground hover:text-foreground py-1'
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
          >
            Remove emoji
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 3: Create DocumentBreadcrumb component**

Create `app/workspace/[workspaceUrl]/components/document/DocumentBreadcrumb.tsx`:

```typescript
'use client'

import { useIntl } from 'react-intl'
import { ChevronRight } from 'lucide-react'

interface BreadcrumbItem {
  id: string
  title: string
  emoji?: string | null
}

interface DocumentBreadcrumbProps {
  ancestors: BreadcrumbItem[]
  current: BreadcrumbItem
  onNavigate: (id: string | null) => void
}

export function DocumentBreadcrumb({
  ancestors,
  current,
  onNavigate,
}: DocumentBreadcrumbProps) {
  const intl = useIntl()

  return (
    <nav className='flex items-center gap-1 text-xs text-muted-foreground mb-4'>
      <button
        type='button'
        className='hover:text-foreground transition-colors'
        onClick={() => onNavigate(null)}
      >
        {intl.formatMessage({ id: 'sidebar.documents' })}
      </button>
      {ancestors.map(item => (
        <span key={item.id} className='flex items-center gap-1'>
          <ChevronRight className='size-3' />
          <button
            type='button'
            className='hover:text-foreground transition-colors'
            onClick={() => onNavigate(item.id)}
          >
            {item.emoji ? `${item.emoji} ` : ''}{item.title}
          </button>
        </span>
      ))}
      <ChevronRight className='size-3' />
      <span className='text-foreground'>
        {current.emoji ? `${current.emoji} ` : ''}{current.title}
      </span>
    </nav>
  )
}
```

- [ ] **Step 4: Create DocumentEditor component**

Create `app/workspace/[workspaceUrl]/components/DocumentEditor.tsx`:

```typescript
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import { useIntl } from 'react-intl'
import { getBaseExtensions } from '@/lib/editor/extensions'
import {
  SlashCommandExtension,
  buildSlashCommandSuggestion,
  type SlashCommandItem,
  type SlashCommandPopupState,
} from '@/lib/editor/slash-command'
import {
  SlashCommandList,
  type SlashCommandListRef,
} from '@/lib/editor/slash-command-list'

interface DocumentEditorProps {
  content: string | null
  onUpdate: (content: string) => void
  placeholder?: string
}

export function DocumentEditor({
  content,
  onUpdate,
  placeholder,
}: DocumentEditorProps) {
  const intl = useIntl()
  const [slashPopup, setSlashPopup] = useState<SlashCommandPopupState | null>(null)
  const slashListRef = useRef<SlashCommandListRef | null>(null)

  const editor = useEditor({
    extensions: [
      ...getBaseExtensions(),
      Placeholder.configure({
        placeholder: placeholder ?? intl.formatMessage({ id: 'documentEditor.slashPlaceholder' }),
      }),
      SlashCommandExtension.configure({
        suggestion: buildSlashCommandSuggestion(
          (state) => setSlashPopup(state),
          (state) => setSlashPopup(state),
          () => setSlashPopup(null),
          slashListRef
        ),
      }),
    ],
    content: content ? JSON.parse(content) : undefined,
    onUpdate: ({ editor: e }) => {
      onUpdate(JSON.stringify(e.getJSON()))
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[300px]',
      },
    },
  })

  // Update content when prop changes (e.g. switching documents)
  useEffect(() => {
    if (editor && content) {
      const currentContent = JSON.stringify(editor.getJSON())
      if (currentContent !== content) {
        editor.commands.setContent(JSON.parse(content))
      }
    }
  }, [editor, content])

  return (
    <div className='relative'>
      <EditorContent editor={editor} />

      {slashPopup &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: slashPopup.rect.left,
              top: slashPopup.rect.bottom + 4,
              zIndex: 50,
            }}
          >
            <SlashCommandList
              ref={slashListRef}
              items={slashPopup.items}
              command={slashPopup.command}
            />
          </div>,
          document.body
        )}
    </div>
  )
}

export { useEditor as useDocumentEditor }
```

- [ ] **Step 5: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/DocumentEditor.tsx" "app/workspace/[workspaceUrl]/components/document/"
git commit -m "feat: add DocumentEditor with slash commands, TOC, emoji picker, breadcrumb"
```

---

## Task 10: DocumentEditorPage — Full-Page Editor

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`

- [ ] **Step 1: Create the editor page**

Create `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`:

```typescript
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { DocumentEditor } from '../DocumentEditor'
import { DocumentTOC } from '../document/DocumentTOC'
import { EmojiPicker } from '../document/EmojiPicker'
import { DocumentBreadcrumb } from '../document/DocumentBreadcrumb'
import type { ApiDocumentDetail, ApiDocument } from '../../types'
import { API } from '../../constants'

interface DocumentEditorPageProps {
  documentId: string
  onNavigateToDocument: (id: string) => void
  onNavigateToDocuments: () => void
  onCreateChildDocument: (parentId: string) => void
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function DocumentEditorPage({
  documentId,
  onNavigateToDocument,
  onNavigateToDocuments,
  onCreateChildDocument,
}: DocumentEditorPageProps) {
  const intl = useIntl()
  const [doc, setDoc] = useState<ApiDocumentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [title, setTitle] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<{ getJSON: () => unknown } | null>(null)

  // Fetch document
  useEffect(() => {
    setLoading(true)
    fetch(API.documents.byId(documentId))
      .then(res => res.json())
      .then(data => {
        setDoc(data.document)
        setTitle(data.document.title)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [documentId])

  // Auto-save with debounce
  const save = useCallback(
    async (updates: { title?: string; content?: string; emoji?: string | null }) => {
      setSaveStatus('saving')
      try {
        const res = await fetch(API.documents.byId(documentId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
        if (res.ok) {
          setSaveStatus('saved')
          const data = await res.json()
          setDoc(prev => (prev ? { ...prev, ...data.document } : prev))
        } else {
          setSaveStatus('error')
        }
      } catch {
        setSaveStatus('error')
      }
    },
    [documentId]
  )

  const debouncedSave = useCallback(
    (updates: { title?: string; content?: string; emoji?: string | null }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => save(updates), 1000)
    },
    [save]
  )

  const handleContentUpdate = useCallback(
    (content: string) => {
      debouncedSave({ content })
    },
    [debouncedSave]
  )

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle)
      debouncedSave({ title: newTitle })
    },
    [debouncedSave]
  )

  const handleEmojiChange = useCallback(
    (emoji: string | null) => {
      setDoc(prev => (prev ? { ...prev, emoji } : prev))
      save({ emoji })
    },
    [save]
  )

  function getSaveStatusText(): string {
    switch (saveStatus) {
      case 'saving':
        return intl.formatMessage({ id: 'documentEditor.saving' })
      case 'saved':
        return intl.formatMessage({ id: 'documentEditor.saved' })
      case 'error':
        return 'Error saving'
      default:
        return ''
    }
  }

  if (loading) {
    return (
      <div className='flex-1 flex items-center justify-center'>
        <div className='animate-pulse text-muted-foreground text-sm'>Loading...</div>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className='flex-1 flex items-center justify-center'>
        <div className='text-muted-foreground text-sm'>Document not found</div>
      </div>
    )
  }

  return (
    <div className='flex-1 flex overflow-hidden'>
      {/* TOC Sidebar */}
      <DocumentTOC
        editor={null}
        children={doc.children ?? []}
        onChildClick={child => onNavigateToDocument(child.id)}
        onAddChild={() => onCreateChildDocument(doc.id)}
      />

      {/* Editor area */}
      <div className='flex-1 overflow-y-auto'>
        <div className='max-w-3xl mx-auto px-8 py-6'>
          <DocumentBreadcrumb
            ancestors={[]}
            current={{ id: doc.id, title: doc.title, emoji: doc.emoji }}
            onNavigate={id => {
              if (id) onNavigateToDocument(id)
              else onNavigateToDocuments()
            }}
          />

          {/* Emoji + Title */}
          <div className='flex items-start gap-3 mb-4'>
            <EmojiPicker value={doc.emoji} onChange={handleEmojiChange} />
            <input
              type='text'
              value={title}
              onChange={e => handleTitleChange(e.target.value)}
              className='flex-1 text-3xl font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground'
              placeholder={intl.formatMessage({ id: 'documents.untitled' })}
            />
          </div>

          {/* Metadata */}
          <div className='flex items-center gap-3 text-xs text-muted-foreground mb-6'>
            {doc.project && <span>{doc.project.name}</span>}
            <span>{doc.visibility}</span>
            {saveStatus !== 'idle' && <span>{getSaveStatusText()}</span>}
          </div>

          {/* Editor */}
          <DocumentEditor
            content={doc.content}
            onUpdate={handleContentUpdate}
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx"
git commit -m "feat: add DocumentEditorPage with auto-save and TOC sidebar"
```

---

## Task 11: Integrate into WorkspaceApp + Sidebar

**Files:**

- Modify: `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/Sidebar.tsx`

- [ ] **Step 1: Add Documents to Sidebar**

In `Sidebar.tsx`, add `FileText` to the lucide-react imports:

```typescript
import {
  Home,
  FolderKanban,
  Inbox,
  LogOut,
  ChevronsUpDown,
  Users,
  Settings,
  FileText,
} from 'lucide-react'
```

Add a Documents menu item in the Workspace `SidebarGroup`, after the Projects entry and before the closing `</SidebarMenu>`:

```tsx
<SidebarMenuItem>
  <SidebarMenuButton
    asChild
    isActive={currentPage === 'documents' || currentPage === 'document-editor'}
    tooltip={intl.formatMessage({ id: 'sidebar.documents' })}
  >
    <Link
      href={`/workspace/${workspaceUrl}/documents`}
      onClick={e => {
        e.preventDefault()
        onNavigate('documents')
      }}
    >
      <FileText />
      <span>{intl.formatMessage({ id: 'sidebar.documents' })}</span>
    </Link>
  </SidebarMenuButton>
</SidebarMenuItem>
```

- [ ] **Step 2: Update WorkspaceApp — add documents routing**

In `WorkspaceApp.tsx`:

1. Add imports at the top:

```typescript
import { DocumentsPage } from './components/pages/DocumentsPage'
import { DocumentEditorPage } from './components/pages/DocumentEditorPage'
import { useDocuments } from './hooks/useDocuments'
```

2. Add to `pageToPath` function:

```typescript
case 'documents':
  return `${base}/documents`
case 'document-editor':
  return `${base}/documents/${project?.id ?? ''}`
```

3. Add to `pathToPage` function:

```typescript
if (rest.startsWith('/documents/')) {
  const docId = rest.slice('/documents/'.length).split('/')[0]
  return { page: 'document-editor', projectSlug: docId }
}
if (rest.startsWith('/documents')) return { page: 'documents' }
```

4. Add `useDocuments()` hook call alongside other hooks:

```typescript
const {
  documents,
  setDocuments,
  loading: documentsLoading,
  error: documentsError,
  fetchDocuments,
} = useDocuments()
```

5. Add `fetchDocuments` to the initial data fetch `useEffect`.

6. Add document handlers:

```typescript
const handleNewDocument = useCallback(async () => {
  try {
    const res = await fetch(API.documents.list, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    })
    if (res.ok) {
      const data = await res.json()
      setDocuments(prev => [data.document, ...prev])
      // Navigate to the new document editor
      setCurrentPage('document-editor')
      setSelectedDocumentId(data.document.id)
      window.history.pushState(
        null,
        '',
        pageToPath(workspaceUrl, 'document-editor', {
          id: data.document.id,
        } as ApiProject)
      )
    }
  } catch {}
}, [workspaceId, workspaceUrl, setDocuments])

const handleDeleteDocument = useCallback(
  async (id: string) => {
    try {
      await fetch(API.documents.byId(id), { method: 'DELETE' })
      setDocuments(prev => prev.filter(d => d.id !== id))
    } catch {}
  },
  [setDocuments]
)
```

7. Add to `renderPage` switch:

```typescript
case 'documents':
  return (
    <DocumentsPage
      documents={documents}
      loading={documentsLoading}
      error={documentsError}
      onRetry={fetchDocuments}
      onNewDocument={handleNewDocument}
      onSelectDocument={doc => {
        setCurrentPage('document-editor')
        setSelectedDocumentId(doc.id)
        window.history.pushState(null, '', `/workspace/${workspaceUrl}/documents/${doc.id}`)
      }}
      onDeleteDocument={handleDeleteDocument}
    />
  )
case 'document-editor':
  return selectedDocumentId ? (
    <DocumentEditorPage
      documentId={selectedDocumentId}
      onNavigateToDocument={id => {
        setSelectedDocumentId(id)
        window.history.pushState(null, '', `/workspace/${workspaceUrl}/documents/${id}`)
      }}
      onNavigateToDocuments={() => {
        setCurrentPage('documents')
        window.history.pushState(null, '', `/workspace/${workspaceUrl}/documents`)
      }}
      onCreateChildDocument={async parentId => {
        const res = await fetch(API.documents.list, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, parentId }),
        })
        if (res.ok) {
          const data = await res.json()
          setSelectedDocumentId(data.document.id)
          window.history.pushState(null, '', `/workspace/${workspaceUrl}/documents/${data.document.id}`)
        }
      }}
    />
  ) : null
```

- [ ] **Step 3: Commit**

```bash
git add "app/workspace/[workspaceUrl]/WorkspaceApp.tsx" "app/workspace/[workspaceUrl]/components/Sidebar.tsx"
git commit -m "feat: integrate documents into sidebar navigation and page routing"
```

---

## Task 12: Task Detail — Related Documents Section

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

- [ ] **Step 1: Add related documents section**

In `TaskDetailPanel.tsx`, add a section that fetches and displays documents mentioning the current task. Add this inside the task detail view, after existing sections:

```typescript
// Add state for related documents
const [relatedDocs, setRelatedDocs] = useState<
  { id: string; title: string; emoji: string | null; updatedAt: string }[]
>([])

// Fetch related documents when task changes
useEffect(() => {
  if (!task?.id) return
  fetch(`/api/tasks/${task.id}/documents`)
    .then(res => res.json())
    .then(data => setRelatedDocs(data.documents ?? []))
    .catch(() => {})
}, [task?.id])
```

Add the UI section (render only if `relatedDocs.length > 0`):

```tsx
{
  relatedDocs.length > 0 && (
    <div className='mt-4 pt-4 border-t'>
      <div className='text-xs font-medium text-muted-foreground mb-2'>
        Related Documents
      </div>
      <div className='space-y-1'>
        {relatedDocs.map(doc => (
          <button
            key={doc.id}
            type='button'
            className='flex items-center gap-2 w-full text-left text-xs py-1 px-2 rounded hover:bg-muted transition-colors'
            onClick={() => {
              // Navigate to document editor
              window.location.href = `/workspace/${workspaceUrl}/documents/${doc.id}`
            }}
          >
            <span>{doc.emoji ?? '📄'}</span>
            <span className='truncate'>{doc.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx"
git commit -m "feat: show related documents on task detail panel"
```

---

## Task 13: Verify and Fix TypeScript Compilation

**Files:**

- All files from previous tasks

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Fix any type errors that arise from the integration.

- [ ] **Step 2: Run the dev server and verify**

```bash
npm run dev
```

Manually verify:

1. Sidebar shows "Documents" entry
2. Clicking it shows DocumentsPage
3. "New Document" creates a document and opens editor
4. Editor loads with slash commands (`/` menu)
5. Title and content auto-save
6. Documents list shows filter tabs

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve TypeScript errors and integration issues"
```

---

## Summary

| Task | Description                               | Files                                                                                 |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| 1    | Prisma schema + migration                 | `prisma/schema.prisma`                                                                |
| 2    | Types + validation + constants            | `types.ts`, `schemas.ts`, `constants.ts`                                              |
| 3    | Document CRUD API                         | `api/documents/route.ts`, `api/documents/[id]/route.ts`                               |
| 4    | Shares + move + task-docs API             | `api/documents/[id]/shares/`, `api/documents/[id]/move/`, `api/tasks/[id]/documents/` |
| 5    | i18n keys                                 | `en.json`, `zh.json`                                                                  |
| 6    | useDocuments hook                         | `hooks/useDocuments.ts`                                                               |
| 7    | DocumentsPage listing                     | `pages/DocumentsPage.tsx`                                                             |
| 8    | Shared extensions + slash commands        | `lib/editor/`                                                                         |
| 9    | DocumentEditor + TOC + emoji + breadcrumb | `DocumentEditor.tsx`, `document/`                                                     |
| 10   | DocumentEditorPage                        | `pages/DocumentEditorPage.tsx`                                                        |
| 11   | WorkspaceApp + Sidebar integration        | `WorkspaceApp.tsx`, `Sidebar.tsx`                                                     |
| 12   | Task detail related documents             | `TaskDetailPanel.tsx`                                                                 |
| 13   | TypeScript verification                   | All files                                                                             |
