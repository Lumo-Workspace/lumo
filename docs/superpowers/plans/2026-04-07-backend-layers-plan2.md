# Backend Layered Architecture — Project, Document, Workspace Domains

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Repository + Service pattern (established in Plan 1 for Task/Comment) to Project, Document, and Workspace domains.

**Architecture:** Same layered pattern: API Route → Service → Repository → Prisma. Routes become thin handlers delegating to Services.

**Tech Stack:** TypeScript, Prisma, Next.js API Routes, Jest, Zod

---

## File Structure

### New files to create:

- `lib/repositories/project.repository.ts`
- `lib/repositories/document.repository.ts`
- `lib/repositories/workspace.repository.ts`
- `lib/services/project.service.ts`
- `lib/services/document.service.ts`
- `lib/services/workspace.service.ts`
- Tests for each repository and service

### Files to modify:

- `app/api/projects/route.ts` (115 → ~50 lines)
- `app/api/projects/[id]/route.ts` (129 → ~60 lines)
- `app/api/projects/[id]/tasks/route.ts` (341 → ~80 lines)
- `app/api/documents/route.ts` (212 → ~50 lines)
- `app/api/documents/[id]/route.ts` (391 → ~80 lines)
- `app/api/workspaces/route.ts` (89 → ~30 lines)
- `app/api/workspaces/me/route.ts` (122 → ~50 lines)
- `app/api/workspaces/members/route.ts` (105 → ~30 lines)
- `lib/repositories/index.ts`
- `lib/services/index.ts`

---

### Task 1: Create ProjectRepository

**Files:**

- Create: `lib/repositories/project.repository.ts`
- Create: `__tests__/lib/repositories/project.repository.test.ts`
- Modify: `lib/repositories/index.ts`

Extract from `app/api/projects/route.ts` and `app/api/projects/[id]/route.ts`:

- `findByWorkspace(workspaceId, memberId)` — permission-filtered findMany (public + own ideas)
- `findById(id)` — with task/view counts
- `create(tx, data)` — create project (called within transaction)
- `update(id, data)` — selective update
- `delete(id)` — cascade delete

---

### Task 2: Create ProjectService

**Files:**

- Create: `lib/services/project.service.ts`
- Create: `__tests__/lib/services/project.service.test.ts`
- Modify: `lib/services/index.ts`

Extract business logic:

- `listProjects(workspaceId, memberId)` — permission filtering + inProgressCount shaping
- `getProject(projectId, memberId)` — idea visibility check
- `createProject(workspaceId, memberId, data)` — transaction: project + default DOCUMENT view
- `updateProject(projectId, memberId, data)` — idea edit permission + reviewer validation
- `deleteProject(projectId, memberId)` — idea delete permission

---

### Task 3: Refactor Project API Routes

**Files:**

- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/route.ts`

Slim down both routes to use ProjectService.

---

### Task 4: Create DocumentRepository

**Files:**

- Create: `lib/repositories/document.repository.ts`
- Create: `__tests__/lib/repositories/document.repository.test.ts`
- Modify: `lib/repositories/index.ts`

Extract from `app/api/documents/route.ts` and `[id]/route.ts`:

- `findByWorkspace(workspaceId, memberId, filters)` — permission-filtered findMany
- `findWithPermission(id, memberId, workspaceId)` — single doc with permission check
- `create(data)` — with sortOrder calculation
- `update(id, data)` — selective update
- `delete(id, workspaceId)` — recursive descendant cleanup
- `findAncestors(parentId)` — ancestor chain builder

---

### Task 5: Create DocumentService

**Files:**

- Create: `lib/services/document.service.ts`
- Create: `__tests__/lib/services/document.service.test.ts`
- Modify: `lib/services/index.ts`

Extract business logic:

- `listDocuments(workspaceId, memberId, filters)` — permission filtering + Clerk enrichment
- `getDocument(id, memberId, workspaceId)` — with ancestor chain + Clerk enrichment
- `createDocument(workspaceId, memberId, data)` — sortOrder + Clerk enrichment
- `updateDocument(id, memberId, data)` — role-based permission + mention sync + editor tracking
- `deleteDocument(id, memberId, workspaceId)` — owner-only + recursive delete
- `getUserRole(doc, memberId)` — determine user's role for a document
- `syncDocumentMentions(docId, content)` — parse Tiptap JSON and sync mentions
- `extractTaskMentionIds(content)` — walk Tiptap JSON for task mention nodes

---

### Task 6: Refactor Document API Routes

**Files:**

- Modify: `app/api/documents/route.ts`
- Modify: `app/api/documents/[id]/route.ts`

Slim down both routes to use DocumentService.

---

### Task 7: Create WorkspaceRepository + WorkspaceService

**Files:**

- Create: `lib/repositories/workspace.repository.ts`
- Create: `lib/services/workspace.service.ts`
- Create: `__tests__/lib/repositories/workspace.repository.test.ts`
- Create: `__tests__/lib/services/workspace.service.test.ts`
- Modify: `lib/repositories/index.ts`
- Modify: `lib/services/index.ts`

Repository methods:

- `create(data)` — full transaction (workspace + team + member + actors)
- `update(id, data)` — selective update
- `delete(id)` — cascade delete
- `checkSlugUnique(slug, excludeId)` — uniqueness check

Service methods:

- `createWorkspace(userId, data)` — orchestrate creation transaction
- `updateWorkspace(workspaceId, memberId, data)` — owner check + slug validation
- `deleteWorkspace(workspaceId, memberId)` — owner check

---

### Task 8: Refactor Workspace API Routes

**Files:**

- Modify: `app/api/workspaces/route.ts`
- Modify: `app/api/workspaces/me/route.ts`

Slim down to use WorkspaceService.

---

### Task 9: Full Verification

- Run all tests
- Type check
- Verify all route file sizes reduced
