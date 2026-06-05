# Document Revisions (LUM-227) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add document version history to Lumo — auto-snapshot document content on save (throttled, same-author 10-min sliding-window merge), with a version list, word-level diff, one-click reversible restore, manual named snapshots, and time-decay retention via cron.

**Architecture:** New `DocumentRevision` Prisma model + repository + `documentRevisionService`. Snapshots are captured as a fire-and-forget `waitUntil` side-effect inside `documentService.updateDocument`/`createDocument`. A daily Vercel cron prunes auto-revisions on a time-decay schedule (24h keep-all → 7d daily → older weekly; first version + manual versions kept forever). Thin API routes under `/api/documents/[id]/revisions` delegate to the service. Restore reuses the normal `updateDocument` save chain (so it generates a new revision and reuses comment-orphan handling) — the revision→document service cycle is broken with a dynamic `import()`. Front-end: a full-screen `DocumentHistoryModal` (left timeline, right diff) + "保存为版本" entry, React-Query hook, and a client-side word-level diff util (jsdiff).

**Tech Stack:** Next.js 14 App Router, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Prisma + Neon Postgres, Clerk, React Query, react-intl, Jest, `diff` (jsdiff, new dependency).

**Design doc:** `docs/superpowers/specs/2026-06-05-lum-227-document-revisions-design.md`

**Conventions reused (verified in codebase):**

- Routes: `requireIdentity(request)` returns `{ clerkId, memberId, workspaceId, workspaceSlug, workspaceName, source }` or a `NextResponse`; `params` is `Promise<{...}>` and must be awaited; errors thrown as `Object.assign(new Error(msg), { status })`.
- Services throw `Object.assign(new Error(msg), { status })`; never touch HTTP; go through repositories. `documentService.getUserRole(doc, memberId)` → `'OWNER' | <shareRole> | null`.
- `waitUntil` imported from `@vercel/functions`.
- Background work must never block the API response (project convention).

---

## File Structure

**Create:**

- `lib/repositories/documentRevision.repository.ts` — Prisma access for revisions (create/update-latest/list/find/prune helpers).
- `lib/services/documentRevision.service.ts` — snapshot/list/get/manual/restore/prune business logic.
- `lib/services/revision-retention.ts` — pure `selectRevisionsToPrune()` decay policy (testable without DB).
- `lib/editor/revision-diff.ts` — pure client-safe word-level diff (`diffDocumentText`, `htmlToPlainText`).
- `lib/validation/revision.ts` — Zod schemas for revision routes.
- `app/api/documents/[id]/revisions/route.ts` — GET list + POST manual snapshot.
- `app/api/documents/[id]/revisions/[revId]/route.ts` — GET one revision (with content).
- `app/api/documents/[id]/revisions/[revId]/restore/route.ts` — POST restore.
- `app/api/cron/prune-document-revisions/route.ts` — daily retention cron.
- `app/workspace/[workspaceUrl]/hooks/useDocumentRevisions.ts` — React Query list/get/manual/restore hooks.
- `app/workspace/[workspaceUrl]/components/documents/DocumentHistoryModal.tsx` — full-screen history UI (timeline + diff + restore).
- `app/workspace/[workspaceUrl]/components/documents/RevisionDiffView.tsx` — diff renderer (inline word-level + side-by-side toggle).
- Tests: `__tests__/documentRevision.repository.test.ts`, `__tests__/documentRevision.service.test.ts`, `__tests__/services/revision-retention.test.ts`, `__tests__/lib/editor/revision-diff.test.ts`, `__tests__/api/documents-revisions.test.ts`, `__tests__/api/cron-prune-document-revisions.test.ts`.

**Modify:**

- `prisma/schema.prisma` — add `DocumentRevision` model + reverse relations on `Document`, `WorkspaceMember`, `Workspace`.
- `lib/services/document.service.ts` — call `documentRevisionService.snapshotOnSave(...)` in `updateDocument` and `createDocument`.
- `lib/services/index.ts` — export `documentRevisionService`.
- `lib/api-client/documents.ts` — add `documentRevisionsApi`.
- `app/workspace/[workspaceUrl]/constants.ts` — add `API.documents.revisions` / `revisionById` / `revisionRestore`.
- `lib/query/keys.ts` — add `documentRevisions` query key.
- `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx` — "历史版本" + "保存为版本" entry points + modal mount.
- `vercel.json` — add the prune cron.
- All 16 locale files in `lib/i18n/` — add `documentHistory.*` keys.

---

## Task 1: Prisma model + migration

**Files:**

- Modify: `prisma/schema.prisma` (Document model ~line 990-1041; add new model after `DocumentEditor` ~line 1093; add reverse relations on `WorkspaceMember` and `Workspace`)
- Create: `prisma/migrations/<timestamp>_add_document_revision/migration.sql`

- [ ] **Step 1: Add the model + reverse relations to `prisma/schema.prisma`**

Add to the `Document` model (after the `documentComments DocumentComment[]` line, ~line 1029):

```prisma
  revisions        DocumentRevision[]
```

Add a new model immediately after the `DocumentEditor` model (~line 1093):

```prisma
model DocumentRevision {
  id          String   @id @default(cuid())
  documentId  String
  document    Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  content     String?  @db.Text
  title       String   @default("")
  emoji       String?
  label       String? // manual-snapshot name; null = automatic snapshot
  isManual    Boolean  @default(false)
  authorId    String
  author      WorkspaceMember @relation(fields: [authorId], references: [id])
  workspaceId String
  workspace   Workspace       @relation(fields: [workspaceId], references: [id])
  wordCount   Int?
  createdAt   DateTime @default(now()) // window-open time
  updatedAt   DateTime @updatedAt // refreshed on in-window merge

  @@index([documentId, createdAt])
}
```

Add the reverse relation field to the `WorkspaceMember` model (anywhere in its relation block):

```prisma
  documentRevisions DocumentRevision[]
```

Add the reverse relation field to the `Workspace` model (anywhere in its relation block):

```prisma
  documentRevisions DocumentRevision[]
```

(Single relation between each pair → no `@relation("name")` needed.)

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_document_revision`
Expected: a new `prisma/migrations/<timestamp>_add_document_revision/migration.sql` and "Your database is now in sync".

**If `migrate dev` is blocked by dev-DB drift (P3008/P3012) — do NOT reset the DB.** Follow the project memory workaround: hand-write the SQL into `prisma/migrations/<timestamp>_add_document_revision/migration.sql` (timestamp later than any existing migration), with this content:

```sql
-- CreateTable
CREATE TABLE "DocumentRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "emoji" TEXT,
    "label" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "wordCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentRevision_documentId_createdAt_idx" ON "DocumentRevision"("documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "WorkspaceMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Then apply + record (per memory): `npx prisma db execute --file prisma/migrations/<timestamp>_add_document_revision/migration.sql` → `npx prisma migrate resolve --applied <timestamp>_add_document_revision`.

- [ ] **Step 3: Regenerate the client**

Run: `npx prisma generate`
Expected: client regenerates; `prisma.documentRevision` is now available.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no errors about `documentRevision` / `DocumentRevision`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add DocumentRevision model and migration [LUM-227]"
```

---

## Task 2: Revision repository

**Files:**

- Create: `lib/repositories/documentRevision.repository.ts`
- Test: `__tests__/documentRevision.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/documentRevision.repository.test.ts
import { documentRevisionRepository } from '@/lib/repositories/documentRevision.repository'

const mockCreate = jest.fn()
const mockFindFirst = jest.fn()
const mockFindMany = jest.fn()
const mockUpdate = jest.fn()
const mockDeleteMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    documentRevision: {
      create: (...a: any[]) => mockCreate(...a),
      findFirst: (...a: any[]) => mockFindFirst(...a),
      findMany: (...a: any[]) => mockFindMany(...a),
      update: (...a: any[]) => mockUpdate(...a),
      deleteMany: (...a: any[]) => mockDeleteMany(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('documentRevisionRepository', () => {
  it('create maps defaults for optional fields', async () => {
    mockCreate.mockResolvedValue({ id: 'r1' })
    await documentRevisionRepository.create({
      documentId: 'd1',
      workspaceId: 'w1',
      authorId: 'm1',
      content: '<p>hi</p>',
      title: 'T',
      emoji: null,
    })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        documentId: 'd1',
        workspaceId: 'w1',
        authorId: 'm1',
        content: '<p>hi</p>',
        title: 'T',
        emoji: null,
        label: null,
        isManual: false,
        wordCount: null,
      },
    })
  })

  it('findLatestForDocument orders by createdAt desc', async () => {
    mockFindFirst.mockResolvedValue({ id: 'r9' })
    const r = await documentRevisionRepository.findLatestForDocument('d1')
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { documentId: 'd1' },
      orderBy: { createdAt: 'desc' },
    })
    expect(r).toEqual({ id: 'r9' })
  })

  it('listByDocument selects metadata only (no content)', async () => {
    mockFindMany.mockResolvedValue([])
    await documentRevisionRepository.listByDocument('d1')
    const arg = mockFindMany.mock.calls[0][0]
    expect(arg.where).toEqual({ documentId: 'd1' })
    expect(arg.orderBy).toEqual({ createdAt: 'desc' })
    expect(arg.select.content).toBeUndefined()
    expect(arg.select.id).toBe(true)
    expect(arg.select.author).toBeDefined()
  })

  it('deleteByIds is a no-op for empty input', async () => {
    const res = await documentRevisionRepository.deleteByIds([])
    expect(mockDeleteMany).not.toHaveBeenCalled()
    expect(res).toEqual({ count: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest documentRevision.repository -c jest.config.js`
Expected: FAIL ("Cannot find module '@/lib/repositories/documentRevision.repository'").

- [ ] **Step 3: Write the implementation**

```typescript
// lib/repositories/documentRevision.repository.ts
import { prisma } from '@/lib/db/prisma'

export interface CreateRevisionData {
  documentId: string
  workspaceId: string
  authorId: string
  content: string | null
  title: string
  emoji: string | null
  label?: string | null
  isManual?: boolean
  wordCount?: number | null
}

export interface UpdateRevisionContentData {
  content: string | null
  title: string
  emoji: string | null
  wordCount?: number | null
}

export interface PrunableRevisionRow {
  id: string
  createdAt: Date
  isManual: boolean
}

export const documentRevisionRepository = {
  create(data: CreateRevisionData) {
    return prisma.documentRevision.create({
      data: {
        documentId: data.documentId,
        workspaceId: data.workspaceId,
        authorId: data.authorId,
        content: data.content,
        title: data.title,
        emoji: data.emoji ?? null,
        label: data.label ?? null,
        isManual: data.isManual ?? false,
        wordCount: data.wordCount ?? null,
      },
    })
  },

  findLatestForDocument(documentId: string) {
    return prisma.documentRevision.findFirst({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    })
  },

  updateContent(id: string, data: UpdateRevisionContentData) {
    // `updatedAt` (@updatedAt) auto-refreshes → slides the merge window.
    return prisma.documentRevision.update({
      where: { id },
      data: {
        content: data.content,
        title: data.title,
        emoji: data.emoji ?? null,
        wordCount: data.wordCount ?? null,
      },
    })
  },

  listByDocument(documentId: string) {
    return prisma.documentRevision.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        isManual: true,
        authorId: true,
        title: true,
        emoji: true,
        wordCount: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, clerkId: true } },
      },
    })
  },

  findByIdWithContent(id: string, documentId: string) {
    return prisma.documentRevision.findFirst({
      where: { id, documentId },
    })
  },

  listForPrune(documentId: string): Promise<PrunableRevisionRow[]> {
    return prisma.documentRevision.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, isManual: true },
    })
  },

  async listDocumentIdsWithRevisions(): Promise<string[]> {
    const rows = await prisma.documentRevision.findMany({
      distinct: ['documentId'],
      select: { documentId: true },
    })
    return rows.map(r => r.documentId)
  },

  deleteByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve({ count: 0 })
    return prisma.documentRevision.deleteMany({ where: { id: { in: ids } } })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest documentRevision.repository -c jest.config.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/documentRevision.repository.ts __tests__/documentRevision.repository.test.ts
git commit -m "feat: add document revision repository [LUM-227]"
```

---

## Task 3: Retention policy (pure function)

**Files:**

- Create: `lib/services/revision-retention.ts`
- Test: `__tests__/services/revision-retention.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/services/revision-retention.test.ts
import { selectRevisionsToPrune } from '@/lib/services/revision-retention'

const NOW = new Date('2026-06-05T12:00:00.000Z')
function rev(id: string, iso: string, isManual = false) {
  return { id, createdAt: new Date(iso), isManual }
}

describe('selectRevisionsToPrune', () => {
  it('keeps everything within 24h', () => {
    const revs = [
      rev('a', '2026-06-05T11:00:00Z'),
      rev('b', '2026-06-05T09:00:00Z'),
      rev('c', '2026-06-04T13:00:00Z'), // 23h ago
    ]
    expect(selectRevisionsToPrune(revs, NOW)).toEqual([])
  })

  it('keeps only the latest per day in the 1-7 day band', () => {
    const revs = [
      rev('first', '2026-05-30T08:00:00Z'), // oldest → always kept
      rev('d1a', '2026-06-02T08:00:00Z'),
      rev('d1b', '2026-06-02T20:00:00Z'), // latest that day → kept
      rev('d2a', '2026-06-03T09:00:00Z'), // only one that day → kept
    ]
    // 'd1a' is the only prunable one
    expect(selectRevisionsToPrune(revs, NOW)).toEqual(['d1a'])
  })

  it('keeps only the latest per ISO week older than 7 days', () => {
    const revs = [
      rev('first', '2026-04-01T08:00:00Z'), // oldest → kept
      rev('w1a', '2026-05-04T08:00:00Z'),
      rev('w1b', '2026-05-06T08:00:00Z'), // same ISO week, later → kept
    ]
    expect(selectRevisionsToPrune(revs, NOW)).toEqual(['w1a'])
  })

  it('never prunes manual snapshots or the oldest revision', () => {
    const revs = [
      rev('oldest', '2026-01-01T08:00:00Z'),
      rev('manual', '2026-01-02T08:00:00Z', true),
      rev('autoOld', '2026-01-02T09:00:00Z'),
    ]
    // same ISO week as 'manual': 'autoOld' is the week survivor; 'manual'+'oldest' protected
    expect(selectRevisionsToPrune(revs, NOW)).toEqual([])
  })

  it('returns [] for empty input', () => {
    expect(selectRevisionsToPrune([], NOW)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest revision-retention -c jest.config.js`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Write the implementation**

```typescript
// lib/services/revision-retention.ts

export interface RetentionRevision {
  id: string
  createdAt: Date
  isManual: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/** UTC calendar-day key, e.g. "2026-06-02". */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** ISO-week key, e.g. "2026-W23". Uses UTC. */
function isoWeekKey(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  )
  // Thursday-based ISO week.
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7
  )
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Decide which auto-revision ids to delete under the time-decay policy:
 *   - ≤24h old: keep all
 *   - 1–7 days old: keep newest per UTC calendar day
 *   - >7 days old: keep newest per ISO week
 * Never deletes: manual snapshots, or the single oldest revision (first version).
 *
 * `revisions` need not be pre-sorted. `now` is injected for testability.
 */
export function selectRevisionsToPrune(
  revisions: RetentionRevision[],
  now: Date
): string[] {
  if (revisions.length === 0) return []

  const sorted = [...revisions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  )

  const keep = new Set<string>()
  const oldest = sorted[0]
  if (oldest) keep.add(oldest.id) // first version is protected

  const dayWinners = new Map<string, string>()
  const weekWinners = new Map<string, string>()

  for (const r of sorted) {
    if (r.isManual) {
      keep.add(r.id)
      continue
    }
    const age = now.getTime() - r.createdAt.getTime()
    if (age <= DAY_MS) {
      keep.add(r.id)
    } else if (age <= WEEK_MS) {
      dayWinners.set(dayKey(r.createdAt), r.id) // ascending → last write wins (newest)
    } else {
      weekWinners.set(isoWeekKey(r.createdAt), r.id)
    }
  }

  for (const id of dayWinners.values()) keep.add(id)
  for (const id of weekWinners.values()) keep.add(id)

  return sorted.filter(r => !keep.has(r.id)).map(r => r.id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest revision-retention -c jest.config.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/revision-retention.ts __tests__/services/revision-retention.test.ts
git commit -m "feat: add revision time-decay retention policy [LUM-227]"
```

---

## Task 4: Revision service — snapshot, list, get, manual, restore, prune

**Files:**

- Create: `lib/services/documentRevision.service.ts`
- Modify: `lib/services/index.ts`
- Test: `__tests__/documentRevision.service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/documentRevision.service.test.ts
import { documentRevisionService } from '@/lib/services/documentRevision.service'

const repo = {
  create: jest.fn(),
  findLatestForDocument: jest.fn(),
  updateContent: jest.fn(),
  listByDocument: jest.fn(),
  findByIdWithContent: jest.fn(),
  listForPrune: jest.fn(),
  listDocumentIdsWithRevisions: jest.fn(),
  deleteByIds: jest.fn(),
}
jest.mock('@/lib/repositories/documentRevision.repository', () => ({
  documentRevisionRepository: {
    create: (...a: any[]) => repo.create(...a),
    findLatestForDocument: (...a: any[]) => repo.findLatestForDocument(...a),
    updateContent: (...a: any[]) => repo.updateContent(...a),
    listByDocument: (...a: any[]) => repo.listByDocument(...a),
    findByIdWithContent: (...a: any[]) => repo.findByIdWithContent(...a),
    listForPrune: (...a: any[]) => repo.listForPrune(...a),
    listDocumentIdsWithRevisions: (...a: any[]) =>
      repo.listDocumentIdsWithRevisions(...a),
    deleteByIds: (...a: any[]) => repo.deleteByIds(...a),
  },
}))

const docRepo = { findWithPermission: jest.fn() }
jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: (...a: any[]) => docRepo.findWithPermission(...a),
  },
}))

const updateDocument = jest.fn()
jest.mock('@/lib/services/document.service', () => ({
  documentService: {
    updateDocument: (...a: any[]) => updateDocument(...a),
    getUserRole: (doc: any, memberId: string) =>
      doc.createdById === memberId
        ? 'OWNER'
        : (doc.shares.find((s: any) => s.memberId === memberId)?.role ?? null),
  },
}))

// Clerk enrichment (used by listRevisions)
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: { getUserList: jest.fn().mockResolvedValue({ data: [] }) },
  }),
}))

beforeEach(() => jest.clearAllMocks())

const NOW = new Date('2026-06-05T12:00:00.000Z')

describe('snapshotOnSave', () => {
  const snap = { content: '<p>new</p>', title: 'T', emoji: null }

  it('creates a new revision when there is no prior revision', async () => {
    repo.findLatestForDocument.mockResolvedValue(null)
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'd1',
        workspaceId: 'w1',
        authorId: 'm1',
        content: '<p>new</p>',
      })
    )
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('merges into the latest revision for the same author within 10 min', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm1',
      isManual: false,
      content: '<p>old</p>',
      updatedAt: new Date('2026-06-05T11:55:00Z'), // 5 min ago
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.updateContent).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ content: '<p>new</p>' })
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('creates a new revision when the window has expired', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm1',
      isManual: false,
      content: '<p>old</p>',
      updatedAt: new Date('2026-06-05T11:40:00Z'), // 20 min ago
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.create).toHaveBeenCalled()
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('creates a new revision when the author differs', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm2',
      isManual: false,
      content: '<p>old</p>',
      updatedAt: new Date('2026-06-05T11:58:00Z'),
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.create).toHaveBeenCalled()
  })

  it('never merges into a manual snapshot', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm1',
      isManual: true,
      content: '<p>old</p>',
      updatedAt: new Date('2026-06-05T11:58:00Z'),
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.create).toHaveBeenCalled()
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('skips entirely when content is identical to the latest revision', async () => {
    repo.findLatestForDocument.mockResolvedValue({
      id: 'r1',
      authorId: 'm1',
      isManual: false,
      content: '<p>new</p>',
      updatedAt: new Date('2026-06-05T11:58:00Z'),
    })
    await documentRevisionService.snapshotOnSave('d1', 'w1', 'm1', snap, NOW)
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.updateContent).not.toHaveBeenCalled()
  })
})

describe('restoreRevision', () => {
  it('rejects a viewer with 403', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      id: 'd1',
      createdById: 'owner',
      shares: [],
    })
    await expect(
      documentRevisionService.restoreRevision('d1', 'r1', 'viewer', 'w1')
    ).rejects.toMatchObject({ status: 403 })
  })

  it('writes the old content back through updateDocument', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      id: 'd1',
      createdById: 'm1',
      shares: [],
    })
    repo.findByIdWithContent.mockResolvedValue({
      id: 'r1',
      content: '<p>old</p>',
    })
    updateDocument.mockResolvedValue({ id: 'd1' })
    await documentRevisionService.restoreRevision('d1', 'r1', 'm1', 'w1')
    expect(updateDocument).toHaveBeenCalledWith('d1', 'm1', 'w1', {
      content: '<p>old</p>',
    })
  })

  it('404s when the revision does not belong to the document', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      id: 'd1',
      createdById: 'm1',
      shares: [],
    })
    repo.findByIdWithContent.mockResolvedValue(null)
    await expect(
      documentRevisionService.restoreRevision('d1', 'rX', 'm1', 'w1')
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('pruneRevisions', () => {
  it('deletes the prunable ids for each document', async () => {
    repo.listDocumentIdsWithRevisions.mockResolvedValue(['d1'])
    repo.listForPrune.mockResolvedValue([
      {
        id: 'oldest',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        isManual: false,
      },
      {
        id: 'mid',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        isManual: false,
      },
      {
        id: 'mid2',
        createdAt: new Date('2026-01-02T06:00:00Z'),
        isManual: false,
      },
    ])
    repo.deleteByIds.mockResolvedValue({ count: 1 })
    const res = await documentRevisionService.pruneRevisions(NOW)
    expect(repo.deleteByIds).toHaveBeenCalledWith(['mid']) // same ISO week → keep latest (mid2), oldest protected
    expect(res.deleted).toBe(1)
  })
})

describe('createManualSnapshot', () => {
  it('snapshots current doc content with the given label as a manual revision', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      id: 'd1',
      createdById: 'm1',
      shares: [],
      content: '<p>cur</p>',
      title: 'Doc',
      emoji: '📄',
    })
    repo.create.mockResolvedValue({ id: 'r1' })
    await documentRevisionService.createManualSnapshot(
      'd1',
      'm1',
      'w1',
      'v1 review'
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'd1',
        isManual: true,
        label: 'v1 review',
        content: '<p>cur</p>',
        title: 'Doc',
        emoji: '📄',
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest documentRevision.service -c jest.config.js`
Expected: FAIL ("Cannot find module '@/lib/services/documentRevision.service'").

- [ ] **Step 3: Write the implementation**

```typescript
// lib/services/documentRevision.service.ts
import { clerkClient } from '@clerk/nextjs/server'
import { documentRevisionRepository } from '@/lib/repositories/documentRevision.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { documentService } from '@/lib/services/document.service'
import { selectRevisionsToPrune } from '@/lib/services/revision-retention'

const MERGE_WINDOW_MS = 10 * 60 * 1000

export interface SnapshotInput {
  content: string | null
  title: string
  emoji: string | null
}

interface DocWithShares {
  id: string
  createdById: string
  shares: { memberId: string; role: string }[]
}

function assertCanEdit(doc: DocWithShares, memberId: string): void {
  const role = documentService.getUserRole(doc, memberId)
  if (!role || role === 'VIEWER') {
    throw Object.assign(new Error('Permission denied'), { status: 403 })
  }
}

async function loadDocOr404(
  documentId: string,
  memberId: string,
  workspaceId: string
) {
  const doc = await documentRepository.findWithPermission(
    documentId,
    memberId,
    workspaceId
  )
  if (!doc) {
    throw Object.assign(new Error('Document not found'), { status: 404 })
  }
  return doc as DocWithShares & {
    content: string | null
    title: string
    emoji: string | null
  }
}

export const documentRevisionService = {
  /**
   * Capture a snapshot after a successful content save.
   * Same-author edits within a 10-min sliding window merge into the latest
   * auto revision; otherwise a new revision is created. No-op when content is
   * unchanged. `now` is injected for testability. Never throws to the caller —
   * intended to run inside `waitUntil`.
   */
  async snapshotOnSave(
    documentId: string,
    workspaceId: string,
    authorId: string,
    snapshot: SnapshotInput,
    now: Date = new Date()
  ): Promise<void> {
    const latest =
      await documentRevisionRepository.findLatestForDocument(documentId)

    if (latest && latest.content === snapshot.content) return

    const withinWindow =
      latest != null &&
      !latest.isManual &&
      latest.authorId === authorId &&
      now.getTime() - latest.updatedAt.getTime() <= MERGE_WINDOW_MS

    if (withinWindow && latest) {
      await documentRevisionRepository.updateContent(latest.id, {
        content: snapshot.content,
        title: snapshot.title,
        emoji: snapshot.emoji,
      })
      return
    }

    await documentRevisionRepository.create({
      documentId,
      workspaceId,
      authorId,
      content: snapshot.content,
      title: snapshot.title,
      emoji: snapshot.emoji,
    })
  },

  /** Manual named snapshot of the current document state (EDITOR+). */
  async createManualSnapshot(
    documentId: string,
    memberId: string,
    workspaceId: string,
    label: string
  ) {
    const doc = await loadDocOr404(documentId, memberId, workspaceId)
    assertCanEdit(doc, memberId)
    return documentRevisionRepository.create({
      documentId: doc.id,
      workspaceId,
      authorId: memberId,
      content: doc.content ?? null,
      title: doc.title,
      emoji: doc.emoji ?? null,
      label,
      isManual: true,
    })
  },

  /** Metadata-only version list (readable by anyone who can read the doc). */
  async listRevisions(
    documentId: string,
    memberId: string,
    workspaceId: string
  ) {
    const doc = await loadDocOr404(documentId, memberId, workspaceId)
    const rows = await documentRevisionRepository.listByDocument(doc.id)

    const clerkIds = [...new Set(rows.map(r => r.author.clerkId))]
    const nameById = new Map<
      string,
      { name: string; imageUrl: string | null }
    >()
    if (clerkIds.length > 0) {
      const client = await clerkClient()
      const users = await client.users.getUserList({
        userId: clerkIds,
        limit: clerkIds.length,
      })
      for (const u of users.data) {
        const name =
          `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ||
          u.emailAddresses[0]?.emailAddress ||
          u.id
        nameById.set(u.id, { name, imageUrl: u.imageUrl ?? null })
      }
    }

    return rows.map(r => ({
      id: r.id,
      label: r.label,
      isManual: r.isManual,
      title: r.title,
      emoji: r.emoji,
      wordCount: r.wordCount,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      author: {
        id: r.author.id,
        name: nameById.get(r.author.clerkId)?.name ?? r.author.clerkId,
        imageUrl: nameById.get(r.author.clerkId)?.imageUrl ?? null,
      },
    }))
  },

  /** Full content of one revision (readable by anyone who can read the doc). */
  async getRevision(
    documentId: string,
    revId: string,
    memberId: string,
    workspaceId: string
  ) {
    const doc = await loadDocOr404(documentId, memberId, workspaceId)
    const rev = await documentRevisionRepository.findByIdWithContent(
      revId,
      doc.id
    )
    if (!rev) {
      throw Object.assign(new Error('Revision not found'), { status: 404 })
    }
    return rev
  },

  /**
   * Restore a revision (EDITOR+). Writes the old content back through the
   * normal `updateDocument` chain — which re-syncs mentions, re-anchors
   * comments (orphan detection) and creates a fresh revision, so the restore
   * is itself reversible. Dynamic import breaks the service import cycle.
   */
  async restoreRevision(
    documentId: string,
    revId: string,
    memberId: string,
    workspaceId: string
  ) {
    const doc = await loadDocOr404(documentId, memberId, workspaceId)
    assertCanEdit(doc, memberId)
    const rev = await documentRevisionRepository.findByIdWithContent(
      revId,
      doc.id
    )
    if (!rev) {
      throw Object.assign(new Error('Revision not found'), { status: 404 })
    }
    const { documentService: svc } =
      await import('@/lib/services/document.service')
    return svc.updateDocument(doc.id, memberId, workspaceId, {
      content: rev.content,
    })
  },

  /** Apply the time-decay retention policy across all documents. */
  async pruneRevisions(now: Date = new Date()): Promise<{ deleted: number }> {
    const docIds =
      await documentRevisionRepository.listDocumentIdsWithRevisions()
    let deleted = 0
    for (const docId of docIds) {
      const revs = await documentRevisionRepository.listForPrune(docId)
      const toPrune = selectRevisionsToPrune(revs, now)
      if (toPrune.length > 0) {
        const res = await documentRevisionRepository.deleteByIds(toPrune)
        deleted += res.count
      }
    }
    return { deleted }
  },
}
```

Note the static `import { documentService }` is used only for `getUserRole` (a pure helper, safe at module load); the **write-back** path uses the dynamic `import()` to avoid the runtime cycle when `document.service` imports this module in Task 5.

Add to `lib/services/index.ts` (next to the other document exports, ~line 11):

```typescript
export { documentRevisionService } from './documentRevision.service'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest documentRevision.service -c jest.config.js`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add lib/services/documentRevision.service.ts lib/services/index.ts __tests__/documentRevision.service.test.ts
git commit -m "feat: add document revision service (snapshot/list/get/manual/restore/prune) [LUM-227]"
```

---

## Task 5: Wire snapshot capture into documentService

**Files:**

- Modify: `lib/services/document.service.ts` (`updateDocument` ~line 505-513; `createDocument` ~line 373-379)
- Test: `__tests__/document.service.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/document.service.test.ts`. First add the revision-service mock near the other `jest.mock` calls at the top of the file:

```typescript
const mockSnapshotOnSave = jest.fn()
jest.mock('@/lib/services/documentRevision.service', () => ({
  documentRevisionService: {
    snapshotOnSave: (...a: any[]) => mockSnapshotOnSave(...a),
  },
}))
```

Then add a test (inside the existing `updateDocument` describe, or a new one):

```typescript
describe('updateDocument revision capture', () => {
  it('schedules a snapshot when content changes', async () => {
    mockFindWithPermission.mockResolvedValue({
      id: 'd1',
      number: 1,
      createdById: 'm1',
      shares: [],
    })
    mockUpdateWithChildrenAndMentions.mockResolvedValue({
      id: 'd1',
      title: 'T',
      emoji: null,
      content: '<p>new</p>',
    })
    await documentService.updateDocument('d1', 'm1', 'ws1', {
      content: '<p>new</p>',
    })
    expect(mockSnapshotOnSave).toHaveBeenCalledWith(
      'd1',
      'ws1',
      'm1',
      expect.objectContaining({
        content: '<p>new</p>',
        title: 'T',
        emoji: null,
      })
    )
  })

  it('does NOT schedule a snapshot for a title-only change', async () => {
    mockFindWithPermission.mockResolvedValue({
      id: 'd1',
      number: 1,
      createdById: 'm1',
      shares: [],
    })
    mockUpdateWithChildrenAndMentions.mockResolvedValue({
      id: 'd1',
      title: 'T2',
      emoji: null,
      content: null,
    })
    await documentService.updateDocument('d1', 'm1', 'ws1', { title: 'T2' })
    expect(mockSnapshotOnSave).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest document.service -c jest.config.js -t "revision capture"`
Expected: FAIL (`snapshotOnSave` not called).

- [ ] **Step 3: Write the implementation**

In `lib/services/document.service.ts`, add the import near the top (after the existing service imports, ~line 17):

```typescript
import { documentRevisionService } from '@/lib/services/documentRevision.service'
```

In `updateDocument`, extend the existing `if (data.content !== undefined)` block (~line 506-513) so it also schedules a snapshot:

```typescript
// Track editor if content was updated
if (data.content !== undefined) {
  await documentRepository.upsertEditor(docId, memberId)
  const bodyText = renderContentToMarkdown(data.content)
  if (bodyText) scheduleDocumentSummary(docId, bodyText)
  // Capture a version snapshot in the background (LUM-227). Never blocks
  // the response; snapshotOnSave no-ops when content is unchanged.
  waitUntil(
    documentRevisionService
      .snapshotOnSave(docId, workspaceId, memberId, {
        content: data.content,
        title: updated.title,
        emoji: updated.emoji,
      })
      .catch(() => {})
  )
}
```

In `createDocument`, extend the existing `if (content)` block (~line 373-379) to seed the initial version:

```typescript
if (content) {
  await this.syncDocumentMentions(document.id, content)
  const bodyText = renderContentToMarkdown(content)
  if (bodyText) scheduleDocumentSummary(document.id, bodyText)
  // Seed the first version (LUM-227) — the protected baseline.
  waitUntil(
    documentRevisionService
      .snapshotOnSave(document.id, workspaceId, memberId, {
        content,
        title: document.title,
        emoji: document.emoji ?? null,
      })
      .catch(() => {})
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest document.service -c jest.config.js`
Expected: PASS (existing + new tests). Then confirm no cycle/type break: `npx tsc --noEmit` (expect PASS).

- [ ] **Step 5: Commit**

```bash
git add lib/services/document.service.ts __tests__/document.service.test.ts
git commit -m "feat: capture document revision snapshots on save/create [LUM-227]"
```

---

## Task 6: Validation schemas

**Files:**

- Create: `lib/validation/revision.ts`
- Test: `__tests__/validation/revision.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/validation/revision.test.ts
import { createManualRevisionSchema } from '@/lib/validation/revision'

describe('createManualRevisionSchema', () => {
  it('accepts a trimmed non-empty label', () => {
    const r = createManualRevisionSchema.safeParse({ label: '  v1 review  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.label).toBe('v1 review')
  })

  it('rejects an empty label', () => {
    expect(createManualRevisionSchema.safeParse({ label: '   ' }).success).toBe(
      false
    )
  })

  it('rejects a label over 200 chars', () => {
    expect(
      createManualRevisionSchema.safeParse({ label: 'x'.repeat(201) }).success
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest validation/revision -c jest.config.js`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Write the implementation**

```typescript
// lib/validation/revision.ts
import { z } from 'zod'

export const createManualRevisionSchema = z.object({
  label: z.string().trim().min(1, 'label is required').max(200),
})

export type CreateManualRevisionInput = z.infer<
  typeof createManualRevisionSchema
>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest validation/revision -c jest.config.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validation/revision.ts __tests__/validation/revision.test.ts
git commit -m "feat: add revision validation schema [LUM-227]"
```

---

## Task 7: API routes (list / manual create / get one / restore)

**Files:**

- Create: `app/api/documents/[id]/revisions/route.ts`
- Create: `app/api/documents/[id]/revisions/[revId]/route.ts`
- Create: `app/api/documents/[id]/revisions/[revId]/restore/route.ts`
- Test: `__tests__/api/documents-revisions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/documents-revisions.test.ts
/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/documents/[id]/revisions/route'
import { POST as RESTORE } from '@/app/api/documents/[id]/revisions/[revId]/restore/route'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/helpers', () => ({ zodError: jest.fn() }))
jest.mock('@/lib/services', () => ({
  documentRevisionService: {
    listRevisions: jest.fn(),
    createManualSnapshot: jest.fn(),
    restoreRevision: jest.fn(),
  },
}))

const { requireIdentity } = jest.requireMock('@/lib/auth') as {
  requireIdentity: jest.Mock
}
const { zodError } = jest.requireMock('@/lib/api/helpers') as {
  zodError: jest.Mock
}
const { documentRevisionService } = jest.requireMock('@/lib/services') as {
  documentRevisionService: {
    listRevisions: jest.Mock
    createManualSnapshot: jest.Mock
    restoreRevision: jest.Mock
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  requireIdentity.mockResolvedValue({
    clerkId: 'u1',
    memberId: 'm1',
    workspaceId: 'ws1',
    workspaceSlug: 'ws',
    workspaceName: 'WS',
    source: 'clerk',
  })
  zodError.mockImplementation(
    () => new Response(JSON.stringify({ error: 'zod' }), { status: 400 })
  )
})

const ctx = (id: string, revId?: string) => ({
  params: Promise.resolve(revId ? { id, revId } : { id }),
})

describe('GET /revisions', () => {
  it('returns the version list', async () => {
    documentRevisionService.listRevisions.mockResolvedValue([{ id: 'r1' }])
    const res = await GET(
      new NextRequest('http://localhost/api/documents/d1/revisions'),
      ctx('d1') as any
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revisions: [{ id: 'r1' }] })
    expect(documentRevisionService.listRevisions).toHaveBeenCalledWith(
      'd1',
      'm1',
      'ws1'
    )
  })
})

describe('POST /revisions (manual)', () => {
  it('creates a manual snapshot', async () => {
    documentRevisionService.createManualSnapshot.mockResolvedValue({
      id: 'r1',
      label: 'v1',
    })
    const req = new NextRequest('http://localhost/api/documents/d1/revisions', {
      method: 'POST',
      body: JSON.stringify({ label: 'v1' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, ctx('d1') as any)
    expect(res.status).toBe(201)
    expect(documentRevisionService.createManualSnapshot).toHaveBeenCalledWith(
      'd1',
      'm1',
      'ws1',
      'v1'
    )
  })

  it('400s on an empty label', async () => {
    const req = new NextRequest('http://localhost/api/documents/d1/revisions', {
      method: 'POST',
      body: JSON.stringify({ label: '' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, ctx('d1') as any)
    expect(res.status).toBe(400)
  })
})

describe('POST /revisions/:revId/restore', () => {
  it('restores and returns the document', async () => {
    documentRevisionService.restoreRevision.mockResolvedValue({ id: 'd1' })
    const res = await RESTORE(
      new NextRequest(
        'http://localhost/api/documents/d1/revisions/r1/restore',
        { method: 'POST' }
      ),
      ctx('d1', 'r1') as any
    )
    expect(res.status).toBe(200)
    expect(documentRevisionService.restoreRevision).toHaveBeenCalledWith(
      'd1',
      'r1',
      'm1',
      'ws1'
    )
  })

  it('propagates a 403 from the service', async () => {
    documentRevisionService.restoreRevision.mockRejectedValue(
      Object.assign(new Error('Permission denied'), { status: 403 })
    )
    const res = await RESTORE(
      new NextRequest(
        'http://localhost/api/documents/d1/revisions/r1/restore',
        { method: 'POST' }
      ),
      ctx('d1', 'r1') as any
    )
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest documents-revisions -c jest.config.js`
Expected: FAIL ("Cannot find module '@/app/api/documents/[id]/revisions/route'").

- [ ] **Step 3: Write the implementations**

```typescript
// app/api/documents/[id]/revisions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createManualRevisionSchema } from '@/lib/validation/revision'
import { documentRevisionService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

function errorResponse(error: unknown) {
  if (error instanceof Error && 'status' in error) {
    return NextResponse.json(
      { error: error.message },
      { status: (error as Error & { status: number }).status }
    )
  }
  console.error('[doc-revisions] unexpected error:', error)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params
    const revisions = await documentRevisionService.listRevisions(
      id,
      identity.memberId,
      identity.workspaceId
    )
    return NextResponse.json({ revisions })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const body = await request.json()
    const parsed = createManualRevisionSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const revision = await documentRevisionService.createManualSnapshot(
      id,
      identity.memberId,
      identity.workspaceId,
      parsed.data.label
    )
    return NextResponse.json({ revision }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
```

```typescript
// app/api/documents/[id]/revisions/[revId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { documentRevisionService } from '@/lib/services'

type Params = { params: Promise<{ id: string; revId: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id, revId } = await params
    const revision = await documentRevisionService.getRevision(
      id,
      revId,
      identity.memberId,
      identity.workspaceId
    )
    return NextResponse.json({ revision })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}
```

```typescript
// app/api/documents/[id]/revisions/[revId]/restore/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { documentRevisionService } from '@/lib/services'

type Params = { params: Promise<{ id: string; revId: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id, revId } = await params
    const document = await documentRevisionService.restoreRevision(
      id,
      revId,
      identity.memberId,
      identity.workspaceId
    )
    return NextResponse.json({ document })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest documents-revisions -c jest.config.js`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/api/documents/[id]/revisions" __tests__/api/documents-revisions.test.ts
git commit -m "feat: add document revision API routes [LUM-227]"
```

---

## Task 8: Retention cron route

**Files:**

- Create: `app/api/cron/prune-document-revisions/route.ts`
- Modify: `vercel.json`
- Test: `__tests__/api/cron-prune-document-revisions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/cron-prune-document-revisions.test.ts
/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/prune-document-revisions/route'

jest.mock('@/lib/services', () => ({
  documentRevisionService: { pruneRevisions: jest.fn() },
}))
const { documentRevisionService } = jest.requireMock('@/lib/services') as {
  documentRevisionService: { pruneRevisions: jest.Mock }
}

const OLD_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...OLD_ENV, CRON_SECRET: 'secret' }
})
afterAll(() => {
  process.env = OLD_ENV
})

function req(auth?: string) {
  return new NextRequest('http://localhost/api/cron/prune-document-revisions', {
    headers: auth ? { authorization: auth } : {},
  })
}

it('rejects an unauthorized request', async () => {
  const res = await GET(req('Bearer wrong'))
  expect(res.status).toBe(401)
  expect(documentRevisionService.pruneRevisions).not.toHaveBeenCalled()
})

it('runs prune for an authorized cron request', async () => {
  documentRevisionService.pruneRevisions.mockResolvedValue({ deleted: 7 })
  const res = await GET(req('Bearer secret'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ deleted: 7 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest cron-prune-document-revisions -c jest.config.js`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Write the implementation**

```typescript
// app/api/cron/prune-document-revisions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { documentRevisionService } from '@/lib/services'

/**
 * GET /api/cron/prune-document-revisions
 * Daily Vercel Cron. Applies the time-decay retention policy to document
 * revisions (24h keep-all → 7d daily → older weekly; first + manual kept).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await documentRevisionService.pruneRevisions()
  return NextResponse.json(result)
}
```

Add the cron to `vercel.json` (inside the existing `crons` array):

```json
{
  "path": "/api/cron/prune-document-revisions",
  "schedule": "0 3 * * *"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest cron-prune-document-revisions -c jest.config.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/api/cron/prune-document-revisions" vercel.json __tests__/api/cron-prune-document-revisions.test.ts
git commit -m "feat: add daily document-revision retention cron [LUM-227]"
```

---

## Task 9: Client-side word-level diff util

**Files:**

- Create: `lib/editor/revision-diff.ts`
- Test: `__tests__/lib/editor/revision-diff.test.ts`
- Modify: `package.json` (add `diff` dependency)

- [ ] **Step 1: Install the dependency**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npm install diff && npm install -D @types/diff`
Expected: `diff` added to dependencies, `@types/diff` to devDependencies. **Note in the PR description: adds `diff` (jsdiff) dependency.**

- [ ] **Step 2: Write the failing test**

```typescript
// __tests__/lib/editor/revision-diff.test.ts
import { diffDocumentText, htmlToPlainText } from '@/lib/editor/revision-diff'

describe('diffDocumentText', () => {
  it('marks added and removed words', () => {
    const segs = diffDocumentText('the quick brown fox', 'the slow brown fox')
    const removed = segs.filter(s => s.removed).map(s => s.value.trim())
    const added = segs.filter(s => s.added).map(s => s.value.trim())
    expect(removed).toContain('quick')
    expect(added).toContain('slow')
    // unchanged words carry neither flag
    expect(
      segs.some(s => !s.added && !s.removed && s.value.includes('brown'))
    ).toBe(true)
  })

  it('returns a single unchanged segment for identical text', () => {
    const segs = diffDocumentText('same text', 'same text')
    expect(segs.every(s => !s.added && !s.removed)).toBe(true)
  })
})

describe('htmlToPlainText', () => {
  it('strips tags to readable text (jsdom)', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toContain(
      'Hello world'
    )
  })
})
```

(The `htmlToPlainText` test relies on jsdom's `DOMParser`; this test file runs under the default jsdom environment — do NOT add `@jest-environment node`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest revision-diff -c jest.config.js`
Expected: FAIL ("Cannot find module").

- [ ] **Step 4: Write the implementation**

```typescript
// lib/editor/revision-diff.ts
import { diffWords } from 'diff'

export interface DiffSegment {
  value: string
  added: boolean
  removed: boolean
}

/** Word-level diff of two plain-text strings. */
export function diffDocumentText(
  oldText: string,
  newText: string
): DiffSegment[] {
  return diffWords(oldText, newText).map(part => ({
    value: part.value,
    added: part.added === true,
    removed: part.removed === true,
  }))
}

/**
 * Convert an HTML body to readable plain text for diffing. Browser/jsdom only
 * (uses DOMParser). Block elements are separated by newlines so paragraph
 * boundaries survive into the diff.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc
    .querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, br, blockquote, pre')
    .forEach(el => el.append('\n'))
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}
```

- [ ] **Step 5: Run test to verify it passes & commit**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest revision-diff -c jest.config.js`
Expected: PASS (3 tests).

```bash
git add lib/editor/revision-diff.ts __tests__/lib/editor/revision-diff.test.ts package.json package-lock.json
git commit -m "feat: add client word-level revision diff util (jsdiff) [LUM-227]"
```

---

## Task 10: API client + query key + constants

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts` (`API.documents` ~line 62-72)
- Modify: `lib/api-client/documents.ts` (after `documentCommentsApi`)
- Modify: `lib/query/keys.ts` (~line 93)
- Test: `__tests__/api-client/document-revisions-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api-client/document-revisions-client.test.ts
import { documentRevisionsApi } from '@/lib/api-client/documents'

const mockFetch = jest.fn()
jest.mock('@/lib/api-client/base', () => ({
  apiFetch: (...a: any[]) => mockFetch(...a),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockFetch.mockResolvedValue({})
})

it('list hits the revisions collection URL', async () => {
  await documentRevisionsApi.list('d1')
  expect(mockFetch).toHaveBeenCalledWith('/api/documents/d1/revisions')
})

it('createManual POSTs the label', async () => {
  await documentRevisionsApi.createManual('d1', { label: 'v1' })
  expect(mockFetch).toHaveBeenCalledWith('/api/documents/d1/revisions', {
    method: 'POST',
    body: { label: 'v1' },
  })
})

it('get hits a single revision URL', async () => {
  await documentRevisionsApi.get('d1', 'r1')
  expect(mockFetch).toHaveBeenCalledWith('/api/documents/d1/revisions/r1')
})

it('restore POSTs to the restore URL', async () => {
  await documentRevisionsApi.restore('d1', 'r1')
  expect(mockFetch).toHaveBeenCalledWith(
    '/api/documents/d1/revisions/r1/restore',
    {
      method: 'POST',
    }
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest document-revisions-client -c jest.config.js`
Expected: FAIL (`documentRevisionsApi` undefined).

- [ ] **Step 3: Write the implementation**

In `app/workspace/[workspaceUrl]/constants.ts`, add to the `documents` block (after the `comment` entry, ~line 72):

```typescript
    revisions: (docId: string) => `/api/documents/${docId}/revisions`,
    revisionById: (docId: string, revId: string) =>
      `/api/documents/${docId}/revisions/${revId}`,
    revisionRestore: (docId: string, revId: string) =>
      `/api/documents/${docId}/revisions/${revId}/restore`,
```

In `lib/api-client/documents.ts`, append after `documentCommentsApi`:

```typescript
export const documentRevisionsApi = {
  list<T>(docId: string) {
    return apiFetch<T>(API.documents.revisions(docId))
  },

  get<T>(docId: string, revId: string) {
    return apiFetch<T>(API.documents.revisionById(docId, revId))
  },

  createManual<T>(docId: string, data: { label: string }) {
    return apiFetch<T>(API.documents.revisions(docId), {
      method: 'POST',
      body: data,
    })
  },

  restore<T>(docId: string, revId: string) {
    return apiFetch<T>(API.documents.revisionRestore(docId, revId), {
      method: 'POST',
    })
  },
}
```

In `lib/query/keys.ts`, add near `documentComments` (~line 93):

```typescript
  documentRevisions: (docId: string) => ['document-revisions', docId] as const,
```

(If `documentRevisionsApi` isn't re-exported from `lib/api-client/index.ts`, add it there next to `documentCommentsApi`.)

- [ ] **Step 4: Run test to verify it passes & commit**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest document-revisions-client -c jest.config.js`
Expected: PASS (4 tests).

```bash
git add "app/workspace/[workspaceUrl]/constants.ts" lib/api-client/documents.ts lib/api-client/index.ts lib/query/keys.ts __tests__/api-client/document-revisions-client.test.ts
git commit -m "feat: add document revisions api client + query key [LUM-227]"
```

---

## Task 11: React Query hook

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useDocumentRevisions.ts`
- Test: `__tests__/hooks/useDocumentRevisions.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/hooks/useDocumentRevisions.test.tsx
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useDocumentRevisions } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentRevisions'

const api = {
  list: jest.fn(),
  createManual: jest.fn(),
  restore: jest.fn(),
}
jest.mock('@/lib/api-client', () => ({
  documentRevisionsApi: {
    list: (...a: any[]) => api.list(...a),
    createManual: (...a: any[]) => api.createManual(...a),
    restore: (...a: any[]) => api.restore(...a),
  },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => jest.clearAllMocks())

it('loads the revision list', async () => {
  api.list.mockResolvedValue({ revisions: [{ id: 'r1' }] })
  const { result } = renderHook(() => useDocumentRevisions('d1', true), { wrapper })
  await waitFor(() => expect(result.current.revisions).toEqual([{ id: 'r1' }]))
})

it('createManual invalidates and refetches the list', async () => {
  api.list.mockResolvedValue({ revisions: [] })
  api.createManual.mockResolvedValue({ revision: { id: 'r2', label: 'v1' } })
  const { result } = renderHook(() => useDocumentRevisions('d1', true), { wrapper })
  await waitFor(() => expect(result.current.revisions).toEqual([]))
  api.list.mockResolvedValue({ revisions: [{ id: 'r2', label: 'v1' }] })
  await act(async () => { await result.current.createManual('v1') })
  await waitFor(() => expect(result.current.revisions).toEqual([{ id: 'r2', label: 'v1' }]))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest useDocumentRevisions -c jest.config.js`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Write the implementation**

```typescript
// app/workspace/[workspaceUrl]/hooks/useDocumentRevisions.ts
'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { documentRevisionsApi } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

export interface RevisionListItem {
  id: string
  label: string | null
  isManual: boolean
  title: string
  emoji: string | null
  wordCount: number | null
  createdAt: string
  updatedAt: string
  author: { id: string; name: string; imageUrl: string | null }
}

export interface RevisionDetail {
  id: string
  content: string | null
  title: string
  emoji: string | null
  label: string | null
  isManual: boolean
  createdAt: string
}

export function useDocumentRevisions(documentId: string, enabled: boolean) {
  const queryClient = useQueryClient()
  const key = queryKeys.documentRevisions(documentId)

  const query = useQuery<RevisionListItem[]>({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const data = await documentRevisionsApi.list<{
        revisions: RevisionListItem[]
      }>(documentId)
      return data.revisions
    },
  })

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient, key]
  )

  const getRevision = useCallback(
    async (revId: string): Promise<RevisionDetail> => {
      const data = await documentRevisionsApi.get<{ revision: RevisionDetail }>(
        documentId,
        revId
      )
      return data.revision
    },
    [documentId]
  )

  const createManual = useCallback(
    async (label: string) => {
      await documentRevisionsApi.createManual(documentId, { label })
      await refresh()
    },
    [documentId, refresh]
  )

  const restore = useCallback(
    async (revId: string) => {
      const data = await documentRevisionsApi.restore<{ document: unknown }>(
        documentId,
        revId
      )
      await refresh()
      return data.document
    },
    [documentId, refresh]
  )

  return {
    revisions: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    getRevision,
    createManual,
    restore,
    refresh,
  }
}
```

- [ ] **Step 4: Run test to verify it passes & commit**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest useDocumentRevisions -c jest.config.js`
Expected: PASS (2 tests).

```bash
git add "app/workspace/[workspaceUrl]/hooks/useDocumentRevisions.ts" __tests__/hooks/useDocumentRevisions.test.tsx
git commit -m "feat: add useDocumentRevisions hook [LUM-227]"
```

---

## Task 12: Diff view component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/documents/RevisionDiffView.tsx`
- Test: `__tests__/components/RevisionDiffView.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/components/RevisionDiffView.test.tsx
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { RevisionDiffView } from '@/app/workspace/[workspaceUrl]/components/documents/RevisionDiffView'

function renderView(props: React.ComponentProps<typeof RevisionDiffView>) {
  return render(
    <IntlProvider locale='en' messages={{}}>
      <RevisionDiffView {...props} />
    </IntlProvider>
  )
}

it('renders inline word-level diff by default with added/removed marks', () => {
  renderView({
    oldHtml: '<p>the quick brown fox</p>',
    newHtml: '<p>the slow brown fox</p>',
    mode: 'inline',
  })
  expect(screen.getByText('quick')).toHaveAttribute('data-diff', 'removed')
  expect(screen.getByText('slow')).toHaveAttribute('data-diff', 'added')
})

it('renders side-by-side panes when mode=split', () => {
  renderView({
    oldHtml: '<p>old body</p>',
    newHtml: '<p>new body</p>',
    mode: 'split',
  })
  expect(screen.getByTestId('diff-old-pane')).toBeInTheDocument()
  expect(screen.getByTestId('diff-new-pane')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest RevisionDiffView -c jest.config.js`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Write the implementation**

```tsx
// app/workspace/[workspaceUrl]/components/documents/RevisionDiffView.tsx
'use client'

import { useMemo } from 'react'
import { diffDocumentText, htmlToPlainText } from '@/lib/editor/revision-diff'

export type DiffMode = 'inline' | 'split'

interface RevisionDiffViewProps {
  oldHtml: string | null
  newHtml: string | null
  mode: DiffMode
}

export function RevisionDiffView({
  oldHtml,
  newHtml,
  mode,
}: RevisionDiffViewProps) {
  const segments = useMemo(
    () => diffDocumentText(htmlToPlainText(oldHtml), htmlToPlainText(newHtml)),
    [oldHtml, newHtml]
  )

  if (mode === 'split') {
    return (
      <div className='grid grid-cols-2 gap-4 text-sm'>
        <div
          data-testid='diff-old-pane'
          className='prose prose-sm max-w-none rounded-md border border-border p-3'
          dangerouslySetInnerHTML={{ __html: oldHtml ?? '' }}
        />
        <div
          data-testid='diff-new-pane'
          className='prose prose-sm max-w-none rounded-md border border-border p-3'
          dangerouslySetInnerHTML={{ __html: newHtml ?? '' }}
        />
      </div>
    )
  }

  return (
    <div
      data-testid='diff-inline'
      className='whitespace-pre-wrap text-sm leading-relaxed'
    >
      {segments.map((seg, i) => {
        if (seg.added) {
          return (
            <span
              key={i}
              data-diff='added'
              className='bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
            >
              {seg.value}
            </span>
          )
        }
        if (seg.removed) {
          return (
            <span
              key={i}
              data-diff='removed'
              className='bg-red-100 text-red-800 line-through dark:bg-red-950 dark:text-red-300'
            >
              {seg.value}
            </span>
          )
        }
        return <span key={i}>{seg.value}</span>
      })}
    </div>
  )
}
```

(The test asserts `getByText('quick')` resolves to the `<span data-diff="removed">`; jsdiff emits each changed run as its own part, so single changed words become standalone spans.)

- [ ] **Step 4: Run test to verify it passes & commit**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest RevisionDiffView -c jest.config.js`
Expected: PASS (2 tests). If a changed word shares a span with surrounding spaces, trim isn't applied — keep test words single and surrounded by unchanged words (as written).

```bash
git add "app/workspace/[workspaceUrl]/components/documents/RevisionDiffView.tsx" __tests__/components/RevisionDiffView.test.tsx
git commit -m "feat: add revision diff view component [LUM-227]"
```

---

## Task 13: History modal

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/documents/DocumentHistoryModal.tsx`
- Test: `__tests__/components/DocumentHistoryModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/components/DocumentHistoryModal.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { DocumentHistoryModal } from '@/app/workspace/[workspaceUrl]/components/documents/DocumentHistoryModal'

const hook = {
  revisions: [
    { id: 'r2', label: null, isManual: false, title: 'T', emoji: null, wordCount: 3, createdAt: '2026-06-05T11:00:00Z', updatedAt: '2026-06-05T11:00:00Z', author: { id: 'm1', name: 'Alex', imageUrl: null } },
    { id: 'r1', label: 'v1 review', isManual: true, title: 'T', emoji: null, wordCount: 2, createdAt: '2026-06-04T10:00:00Z', updatedAt: '2026-06-04T10:00:00Z', author: { id: 'm1', name: 'Alex', imageUrl: null } },
  ],
  loading: false,
  error: null,
  getRevision: jest.fn().mockResolvedValue({ id: 'r2', content: '<p>old</p>' }),
  createManual: jest.fn(),
  restore: jest.fn().mockResolvedValue({ id: 'd1' }),
  refresh: jest.fn(),
}
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useDocumentRevisions', () => ({
  useDocumentRevisions: () => hook,
}))

function renderModal(onRestored = jest.fn()) {
  return render(
    <IntlProvider locale='en' messages={{}}>
      <DocumentHistoryModal
        open
        documentId='d1'
        currentHtml='<p>current</p>'
        onClose={jest.fn()}
        onRestored={onRestored}
      />
    </IntlProvider>
  )
}

beforeEach(() => jest.clearAllMocks())

it('lists revisions with a manual-version badge', async () => {
  renderModal()
  expect(await screen.findByText('v1 review')).toBeInTheDocument()
  expect(screen.getAllByText('Alex').length).toBeGreaterThan(0)
})

it('restores the selected revision and calls onRestored', async () => {
  const onRestored = jest.fn()
  renderModal(onRestored)
  fireEvent.click(await screen.findByText('v1 review'))
  fireEvent.click(screen.getByRole('button', { name: /restore/i }))
  await waitFor(() => expect(hook.restore).toHaveBeenCalledWith('r1'))
  await waitFor(() => expect(onRestored).toHaveBeenCalled())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest DocumentHistoryModal -c jest.config.js`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Write the implementation**

```tsx
// app/workspace/[workspaceUrl]/components/documents/DocumentHistoryModal.tsx
'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { Star } from 'lucide-react'
import {
  useDocumentRevisions,
  type RevisionListItem,
} from '@/app/workspace/[workspaceUrl]/hooks/useDocumentRevisions'
import { RevisionDiffView, type DiffMode } from './RevisionDiffView'

interface DocumentHistoryModalProps {
  open: boolean
  documentId: string
  currentHtml: string | null
  onClose: () => void
  onRestored: (document: unknown) => void
}

export function DocumentHistoryModal({
  open,
  documentId,
  currentHtml,
  onClose,
  onRestored,
}: DocumentHistoryModalProps) {
  const intl = useIntl()
  const { revisions, loading, getRevision, restore } = useDocumentRevisions(
    documentId,
    open
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedHtml, setSelectedHtml] = useState<string | null>(null)
  const [mode, setMode] = useState<DiffMode>('inline')
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    void getRevision(selectedId).then(r => {
      if (!cancelled) setSelectedHtml(r.content)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId, getRevision])

  if (!open) return null

  const onRestore = async () => {
    if (!selectedId) return
    setRestoring(true)
    try {
      const doc = await restore(selectedId)
      onRestored(doc)
      onClose()
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6'
      role='dialog'
      aria-modal='true'
      aria-label={intl.formatMessage({
        id: 'documentHistory.title',
        defaultMessage: 'Version history',
      })}
    >
      <div className='flex h-[80vh] w-full max-w-5xl overflow-hidden rounded-lg bg-background shadow-xl'>
        {/* Left: timeline */}
        <aside className='w-72 shrink-0 overflow-y-auto border-r border-border p-2'>
          <h2 className='px-2 py-2 text-sm font-semibold'>
            {intl.formatMessage({
              id: 'documentHistory.title',
              defaultMessage: 'Version history',
            })}
          </h2>
          {loading && (
            <p className='px-2 text-xs text-muted-foreground'>
              {intl.formatMessage({
                id: 'documentHistory.loading',
                defaultMessage: 'Loading…',
              })}
            </p>
          )}
          <ul>
            {revisions.map((r: RevisionListItem) => (
              <li key={r.id}>
                <button
                  type='button'
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${
                    selectedId === r.id ? 'bg-muted' : ''
                  }`}
                >
                  <span className='flex items-center gap-1.5'>
                    {r.isManual && (
                      <Star size={12} className='text-amber-500' aria-hidden />
                    )}
                    <span className='font-medium'>
                      {r.label ??
                        intl.formatDate(r.createdAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                    </span>
                  </span>
                  <span className='text-xs text-muted-foreground'>
                    {r.author.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Right: diff + actions */}
        <section className='flex flex-1 flex-col'>
          <header className='flex items-center justify-between border-b border-border px-4 py-2'>
            <div className='flex gap-1 text-xs'>
              <button
                type='button'
                onClick={() => setMode('inline')}
                className={`rounded px-2 py-1 ${mode === 'inline' ? 'bg-muted font-medium' : ''}`}
              >
                {intl.formatMessage({
                  id: 'documentHistory.inline',
                  defaultMessage: 'Inline',
                })}
              </button>
              <button
                type='button'
                onClick={() => setMode('split')}
                className={`rounded px-2 py-1 ${mode === 'split' ? 'bg-muted font-medium' : ''}`}
              >
                {intl.formatMessage({
                  id: 'documentHistory.sideBySide',
                  defaultMessage: 'Side by side',
                })}
              </button>
            </div>
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={onRestore}
                disabled={!selectedId || restoring}
                className='rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50'
              >
                {intl.formatMessage({
                  id: 'documentHistory.restore',
                  defaultMessage: 'Restore this version',
                })}
              </button>
              <button
                type='button'
                onClick={onClose}
                className='rounded-md border border-border px-3 py-1.5 text-sm'
              >
                {intl.formatMessage({
                  id: 'documentHistory.close',
                  defaultMessage: 'Close',
                })}
              </button>
            </div>
          </header>
          <div className='flex-1 overflow-y-auto p-4'>
            {selectedId ? (
              <RevisionDiffView
                oldHtml={selectedHtml}
                newHtml={currentHtml}
                mode={mode}
              />
            ) : (
              <p className='text-sm text-muted-foreground'>
                {intl.formatMessage({
                  id: 'documentHistory.selectPrompt',
                  defaultMessage:
                    'Select a version to compare with the current document.',
                })}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes & commit**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest DocumentHistoryModal -c jest.config.js`
Expected: PASS (2 tests).

```bash
git add "app/workspace/[workspaceUrl]/components/documents/DocumentHistoryModal.tsx" __tests__/components/DocumentHistoryModal.test.tsx
git commit -m "feat: add document history modal [LUM-227]"
```

---

## Task 14: Wire entry points into DocumentEditorPage

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx`

- [ ] **Step 1: Add state + imports**

Near the other imports, add:

```typescript
import { History } from 'lucide-react'
import { DocumentHistoryModal } from '../documents/DocumentHistoryModal'
import { documentRevisionsApi } from '@/lib/api-client'
```

Inside the component body (with the other `useState` declarations), add:

```typescript
const [historyOpen, setHistoryOpen] = useState(false)
```

- [ ] **Step 2: Add the "History" + "Save as version" buttons**

In the header row next to the Share button (~line 407-417), add a history button before/after `<Button … Share>`:

```tsx
<Button
  size='sm'
  variant='ghost'
  className='gap-1.5 h-8'
  onClick={async () => {
    await flushAsync() // ensure the latest content is saved first
    setHistoryOpen(true)
  }}
>
  <History size={14} />
  {intl.formatMessage({
    id: 'documentHistory.openButton',
    defaultMessage: 'History',
  })}
</Button>
```

Add a "Save as version" action in the metadata strip (after the TagPicker block, ~line 562). It prompts for a name and creates a manual snapshot:

```tsx
                <span className='text-border'>·</span>
                <button
                  type='button'
                  className='shrink-0 italic hover:text-foreground'
                  onClick={async () => {
                    const label = window.prompt(
                      intl.formatMessage({
                        id: 'documentHistory.namePrompt',
                        defaultMessage: 'Name this version',
                      })
                    )
                    if (!label || !label.trim()) return
                    await flushAsync()
                    await documentRevisionsApi.createManual(doc.id, {
                      label: label.trim(),
                    })
                  }}
                >
                  {intl.formatMessage({
                    id: 'documentHistory.saveAsVersion',
                    defaultMessage: 'Save as version',
                  })}
                </button>
```

(`flushAsync` is already returned by `useDocumentSave` in this component — see line ~249/262 where it is used before posting comments.)

- [ ] **Step 3: Mount the modal**

Near the other dialogs/modals at the end of the component's returned JSX, add:

```tsx
<DocumentHistoryModal
  open={historyOpen}
  documentId={doc.id}
  currentHtml={doc.content ?? null}
  onClose={() => setHistoryOpen(false)}
  onRestored={() => {
    setHistoryOpen(false)
    // Reload the document so the editor shows the restored content.
    onReloadDocument?.()
  }}
/>
```

If no `onReloadDocument` prop exists, invalidate the document detail query instead — add `const queryClient = useQueryClient()` and call `queryClient.invalidateQueries({ queryKey: queryKeys.documents.detail(doc.id) })` in `onRestored` (import `useQueryClient` from `@tanstack/react-query` and `queryKeys` from `@/lib/query/keys`).

- [ ] **Step 4: Verify build + type-check**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx tsc --noEmit`
Expected: PASS. Then run the full editor-page-related tests if any: `npx jest DocumentEditorPage -c jest.config.js` (expect PASS or "no tests found").

- [ ] **Step 5: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/pages/DocumentEditorPage.tsx"
git commit -m "feat: wire history + save-as-version entry points into doc editor [LUM-227]"
```

---

## Task 15: i18n — add `documentHistory.*` keys to all 16 locales

**Files:**

- Modify: all 16 files in `lib/i18n/`: `en.json`, `en-AU.json`, `en-GB.json`, `zh-CN.json`, `zh-TW.json`, `es.json`, `es-419.json`, `fr.json`, `de.json`, `ru.json`, `ja.json`, `ko.json`, `hi.json`, `vi.json`, `id.json`, `ms.json`
- Test (already exists): `__tests__/i18n-locale-parity.test.ts`

- [ ] **Step 1: Run the parity test to see it is currently green**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest i18n-locale-parity -c jest.config.js`
Expected: PASS (baseline).

- [ ] **Step 2: Add the 9 keys to every locale with REAL translations**

Add these keys to each locale file (do NOT use English as a fallback for non-English locales — provide a proper translation). Keys: `documentHistory.title`, `documentHistory.openButton`, `documentHistory.saveAsVersion`, `documentHistory.namePrompt`, `documentHistory.restore`, `documentHistory.inline`, `documentHistory.sideBySide`, `documentHistory.close`, `documentHistory.loading`, `documentHistory.selectPrompt`.

`en.json` (and en-AU / en-GB):

```json
  "documentHistory.title": "Version history",
  "documentHistory.openButton": "History",
  "documentHistory.saveAsVersion": "Save as version",
  "documentHistory.namePrompt": "Name this version",
  "documentHistory.restore": "Restore this version",
  "documentHistory.inline": "Inline",
  "documentHistory.sideBySide": "Side by side",
  "documentHistory.close": "Close",
  "documentHistory.loading": "Loading…",
  "documentHistory.selectPrompt": "Select a version to compare with the current document.",
```

`zh-CN.json`:

```json
  "documentHistory.title": "历史版本",
  "documentHistory.openButton": "历史",
  "documentHistory.saveAsVersion": "保存为版本",
  "documentHistory.namePrompt": "为此版本命名",
  "documentHistory.restore": "恢复此版本",
  "documentHistory.inline": "行内对比",
  "documentHistory.sideBySide": "并排对比",
  "documentHistory.close": "关闭",
  "documentHistory.loading": "加载中…",
  "documentHistory.selectPrompt": "选择一个版本与当前文档对比。",
```

`zh-TW.json`:

```json
  "documentHistory.title": "歷史版本",
  "documentHistory.openButton": "歷史",
  "documentHistory.saveAsVersion": "儲存為版本",
  "documentHistory.namePrompt": "為此版本命名",
  "documentHistory.restore": "還原此版本",
  "documentHistory.inline": "行內對比",
  "documentHistory.sideBySide": "並排對比",
  "documentHistory.close": "關閉",
  "documentHistory.loading": "載入中…",
  "documentHistory.selectPrompt": "選擇一個版本與目前文件對比。",
```

`es.json` / `es-419.json`:

```json
  "documentHistory.title": "Historial de versiones",
  "documentHistory.openButton": "Historial",
  "documentHistory.saveAsVersion": "Guardar como versión",
  "documentHistory.namePrompt": "Nombra esta versión",
  "documentHistory.restore": "Restaurar esta versión",
  "documentHistory.inline": "En línea",
  "documentHistory.sideBySide": "Lado a lado",
  "documentHistory.close": "Cerrar",
  "documentHistory.loading": "Cargando…",
  "documentHistory.selectPrompt": "Selecciona una versión para compararla con el documento actual.",
```

`fr.json`:

```json
  "documentHistory.title": "Historique des versions",
  "documentHistory.openButton": "Historique",
  "documentHistory.saveAsVersion": "Enregistrer comme version",
  "documentHistory.namePrompt": "Nommer cette version",
  "documentHistory.restore": "Restaurer cette version",
  "documentHistory.inline": "En ligne",
  "documentHistory.sideBySide": "Côte à côte",
  "documentHistory.close": "Fermer",
  "documentHistory.loading": "Chargement…",
  "documentHistory.selectPrompt": "Sélectionnez une version à comparer avec le document actuel.",
```

`de.json`:

```json
  "documentHistory.title": "Versionsverlauf",
  "documentHistory.openButton": "Verlauf",
  "documentHistory.saveAsVersion": "Als Version speichern",
  "documentHistory.namePrompt": "Diese Version benennen",
  "documentHistory.restore": "Diese Version wiederherstellen",
  "documentHistory.inline": "Inline",
  "documentHistory.sideBySide": "Nebeneinander",
  "documentHistory.close": "Schließen",
  "documentHistory.loading": "Wird geladen…",
  "documentHistory.selectPrompt": "Wähle eine Version zum Vergleich mit dem aktuellen Dokument.",
```

`ru.json`:

```json
  "documentHistory.title": "История версий",
  "documentHistory.openButton": "История",
  "documentHistory.saveAsVersion": "Сохранить как версию",
  "documentHistory.namePrompt": "Назовите эту версию",
  "documentHistory.restore": "Восстановить эту версию",
  "documentHistory.inline": "В строке",
  "documentHistory.sideBySide": "Рядом",
  "documentHistory.close": "Закрыть",
  "documentHistory.loading": "Загрузка…",
  "documentHistory.selectPrompt": "Выберите версию для сравнения с текущим документом.",
```

`ja.json`:

```json
  "documentHistory.title": "バージョン履歴",
  "documentHistory.openButton": "履歴",
  "documentHistory.saveAsVersion": "バージョンとして保存",
  "documentHistory.namePrompt": "このバージョンに名前を付ける",
  "documentHistory.restore": "このバージョンを復元",
  "documentHistory.inline": "インライン",
  "documentHistory.sideBySide": "左右に並べる",
  "documentHistory.close": "閉じる",
  "documentHistory.loading": "読み込み中…",
  "documentHistory.selectPrompt": "現在の文書と比較するバージョンを選択してください。",
```

`ko.json`:

```json
  "documentHistory.title": "버전 기록",
  "documentHistory.openButton": "기록",
  "documentHistory.saveAsVersion": "버전으로 저장",
  "documentHistory.namePrompt": "이 버전의 이름 지정",
  "documentHistory.restore": "이 버전 복원",
  "documentHistory.inline": "인라인",
  "documentHistory.sideBySide": "나란히 보기",
  "documentHistory.close": "닫기",
  "documentHistory.loading": "불러오는 중…",
  "documentHistory.selectPrompt": "현재 문서와 비교할 버전을 선택하세요.",
```

`hi.json`:

```json
  "documentHistory.title": "संस्करण इतिहास",
  "documentHistory.openButton": "इतिहास",
  "documentHistory.saveAsVersion": "संस्करण के रूप में सहेजें",
  "documentHistory.namePrompt": "इस संस्करण को नाम दें",
  "documentHistory.restore": "यह संस्करण पुनर्स्थापित करें",
  "documentHistory.inline": "इनलाइन",
  "documentHistory.sideBySide": "साथ-साथ",
  "documentHistory.close": "बंद करें",
  "documentHistory.loading": "लोड हो रहा है…",
  "documentHistory.selectPrompt": "वर्तमान दस्तावेज़ से तुलना करने के लिए एक संस्करण चुनें।",
```

`vi.json`:

```json
  "documentHistory.title": "Lịch sử phiên bản",
  "documentHistory.openButton": "Lịch sử",
  "documentHistory.saveAsVersion": "Lưu thành phiên bản",
  "documentHistory.namePrompt": "Đặt tên cho phiên bản này",
  "documentHistory.restore": "Khôi phục phiên bản này",
  "documentHistory.inline": "Cùng dòng",
  "documentHistory.sideBySide": "Song song",
  "documentHistory.close": "Đóng",
  "documentHistory.loading": "Đang tải…",
  "documentHistory.selectPrompt": "Chọn một phiên bản để so sánh với tài liệu hiện tại.",
```

`id.json`:

```json
  "documentHistory.title": "Riwayat versi",
  "documentHistory.openButton": "Riwayat",
  "documentHistory.saveAsVersion": "Simpan sebagai versi",
  "documentHistory.namePrompt": "Beri nama versi ini",
  "documentHistory.restore": "Pulihkan versi ini",
  "documentHistory.inline": "Sebaris",
  "documentHistory.sideBySide": "Berdampingan",
  "documentHistory.close": "Tutup",
  "documentHistory.loading": "Memuat…",
  "documentHistory.selectPrompt": "Pilih versi untuk dibandingkan dengan dokumen saat ini.",
```

`ms.json`:

```json
  "documentHistory.title": "Sejarah versi",
  "documentHistory.openButton": "Sejarah",
  "documentHistory.saveAsVersion": "Simpan sebagai versi",
  "documentHistory.namePrompt": "Namakan versi ini",
  "documentHistory.restore": "Pulihkan versi ini",
  "documentHistory.inline": "Sebaris",
  "documentHistory.sideBySide": "Bersebelahan",
  "documentHistory.close": "Tutup",
  "documentHistory.loading": "Memuatkan…",
  "documentHistory.selectPrompt": "Pilih versi untuk dibandingkan dengan dokumen semasa.",
```

- [ ] **Step 3: Run the parity test**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest i18n-locale-parity -c jest.config.js`
Expected: PASS (all 16 locales have the 10 new keys, none empty).

- [ ] **Step 4: Commit**

```bash
git add lib/i18n
git commit -m "i18n: add documentHistory keys to all locales [LUM-227]"
```

---

## Task 16: Full verification + PR

- [ ] **Step 1: Regenerate client + type-check the whole repo**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx prisma generate && npx tsc --noEmit`
Expected: PASS (no errors). If "DocumentRevision not exported" appears, it's a stale client — rerun `npx prisma generate`.

- [ ] **Step 2: Run the full test suite**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npx jest -c jest.config.js`
Expected: PASS (all suites, including the new ones and `i18n-locale-parity`).

- [ ] **Step 3: Lint tokens (design-token check) if components added classes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo && npm run lint:tokens`
Expected: PASS. The diff view uses `bg-green-100`/`bg-red-100` etc. for added/removed marks — if `lint:tokens` flags them as non-semantic, either switch to sanctioned semantic tokens or, if this is an accepted brand-style exception, record the baseline with `npm run lint:tokens -- --update` and stage it (per project convention).

- [ ] **Step 4: Confirm no migration deletions / branch hygiene**

Run: `git fetch origin main && git diff --stat origin/main...HEAD -- prisma/migrations`
Expected: only ADDED migration file(s), no deletions. If a newer migration landed on main, merge `origin/main` before opening the PR.

- [ ] **Step 5: Push + open the PR**

```bash
git push -u origin lumo/LUM-227-doc-revisions
gh pr create --title "feat: document version history, diff and restore [LUM-227]" --body "$(cat <<'EOF'
## Summary
Adds document version history (LUM-227): throttled auto-snapshots on save (same-author 10-min sliding-window merge), version list, word-level inline diff (+ side-by-side toggle), reversible one-click restore, manual named snapshots, and a daily time-decay retention cron.

## Production / deploy notes
- **Requires `prisma migrate deploy` on next deploy** — adds the `DocumentRevision` table (purely additive, no data-destructive steps).
- Adds a Vercel cron `/api/cron/prune-document-revisions` (daily 03:00) — needs `CRON_SECRET` (already configured for existing crons).
- **New dependencies:** `diff` (jsdiff) + `@types/diff`.

## Test plan
- Unit: repository, service (snapshot window-merge / restore / prune), retention policy, diff util, validation.
- API: revisions routes + cron route.
- Hook + components: useDocumentRevisions, RevisionDiffView, DocumentHistoryModal.
- i18n parity across all 16 locales.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Verify the migration applied to production after deploy**

After the PR merges and the deploy completes, confirm prod is migrated:
Run: `DOTENV_CONFIG_PATH=.env.production npx prisma migrate status`
Expected: the `add_document_revision` migration shows as applied. If CI didn't run `migrate deploy`, apply manually (only with explicit authorization): `DOTENV_CONFIG_PATH=.env.production npx prisma migrate deploy`.

---

## Self-Review

**Spec coverage:**

- §3 data model → Task 1 ✅
- §4 snapshot capture (throttle + window merge) → Tasks 2,4,5 ✅
- §5 time-decay retention + cron → Tasks 3,4(prune),8 ✅
- §6 diff (inline word-level + side-by-side) → Tasks 9,12 ✅
- §7 restore (reversible, reuse orphan) → Tasks 4(restore),7 ✅
- §8 API → Tasks 6,7 ✅
- §9 UI (modal + entry points) → Tasks 13,14 ✅
- §10 i18n (all locales) → Task 15 ✅
- §11 testing → every task is TDD; full-suite gate in Task 16 ✅

**Type consistency:** `snapshotOnSave(documentId, workspaceId, authorId, snapshot, now?)` — same signature in service (Task 4), its tests, and the call site (Task 5). `documentRevisionsApi.{list,get,createManual,restore}` — same names in client (Task 10), hook (Task 11), test (Task 10). `RevisionDiffView` props `{oldHtml,newHtml,mode}` — same in component (Task 12), modal (Task 13), tests. `selectRevisionsToPrune(revisions, now)` — same in policy (Task 3) and service prune (Task 4).

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The only intentionally open branch is Task 14 Step 3's "if no `onReloadDocument` prop exists" — both alternatives are spelled out with concrete code.

**Note on locale count:** the design doc says "17 locales"; the actual `lib/i18n/` directory has **16** files (verified). Task 15 covers all 16 — treat 16 as authoritative.

```

```
