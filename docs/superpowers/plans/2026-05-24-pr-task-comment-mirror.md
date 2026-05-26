# PR ↔ Task Comment Bidirectional Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror all three GitHub PR comment kinds (`issue_comment`, `pull_request_review`, `pull_request_review_comment`) bidirectionally with the linked Lumo task's comment thread.

**Architecture:** Inbound via existing `/api/webhooks/github` with three new event branches. Outbound via `commentService` hooks dispatched through `waitUntil`. A new service `pr-comment-mirror.service.ts` owns echo defense, conflict resolution, and the GitHub fetch layer. Failures spill into a small `PrCommentSyncJob` table that is **drained event-driven** — every inbound webhook drains pending inbound jobs for that PR, and every outbound dispatch drains pending outbound jobs for that task. No cron. Known limit: a workspace with zero activity will leave failed jobs PENDING indefinitely (acceptable for MVP; post-MVP can add a low-frequency cron or operator CLI).

**Tech Stack:** Next.js App Router, Prisma + Postgres, GitHub REST API via `fetch` (no octokit), Vercel `waitUntil`, Jest.

**Spec:** [docs/superpowers/specs/2026-05-24-pr-task-comment-mirror-design.md](../specs/2026-05-24-pr-task-comment-mirror-design.md)

**Lumo task:** [LUM-90](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-90)

---

## Phase A — Schema & Repositories

### Task 1: Schema migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_pr_comment_mirror/migration.sql` (Prisma will generate)

- [ ] **Step 1: Read current schema sections to splice into**

Read `prisma/schema.prisma` and locate:

- `enum ActorType` (around line 110)
- `model Actor` (around line 310)
- `model Comment` (around line 580)
- `model PullRequest` (around line 718)

- [ ] **Step 2: Edit schema — add enum values to ActorType**

In `prisma/schema.prisma`, edit:

```prisma
enum ActorType {
  HUMAN
  AGENT
  GITHUB_USER
}
```

- [ ] **Step 3: Edit Actor model — add externalIdentity column**

```prisma
model Actor {
  id                String    @id @default(cuid())
  workspaceId       String
  type              ActorType
  memberId          String?   @unique
  agentId           String?   @unique
  externalIdentity  String?   // "github:<login>" for GITHUB_USER; null otherwise
  externalAvatarUrl String?   // cached avatar for external actors

  workspace Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  member    WorkspaceMember? @relation(fields: [memberId], references: [id], onDelete: Cascade)
  agent     AgentProfile?    @relation(fields: [agentId], references: [id], onDelete: Cascade)

  assignedTasks          Task[]         @relation("TaskAssignee")
  comments               Comment[]      @relation("CommentAuthor")
  activities             TaskActivity[]
  receivedNotifications  Notification[] @relation("NotificationRecipient")
  triggeredNotifications Notification[] @relation("NotificationTrigger")

  @@unique([workspaceId, externalIdentity])
  @@index([workspaceId])
  @@map("actors")
}
```

- [ ] **Step 4: Edit Comment model — add deletedAt + back-relation**

```prisma
model Comment {
  id              String      @id @default(cuid())
  taskId          String
  authorActorId   String?
  body            String
  parentId        String?
  quotedCommentId String?
  type            CommentType @default(USER)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  task     Task               @relation(fields: [taskId], references: [id], onDelete: Cascade)
  author   Actor?             @relation("CommentAuthor", fields: [authorActorId], references: [id], onDelete: SetNull)
  parent   Comment?           @relation("CommentReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies  Comment[]          @relation("CommentReplies")
  mirror   PrCommentMirror?
  syncJobs PrCommentSyncJob[]

  @@index([taskId])
  @@index([parentId])
  @@index([authorActorId])
  @@map("comments")
}
```

- [ ] **Step 5: Edit PullRequest — add back-relation**

Add the line `mirroredComments PrCommentMirror[]` inside the existing `model PullRequest` block (alongside other relations).

- [ ] **Step 6: Add new enums + tables at end of schema**

Append to `prisma/schema.prisma`:

```prisma
enum PrCommentSource {
  ISSUE
  REVIEW
  REVIEW_LINE
}

enum DiffSide {
  LEFT
  RIGHT
}

enum OutboundActorKind {
  USER_OAUTH
  BOT_APP
}

enum SyncDirection {
  OUTBOUND
  INBOUND
}

enum SyncJobStatus {
  PENDING
  DEAD_LETTER
}

model PrCommentMirror {
  id                  String          @id @default(cuid())
  commentId           String          @unique
  pullRequestId       String

  externalSource      PrCommentSource
  externalId          String
  externalNodeId      String?
  externalUrl         String
  externalUpdatedAt   DateTime
  lastSyncedAt        DateTime
  deletedAt           DateTime?

  filePath            String?
  lineStart           Int?
  lineEnd             Int?
  diffSide            DiffSide?
  inReplyToExternalId String?

  outboundActor       OutboundActorKind
  outboundActorUserId String?

  bodyHash            String?         // for race-patch fallback lookup (sha256 of outbound rendered body)

  comment     Comment     @relation(fields: [commentId], references: [id], onDelete: Cascade)
  pullRequest PullRequest @relation(fields: [pullRequestId], references: [id], onDelete: Cascade)

  @@unique([externalSource, externalId])
  @@index([pullRequestId])
  @@index([pullRequestId, bodyHash, lastSyncedAt])
  @@map("pr_comment_mirrors")
}

model PrCommentSyncJob {
  id           String        @id @default(cuid())
  direction    SyncDirection
  payload      Json
  commentId    String?
  externalId   String?
  attempts     Int           @default(0)
  lastError    String?
  status       SyncJobStatus @default(PENDING)
  scheduledFor DateTime      @default(now())
  workspaceId  String
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  comment Comment? @relation(fields: [commentId], references: [id], onDelete: SetNull)

  @@index([status, scheduledFor])
  @@index([workspaceId])
  @@index([commentId])
  @@map("pr_comment_sync_jobs")
}
```

- [ ] **Step 7: Generate migration**

Run: `npx prisma migrate dev --name pr_comment_mirror --create-only`
Expected: a new directory `prisma/migrations/<timestamp>_pr_comment_mirror/` containing `migration.sql`.

- [ ] **Step 8: Inspect the generated SQL**

Read the generated `migration.sql`. Verify it:

- Adds `GITHUB_USER` to `ActorType` enum
- Adds `external_identity`, `external_avatar_url` columns to `actors`
- Adds `deleted_at` column to `comments`
- Creates `pr_comment_mirrors` and `pr_comment_sync_jobs` tables
- Adds the unique constraint `actors_workspace_id_external_identity_key`

If any of these is missing, fix the prisma file and re-generate.

- [ ] **Step 9: Apply migration locally**

Run: `npx prisma migrate dev`
Expected: migration applied, client regenerated. If you hit checksum drift on a previously applied migration (P3008/P3012), refer to the project's CLAUDE.md "Database Migrations" section — never reset.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add Comment.deletedAt, Actor.externalIdentity, PrCommentMirror, PrCommentSyncJob [LUM-90]"
```

---

### Task 2: Comment soft-delete refactor

The new `Comment.deletedAt` column has no effect until callers filter on it and `commentRepository.delete` writes to it instead of hard-deleting.

**Files:**

- Modify: `lib/repositories/comment.repository.ts`
- Test: `__tests__/repositories/comment.repository.test.ts` (create or extend)

- [ ] **Step 1: Write failing tests**

Create `__tests__/repositories/comment.repository.test.ts`:

```typescript
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    comment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}))

describe('commentRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('delete (soft)', () => {
    it('sets deletedAt instead of hard-deleting', async () => {
      ;(prisma.comment.update as jest.Mock).mockResolvedValue({
        id: 'c1',
        deletedAt: new Date(),
      })
      await commentRepository.delete('c1')
      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { deletedAt: expect.any(Date) },
      })
    })
  })

  describe('findByTaskId', () => {
    it('filters out soft-deleted comments and replies', async () => {
      await commentRepository.findByTaskId('t1')
      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 't1', parentId: null, deletedAt: null },
          include: {
            replies: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        })
      )
    })
  })

  describe('findById', () => {
    it('returns soft-deleted rows (callers decide policy)', async () => {
      ;(prisma.comment.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        deletedAt: new Date(),
      })
      const r = await commentRepository.findById('c1')
      expect(r?.deletedAt).toBeInstanceOf(Date)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/repositories/comment.repository.test.ts -v`
Expected: FAIL — `findByTaskId` won't filter `deletedAt`; `delete` calls `prisma.comment.delete` not `.update`.

- [ ] **Step 3: Update repository**

Edit `lib/repositories/comment.repository.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'

interface CreateCommentData {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
}

export const commentRepository = {
  async findByTaskId(taskId: string) {
    return prisma.comment.findMany({
      where: { taskId, parentId: null, deletedAt: null },
      include: {
        replies: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' as const },
        },
      },
      orderBy: { createdAt: 'asc' as const },
    })
  },

  async findById(id: string) {
    return prisma.comment.findUnique({ where: { id } })
  },

  async create(data: CreateCommentData) {
    return prisma.comment.create({ data })
  },

  async findByIdWithTask(id: string) {
    return prisma.comment.findUnique({
      where: { id },
      include: {
        task: { select: { project: { select: { workspaceId: true } } } },
      },
    })
  },

  async update(id: string, data: { body: string }) {
    return prisma.comment.update({ where: { id }, data })
  },

  /** Soft-delete: sets deletedAt to now. */
  async delete(id: string) {
    return prisma.comment.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/repositories/comment.repository.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Scan other repos/services that select comments without filtering**

Run: `grep -rn 'prisma.comment.findMany\|prisma.comment.findUnique\|prisma.comment.findFirst' lib app`

**Known offender to fix in this task:** `lib/repositories/notification.repository.ts:160` reads `prisma.comment.findMany` directly. Add `deletedAt: null` to its `where` clause.

If grep surfaces any other direct callsites beyond `commentRepository` and the now-fixed notification repo, patch them too.

- [ ] **Step 6: Run the wider comment test suite**

Run: `npx jest comment -v`
Expected: PASS (existing comment.service.test should still pass — the soft-delete change is transparent to callers).

- [ ] **Step 7: Commit**

```bash
git add lib/repositories/comment.repository.ts __tests__/repositories/comment.repository.test.ts
git commit -m "refactor(comment): soft-delete via deletedAt + filter active rows [LUM-90]"
```

---

### Task 3: PrCommentMirror repository

**Files:**

- Create: `lib/repositories/pr-comment-mirror.repository.ts`
- Modify: `lib/repositories/index.ts` (export it)
- Test: `__tests__/repositories/pr-comment-mirror.repository.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/repositories/pr-comment-mirror.repository.test.ts
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prisma } from '@/lib/db/prisma'
import { PrCommentSource } from '@prisma/client'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prCommentMirror: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}))

describe('prCommentMirrorRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  it('reserve creates a row with a pending- placeholder externalId', async () => {
    ;(prisma.prCommentMirror.create as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalId: 'pending-cuid',
    })
    const r = await prCommentMirrorRepository.reserve({
      commentId: 'c1',
      pullRequestId: 'pr1',
      externalSource: PrCommentSource.ISSUE,
      outboundActor: 'BOT_APP',
      outboundActorUserId: null,
      bodyHash: 'hash',
    })
    expect(prisma.prCommentMirror.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commentId: 'c1',
        pullRequestId: 'pr1',
        externalSource: 'ISSUE',
        externalId: expect.stringMatching(/^pending-/),
        externalUrl: '',
        bodyHash: 'hash',
      }),
    })
    expect(r.externalId).toMatch(/^pending-/)
  })

  it('resolvePlaceholder swaps placeholder externalId with real values', async () => {
    await prCommentMirrorRepository.resolvePlaceholder('m1', {
      externalId: '12345',
      externalNodeId: 'IC_x',
      externalUrl: 'https://github.com/...',
      externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
    })
    expect(prisma.prCommentMirror.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: expect.objectContaining({
        externalId: '12345',
        externalNodeId: 'IC_x',
        lastSyncedAt: expect.any(Date),
      }),
    })
  })

  it('findByExternal looks up by source + externalId', async () => {
    await prCommentMirrorRepository.findByExternal(
      PrCommentSource.ISSUE,
      '12345'
    )
    expect(prisma.prCommentMirror.findUnique).toHaveBeenCalledWith({
      where: {
        externalSource_externalId: {
          externalSource: 'ISSUE',
          externalId: '12345',
        },
      },
    })
  })

  it('findRecentPlaceholder filters by PR, body hash, and 60s window', async () => {
    await prCommentMirrorRepository.findRecentPlaceholder('pr1', 'hash', 60)
    expect(prisma.prCommentMirror.findFirst).toHaveBeenCalledWith({
      where: {
        pullRequestId: 'pr1',
        bodyHash: 'hash',
        externalId: { startsWith: 'pending-' },
        lastSyncedAt: { gte: expect.any(Date) },
      },
      orderBy: { lastSyncedAt: 'desc' },
    })
  })

  it('markDeleted sets deletedAt', async () => {
    await prCommentMirrorRepository.markDeleted('m1')
    expect(prisma.prCommentMirror.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { deletedAt: expect.any(Date) },
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/repositories/pr-comment-mirror.repository.test.ts -v`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement repository**

Create `lib/repositories/pr-comment-mirror.repository.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import {
  PrCommentSource,
  DiffSide,
  OutboundActorKind,
  Prisma,
} from '@prisma/client'
import { randomUUID } from 'crypto'

interface ReserveInput {
  commentId: string
  pullRequestId: string
  externalSource: PrCommentSource
  outboundActor: OutboundActorKind
  outboundActorUserId: string | null
  bodyHash: string
  filePath?: string | null
  lineStart?: number | null
  lineEnd?: number | null
  diffSide?: DiffSide | null
  inReplyToExternalId?: string | null
}

interface ResolveInput {
  externalId: string
  externalNodeId?: string | null
  externalUrl: string
  externalUpdatedAt: Date
}

interface DirectCreateInput extends ReserveInput {
  externalId: string
  externalNodeId?: string | null
  externalUrl: string
  externalUpdatedAt: Date
}

export const prCommentMirrorRepository = {
  /** Reserve a row before the GitHub POST returns, with a placeholder externalId. */
  async reserve(input: ReserveInput) {
    const now = new Date()
    return prisma.prCommentMirror.create({
      data: {
        commentId: input.commentId,
        pullRequestId: input.pullRequestId,
        externalSource: input.externalSource,
        externalId: `pending-${randomUUID()}`,
        externalUrl: '',
        externalUpdatedAt: now,
        lastSyncedAt: now,
        outboundActor: input.outboundActor,
        outboundActorUserId: input.outboundActorUserId,
        bodyHash: input.bodyHash,
        filePath: input.filePath ?? null,
        lineStart: input.lineStart ?? null,
        lineEnd: input.lineEnd ?? null,
        diffSide: input.diffSide ?? null,
        inReplyToExternalId: input.inReplyToExternalId ?? null,
      },
    })
  },

  /** After GitHub responds, fill in the real externalId / url / updatedAt. */
  async resolvePlaceholder(id: string, input: ResolveInput) {
    return prisma.prCommentMirror.update({
      where: { id },
      data: {
        externalId: input.externalId,
        externalNodeId: input.externalNodeId ?? null,
        externalUrl: input.externalUrl,
        externalUpdatedAt: input.externalUpdatedAt,
        lastSyncedAt: new Date(),
      },
    })
  },

  /** Inbound-path direct create: we already have GitHub's real externalId. */
  async create(input: DirectCreateInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.prCommentMirror.create({
      data: {
        commentId: input.commentId,
        pullRequestId: input.pullRequestId,
        externalSource: input.externalSource,
        externalId: input.externalId,
        externalNodeId: input.externalNodeId ?? null,
        externalUrl: input.externalUrl,
        externalUpdatedAt: input.externalUpdatedAt,
        lastSyncedAt: new Date(),
        outboundActor: input.outboundActor,
        outboundActorUserId: input.outboundActorUserId,
        bodyHash: input.bodyHash,
        filePath: input.filePath ?? null,
        lineStart: input.lineStart ?? null,
        lineEnd: input.lineEnd ?? null,
        diffSide: input.diffSide ?? null,
        inReplyToExternalId: input.inReplyToExternalId ?? null,
      },
    })
  },

  async findById(id: string) {
    return prisma.prCommentMirror.findUnique({ where: { id } })
  },

  async findByCommentId(commentId: string) {
    return prisma.prCommentMirror.findUnique({ where: { commentId } })
  },

  async findByExternal(source: PrCommentSource, externalId: string) {
    return prisma.prCommentMirror.findUnique({
      where: {
        externalSource_externalId: { externalSource: source, externalId },
      },
    })
  },

  async findRecentPlaceholder(
    pullRequestId: string,
    bodyHash: string,
    withinSeconds: number
  ) {
    const since = new Date(Date.now() - withinSeconds * 1000)
    return prisma.prCommentMirror.findFirst({
      where: {
        pullRequestId,
        bodyHash,
        externalId: { startsWith: 'pending-' },
        lastSyncedAt: { gte: since },
      },
      orderBy: { lastSyncedAt: 'desc' },
    })
  },

  async patchAfterEdit(id: string, externalUpdatedAt: Date, bodyHash: string) {
    return prisma.prCommentMirror.update({
      where: { id },
      data: {
        externalUpdatedAt,
        bodyHash,
        lastSyncedAt: new Date(),
      },
    })
  },

  async markDeleted(id: string) {
    return prisma.prCommentMirror.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  },
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest __tests__/repositories/pr-comment-mirror.repository.test.ts -v`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Export from repo barrel**

Edit `lib/repositories/index.ts`, add:

```typescript
export { prCommentMirrorRepository } from './pr-comment-mirror.repository'
```

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/pr-comment-mirror.repository.ts lib/repositories/index.ts __tests__/repositories/pr-comment-mirror.repository.test.ts
git commit -m "feat(repo): PrCommentMirror repository [LUM-90]"
```

---

### Task 4: PrCommentSyncJob repository

**Files:**

- Create: `lib/repositories/pr-comment-sync-job.repository.ts`
- Modify: `lib/repositories/index.ts`
- Test: `__tests__/repositories/pr-comment-sync-job.repository.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prCommentSyncJob: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

describe('prCommentSyncJobRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  it('enqueue inserts a PENDING row with scheduledFor=now by default', async () => {
    await prCommentSyncJobRepository.enqueue({
      direction: 'OUTBOUND',
      payload: { op: 'CREATE' },
      commentId: 'c1',
      workspaceId: 'w1',
    })
    expect(prisma.prCommentSyncJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'OUTBOUND',
        payload: { op: 'CREATE' },
        commentId: 'c1',
        workspaceId: 'w1',
        status: 'PENDING',
      }),
    })
  })

  it('findDue returns PENDING jobs whose scheduledFor <= now, capped at limit', async () => {
    await prCommentSyncJobRepository.findDue({ limit: 50 })
    expect(prisma.prCommentSyncJob.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', scheduledFor: { lte: expect.any(Date) } },
      orderBy: { scheduledFor: 'asc' },
      take: 50,
    })
  })

  it('recordFailure increments attempts and sets backoff (1m, 5m, 15m)', async () => {
    await prCommentSyncJobRepository.recordFailure('j1', 1, 'err')
    expect(prisma.prCommentSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: {
        attempts: 2,
        lastError: 'err',
        scheduledFor: expect.any(Date),
      },
    })
    const arg = (prisma.prCommentSyncJob.update as jest.Mock).mock.calls[0][0]
    const delay = arg.data.scheduledFor.getTime() - Date.now()
    expect(delay).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000)
    expect(delay).toBeLessThanOrEqual(5 * 60 * 1000 + 1000)
  })

  it('rescheduleAt sets scheduledFor without consuming an attempt', async () => {
    const at = new Date('2027-01-01T00:00:00Z')
    await prCommentSyncJobRepository.rescheduleAt('j1', at, 'rate-limit')
    expect(prisma.prCommentSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { scheduledFor: at, lastError: 'rate-limit' },
    })
  })

  it('markDeadLetter flips status', async () => {
    await prCommentSyncJobRepository.markDeadLetter('j1', 'final error')
    expect(prisma.prCommentSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { status: 'DEAD_LETTER', lastError: 'final error' },
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/repositories/pr-comment-sync-job.repository.test.ts -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement repository**

Create `lib/repositories/pr-comment-sync-job.repository.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { SyncDirection, Prisma } from '@prisma/client'

interface EnqueueInput {
  direction: SyncDirection
  payload: Prisma.InputJsonValue
  commentId?: string | null
  externalId?: string | null
  workspaceId: string
  scheduledFor?: Date
}

const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000]

export const prCommentSyncJobRepository = {
  async enqueue(input: EnqueueInput) {
    return prisma.prCommentSyncJob.create({
      data: {
        direction: input.direction,
        payload: input.payload,
        commentId: input.commentId ?? null,
        externalId: input.externalId ?? null,
        workspaceId: input.workspaceId,
        status: 'PENDING',
        scheduledFor: input.scheduledFor ?? new Date(),
      },
    })
  },

  async findDue({ limit }: { limit: number }) {
    return prisma.prCommentSyncJob.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    })
  },

  async recordFailure(id: string, currentAttempts: number, error: string) {
    const nextAttempt = currentAttempts + 1
    const delay = BACKOFF_MS[Math.min(nextAttempt - 1, BACKOFF_MS.length - 1)]
    return prisma.prCommentSyncJob.update({
      where: { id },
      data: {
        attempts: nextAttempt,
        lastError: error.slice(0, 1000),
        scheduledFor: new Date(Date.now() + delay),
      },
    })
  },

  async rescheduleAt(id: string, at: Date, note: string) {
    return prisma.prCommentSyncJob.update({
      where: { id },
      data: { scheduledFor: at, lastError: note.slice(0, 1000) },
    })
  },

  async markDeadLetter(id: string, error: string) {
    return prisma.prCommentSyncJob.update({
      where: { id },
      data: { status: 'DEAD_LETTER', lastError: error.slice(0, 1000) },
    })
  },

  async delete(id: string) {
    return prisma.prCommentSyncJob.delete({ where: { id } })
  },
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/repositories/pr-comment-sync-job.repository.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Export from barrel**

Edit `lib/repositories/index.ts`, add:

```typescript
export { prCommentSyncJobRepository } from './pr-comment-sync-job.repository'
```

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/pr-comment-sync-job.repository.ts lib/repositories/index.ts __tests__/repositories/pr-comment-sync-job.repository.test.ts
git commit -m "feat(repo): PrCommentSyncJob repository with backoff + dead-letter [LUM-90]"
```

---

## Phase B — GitHub Plumbing

### Task 5: Helpers — lookup GitHub integration by login, upsert GitHub pseudo-actor

**Files:**

- Modify: `lib/repositories/github.repository.ts` — add `findIntegrationByLogin`
- Create: `lib/services/github-actor.service.ts`
- Test: `__tests__/services/github-actor.service.test.ts`

- [ ] **Step 1: Add repository method**

In `lib/repositories/github.repository.ts`, append to the exported object:

```typescript
async findIntegrationByLogin(workspaceId: string, githubLogin: string) {
  return prisma.gitHubIntegration.findFirst({
    where: { workspaceId, githubLogin },
    include: { member: { include: { actor: { select: { id: true } } } } },
  })
}
```

- [ ] **Step 2: Write failing service tests**

Create `__tests__/services/github-actor.service.test.ts`:

```typescript
import { githubActorService } from '@/lib/services/github-actor.service'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: { findUnique: jest.fn(), create: jest.fn() },
  },
}))

describe('githubActorService.upsertPseudoActor', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns existing actor when externalIdentity already exists', async () => {
    ;(prisma.actor.findUnique as jest.Mock).mockResolvedValue({
      id: 'a1',
      externalIdentity: 'github:foo',
    })
    const r = await githubActorService.upsertPseudoActor('w1', {
      id: 12345,
      login: 'foo',
      avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4',
    })
    expect(r.id).toBe('a1')
    expect(prisma.actor.create).not.toHaveBeenCalled()
  })

  it('creates a GITHUB_USER actor when none exists', async () => {
    ;(prisma.actor.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.actor.create as jest.Mock).mockResolvedValue({ id: 'a2' })
    await githubActorService.upsertPseudoActor('w1', {
      id: 12345,
      login: 'foo',
      avatar_url: 'https://example.com/avatar.png',
    })
    expect(prisma.actor.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'w1',
        type: 'GITHUB_USER',
        externalIdentity: 'github:foo',
        externalAvatarUrl: 'https://example.com/avatar.png',
      },
    })
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest __tests__/services/github-actor.service.test.ts -v`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement service**

Create `lib/services/github-actor.service.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'

interface GithubUser {
  id: number
  login: string
  avatar_url: string
}

export const githubActorService = {
  /** Find-or-create a GITHUB_USER actor for an unmapped GitHub login. */
  async upsertPseudoActor(workspaceId: string, user: GithubUser) {
    const externalIdentity = `github:${user.login}`
    const existing = await prisma.actor.findUnique({
      where: {
        workspaceId_externalIdentity: { workspaceId, externalIdentity },
      },
    })
    if (existing) return existing
    return prisma.actor.create({
      data: {
        workspaceId,
        type: 'GITHUB_USER',
        externalIdentity,
        externalAvatarUrl: user.avatar_url,
      },
    })
  },
}
```

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/services/github-actor.service.test.ts -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/github.repository.ts lib/services/github-actor.service.ts __tests__/services/github-actor.service.test.ts
git commit -m "feat(github): findIntegrationByLogin + upsertGithubPseudoActor [LUM-90]"
```

---

### Task 6: Markdown bridge (Lumo HTML ↔ GitHub markdown)

**Files:**

- Create: `lib/integrations/github/markdown-bridge.ts`
- Test: `__tests__/integrations/github/markdown-bridge.test.ts`

**Background:** Lumo comments are HTML with mention chips like `<span data-type="mention" data-id="user_clerk123">张三</span>`. GitHub stores plain markdown. We need lossless-ish conversion with header marker handling.

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/integrations/github/markdown-bridge.test.ts
import {
  lumoHtmlToGithubMarkdown,
  githubMarkdownToLumoHtml,
  HEADER_MARKER_OPEN,
  HEADER_MARKER_CLOSE,
  computeBodyHash,
} from '@/lib/integrations/github/markdown-bridge'

describe('markdown-bridge', () => {
  describe('lumoHtmlToGithubMarkdown', () => {
    it('strips header marker blocks', () => {
      const html = `${HEADER_MARKER_OPEN}foo${HEADER_MARKER_CLOSE}<p>body</p>`
      expect(lumoHtmlToGithubMarkdown(html, () => null)).toBe('body')
    })

    it('renders mention chip to @login when resolver returns a github login', () => {
      const html =
        '<p>hi <span data-type="mention" data-id="clerk123">张三</span></p>'
      const resolver = (clerkId: string) =>
        clerkId === 'clerk123' ? 'foo' : null
      expect(lumoHtmlToGithubMarkdown(html, resolver)).toContain('@foo')
    })

    it('renders mention chip to plain name when resolver returns null', () => {
      const html =
        '<p>hi <span data-type="mention" data-id="clerk_x">张三</span></p>'
      expect(lumoHtmlToGithubMarkdown(html, () => null)).toContain('张三')
    })
  })

  describe('githubMarkdownToLumoHtml', () => {
    it('wraps bare markdown into <p> blocks', () => {
      expect(githubMarkdownToLumoHtml('hello world', () => null)).toContain(
        '<p>hello world</p>'
      )
    })

    it('resolves @login to mention chip when resolver returns a clerkId', () => {
      const out = githubMarkdownToLumoHtml('hi @foo', login =>
        login === 'foo' ? { clerkId: 'clerk1', displayName: '张三' } : null
      )
      expect(out).toContain('data-type="mention"')
      expect(out).toContain('data-id="clerk1"')
      expect(out).toContain('张三')
    })

    it('leaves @login as plain text when resolver returns null', () => {
      const out = githubMarkdownToLumoHtml('hi @stranger', () => null)
      expect(out).toContain('@stranger')
      expect(out).not.toContain('data-type="mention"')
    })

    it('does not echo the header marker', () => {
      const md = 'just body'
      const out = githubMarkdownToLumoHtml(md, () => null)
      expect(out).not.toContain(HEADER_MARKER_OPEN)
    })
  })

  describe('computeBodyHash', () => {
    it('is deterministic over the same input', () => {
      expect(computeBodyHash('hello')).toBe(computeBodyHash('hello'))
    })

    it('differs for different inputs', () => {
      expect(computeBodyHash('a')).not.toBe(computeBodyHash('b'))
    })

    it('normalizes whitespace before hashing', () => {
      expect(computeBodyHash('hello\nworld')).toBe(
        computeBodyHash('hello\r\nworld')
      )
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/integrations/github/markdown-bridge.test.ts -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement bridge**

Create `lib/integrations/github/markdown-bridge.ts`:

```typescript
import { createHash } from 'crypto'

export const HEADER_MARKER_OPEN = '<!-- pr-mirror-header -->'
export const HEADER_MARKER_CLOSE = '<!-- /pr-mirror-header -->'

/** Resolve a Lumo clerkId → GitHub login (or null). */
type LumoMentionResolver = (clerkId: string) => string | null

/** Resolve a GitHub login → { clerkId, displayName } (or null). */
type GithubMentionResolver = (
  login: string
) => { clerkId: string; displayName: string } | null

const MENTION_CHIP_RE =
  /<span[^>]*data-type="mention"[^>]*data-id="([^"]+)"[^>]*>([^<]*)<\/span>/g
const HEADER_RE = new RegExp(
  `${HEADER_MARKER_OPEN}[\\s\\S]*?${HEADER_MARKER_CLOSE}`,
  'g'
)

export function lumoHtmlToGithubMarkdown(
  html: string,
  resolver: LumoMentionResolver
): string {
  // 1. Strip header marker (we never push our own header back to GH)
  let work = html.replace(HEADER_RE, '')
  // 2. Mention chips → @login or plain name
  work = work.replace(
    MENTION_CHIP_RE,
    (_match, clerkId: string, name: string) => {
      const login = resolver(clerkId)
      return login ? `@${login}` : name
    }
  )
  // 3. Coarse HTML→markdown: strip tags, decode entities
  work = work
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return work.trim()
}

const GH_MENTION_RE = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9-]+)/g

export function githubMarkdownToLumoHtml(
  markdown: string,
  resolver: GithubMentionResolver
): string {
  // Strip any header marker that may have leaked back (defense in depth)
  let work = markdown.replace(HEADER_RE, '')
  // Replace @login with chip or plain text
  work = work.replace(GH_MENTION_RE, (_m, lead: string, login: string) => {
    const hit = resolver(login)
    if (!hit) return `${lead}@${login}`
    return `${lead}<span data-type="mention" data-id="${hit.clerkId}">${hit.displayName}</span>`
  })
  // Block-ize: each paragraph (blank-line-separated) becomes <p>...</p>
  const paragraphs = work.split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>'))
  return paragraphs.map(p => `<p>${p}</p>`).join('')
}

/** Build a header marker block. */
export function buildHeader(content: string): string {
  return `${HEADER_MARKER_OPEN}${content}${HEADER_MARKER_CLOSE}`
}

/** Hash for race-patch placeholder fallback lookup. Normalizes line endings + whitespace. */
export function computeBodyHash(body: string): string {
  const normalized = body
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return createHash('sha256').update(normalized).digest('hex')
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/integrations/github/markdown-bridge.test.ts -v`
Expected: PASS (all 9 cases).

- [ ] **Step 5: Export from barrel**

Edit `lib/integrations/github/index.ts`, add:

```typescript
export {
  lumoHtmlToGithubMarkdown,
  githubMarkdownToLumoHtml,
  HEADER_MARKER_OPEN,
  HEADER_MARKER_CLOSE,
  buildHeader,
  computeBodyHash,
} from './markdown-bridge'
```

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/github/markdown-bridge.ts lib/integrations/github/index.ts __tests__/integrations/github/markdown-bridge.test.ts
git commit -m "feat(github): markdown bridge with header marker + body hash [LUM-90]"
```

---

### Task 7: pr-comment-client (fetch wrapper for the three GitHub endpoints)

**Files:**

- Create: `lib/integrations/github/pr-comment-client.ts`
- Test: `__tests__/integrations/github/pr-comment-client.test.ts`

**Notes:** Project uses raw `fetch` with bearer headers (no octokit). Pattern from `lib/services/github.service.ts:206`.

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/integrations/github/pr-comment-client.test.ts
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'

describe('prCommentClient', () => {
  const baseRepo = { owner: 'foo', name: 'bar' }
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 999,
          node_id: 'IC_x',
          html_url: 'https://github.com/foo/bar/pull/1#issuecomment-999',
          updated_at: '2026-05-24T00:00:00Z',
          body: 'echo',
        }),
        { status: 201 }
      )
    )
  })
  afterEach(() => fetchSpy.mockRestore())

  it('createIssueComment POSTs to /issues/{n}/comments with bearer auth', async () => {
    const r = await prCommentClient.createIssueComment({
      repo: baseRepo,
      prNumber: 1,
      body: 'hello',
      token: 'tok123',
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/repos/foo/bar/issues/1/comments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok123',
          Accept: 'application/vnd.github+json',
        }),
        body: JSON.stringify({ body: 'hello' }),
      })
    )
    expect(r.id).toBe(999)
    expect(r.updated_at).toBe('2026-05-24T00:00:00Z')
  })

  it('createReviewLineReply POSTs to /pulls/{n}/comments with in_reply_to', async () => {
    await prCommentClient.createReviewLineReply({
      repo: baseRepo,
      prNumber: 1,
      inReplyTo: 555,
      body: 'reply',
      token: 'tok',
    })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/foo/bar/pulls/1/comments')
    expect(JSON.parse(init.body)).toEqual({ body: 'reply', in_reply_to: 555 })
  })

  it('updateIssueComment PATCHes /issues/comments/{id}', async () => {
    await prCommentClient.updateIssueComment({
      repo: baseRepo,
      externalId: '999',
      body: 'edit',
      token: 'tok',
    })
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/foo/bar/issues/comments/999'
    )
    expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH')
  })

  it('updateReviewLineComment PATCHes /pulls/comments/{id}', async () => {
    await prCommentClient.updateReviewLineComment({
      repo: baseRepo,
      externalId: '999',
      body: 'edit',
      token: 'tok',
    })
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/foo/bar/pulls/comments/999'
    )
  })

  it('deleteIssueComment returns void on 204', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(
      prCommentClient.deleteIssueComment({
        repo: baseRepo,
        externalId: '999',
        token: 'tok',
      })
    ).resolves.toBeUndefined()
  })

  it('throws GithubApiError on non-2xx with status and body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    )
    await expect(
      prCommentClient.createIssueComment({
        repo: baseRepo,
        prNumber: 1,
        body: 'x',
        token: 'tok',
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('detects rate-limit error from 403 + X-RateLimit-Remaining=0', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'rate limit' }), {
        status: 403,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
        },
      })
    )
    await expect(
      prCommentClient.createIssueComment({
        repo: baseRepo,
        prNumber: 1,
        body: 'x',
        token: 'tok',
      })
    ).rejects.toMatchObject({ status: 403, rateLimitResetAt: expect.any(Date) })
  })

  it('listIssueCommentsSince GETs with since param for idempotency check', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ id: 1, body: 'a', user: { id: 1 } }]), {
        status: 200,
      })
    )
    const since = new Date('2026-05-23T00:00:00Z')
    await prCommentClient.listIssueCommentsSince({
      repo: baseRepo,
      prNumber: 1,
      since,
      token: 'tok',
    })
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/foo/bar/issues/1/comments?since=2026-05-23T00%3A00%3A00.000Z'
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/integrations/github/pr-comment-client.test.ts -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement client**

Create `lib/integrations/github/pr-comment-client.ts`:

```typescript
const GH_API = 'https://api.github.com'

interface Repo {
  owner: string
  name: string
}

export class GithubApiError extends Error {
  status: number
  body: unknown
  rateLimitResetAt?: Date

  constructor(status: number, body: unknown, rateLimitResetAt?: Date) {
    super(
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: unknown }).message)
        : `GitHub API error ${status}`
    )
    this.status = status
    this.body = body
    this.rateLimitResetAt = rateLimitResetAt
  }
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T | undefined> {
  const res = await fetch(url, init)
  if (res.status === 204) return undefined
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    let resetAt: Date | undefined
    if (
      res.status === 403 &&
      res.headers.get('X-RateLimit-Remaining') === '0'
    ) {
      const resetHeader = res.headers.get('X-RateLimit-Reset')
      if (resetHeader) resetAt = new Date(Number(resetHeader) * 1000)
    }
    throw new GithubApiError(res.status, body, resetAt)
  }
  return body as T
}

interface CommentResponse {
  id: number
  node_id: string
  html_url: string
  updated_at: string
  body: string
}

interface CreateIssueCommentInput {
  repo: Repo
  prNumber: number
  body: string
  token: string
}

interface CreateReviewLineReplyInput {
  repo: Repo
  prNumber: number
  inReplyTo: number
  body: string
  token: string
}

interface UpdateCommentInput {
  repo: Repo
  externalId: string
  body: string
  token: string
}

interface DeleteCommentInput {
  repo: Repo
  externalId: string
  token: string
}

interface ListIssueCommentsInput {
  repo: Repo
  prNumber: number
  since: Date
  token: string
}

export const prCommentClient = {
  async createIssueComment(input: CreateIssueCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/${input.prNumber}/comments`
    return call<CommentResponse>(url, {
      method: 'POST',
      headers: headers(input.token),
      body: JSON.stringify({ body: input.body }),
    }) as Promise<CommentResponse>
  },

  async createReviewLineReply(input: CreateReviewLineReplyInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/comments`
    return call<CommentResponse>(url, {
      method: 'POST',
      headers: headers(input.token),
      body: JSON.stringify({ body: input.body, in_reply_to: input.inReplyTo }),
    }) as Promise<CommentResponse>
  },

  async updateIssueComment(input: UpdateCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/comments/${input.externalId}`
    return call<CommentResponse>(url, {
      method: 'PATCH',
      headers: headers(input.token),
      body: JSON.stringify({ body: input.body }),
    }) as Promise<CommentResponse>
  },

  async updateReviewLineComment(input: UpdateCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/comments/${input.externalId}`
    return call<CommentResponse>(url, {
      method: 'PATCH',
      headers: headers(input.token),
      body: JSON.stringify({ body: input.body }),
    }) as Promise<CommentResponse>
  },

  async deleteIssueComment(input: DeleteCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/comments/${input.externalId}`
    await call<void>(url, { method: 'DELETE', headers: headers(input.token) })
  },

  async deleteReviewLineComment(input: DeleteCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/comments/${input.externalId}`
    await call<void>(url, { method: 'DELETE', headers: headers(input.token) })
  },

  async listIssueCommentsSince(input: ListIssueCommentsInput) {
    const sinceParam = encodeURIComponent(input.since.toISOString())
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/${input.prNumber}/comments?since=${sinceParam}`
    return call<Array<{ id: number; body: string; user: { id: number } }>>(
      url,
      { method: 'GET', headers: headers(input.token) }
    ) as Promise<Array<{ id: number; body: string; user: { id: number } }>>
  },

  async listReviewCommentsSince(input: ListIssueCommentsInput) {
    const sinceParam = encodeURIComponent(input.since.toISOString())
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/comments?since=${sinceParam}`
    return call<Array<{ id: number; body: string; user: { id: number } }>>(
      url,
      { method: 'GET', headers: headers(input.token) }
    ) as Promise<Array<{ id: number; body: string; user: { id: number } }>>
  },
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/integrations/github/pr-comment-client.test.ts -v`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/github/pr-comment-client.ts __tests__/integrations/github/pr-comment-client.test.ts
git commit -m "feat(github): pr-comment-client fetch wrapper (3 endpoints + rate-limit detection) [LUM-90]"
```

---

## Phase C — Mirror Service

### Task 8: pr-comment-mirror service skeleton + actor resolution

**Files:**

- Create: `lib/services/pr-comment-mirror.service.ts`
- Test: `__tests__/services/pr-comment-mirror/actor-resolution.test.ts`

**Scope of this task:** the service file with types, `resolveOutboundActor` (USER_OAUTH vs BOT_APP), and stub `runOutbound` / `runInbound` functions that throw "not implemented". Subsequent tasks fill them in.

- [ ] **Step 1: Write failing tests for actor resolution**

```typescript
// __tests__/services/pr-comment-mirror/actor-resolution.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: { findIntegrationByUserAndWorkspace: jest.fn() },
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn() }))
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('app-token'),
}))

// canWriteRepo uses fetch
const fetchMock = jest.fn()
beforeEach(() => {
  global.fetch = fetchMock
  jest.clearAllMocks()
})

describe('resolveOutboundActor', () => {
  it('returns USER_OAUTH when user has integration with push perm', async () => {
    ;(
      githubRepository.findIntegrationByUserAndWorkspace as jest.Mock
    ).mockResolvedValue({ accessToken: 'enc', githubLogin: 'foo' })
    ;(decrypt as jest.Mock).mockReturnValue('user-token')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ permissions: { push: true } }), {
        status: 200,
      })
    )

    const r = await prCommentMirrorService.resolveOutboundActor({
      workspaceId: 'w1',
      authorUserId: 'm1',
      repo: { owner: 'o', name: 'r' },
    })
    expect(r.actor).toBe('USER_OAUTH')
    expect(r.token).toBe('user-token')
    expect(r.userId).toBe('m1')
  })

  it('falls back to BOT_APP when user lacks push perm', async () => {
    ;(
      githubRepository.findIntegrationByUserAndWorkspace as jest.Mock
    ).mockResolvedValue({ accessToken: 'enc', githubLogin: 'foo' })
    ;(decrypt as jest.Mock).mockReturnValue('user-token')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ permissions: { push: false } }), {
        status: 200,
      })
    )

    const r = await prCommentMirrorService.resolveOutboundActor({
      workspaceId: 'w1',
      authorUserId: 'm1',
      repo: { owner: 'o', name: 'r' },
    })
    expect(r.actor).toBe('BOT_APP')
    expect(r.token).toBe('app-token')
  })

  it('falls back to BOT_APP when no integration', async () => {
    ;(
      githubRepository.findIntegrationByUserAndWorkspace as jest.Mock
    ).mockResolvedValue(null)
    const r = await prCommentMirrorService.resolveOutboundActor({
      workspaceId: 'w1',
      authorUserId: 'm1',
      repo: { owner: 'o', name: 'r' },
    })
    expect(r.actor).toBe('BOT_APP')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/services/pr-comment-mirror/ -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Add the missing repo method**

In `lib/repositories/github.repository.ts`, add:

```typescript
async findIntegrationByUserAndWorkspace(workspaceId: string, memberId: string) {
  return prisma.gitHubIntegration.findUnique({
    where: { workspaceId_memberId: { workspaceId, memberId } },
  })
}
```

- [ ] **Step 4: Implement the service skeleton**

Create `lib/services/pr-comment-mirror.service.ts`:

```typescript
import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import type { OutboundActorKind } from '@prisma/client'

interface Repo {
  owner: string
  name: string
}

interface OutboundActorResult {
  actor: OutboundActorKind
  token: string
  userId: string | null
}

const CACHE_TTL_MS = 10 * 60 * 1000
const writeCache = new Map<string, { until: number; canWrite: boolean }>()

async function canWriteRepo(token: string, repo: Repo): Promise<boolean> {
  const key = `${token.slice(0, 8)}:${repo.owner}/${repo.name}`
  const cached = writeCache.get(key)
  if (cached && cached.until > Date.now()) return cached.canWrite
  const res = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.name}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    }
  )
  if (!res.ok) {
    writeCache.set(key, { until: Date.now() + CACHE_TTL_MS, canWrite: false })
    return false
  }
  const body = (await res.json()) as { permissions?: { push?: boolean } }
  const canWrite = body.permissions?.push === true
  writeCache.set(key, { until: Date.now() + CACHE_TTL_MS, canWrite })
  return canWrite
}

interface ResolveActorInput {
  workspaceId: string
  authorUserId: string
  repo: Repo
}

export const prCommentMirrorService = {
  async resolveOutboundActor(
    input: ResolveActorInput
  ): Promise<OutboundActorResult> {
    const integration =
      await githubRepository.findIntegrationByUserAndWorkspace(
        input.workspaceId,
        input.authorUserId
      )
    if (integration) {
      const token = decrypt(integration.accessToken)
      if (await canWriteRepo(token, input.repo)) {
        return { actor: 'USER_OAUTH', token, userId: input.authorUserId }
      }
    }
    // getGithubInstallationToken() takes no args (single Lumo App installation; see lib/integrations/github/auth.ts:7)
    const appToken = await getGithubInstallationToken()
    return { actor: 'BOT_APP', token: appToken, userId: null }
  },

  async runOutbound(_commentId: string, _op: 'CREATE' | 'UPDATE' | 'DELETE') {
    throw new Error('not implemented — Task 9-11')
  },

  async runInbound(_payload: unknown) {
    throw new Error('not implemented — Task 12-15')
  },

  async scheduleOutbound(
    _commentId: string,
    _op: 'CREATE' | 'UPDATE' | 'DELETE',
    _opts: { mirrorOrigin?: 'inbound' | 'user' } = {}
  ) {
    throw new Error('not implemented — Task 16')
  },
}
```

- [ ] **Step 5: Run tests to pass**

Run: `npx jest __tests__/services/pr-comment-mirror/ -v`
Expected: PASS (3 actor-resolution cases).

- [ ] **Step 6: Commit**

```bash
git add lib/services/pr-comment-mirror.service.ts lib/repositories/github.repository.ts __tests__/services/pr-comment-mirror/actor-resolution.test.ts
git commit -m "feat(pr-mirror): service skeleton + outbound actor resolution with write-check cache [LUM-90]"
```

---

### Task 9: runOutbound CREATE

**Files:**

- Modify: `lib/services/pr-comment-mirror.service.ts`
- Test: `__tests__/services/pr-comment-mirror/run-outbound-create.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/services/pr-comment-mirror/run-outbound-create.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/integrations/github/pr-comment-client')
jest.mock('@/lib/services/pr-comment-mirror.service', () => {
  const actual = jest.requireActual('@/lib/services/pr-comment-mirror.service')
  return {
    ...actual,
    prCommentMirrorService: {
      ...actual.prCommentMirrorService,
      resolveOutboundActor: jest.fn(),
    },
  }
})

const baseComment = {
  id: 'c1',
  taskId: 't1',
  authorActorId: 'a1',
  body: '<p>hello</p>',
  parentId: null,
  type: 'USER',
  deletedAt: null,
}
const basePr = {
  id: 'pr1',
  taskId: 't1',
  repo: 'foo/bar',
  number: 42,
  workspaceId: 'w1',
}

describe('runOutbound CREATE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(commentRepository.findById as jest.Mock).mockResolvedValue(baseComment)
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(basePr)
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    ;(
      prCommentMirrorService.resolveOutboundActor as jest.Mock
    ).mockResolvedValue({
      actor: 'BOT_APP',
      token: 'tok',
      userId: null,
    })
    ;(prCommentClient.createIssueComment as jest.Mock).mockResolvedValue({
      id: 999,
      node_id: 'IC_x',
      html_url: 'https://github.com/foo/bar/pull/42#issuecomment-999',
      updated_at: '2026-05-24T00:00:00Z',
      body: 'hello',
    })
    ;(prCommentMirrorRepository.reserve as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalId: 'pending-xxx',
    })
  })

  it('reserves a mirror row before calling GitHub', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentMirrorRepository.reserve).toHaveBeenCalledBefore(
      prCommentClient.createIssueComment as jest.Mock
    )
  })

  it('POSTs an issue_comment for a top-level comment', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).toHaveBeenCalledWith({
      repo: { owner: 'foo', name: 'bar' },
      prNumber: 42,
      body: expect.stringContaining('hello'),
      token: 'tok',
    })
  })

  it('patches mirror with real externalId after POST returns', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentMirrorRepository.resolvePlaceholder).toHaveBeenCalledWith(
      'm1',
      {
        externalId: '999',
        externalNodeId: 'IC_x',
        externalUrl: 'https://github.com/foo/bar/pull/42#issuecomment-999',
        externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
      }
    )
  })

  it('no-ops when task has no linked PR', async () => {
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(null)
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).not.toHaveBeenCalled()
  })

  it('no-ops for AGENT comment', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      ...baseComment,
      type: 'AGENT',
    })
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createIssueComment).not.toHaveBeenCalled()
  })

  it('prefixes body with author attribution when actor is BOT_APP', async () => {
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    const body = (prCommentClient.createIssueComment as jest.Mock).mock
      .calls[0][0].body
    expect(body).toMatch(/在 Lumo 说/)
  })

  it('does not prefix when actor is USER_OAUTH', async () => {
    ;(
      prCommentMirrorService.resolveOutboundActor as jest.Mock
    ).mockResolvedValue({
      actor: 'USER_OAUTH',
      token: 'tok',
      userId: 'm1',
    })
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    const body = (prCommentClient.createIssueComment as jest.Mock).mock
      .calls[0][0].body
    expect(body).not.toMatch(/在 Lumo 说/)
  })

  it('posts as review-line reply when parent is a mirrored REVIEW_LINE', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      ...baseComment,
      parentId: 'parent1',
    })
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        externalSource: 'REVIEW_LINE',
        externalId: '555',
      }
    )
    ;(prCommentClient.createReviewLineReply as jest.Mock).mockResolvedValue({
      id: 1000,
      node_id: 'PRRC_x',
      html_url: 'https://github.com/foo/bar/pull/42#discussion_r1000',
      updated_at: '2026-05-24T00:00:00Z',
      body: 'hello',
    })
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentClient.createReviewLineReply).toHaveBeenCalledWith(
      expect.objectContaining({ inReplyTo: 555 })
    )
  })
})
```

- [ ] **Step 2: Add pull-request repo method**

In `lib/repositories/pull-request.repository.ts`, add:

```typescript
async findByTaskId(taskId: string) {
  return prisma.pullRequest.findFirst({
    where: { taskId },
    orderBy: { updatedAt: 'desc' },
  })
}
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest __tests__/services/pr-comment-mirror/run-outbound-create.test.ts -v`
Expected: FAIL.

- [ ] **Step 4: Implement runOutbound CREATE**

In `lib/services/pr-comment-mirror.service.ts`, replace the `runOutbound` stub with:

```typescript
import { commentRepository } from '@/lib/repositories/comment.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  lumoHtmlToGithubMarkdown,
  computeBodyHash,
} from '@/lib/integrations/github/markdown-bridge'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'

function parseRepo(repo: string): Repo {
  const [owner, name] = repo.split('/')
  return { owner, name }
}

async function buildOutboundBody(
  comment: { body: string; authorActorId: string | null },
  actor: OutboundActorKind,
  workspaceId: string,
  commentUrl: string
): Promise<{ body: string; bodyHash: string }> {
  const rendered = lumoHtmlToGithubMarkdown(comment.body, _clerkId => {
    // resolver: clerkId → github login (best-effort; null for unknowns)
    return null // wired through in Task 13's broader integration; OK to leave null here
  })

  if (actor === 'USER_OAUTH') {
    return { body: rendered, bodyHash: computeBodyHash(rendered) }
  }

  // BOT_APP: prefix with author attribution
  const authorName = comment.authorActorId
    ? await resolveAuthorDisplayName(comment.authorActorId)
    : 'Someone'
  const prefixed = `**[${authorName}](${commentUrl}) 在 Lumo 说：**\n\n${rendered}`
  return { body: prefixed, bodyHash: computeBodyHash(prefixed) }
}

/**
 * Resolve actor id → display name for the bot-prefix template.
 * Strategy:
 *   1. memberRepository.findByActorId(actorId) gives us { id, workspaceId } — does NOT include displayName
 *      (real signature: lib/repositories/member.repository.ts:82)
 *   2. Lookup WorkspaceMember row directly to get clerkId
 *   3. Fetch Clerk user → firstName + lastName or email-localpart, mirroring the pattern in
 *      member.repository.ts:245-275 (single-user version)
 *   4. Any failure → 'Someone' (degraded but safe)
 */
async function resolveAuthorDisplayName(actorId: string): Promise<string> {
  try {
    const member = await memberRepository.findByActorId(actorId)
    if (!member) return 'Someone'
    const row = await prisma.workspaceMember.findUnique({
      where: { id: member.id },
      select: { clerkId: true },
    })
    if (!row?.clerkId) return 'Someone'
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const user = await client.users.getUser(row.clerkId)
    const fullName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim()
    if (fullName) return fullName
    const email = user.emailAddresses[0]?.emailAddress
    return email ? email.split('@')[0] : 'Someone'
  } catch {
    return 'Someone'
  }
}

async function runOutboundCreate(commentId: string) {
  const comment = await commentRepository.findById(commentId)
  if (!comment) return
  if (comment.type === 'AGENT') return

  const pr = await pullRequestRepository.findByTaskId(comment.taskId)
  if (!pr) return

  const repo = parseRepo(pr.repo)

  // Determine if this is a review-line reply
  let parentMirror = null
  if (comment.parentId) {
    parentMirror = await prCommentMirrorRepository.findByCommentId(
      comment.parentId
    )
  }
  const isReviewLineReply = parentMirror?.externalSource === 'REVIEW_LINE'

  // Resolve outbound actor identity. findByActorId returns { id, workspaceId } — no extra args.
  const memberForActor = comment.authorActorId
    ? await memberRepository.findByActorId(comment.authorActorId)
    : null
  const actorResult = memberForActor
    ? await prCommentMirrorService.resolveOutboundActor({
        workspaceId: pr.workspaceId,
        authorUserId: memberForActor.id,
        repo,
      })
    : { actor: 'BOT_APP' as const, token: '', userId: null }

  if (actorResult.actor === 'BOT_APP' && !actorResult.token) {
    // No member to attribute (e.g. agent-authored that slipped through, or actor not a member)
    return
  }

  const commentUrl = '' // best-effort; can be enriched later with workspace slug + task number
  const { body, bodyHash } = await buildOutboundBody(
    comment,
    actorResult.actor,
    pr.workspaceId,
    commentUrl
  )

  // Reserve mirror BEFORE the GitHub call
  const mirror = await prCommentMirrorRepository.reserve({
    commentId,
    pullRequestId: pr.id,
    externalSource: isReviewLineReply ? 'REVIEW_LINE' : 'ISSUE',
    outboundActor: actorResult.actor,
    outboundActorUserId: actorResult.userId,
    bodyHash,
    inReplyToExternalId: isReviewLineReply ? parentMirror!.externalId : null,
  })

  try {
    const response = isReviewLineReply
      ? await prCommentClient.createReviewLineReply({
          repo,
          prNumber: pr.number,
          inReplyTo: Number(parentMirror!.externalId),
          body,
          token: actorResult.token,
        })
      : await prCommentClient.createIssueComment({
          repo,
          prNumber: pr.number,
          body,
          token: actorResult.token,
        })

    await prCommentMirrorRepository.resolvePlaceholder(mirror.id, {
      externalId: String(response.id),
      externalNodeId: response.node_id,
      externalUrl: response.html_url,
      externalUpdatedAt: new Date(response.updated_at),
    })
  } catch (err) {
    await prCommentSyncJobRepository.enqueue({
      direction: 'OUTBOUND',
      payload: { op: 'CREATE', mirrorId: mirror.id },
      commentId,
      workspaceId: pr.workspaceId,
      scheduledFor:
        err instanceof GithubApiError && err.rateLimitResetAt
          ? err.rateLimitResetAt
          : undefined,
    })
    throw err
  }
}
```

Then replace the `runOutbound` method to dispatch by op:

```typescript
async runOutbound(commentId: string, op: 'CREATE' | 'UPDATE' | 'DELETE') {
  if (op === 'CREATE') return runOutboundCreate(commentId)
  throw new Error(`runOutbound op=${op} not yet implemented`)
},
```

- [ ] **Step 5: Verify `memberRepository.findByActorId` already exists**

The method exists at `lib/repositories/member.repository.ts:82` with signature `findByActorId(actorId: string) → { id, workspaceId } | null`. Do NOT add it — use the existing signature.

If you find that the existing return shape doesn't include something your code needs, **do not change the existing method** (other callers depend on it). Either fetch the missing pieces with a separate query (e.g. `prisma.workspaceMember.findUnique({ where: { id }, select: { clerkId: true } })` as `resolveAuthorDisplayName` does in Step 4 above), or add a new method beside the existing one. Display names are NOT a field on `WorkspaceMember`; they come from Clerk (pattern: `lib/repositories/member.repository.ts:245-275`).

- [ ] **Step 6: Install `jest-extended` for toHaveBeenCalledBefore (if missing)**

Check whether `jest-extended` is in package.json (`grep jest-extended package.json`).
If yes, skip. If not, replace the `toHaveBeenCalledBefore` assertion with a manual `expect((reserve.mock.invocationCallOrder[0]) < (createIssueComment.mock.invocationCallOrder[0]))`.

- [ ] **Step 7: Run tests until pass**

Run: `npx jest __tests__/services/pr-comment-mirror/run-outbound-create.test.ts -v`
Expected: PASS (8 cases).

- [ ] **Step 8: Commit**

```bash
git add lib/services/pr-comment-mirror.service.ts lib/repositories/pull-request.repository.ts lib/repositories/member.repository.ts __tests__/services/pr-comment-mirror/run-outbound-create.test.ts
git commit -m "feat(pr-mirror): runOutbound CREATE with actor attribution + mirror reservation [LUM-90]"
```

---

### Task 10: runOutbound UPDATE

**Files:**

- Modify: `lib/services/pr-comment-mirror.service.ts`
- Test: `__tests__/services/pr-comment-mirror/run-outbound-update.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/services/pr-comment-mirror/run-outbound-update.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/integrations/github/pr-comment-client')

describe('runOutbound UPDATE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      body: '<p>edited</p>',
      type: 'USER',
      authorActorId: 'a1',
    })
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm1',
        externalSource: 'ISSUE',
        externalId: '999',
        outboundActor: 'BOT_APP',
      }
    )
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue({
      id: 'pr1',
      repo: 'foo/bar',
      number: 42,
      workspaceId: 'w1',
    })
    ;(prCommentClient.updateIssueComment as jest.Mock).mockResolvedValue({
      id: 999,
      node_id: 'IC_x',
      html_url: 'https://...',
      updated_at: '2026-05-24T01:00:00Z',
      body: 'edited',
    })
  })

  it('PATCHes the issue comment via prCommentClient.updateIssueComment', async () => {
    await prCommentMirrorService.runOutbound('c1', 'UPDATE')
    expect(prCommentClient.updateIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '999' })
    )
  })

  it('PATCHes review-line endpoint when source is REVIEW_LINE', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm1',
        externalSource: 'REVIEW_LINE',
        externalId: '999',
        outboundActor: 'BOT_APP',
      }
    )
    ;(prCommentClient.updateReviewLineComment as jest.Mock).mockResolvedValue({
      id: 999,
      node_id: 'PRRC_x',
      html_url: 'https://...',
      updated_at: '2026-05-24T01:00:00Z',
      body: 'edited',
    })
    await prCommentMirrorService.runOutbound('c1', 'UPDATE')
    expect(prCommentClient.updateReviewLineComment).toHaveBeenCalled()
  })

  it('patches mirror.externalUpdatedAt + bodyHash after success', async () => {
    await prCommentMirrorService.runOutbound('c1', 'UPDATE')
    expect(prCommentMirrorRepository.patchAfterEdit).toHaveBeenCalledWith(
      'm1',
      new Date('2026-05-24T01:00:00Z'),
      expect.any(String)
    )
  })

  it('no-ops if no mirror row exists (nothing to update)', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    await prCommentMirrorService.runOutbound('c1', 'UPDATE')
    expect(prCommentClient.updateIssueComment).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/services/pr-comment-mirror/run-outbound-update.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Implement runOutbound UPDATE**

In `lib/services/pr-comment-mirror.service.ts`, add a private function and route it:

```typescript
async function runOutboundUpdate(commentId: string) {
  const comment = await commentRepository.findById(commentId)
  if (!comment) return
  const mirror = await prCommentMirrorRepository.findByCommentId(commentId)
  if (!mirror) return // never mirrored — nothing to push

  const pr = await pullRequestRepository.findByTaskId(comment.taskId)
  if (!pr) return
  const repo = parseRepo(pr.repo)

  // Recompute body using the same prefix rules as CREATE (outbound actor read from mirror)
  const memberForActor = comment.authorActorId
    ? await memberRepository.findByActorId(comment.authorActorId)
    : null
  const actorResult = memberForActor
    ? await prCommentMirrorService.resolveOutboundActor({
        workspaceId: pr.workspaceId,
        authorUserId: memberForActor.id,
        repo,
      })
    : { actor: 'BOT_APP' as const, token: '', userId: null }
  if (actorResult.actor === 'BOT_APP' && !actorResult.token) return

  const { body, bodyHash } = await buildOutboundBody(
    comment,
    actorResult.actor,
    pr.workspaceId,
    ''
  )

  try {
    const response =
      mirror.externalSource === 'REVIEW_LINE'
        ? await prCommentClient.updateReviewLineComment({
            repo,
            externalId: mirror.externalId,
            body,
            token: actorResult.token,
          })
        : await prCommentClient.updateIssueComment({
            repo,
            externalId: mirror.externalId,
            body,
            token: actorResult.token,
          })
    await prCommentMirrorRepository.patchAfterEdit(
      mirror.id,
      new Date(response.updated_at),
      bodyHash
    )
  } catch (err) {
    await prCommentSyncJobRepository.enqueue({
      direction: 'OUTBOUND',
      payload: { op: 'UPDATE', mirrorId: mirror.id },
      commentId,
      workspaceId: pr.workspaceId,
      scheduledFor:
        err instanceof GithubApiError && err.rateLimitResetAt
          ? err.rateLimitResetAt
          : undefined,
    })
    throw err
  }
}
```

Then update the dispatch:

```typescript
async runOutbound(commentId: string, op: 'CREATE' | 'UPDATE' | 'DELETE') {
  if (op === 'CREATE') return runOutboundCreate(commentId)
  if (op === 'UPDATE') return runOutboundUpdate(commentId)
  throw new Error('DELETE not yet implemented')
},
```

- [ ] **Step 4: Run tests until pass**

Run: `npx jest __tests__/services/pr-comment-mirror/run-outbound-update.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pr-comment-mirror.service.ts __tests__/services/pr-comment-mirror/run-outbound-update.test.ts
git commit -m "feat(pr-mirror): runOutbound UPDATE [LUM-90]"
```

---

### Task 11: runOutbound DELETE

**Files:**

- Modify: `lib/services/pr-comment-mirror.service.ts`
- Test: `__tests__/services/pr-comment-mirror/run-outbound-delete.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/services/pr-comment-mirror/run-outbound-delete.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { commentRepository } from '@/lib/repositories/comment.repository'

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/integrations/github/pr-comment-client')

describe('runOutbound DELETE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      type: 'USER',
    })
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm1',
        externalSource: 'ISSUE',
        externalId: '999',
        outboundActor: 'BOT_APP',
      }
    )
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue({
      id: 'pr1',
      repo: 'foo/bar',
      number: 42,
      workspaceId: 'w1',
    })
  })

  it('calls deleteIssueComment for ISSUE source', async () => {
    await prCommentMirrorService.runOutbound('c1', 'DELETE')
    expect(prCommentClient.deleteIssueComment).toHaveBeenCalled()
  })

  it('calls deleteReviewLineComment for REVIEW_LINE source', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      {
        id: 'm1',
        externalSource: 'REVIEW_LINE',
        externalId: '999',
        outboundActor: 'BOT_APP',
      }
    )
    await prCommentMirrorService.runOutbound('c1', 'DELETE')
    expect(prCommentClient.deleteReviewLineComment).toHaveBeenCalled()
  })

  it('marks mirror deletedAt after success', async () => {
    await prCommentMirrorService.runOutbound('c1', 'DELETE')
    expect(prCommentMirrorRepository.markDeleted).toHaveBeenCalledWith('m1')
  })

  it('no-ops when no mirror row', async () => {
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    await prCommentMirrorService.runOutbound('c1', 'DELETE')
    expect(prCommentClient.deleteIssueComment).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/services/pr-comment-mirror/run-outbound-delete.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Implement runOutbound DELETE**

In `lib/services/pr-comment-mirror.service.ts`:

```typescript
async function runOutboundDelete(commentId: string) {
  const mirror = await prCommentMirrorRepository.findByCommentId(commentId)
  if (!mirror) return
  const comment = await commentRepository.findById(commentId)
  if (!comment) return
  const pr = await pullRequestRepository.findByTaskId(comment.taskId)
  if (!pr) return
  const repo = parseRepo(pr.repo)

  // For DELETE we need to call as a token authorised to delete: prefer the same
  // outbound actor that wrote the comment originally. Fall back to BOT_APP.
  let token: string
  if (mirror.outboundActor === 'USER_OAUTH' && mirror.outboundActorUserId) {
    const member = comment.authorActorId
      ? await memberRepository.findByActorId(comment.authorActorId)
      : null
    const actor = member
      ? await prCommentMirrorService.resolveOutboundActor({
          workspaceId: pr.workspaceId,
          authorUserId: member.id,
          repo,
        })
      : null
    // getGithubInstallationToken() takes no args (lib/integrations/github/auth.ts:7)
    token = actor?.token ?? (await getGithubInstallationToken())
  } else {
    token = await getGithubInstallationToken()
  }

  try {
    if (mirror.externalSource === 'REVIEW_LINE') {
      await prCommentClient.deleteReviewLineComment({
        repo,
        externalId: mirror.externalId,
        token,
      })
    } else {
      await prCommentClient.deleteIssueComment({
        repo,
        externalId: mirror.externalId,
        token,
      })
    }
    await prCommentMirrorRepository.markDeleted(mirror.id)
  } catch (err) {
    await prCommentSyncJobRepository.enqueue({
      direction: 'OUTBOUND',
      payload: { op: 'DELETE', mirrorId: mirror.id },
      commentId,
      workspaceId: pr.workspaceId,
      scheduledFor:
        err instanceof GithubApiError && err.rateLimitResetAt
          ? err.rateLimitResetAt
          : undefined,
    })
    throw err
  }
}
```

Update the dispatch:

```typescript
async runOutbound(commentId: string, op: 'CREATE' | 'UPDATE' | 'DELETE') {
  if (op === 'CREATE') return runOutboundCreate(commentId)
  if (op === 'UPDATE') return runOutboundUpdate(commentId)
  if (op === 'DELETE') return runOutboundDelete(commentId)
},
```

- [ ] **Step 4: Run tests until pass**

Run: `npx jest __tests__/services/pr-comment-mirror/run-outbound-delete.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pr-comment-mirror.service.ts __tests__/services/pr-comment-mirror/run-outbound-delete.test.ts
git commit -m "feat(pr-mirror): runOutbound DELETE with mirror tombstone [LUM-90]"
```

---

### Task 12: runInbound dispatch — echo check, source parse, author resolution, parent resolution

**Files:**

- Modify: `lib/services/pr-comment-mirror.service.ts`
- Test: `__tests__/services/pr-comment-mirror/run-inbound-dispatch.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/services/pr-comment-mirror/run-inbound-dispatch.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { githubActorService } from '@/lib/services/github-actor.service'
import { githubRepository } from '@/lib/repositories/github.repository'

jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/services/github-actor.service')
jest.mock('@/lib/repositories/github.repository')

const baseEnv = {
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
}

const issuePayload = {
  event: 'issue_comment' as const,
  action: 'created' as const,
  ...baseEnv,
  raw: {
    comment: {
      id: 999,
      node_id: 'IC_x',
      html_url: 'https://github.com/foo/bar/pull/1#issuecomment-999',
      body: 'hello',
      updated_at: '2026-05-24T00:00:00Z',
      user: {
        id: 12345,
        login: 'foo',
        type: 'User',
        avatar_url: 'https://...',
      },
    },
    repository: { full_name: 'foo/bar' },
  },
}

describe('runInbound dispatch', () => {
  beforeEach(() => jest.clearAllMocks())

  it('drops echo when matching mirror has externalUpdatedAt >= payload.updated_at', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
    })
    await prCommentMirrorService.runInbound(issuePayload)
    expect(githubActorService.upsertPseudoActor).not.toHaveBeenCalled()
  })

  it('falls back to placeholder lookup when no exact mirror match', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
    ;(
      prCommentMirrorRepository.findRecentPlaceholder as jest.Mock
    ).mockResolvedValue({
      id: 'm-placeholder',
      externalId: 'pending-xxx',
    })
    await prCommentMirrorService.runInbound(issuePayload)
    expect(prCommentMirrorRepository.resolvePlaceholder).toHaveBeenCalledWith(
      'm-placeholder',
      expect.objectContaining({ externalId: '999' })
    )
  })

  it('resolves author to mapped Lumo member when GitHub login matches integration', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
    ;(
      prCommentMirrorRepository.findRecentPlaceholder as jest.Mock
    ).mockResolvedValue(null)
    ;(githubRepository.findIntegrationByLogin as jest.Mock).mockResolvedValue({
      member: { actor: { id: 'mapped-actor' } },
    })

    // Spy on internal write path - we test concrete behavior in Task 13
    // Here we assert the author resolution returns the mapped actor id
    const r = await prCommentMirrorService.resolveInboundAuthor(
      'w1',
      issuePayload.raw.comment.user
    )
    expect(r?.actorId).toBe('mapped-actor')
  })

  it('creates GITHUB_USER pseudo actor when no integration matches', async () => {
    ;(githubRepository.findIntegrationByLogin as jest.Mock).mockResolvedValue(
      null
    )
    ;(githubActorService.upsertPseudoActor as jest.Mock).mockResolvedValue({
      id: 'pseudo-actor',
    })
    const r = await prCommentMirrorService.resolveInboundAuthor(
      'w1',
      issuePayload.raw.comment.user
    )
    expect(r?.actorId).toBe('pseudo-actor')
    expect(githubActorService.upsertPseudoActor).toHaveBeenCalled()
  })

  it('skips when GitHub user is the configured BOT login', async () => {
    const r = await prCommentMirrorService.resolveInboundAuthor('w1', {
      id: 1,
      login: 'lumo-app[bot]',
      type: 'Bot',
      avatar_url: '',
    })
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/services/pr-comment-mirror/run-inbound-dispatch.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Implement dispatch + author resolution**

In `lib/services/pr-comment-mirror.service.ts` add:

```typescript
import { githubActorService } from '@/lib/services/github-actor.service'

const BOT_LOGIN = process.env.LUMO_GITHUB_BOT_LOGIN ?? 'lumo-app[bot]'

interface InboundPayload {
  event: 'issue_comment' | 'pull_request_review' | 'pull_request_review_comment'
  action: 'created' | 'edited' | 'deleted' | 'submitted' | 'dismissed'
  workspaceId: string
  taskId: string
  pullRequestId: string
  raw: any
}

interface InboundCommentNode {
  id: number
  node_id: string
  html_url: string
  body: string | null
  updated_at: string
  user: { id: number; login: string; type: string; avatar_url: string }
  in_reply_to_id?: number
  path?: string
  line?: number
  start_line?: number | null
  side?: 'LEFT' | 'RIGHT'
}

function extractCommentNode(payload: InboundPayload): InboundCommentNode {
  if (payload.event === 'pull_request_review') {
    const review = payload.raw.review as InboundCommentNode & { state?: string }
    return review
  }
  return payload.raw.comment as InboundCommentNode
}

function payloadSource(payload: InboundPayload): PrCommentSource {
  if (payload.event === 'issue_comment') return 'ISSUE'
  if (payload.event === 'pull_request_review') return 'REVIEW'
  return 'REVIEW_LINE'
}

export const prCommentMirrorService = {
  // ... existing methods ...

  async resolveInboundAuthor(
    workspaceId: string,
    ghUser: { id: number; login: string; type: string; avatar_url: string }
  ): Promise<{ actorId: string } | null> {
    if (ghUser.type === 'Bot' && ghUser.login === BOT_LOGIN) return null
    const integration = await githubRepository.findIntegrationByLogin(
      workspaceId,
      ghUser.login
    )
    if (integration?.member?.actor?.id) {
      return { actorId: integration.member.actor.id }
    }
    const actor = await githubActorService.upsertPseudoActor(workspaceId, {
      id: ghUser.id,
      login: ghUser.login,
      avatar_url: ghUser.avatar_url,
    })
    return { actorId: actor.id }
  },

  async runInbound(payload: InboundPayload) {
    const node = extractCommentNode(payload)
    const source = payloadSource(payload)

    // Echo / dedupe via exact externalId match
    const existing = await prCommentMirrorRepository.findByExternal(
      source,
      String(node.id)
    )
    if (existing) {
      const tIncoming = new Date(node.updated_at)
      if (existing.externalUpdatedAt >= tIncoming) return // echo

      // UPDATE path — handled in Task 14
      return runInboundUpdate(payload, existing, node)
    }

    // Race-patch: did we just POST this comment and the webhook beat the response?
    if (payload.action === 'created') {
      const placeholder = await prCommentMirrorRepository.findRecentPlaceholder(
        payload.pullRequestId,
        computeBodyHash(node.body ?? ''),
        60
      )
      if (placeholder) {
        await prCommentMirrorRepository.resolvePlaceholder(placeholder.id, {
          externalId: String(node.id),
          externalNodeId: node.node_id,
          externalUrl: node.html_url,
          externalUpdatedAt: new Date(node.updated_at),
        })
        return
      }
    }

    if (payload.action === 'deleted') return // unknown comment, ignore delete
    if (
      payload.action === 'created' ||
      payload.action === 'submitted' ||
      payload.action === 'edited' // edit on something we don't know — treat as create
    ) {
      return runInboundCreate(payload, node, source)
    }
  },
}
```

(`runInboundCreate` and `runInboundUpdate` are stubbed for now — Task 13 / 14.)

- [ ] **Step 4: Add stubs**

```typescript
async function runInboundCreate(
  _payload: InboundPayload,
  _node: InboundCommentNode,
  _source: PrCommentSource
) {
  throw new Error('runInboundCreate not yet implemented — Task 13')
}

async function runInboundUpdate(
  _payload: InboundPayload,
  _existing: { id: string; externalUpdatedAt: Date; commentId: string },
  _node: InboundCommentNode
) {
  throw new Error('runInboundUpdate not yet implemented — Task 14')
}
```

- [ ] **Step 5: Run tests until pass**

Run: `npx jest __tests__/services/pr-comment-mirror/run-inbound-dispatch.test.ts -v`
Expected: PASS (5 cases).

- [ ] **Step 6: Commit**

```bash
git add lib/services/pr-comment-mirror.service.ts __tests__/services/pr-comment-mirror/run-inbound-dispatch.test.ts
git commit -m "feat(pr-mirror): runInbound dispatch with echo + placeholder + author resolution [LUM-90]"
```

---

### Task 13: runInbound CREATE

**Files:**

- Modify: `lib/services/pr-comment-mirror.service.ts`
- Test: `__tests__/services/pr-comment-mirror/run-inbound-create.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/services/pr-comment-mirror/run-inbound-create.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn(async cb => cb({})) },
}))

describe('runInbound CREATE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
    ;(
      prCommentMirrorRepository.findRecentPlaceholder as jest.Mock
    ).mockResolvedValue(null)
    jest
      .spyOn(prCommentMirrorService, 'resolveInboundAuthor')
      .mockResolvedValue({ actorId: 'mapped-actor' })
    ;(commentRepository.create as jest.Mock).mockResolvedValue({ id: 'c-new' })
  })

  it('creates a Comment + PrCommentMirror in a transaction for an ISSUE event', async () => {
    await prCommentMirrorService.runInbound({
      event: 'issue_comment',
      action: 'created',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 999,
          node_id: 'IC_x',
          html_url: 'https://...',
          body: 'hello',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        authorActorId: 'mapped-actor',
        body: expect.stringContaining('hello'),
        parentId: null,
      })
    )
    expect(prCommentMirrorRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: 'c-new',
        pullRequestId: 'pr1',
        externalSource: 'ISSUE',
        externalId: '999',
      }),
      expect.anything()
    )
  })

  it('renders REVIEW_LINE header with file path + line linking out to comment URL', async () => {
    await prCommentMirrorService.runInbound({
      event: 'pull_request_review_comment',
      action: 'created',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 1000,
          node_id: 'PRRC_x',
          html_url: 'https://github.com/foo/bar/pull/1#discussion_r1000',
          body: 'nit: rename',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
          path: 'src/foo.ts',
          line: 42,
          start_line: null,
          side: 'RIGHT',
        },
      },
    })
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('src/foo.ts:42'),
      })
    )
  })

  it('renders REVIEW header with state icon for Approved/Changes/Commented', async () => {
    await prCommentMirrorService.runInbound({
      event: 'pull_request_review',
      action: 'submitted',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        review: {
          id: 700,
          node_id: 'PRR_x',
          html_url: 'https://...',
          body: 'looks good',
          submitted_at: '2026-05-24T00:00:00Z',
          updated_at: '2026-05-24T00:00:00Z',
          state: 'approved',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Approved'),
      })
    )
  })

  it('resolves parent via in_reply_to_id when present', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockImplementation(
      async (source, externalId) =>
        externalId === '555' ? { commentId: 'parent-comment' } : null
    )
    await prCommentMirrorService.runInbound({
      event: 'pull_request_review_comment',
      action: 'created',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 1001,
          node_id: 'PRRC_y',
          html_url: 'https://...',
          body: 'reply',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
          path: 'src/foo.ts',
          line: 42,
          in_reply_to_id: 555,
        },
      },
    })
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'parent-comment' })
    )
  })

  it('schedules a delayed retry job when parent mirror is missing', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockImplementation(
      async (source, externalId) => (externalId === '555' ? null : null) // parent missing
    )
    const { prCommentSyncJobRepository } =
      await import('@/lib/repositories/pr-comment-sync-job.repository')
    jest
      .spyOn(prCommentSyncJobRepository, 'enqueue')
      .mockResolvedValue({} as any)
    await prCommentMirrorService.runInbound({
      event: 'pull_request_review_comment',
      action: 'created',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 1001,
          node_id: 'PRRC_y',
          html_url: 'https://...',
          body: 'reply',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
          path: 'src/foo.ts',
          line: 42,
          in_reply_to_id: 555,
        },
      },
    })
    // Top-level created + delayed retry queued
    expect(commentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: null })
    )
    expect(prCommentSyncJobRepository.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'INBOUND',
        scheduledFor: expect.any(Date),
      })
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/services/pr-comment-mirror/run-inbound-create.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Implement runInboundCreate**

In `lib/services/pr-comment-mirror.service.ts`, replace the stub:

```typescript
import {
  githubMarkdownToLumoHtml,
  buildHeader,
  computeBodyHash,
} from '@/lib/integrations/github/markdown-bridge'

function buildInboundBody(
  payload: InboundPayload,
  node: InboundCommentNode,
  source: PrCommentSource
): string {
  const md = node.body ?? ''
  const innerHtml = githubMarkdownToLumoHtml(md, () => null) // mention resolver wired later

  if (source === 'REVIEW_LINE' && node.path && node.line) {
    const headerInner = `📍 在 <a href="${node.html_url}">${node.path}:${node.line}</a> 评论`
    return buildHeader(headerInner) + innerHtml
  }

  if (source === 'REVIEW') {
    const state = (
      payload.raw.review?.state as string | undefined
    )?.toLowerCase()
    let header = '💬 Commented'
    if (state === 'approved') header = '✅ Approved'
    else if (state === 'changes_requested') header = '🛑 Requested changes'
    else if (state === 'dismissed') header = '📭 Review dismissed'
    return buildHeader(header) + innerHtml
  }

  return innerHtml
}

async function resolveInboundParent(
  source: PrCommentSource,
  node: InboundCommentNode
): Promise<{ parentId: string | null; missing: boolean }> {
  if (source !== 'REVIEW_LINE' || !node.in_reply_to_id) {
    return { parentId: null, missing: false }
  }
  const parent = await prCommentMirrorRepository.findByExternal(
    'REVIEW_LINE',
    String(node.in_reply_to_id)
  )
  if (parent?.commentId) return { parentId: parent.commentId, missing: false }
  return { parentId: null, missing: true }
}

async function runInboundCreate(
  payload: InboundPayload,
  node: InboundCommentNode,
  source: PrCommentSource
) {
  const author = await prCommentMirrorService.resolveInboundAuthor(
    payload.workspaceId,
    node.user
  )
  if (!author) return // bot defense triggered

  const body = buildInboundBody(payload, node, source)
  const { parentId, missing } = await resolveInboundParent(source, node)

  const comment = await prisma.$transaction(async tx => {
    const c = await commentRepository.create({
      taskId: payload.taskId,
      authorActorId: author.actorId,
      body,
      parentId,
      quotedCommentId: null,
    })
    await prCommentMirrorRepository.create(
      {
        commentId: c.id,
        pullRequestId: payload.pullRequestId,
        externalSource: source,
        externalId: String(node.id),
        externalNodeId: node.node_id,
        externalUrl: node.html_url,
        externalUpdatedAt: new Date(node.updated_at),
        outboundActor: 'BOT_APP', // origin: external; outbound writer unknown
        outboundActorUserId: null,
        bodyHash: computeBodyHash(node.body ?? ''),
        filePath: source === 'REVIEW_LINE' ? (node.path ?? null) : null,
        lineStart:
          source === 'REVIEW_LINE'
            ? (node.start_line ?? node.line ?? null)
            : null,
        lineEnd: source === 'REVIEW_LINE' ? (node.line ?? null) : null,
        diffSide: source === 'REVIEW_LINE' ? (node.side ?? null) : null,
        inReplyToExternalId:
          source === 'REVIEW_LINE' && node.in_reply_to_id
            ? String(node.in_reply_to_id)
            : null,
      },
      tx
    )
    return c
  })

  if (missing) {
    // Re-attempt the parent linkage after a short delay
    await prCommentSyncJobRepository.enqueue({
      direction: 'INBOUND',
      payload: {
        reason: 'parent-mirror-missing',
        commentId: comment.id,
        raw: payload.raw,
      },
      externalId: String(node.id),
      workspaceId: payload.workspaceId,
      scheduledFor: new Date(Date.now() + 30_000),
    })
  }

  // Notifications wired in Task 18
}
```

- [ ] **Step 4: Add `prisma` import**

If not already at the top of `pr-comment-mirror.service.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
```

- [ ] **Step 5: Run tests until pass**

Run: `npx jest __tests__/services/pr-comment-mirror/run-inbound-create.test.ts -v`
Expected: PASS (5 cases).

- [ ] **Step 6: Commit**

```bash
git add lib/services/pr-comment-mirror.service.ts __tests__/services/pr-comment-mirror/run-inbound-create.test.ts
git commit -m "feat(pr-mirror): runInbound CREATE with header markers + parent resolution [LUM-90]"
```

---

### Task 14: runInbound UPDATE with conflict resolution

**Files:**

- Modify: `lib/services/pr-comment-mirror.service.ts`
- Test: `__tests__/services/pr-comment-mirror/run-inbound-update-conflict.test.ts`

- [ ] **Step 1: Write failing tests covering all 4 conflict branches**

```typescript
// __tests__/services/pr-comment-mirror/run-inbound-update-conflict.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pr-comment-sync-job.repository')

const baseExisting = {
  id: 'm1',
  commentId: 'c1',
  externalSource: 'ISSUE',
  externalId: '999',
  externalUpdatedAt: new Date('2026-05-24T01:00:00Z'),
}

const basePayload = (updatedAt: string, body = 'remote edit') => ({
  event: 'issue_comment' as const,
  action: 'edited' as const,
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
  raw: {
    comment: {
      id: 999,
      node_id: 'IC_x',
      html_url: 'https://...',
      body,
      updated_at: updatedAt,
      user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
    },
  },
})

describe('runInbound UPDATE — conflict matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      baseExisting
    )
  })

  it('T <= M → echo drop (no update, no outbound)', async () => {
    await prCommentMirrorService.runInbound(basePayload('2026-05-24T01:00:00Z'))
    expect(commentRepository.update).not.toHaveBeenCalled()
    expect(prCommentSyncJobRepository.enqueue).not.toHaveBeenCalled()
  })

  it('L <= M → apply inbound (no local edits since last sync)', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      updatedAt: new Date('2026-05-24T00:30:00Z'), // L < M
    })
    await prCommentMirrorService.runInbound(basePayload('2026-05-24T02:00:00Z'))
    expect(commentRepository.update).toHaveBeenCalledWith(
      'c1',
      expect.any(Object)
    )
    expect(prCommentMirrorRepository.patchAfterEdit).toHaveBeenCalled()
  })

  it('M < L < T → GH wins (apply inbound, log conflict)', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      updatedAt: new Date('2026-05-24T01:30:00Z'), // M < L < T
      body: '<p>local edit</p>',
    })
    const logSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await prCommentMirrorService.runInbound(basePayload('2026-05-24T02:00:00Z'))
    expect(commentRepository.update).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('pr-mirror conflict'),
      expect.any(Object)
    )
    logSpy.mockRestore()
  })

  it('M < T < L → local wins (schedule outbound, no local mutation)', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      updatedAt: new Date('2026-05-24T03:00:00Z'), // L > T > M
    })
    await prCommentMirrorService.runInbound(basePayload('2026-05-24T02:00:00Z'))
    expect(commentRepository.update).not.toHaveBeenCalled()
    expect(prCommentSyncJobRepository.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUTBOUND',
        payload: { op: 'UPDATE', mirrorId: 'm1' },
      })
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/services/pr-comment-mirror/run-inbound-update-conflict.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Implement runInboundUpdate**

In `lib/services/pr-comment-mirror.service.ts`, replace the stub:

```typescript
async function runInboundUpdate(
  payload: InboundPayload,
  existing: { id: string; commentId: string; externalUpdatedAt: Date },
  node: InboundCommentNode
) {
  const T = new Date(node.updated_at)
  const M = existing.externalUpdatedAt

  // T <= M: echo
  if (T <= M) return

  const local = await commentRepository.findById(existing.commentId)
  if (!local || local.deletedAt) return // local was deleted; inbound update is moot

  const L = local.updatedAt

  if (L <= M) {
    // Apply inbound
    return applyInboundUpdate(payload, existing, node)
  }

  if (T > L) {
    // GH wins despite local edit
    console.warn('pr-mirror conflict: inbound wins', {
      mirrorId: existing.id,
      L: L.toISOString(),
      M: M.toISOString(),
      T: T.toISOString(),
      localBody: local.body,
      remoteBody: node.body,
    })
    return applyInboundUpdate(payload, existing, node)
  }

  // L >= T > M: local wins — push local back to GitHub
  await prCommentSyncJobRepository.enqueue({
    direction: 'OUTBOUND',
    payload: { op: 'UPDATE', mirrorId: existing.id },
    commentId: existing.commentId,
    workspaceId: payload.workspaceId,
  })
}

async function applyInboundUpdate(
  payload: InboundPayload,
  existing: { id: string; commentId: string },
  node: InboundCommentNode
) {
  const source = payloadSource(payload)
  const newBody = buildInboundBody(payload, node, source)
  await commentRepository.update(existing.commentId, { body: newBody })
  await prCommentMirrorRepository.patchAfterEdit(
    existing.id,
    new Date(node.updated_at),
    computeBodyHash(node.body ?? '')
  )
}
```

Also update the dispatch in `runInbound` to handle the `deleted` action by calling `runInboundDelete` (next task) and route `edited` action to `runInboundUpdate` when a mirror exists.

- [ ] **Step 4: Run tests until pass**

Run: `npx jest __tests__/services/pr-comment-mirror/run-inbound-update-conflict.test.ts -v`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/services/pr-comment-mirror.service.ts __tests__/services/pr-comment-mirror/run-inbound-update-conflict.test.ts
git commit -m "feat(pr-mirror): runInbound UPDATE with LWW conflict resolution [LUM-90]"
```

---

### Task 15: runInbound DELETE

**Files:**

- Modify: `lib/services/pr-comment-mirror.service.ts`
- Test: `__tests__/services/pr-comment-mirror/run-inbound-delete.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/services/pr-comment-mirror/run-inbound-delete.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')

describe('runInbound DELETE', () => {
  beforeEach(() => jest.clearAllMocks())

  it('soft-deletes the local comment and marks mirror deletedAt', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue({
      id: 'm1',
      commentId: 'c1',
      externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
    })
    await prCommentMirrorService.runInbound({
      event: 'issue_comment',
      action: 'deleted',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 999,
          node_id: 'IC_x',
          html_url: 'https://...',
          body: null,
          updated_at: '2026-05-24T02:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    expect(commentRepository.delete).toHaveBeenCalledWith('c1')
    expect(prCommentMirrorRepository.markDeleted).toHaveBeenCalledWith('m1')
  })

  it('is a no-op when mirror missing (unknown comment)', async () => {
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
    await prCommentMirrorService.runInbound({
      event: 'issue_comment',
      action: 'deleted',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 999,
          node_id: 'IC_x',
          html_url: 'https://...',
          body: null,
          updated_at: '2026-05-24T02:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    expect(commentRepository.delete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/services/pr-comment-mirror/run-inbound-delete.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Wire DELETE through the dispatch**

Inside `runInbound`, replace the `if (payload.action === 'deleted') return // unknown comment, ignore delete` block:

```typescript
if (payload.action === 'deleted') {
  const existing = await prCommentMirrorRepository.findByExternal(
    source,
    String(node.id)
  )
  if (!existing) return
  await commentRepository.delete(existing.commentId)
  await prCommentMirrorRepository.markDeleted(existing.id)
  return
}
```

(Move the lookup before the action check OR re-do the lookup; cleanest is to extract the lookup once at the top of `runInbound` and reuse.)

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/services/pr-comment-mirror/run-inbound-delete.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pr-comment-mirror.service.ts __tests__/services/pr-comment-mirror/run-inbound-delete.test.ts
git commit -m "feat(pr-mirror): runInbound DELETE (always wins; soft-delete local + tombstone mirror) [LUM-90]"
```

---

## Phase D — Wire-Up

### Task 16: commentService — add updateCommentWithSideEffects, deleteCommentWithSideEffects, scheduleOutbound integration

**Files:**

- Modify: `lib/services/comment.service.ts`
- Modify: `lib/services/pr-comment-mirror.service.ts`
- Test: `__tests__/services/comment.service.scheduleOutbound.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/services/comment.service.scheduleOutbound.test.ts
import { commentService } from '@/lib/services/comment.service'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'

jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { scheduleOutbound: jest.fn() },
}))
jest.mock('@/lib/repositories/comment.repository')

describe('commentService — mirror hooks', () => {
  beforeEach(() => jest.clearAllMocks())

  it('createCommentWithSideEffects calls scheduleOutbound with op=CREATE and mirrorOrigin=user (default)', async () => {
    ;(commentRepository.create as jest.Mock).mockResolvedValue({ id: 'c1' })
    await commentService.createCommentWithSideEffects({
      taskId: 't1',
      authorActorId: 'a1',
      body: '<p>x</p>',
      parentId: null,
      quotedCommentId: null,
      authorClerkId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      taskTitle: 't',
      taskNumber: 1,
      teamIdentifier: 'X',
      workspaceSlug: 's',
      waitUntil: p => p,
    } as any)
    expect(prCommentMirrorService.scheduleOutbound).toHaveBeenCalledWith(
      'c1',
      'CREATE',
      { mirrorOrigin: 'user' }
    )
  })

  it('does not call scheduleOutbound when mirrorOrigin=inbound', async () => {
    ;(commentRepository.create as jest.Mock).mockResolvedValue({ id: 'c1' })
    await commentService.createCommentWithSideEffects({
      taskId: 't1',
      authorActorId: 'a1',
      body: '<p>x</p>',
      parentId: null,
      quotedCommentId: null,
      authorClerkId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      taskTitle: 't',
      taskNumber: 1,
      teamIdentifier: 'X',
      workspaceSlug: 's',
      waitUntil: p => p,
      mirrorOrigin: 'inbound',
    } as any)
    expect(prCommentMirrorService.scheduleOutbound).not.toHaveBeenCalled()
  })

  it('updateCommentWithSideEffects calls scheduleOutbound op=UPDATE', async () => {
    ;(commentRepository.update as jest.Mock).mockResolvedValue({ id: 'c1' })
    await commentService.updateCommentWithSideEffects({
      commentId: 'c1',
      body: '<p>edit</p>',
      waitUntil: p => p,
    })
    expect(prCommentMirrorService.scheduleOutbound).toHaveBeenCalledWith(
      'c1',
      'UPDATE',
      { mirrorOrigin: 'user' }
    )
  })

  it('deleteCommentWithSideEffects calls scheduleOutbound op=DELETE', async () => {
    ;(commentRepository.delete as jest.Mock).mockResolvedValue(undefined)
    await commentService.deleteCommentWithSideEffects({
      commentId: 'c1',
      waitUntil: p => p,
    })
    expect(prCommentMirrorService.scheduleOutbound).toHaveBeenCalledWith(
      'c1',
      'DELETE',
      { mirrorOrigin: 'user' }
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/services/comment.service.scheduleOutbound.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Implement scheduleOutbound in pr-comment-mirror**

In `lib/services/pr-comment-mirror.service.ts`, replace the stub:

```typescript
import { waitUntil } from '@vercel/functions'

async scheduleOutbound(
  commentId: string,
  op: 'CREATE' | 'UPDATE' | 'DELETE',
  opts: { mirrorOrigin?: 'inbound' | 'user' } = {}
) {
  if (opts.mirrorOrigin === 'inbound') return
  waitUntil(
    prCommentMirrorService.runOutbound(commentId, op).catch((err) =>
      console.error('[pr-mirror] outbound failed', { commentId, op, err })
    )
  )
},
```

- [ ] **Step 4: Extend commentService**

In `lib/services/comment.service.ts`:

1. Add `mirrorOrigin?: 'inbound' | 'user'` to `CreateCommentWithSideEffectsInput`.
2. At the end of `createCommentWithSideEffects` (after the side-effects), add:

```typescript
await prCommentMirrorService.scheduleOutbound(comment.id, 'CREATE', {
  mirrorOrigin: input.mirrorOrigin ?? 'user',
})
```

3. Add new methods:

```typescript
async updateCommentWithSideEffects(input: {
  commentId: string
  body: string
  waitUntil: (p: Promise<unknown>) => void
  mirrorOrigin?: 'inbound' | 'user'
}) {
  const updated = await commentRepository.update(input.commentId, { body: input.body })
  await prCommentMirrorService.scheduleOutbound(input.commentId, 'UPDATE', {
    mirrorOrigin: input.mirrorOrigin ?? 'user',
  })
  return updated
},

async deleteCommentWithSideEffects(input: {
  commentId: string
  waitUntil: (p: Promise<unknown>) => void
  mirrorOrigin?: 'inbound' | 'user'
}) {
  await commentRepository.delete(input.commentId)
  await prCommentMirrorService.scheduleOutbound(input.commentId, 'DELETE', {
    mirrorOrigin: input.mirrorOrigin ?? 'user',
  })
},
```

Don't forget to import `prCommentMirrorService` at the top.

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/services/comment.service.scheduleOutbound.test.ts -v`
Expected: PASS.

- [ ] **Step 6: Run the full comment.service test suite**

Run: `npx jest comment.service -v`
Expected: PASS (existing tests still green).

- [ ] **Step 7: Commit**

```bash
git add lib/services/comment.service.ts lib/services/pr-comment-mirror.service.ts __tests__/services/comment.service.scheduleOutbound.test.ts
git commit -m "feat(comment): scheduleOutbound hooks on create/update/delete with mirrorOrigin gating [LUM-90]"
```

---

### Task 17: Refactor PATCH/DELETE routes to use new service methods + thread mirrorOrigin through inbound

**Files:**

- Modify: `app/api/tasks/[id]/comments/[commentId]/route.ts`
- Modify: `lib/services/pr-comment-mirror.service.ts` (pass `mirrorOrigin: 'inbound'` when calling commentService from runInbound)

- [ ] **Step 1: Update PATCH route**

In `app/api/tasks/[id]/comments/[commentId]/route.ts`, replace the body of the PATCH handler's update call:

```typescript
const updated = await commentService.updateCommentWithSideEffects({
  commentId,
  body: parsed.data.body,
  waitUntil,
})
return NextResponse.json({ comment: updated })
```

Add the import: `import { commentService } from '@/lib/services/comment.service'`.

- [ ] **Step 2: Update DELETE route**

Replace `await commentRepository.delete(commentId)` with:

```typescript
await commentService.deleteCommentWithSideEffects({ commentId, waitUntil })
```

- [ ] **Step 3: Update runInbound CREATE to call commentService with mirrorOrigin='inbound'**

In `lib/services/pr-comment-mirror.service.ts`, the inbound CREATE currently calls `commentRepository.create` directly inside the transaction (per Task 13). Switch to call `commentService` once outside the transaction so notifications fire — replace the transaction block in `runInboundCreate` with:

```typescript
const comment = await commentRepository.create({
  taskId: payload.taskId,
  authorActorId: author.actorId,
  body,
  parentId,
  quotedCommentId: null,
})
await prCommentMirrorRepository.create({
  commentId: comment.id,
  pullRequestId: payload.pullRequestId,
  externalSource: source,
  externalId: String(node.id),
  externalNodeId: node.node_id,
  externalUrl: node.html_url,
  externalUpdatedAt: new Date(node.updated_at),
  outboundActor: 'BOT_APP',
  outboundActorUserId: null,
  bodyHash: computeBodyHash(node.body ?? ''),
  filePath: source === 'REVIEW_LINE' ? (node.path ?? null) : null,
  lineStart:
    source === 'REVIEW_LINE' ? (node.start_line ?? node.line ?? null) : null,
  lineEnd: source === 'REVIEW_LINE' ? (node.line ?? null) : null,
  diffSide: source === 'REVIEW_LINE' ? (node.side ?? null) : null,
  inReplyToExternalId:
    source === 'REVIEW_LINE' && node.in_reply_to_id
      ? String(node.in_reply_to_id)
      : null,
})

// Notification dispatch is wired in Task 18; leave a TODO marker here for now
// TODO(LUM-90 Task 18): commentService.notifyMentionsForMirror({...})
```

(The notification call is intentionally **not** written yet — just the TODO. Task 18 adds the `notifyMentionsForMirror` method on `commentService` AND swaps this TODO for the real call. If you write the call now the build fails because the method does not exist.)

Note: dropping the transactional create/mirror-create pair is intentional — if the mirror insert fails, the duplicate detection in the next webhook (echo path) catches the next event.

- [ ] **Step 4: Run existing comment route tests**

Run: `npx jest app/api/tasks/.+/comments -v` (or `npx jest comments`)
Expected: PASS (no regressions on existing route behaviour).

- [ ] **Step 5: Commit**

```bash
git add app/api/tasks/\[id\]/comments/\[commentId\]/route.ts lib/services/pr-comment-mirror.service.ts
git commit -m "refactor(comment): route PATCH/DELETE through commentService + inbound origin tag [LUM-90]"
```

---

### Task 18: notifyMentionsForMirror + webhook handlers — add issue_comment, pull_request_review, pull_request_review_comment

(Task 18 also retro-fits the TODO marker from Task 17 step 3 with the real `notifyMentionsForMirror` call once the method exists.)

**Files:**

- Modify: `app/api/webhooks/github/route.ts` (switch cases)
- Modify: `app/api/webhooks/github/handlers.ts` (new exports)
- Modify: `lib/services/comment.service.ts` (add `notifyMentionsForMirror`)
- Test: `__tests__/api/webhooks/github/comment-events.test.ts`

- [ ] **Step 1: Add `notifyMentionsForMirror` to commentService**

In `lib/services/comment.service.ts`, add:

```typescript
async notifyMentionsForMirror(params: {
  commentId: string
  taskId: string
  body: string
  authorActorId: string
  workspaceId: string
}): Promise<void> {
  // Load task / project context for the existing notifyMentions API.
  // Use findForComment — its TASK_COMMENT_SELECT shape returns exactly the fields
  // notifyMentions needs (team.identifier + project.workspace.slug).
  // (lib/repositories/task.repository.ts:218 TASK_COMMENT_SELECT, :544 findForComment)
  const { taskRepository } = await import('@/lib/repositories')
  const task = await taskRepository.findForComment(params.taskId)
  if (!task) return
  return commentService.notifyMentions({
    taskId: params.taskId,
    commentId: params.commentId,
    body: params.body,
    authorActorId: params.authorActorId,
    authorClerkId: '', // pseudo-author has no clerk id; parseMentionedClerkIds will still find @mentions in body
    workspaceId: params.workspaceId,
    projectId: task.projectId ?? '',
    taskTitle: task.title,
    taskNumber: task.number,
    teamIdentifier: task.team?.identifier ?? '',
    workspaceSlug: task.project?.workspace?.slug ?? '',
    waitUntil: (p) => { void p },
  })
},
```

`taskRepository.findForComment` already exists at `lib/repositories/task.repository.ts:544` and selects exactly the fields above — no new repo method required.

After defining the method, edit `runInboundCreate` in `lib/services/pr-comment-mirror.service.ts` and replace the `// TODO(LUM-90 Task 18): commentService.notifyMentionsForMirror({...})` marker (added in Task 17) with the real call:

```typescript
await commentService.notifyMentionsForMirror({
  commentId: comment.id,
  taskId: payload.taskId,
  body,
  authorActorId: author.actorId,
  workspaceId: payload.workspaceId,
})
```

Add the import at the top of `pr-comment-mirror.service.ts` if not already present:

```typescript
import { commentService } from '@/lib/services/comment.service'
```

Watch for a circular-import warning — both files import each other. If it surfaces, defer the import dynamically: `const { commentService } = await import('@/lib/services/comment.service')` inside `runInboundCreate`.

- [ ] **Step 2: Write failing webhook test**

```typescript
// __tests__/api/webhooks/github/comment-events.test.ts
import { POST } from '@/app/api/webhooks/github/route'
import { NextRequest } from 'next/server'
import { githubService } from '@/lib/services/github.service'
import { verifyGitHubSignature } from '@/lib/integrations/github'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'

jest.mock('@/lib/services/github.service')
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.fn().mockReturnValue(true),
}))
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: {
    runInbound: jest.fn().mockResolvedValue(undefined),
  },
}))

function makeRequest(event: string, body: object) {
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    headers: { 'x-github-event': event, 'x-hub-signature-256': 'sha256=' },
    body: JSON.stringify(body),
  })
}

describe('GitHub webhook — comment events', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(githubService.findWebhooksByRepo as jest.Mock).mockResolvedValue([
      {
        integration: {
          webhookSecret: 'secret',
          workspaceId: 'w1',
          id: 'int1',
        },
      },
    ])
  })

  it('routes issue_comment to prCommentMirrorService.runInbound when PR is linked to a task', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      {
        id: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
      }
    )
    const body = {
      action: 'created',
      issue: { number: 1, pull_request: { url: 'x' } },
      comment: { id: 999 },
      repository: { full_name: 'foo/bar' },
    }
    const res = await POST(makeRequest('issue_comment', body))
    expect(res.status).toBe(200)
    expect(prCommentMirrorService.runInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'issue_comment',
        action: 'created',
        taskId: 't1',
      })
    )
  })

  it('skips issue_comment when payload.issue.pull_request is null (real issue)', async () => {
    const body = {
      action: 'created',
      issue: { number: 1, pull_request: null },
      comment: { id: 999 },
      repository: { full_name: 'foo/bar' },
    }
    await POST(makeRequest('issue_comment', body))
    expect(prCommentMirrorService.runInbound).not.toHaveBeenCalled()
  })

  it('routes pull_request_review_comment to runInbound', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      {
        id: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
      }
    )
    const body = {
      action: 'created',
      pull_request: { number: 1 },
      comment: { id: 1000 },
      repository: { full_name: 'foo/bar' },
    }
    await POST(makeRequest('pull_request_review_comment', body))
    expect(prCommentMirrorService.runInbound).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pull_request_review_comment' })
    )
  })

  it('routes pull_request_review to runInbound', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      {
        id: 'pr1',
        taskId: 't1',
        workspaceId: 'w1',
      }
    )
    const body = {
      action: 'submitted',
      pull_request: { number: 1 },
      review: { id: 700, state: 'approved' },
      repository: { full_name: 'foo/bar' },
    }
    await POST(makeRequest('pull_request_review', body))
    expect(prCommentMirrorService.runInbound).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pull_request_review' })
    )
  })

  it('no-ops when PR has no taskId', async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      {
        id: 'pr1',
        taskId: null,
        workspaceId: 'w1',
      }
    )
    const body = {
      action: 'created',
      issue: { number: 1, pull_request: { url: 'x' } },
      comment: { id: 999 },
      repository: { full_name: 'foo/bar' },
    }
    await POST(makeRequest('issue_comment', body))
    expect(prCommentMirrorService.runInbound).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest __tests__/api/webhooks/github/comment-events.test.ts -v`
Expected: FAIL.

- [ ] **Step 4: Add handler functions**

In `app/api/webhooks/github/handlers.ts`, append:

```typescript
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'

export async function handleIssueComment(
  payload: Record<string, unknown>,
  workspaceId: string,
  _integrationId: string
): Promise<void> {
  const issue = payload.issue as
    | { number: number; pull_request?: unknown }
    | undefined
  if (!issue?.pull_request) return // real issue, not a PR
  const repo = (payload.repository as { full_name?: string } | undefined)
    ?.full_name
  if (!repo) return
  const pr = await pullRequestRepository.findByRepoAndNumber(repo, issue.number)
  if (!pr?.taskId) return
  await prCommentMirrorService.runInbound({
    event: 'issue_comment',
    action: (payload.action as InboundAction) ?? 'created',
    workspaceId,
    taskId: pr.taskId,
    pullRequestId: pr.id,
    raw: payload,
  })
}

export async function handlePullRequestReview(
  payload: Record<string, unknown>,
  workspaceId: string,
  _integrationId: string
): Promise<void> {
  const prRef = payload.pull_request as { number: number } | undefined
  if (!prRef) return
  const repo = (payload.repository as { full_name?: string } | undefined)
    ?.full_name
  if (!repo) return
  const pr = await pullRequestRepository.findByRepoAndNumber(repo, prRef.number)
  if (!pr?.taskId) return
  await prCommentMirrorService.runInbound({
    event: 'pull_request_review',
    action: (payload.action as InboundAction) ?? 'submitted',
    workspaceId,
    taskId: pr.taskId,
    pullRequestId: pr.id,
    raw: payload,
  })
}

export async function handlePullRequestReviewComment(
  payload: Record<string, unknown>,
  workspaceId: string,
  _integrationId: string
): Promise<void> {
  const prRef = payload.pull_request as { number: number } | undefined
  if (!prRef) return
  const repo = (payload.repository as { full_name?: string } | undefined)
    ?.full_name
  if (!repo) return
  const pr = await pullRequestRepository.findByRepoAndNumber(repo, prRef.number)
  if (!pr?.taskId) return
  await prCommentMirrorService.runInbound({
    event: 'pull_request_review_comment',
    action: (payload.action as InboundAction) ?? 'created',
    workspaceId,
    taskId: pr.taskId,
    pullRequestId: pr.id,
    raw: payload,
  })
}

type InboundAction =
  | 'created'
  | 'edited'
  | 'deleted'
  | 'submitted'
  | 'dismissed'
```

- [ ] **Step 5: Wire into the switch**

Edit `app/api/webhooks/github/route.ts`:

```typescript
import {
  handlePullRequest,
  handleCheckSuite,
  handlePush,
  handleIssueComment,
  handlePullRequestReview,
  handlePullRequestReviewComment,
} from './handlers'

// ...
switch (event) {
  case 'pull_request':
    await handlePullRequest(payload, workspaceId, integrationId)
    break
  case 'push':
    await handlePush(payload, workspaceId)
    break
  case 'check_suite':
    await handleCheckSuite(payload, workspaceId)
    break
  case 'issue_comment':
    await handleIssueComment(payload, workspaceId, integrationId)
    break
  case 'pull_request_review':
    await handlePullRequestReview(payload, workspaceId, integrationId)
    break
  case 'pull_request_review_comment':
    await handlePullRequestReviewComment(payload, workspaceId, integrationId)
    break
}
```

- [ ] **Step 6: Run tests**

Run: `npx jest __tests__/api/webhooks/github/comment-events.test.ts -v`
Expected: PASS (5 cases).

- [ ] **Step 7: Commit**

```bash
git add app/api/webhooks/github/route.ts app/api/webhooks/github/handlers.ts lib/services/comment.service.ts __tests__/api/webhooks/github/comment-events.test.ts
git commit -m "feat(webhook): handle issue_comment, pull_request_review(_comment) → runInbound [LUM-90]"
```

---

## Phase E — Event-Driven Retry + Integration

### Task 19: Drain-on-event retry (replaces cron)

**Decision:** No cron. Pending `PrCommentSyncJob` rows are drained at the start of every `runOutbound` (per task) and `runInbound` (per PR). Median retry latency = "until the next activity," which is fine because failures will almost always be transient (rate limit, GH 5xx) and any next webhook / comment on the same task drains the backlog. Known limit: a workspace with zero activity will leave failed jobs PENDING indefinitely — acceptable for MVP; post-MVP can add a low-frequency cron or operator CLI.

**Files:**

- Modify: `lib/repositories/pr-comment-sync-job.repository.ts` (add `findDueByTask`, `findDueByPullRequest`)
- Modify: `lib/services/pr-comment-mirror.service.ts` (drain at the top of `runOutbound` / `runInbound`; dead-letter logic moves into the drain catch path)
- Test: extend `__tests__/repositories/pr-comment-sync-job.repository.test.ts` + new `__tests__/services/pr-comment-mirror/drain-on-event.test.ts`

- [ ] **Step 1: Add repository methods + tests**

Append to `__tests__/repositories/pr-comment-sync-job.repository.test.ts`:

```typescript
it('findDueByTask filters by commentId.taskId joined and limit', async () => {
  await prCommentSyncJobRepository.findDueByTask('t1', { limit: 10 })
  expect(prisma.prCommentSyncJob.findMany).toHaveBeenCalledWith({
    where: {
      status: 'PENDING',
      scheduledFor: { lte: expect.any(Date) },
      direction: 'OUTBOUND',
      comment: { taskId: 't1' },
    },
    orderBy: { scheduledFor: 'asc' },
    take: 10,
  })
})

it('findDueByPullRequest filters by inbound payload.pullRequestId', async () => {
  await prCommentSyncJobRepository.findDueByPullRequest('pr1', { limit: 10 })
  expect(prisma.prCommentSyncJob.findMany).toHaveBeenCalledWith({
    where: {
      status: 'PENDING',
      scheduledFor: { lte: expect.any(Date) },
      direction: 'INBOUND',
      payload: { path: ['pullRequestId'], equals: 'pr1' },
    },
    orderBy: { scheduledFor: 'asc' },
    take: 10,
  })
})
```

Implement in `lib/repositories/pr-comment-sync-job.repository.ts`:

```typescript
async findDueByTask(taskId: string, { limit }: { limit: number }) {
  return prisma.prCommentSyncJob.findMany({
    where: {
      status: 'PENDING',
      scheduledFor: { lte: new Date() },
      direction: 'OUTBOUND',
      comment: { taskId },
    },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
  })
},

async findDueByPullRequest(pullRequestId: string, { limit }: { limit: number }) {
  return prisma.prCommentSyncJob.findMany({
    where: {
      status: 'PENDING',
      scheduledFor: { lte: new Date() },
      direction: 'INBOUND',
      payload: { path: ['pullRequestId'], equals: pullRequestId },
    },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
  })
},
```

(The OUTBOUND filter uses the `comment` relation, which means OUTBOUND jobs need `commentId` populated — they always do, per the `enqueue` contract in Task 4.)

The `PrCommentSyncJob.comment` relation and the `Comment.syncJobs` back-relation are already declared as part of Task 1's schema, so no additional migration is required here.

- [ ] **Step 2: Write drain-on-event tests**

```typescript
// __tests__/services/pr-comment-mirror/drain-on-event.test.ts
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import { GithubApiError } from '@/lib/integrations/github/pr-comment-client'

jest.mock('@/lib/repositories/pr-comment-sync-job.repository')
jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')

describe('drain-on-event', () => {
  beforeEach(() => jest.clearAllMocks())

  it('runOutbound drains pending OUTBOUND jobs for the same task before its own work', async () => {
    // Arrange a pending job for the same task as our incoming work
    ;(prCommentSyncJobRepository.findDueByTask as jest.Mock).mockResolvedValue([
      {
        id: 'j-prior',
        direction: 'OUTBOUND',
        commentId: 'c-old',
        payload: { op: 'CREATE' },
        attempts: 0,
      },
    ])
    // Skip the actual main-path work for this test by stubbing the lookups to return no PR
    const { pullRequestRepository } =
      await import('@/lib/repositories/pull-request.repository')
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(null)
    const { commentRepository } =
      await import('@/lib/repositories/comment.repository')
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      type: 'USER',
    })

    await prCommentMirrorService.runOutbound('c1', 'CREATE')

    expect(prCommentSyncJobRepository.findDueByTask).toHaveBeenCalledWith(
      't1',
      { limit: 10 }
    )
  })

  it('drain failures escalate to dead-letter after 3rd attempt', async () => {
    ;(prCommentSyncJobRepository.findDueByTask as jest.Mock).mockResolvedValue([
      {
        id: 'j-fail',
        direction: 'OUTBOUND',
        commentId: 'c-old',
        payload: { op: 'CREATE' },
        attempts: 2,
      },
    ])
    // Force the drained job's retry to throw
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    // Spy on runOutbound to mock the inner retry call (note: drain calls runOutbound recursively for each pending job)
    // For this test we simulate the recursive failure path by making the second lookup throw
    const { commentRepository } =
      await import('@/lib/repositories/comment.repository')
    ;(commentRepository.findById as jest.Mock).mockImplementation(id => {
      if (id === 'c-old') throw new Error('boom')
      return { id: 'c1', taskId: 't1', type: 'USER' }
    })
    const { pullRequestRepository } =
      await import('@/lib/repositories/pull-request.repository')
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue(null)

    await prCommentMirrorService.runOutbound('c1', 'CREATE')

    expect(prCommentSyncJobRepository.markDeadLetter).toHaveBeenCalledWith(
      'j-fail',
      'boom'
    )
    errSpy.mockRestore()
  })

  it('runInbound drains pending INBOUND jobs for the same PR', async () => {
    ;(
      prCommentSyncJobRepository.findDueByPullRequest as jest.Mock
    ).mockResolvedValue([])
    const { prCommentMirrorRepository } =
      await import('@/lib/repositories/pr-comment-mirror.repository')
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue(
      null
    )
    ;(
      prCommentMirrorRepository.findRecentPlaceholder as jest.Mock
    ).mockResolvedValue(null)

    await prCommentMirrorService.runInbound({
      event: 'issue_comment',
      action: 'deleted',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 999,
          node_id: 'IC_x',
          html_url: 'https://...',
          body: null,
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })

    expect(
      prCommentSyncJobRepository.findDueByPullRequest
    ).toHaveBeenCalledWith('pr1', { limit: 10 })
  })
})
```

- [ ] **Step 3: Implement drain at the entrypoints**

In `lib/services/pr-comment-mirror.service.ts`, wrap `runOutbound` and `runInbound` with a drain pass:

```typescript
const DRAIN_LIMIT = 10
const DEAD_LETTER_THRESHOLD = 3

async function drainAndRetry<T>(
  job: { id: string; attempts: number },
  work: () => Promise<T>
): Promise<void> {
  try {
    await work()
    await prCommentSyncJobRepository.delete(job.id)
  } catch (err) {
    if (err instanceof GithubApiError && err.rateLimitResetAt) {
      await prCommentSyncJobRepository.rescheduleAt(
        job.id,
        err.rateLimitResetAt,
        'rate-limit'
      )
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    const nextAttempts = job.attempts + 1
    if (nextAttempts >= DEAD_LETTER_THRESHOLD) {
      await prCommentSyncJobRepository.markDeadLetter(job.id, message)
      console.error('pr-mirror dead-letter', {
        jobId: job.id,
        attempts: nextAttempts,
        error: message,
      })
    } else {
      await prCommentSyncJobRepository.recordFailure(
        job.id,
        job.attempts,
        message
      )
    }
  }
}

async function drainOutboundForTask(taskId: string) {
  const due = await prCommentSyncJobRepository.findDueByTask(taskId, {
    limit: DRAIN_LIMIT,
  })
  for (const job of due) {
    if (!job.commentId) continue
    const op =
      (job.payload as { op?: 'CREATE' | 'UPDATE' | 'DELETE' }).op ?? 'CREATE'
    // Recursive call — but the inner call will drain WHATEVER's still pending,
    // and findDueByTask returns no rows if we just drained them. Safe.
    await drainAndRetry(job, () =>
      prCommentMirrorService.runOutbound(job.commentId!, op)
    )
  }
}

async function drainInboundForPr(pullRequestId: string) {
  const due = await prCommentSyncJobRepository.findDueByPullRequest(
    pullRequestId,
    { limit: DRAIN_LIMIT }
  )
  for (const job of due) {
    await drainAndRetry(job, () =>
      prCommentMirrorService.runInbound(job.payload as never)
    )
  }
}
```

Inside `runOutbound`, drain BEFORE the main path:

```typescript
async runOutbound(commentId: string, op: 'CREATE' | 'UPDATE' | 'DELETE') {
  // Look up the task for drain — needed for both the drain and the main path.
  const comment = await commentRepository.findById(commentId)
  if (comment) await drainOutboundForTask(comment.taskId)

  if (op === 'CREATE') return runOutboundCreate(commentId)
  if (op === 'UPDATE') return runOutboundUpdate(commentId)
  if (op === 'DELETE') return runOutboundDelete(commentId)
},
```

Inside `runInbound`, drain BEFORE the main path (right after extracting the source/node):

```typescript
async runInbound(payload: InboundPayload) {
  await drainInboundForPr(payload.pullRequestId)
  // ...existing logic
},
```

- [ ] **Step 4: Run tests until pass**

Run: `npx jest __tests__/services/pr-comment-mirror/drain-on-event.test.ts -v`
Run: `npx jest __tests__/repositories/pr-comment-sync-job.repository.test.ts -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/pr-comment-sync-job.repository.ts lib/services/pr-comment-mirror.service.ts prisma/schema.prisma prisma/migrations/ __tests__/services/pr-comment-mirror/drain-on-event.test.ts __tests__/repositories/pr-comment-sync-job.repository.test.ts
git commit -m "feat(pr-mirror): drain pending sync jobs on every runOutbound/runInbound (replaces cron) [LUM-90]"
```

---

### Task 20: Integration test — full echo round-trip with nock

**Files:**

- Create: `__tests__/integration/pr-mirror-flow.test.ts`

- [ ] **Step 1: Add nock if missing**

Check: `grep -E '"nock"' package.json`
If absent: `npm install --save-dev nock`
Note this in PR description (per CLAUDE.md "Forbidden" rules — new dev dep, not runtime).

- [ ] **Step 2: Write the integration test**

```typescript
// __tests__/integration/pr-mirror-flow.test.ts
import nock from 'nock'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentService } from '@/lib/services/comment.service'

// This test uses heavy module-level mocks for repositories — replace as needed
// with a real test DB once factory helpers exist.

jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories/pr-comment-mirror.repository')
jest.mock('@/lib/repositories/pull-request.repository')
jest.mock('@/lib/repositories/member.repository')
jest.mock('@/lib/repositories/github.repository')
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('app-token'),
}))

import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { githubRepository } from '@/lib/repositories/github.repository'

describe('pr-mirror integration — outbound → webhook echo', () => {
  afterEach(() => nock.cleanAll())

  it('does not duplicate comment when GitHub fires webhook for our own POST', async () => {
    ;(commentRepository.findById as jest.Mock).mockResolvedValue({
      id: 'c1',
      taskId: 't1',
      body: '<p>hi</p>',
      type: 'USER',
      authorActorId: null,
    })
    ;(pullRequestRepository.findByTaskId as jest.Mock).mockResolvedValue({
      id: 'pr1',
      taskId: 't1',
      repo: 'foo/bar',
      number: 1,
      workspaceId: 'w1',
    })
    ;(prCommentMirrorRepository.findByCommentId as jest.Mock).mockResolvedValue(
      null
    )
    ;(prCommentMirrorRepository.reserve as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalId: 'pending-xxx',
    })
    ;(
      githubRepository.findIntegrationByUserAndWorkspace as jest.Mock
    ).mockResolvedValue(null)

    nock('https://api.github.com')
      .post('/repos/foo/bar/issues/1/comments')
      .reply(201, {
        id: 999,
        node_id: 'IC_x',
        html_url: 'https://github.com/foo/bar/issues/1#issuecomment-999',
        updated_at: '2026-05-24T00:00:00Z',
        body: '**Author...',
      })

    // outbound POST
    await prCommentMirrorService.runOutbound('c1', 'CREATE')
    expect(prCommentMirrorRepository.resolvePlaceholder).toHaveBeenCalled()

    // simulate echo webhook arriving with the same externalId
    ;(prCommentMirrorRepository.findByExternal as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
    })

    await prCommentMirrorService.runInbound({
      event: 'issue_comment',
      action: 'created',
      workspaceId: 'w1',
      taskId: 't1',
      pullRequestId: 'pr1',
      raw: {
        comment: {
          id: 999,
          node_id: 'IC_x',
          html_url: 'https://...',
          body: '**Author...',
          updated_at: '2026-05-24T00:00:00Z',
          user: { id: 1, login: 'foo', type: 'User', avatar_url: '' },
        },
      },
    })
    // Echo path: commentRepository.create must NOT have been called by inbound
    expect(commentRepository.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test until pass**

Run: `npx jest __tests__/integration/pr-mirror-flow.test.ts -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add __tests__/integration/pr-mirror-flow.test.ts package.json package-lock.json
git commit -m "test(pr-mirror): integration test for echo round-trip [LUM-90]"
```

---

### Task 21: Full type & test sweep

- [ ] **Step 1: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no new errors. Fix any introduced.

- [ ] **Step 2: Run the whole test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 3: Lint**

Run: `npx eslint . --ext .ts,.tsx`
Expected: no errors related to the new files.

- [ ] **Step 4: If anything fails, fix in place and commit fixes**

```bash
git commit -am "fix(pr-mirror): typecheck/lint sweep [LUM-90]"
```

---

### Task 22: SKILL.md sync check + PR

**Files:**

- Confirm: `.claude/skills/lumo/SKILL.md` — verify no CLI changes were made that require a SKILL.md update (this feature is server-side, so no CLI surface change → no SKILL.md update needed)
- Create PR

- [ ] **Step 1: Confirm no CLI changes were touched**

Run: `git diff main --stat -- cli/`
Expected: no output (no files under `cli/` modified). If anything appears, update `.claude/skills/lumo/SKILL.md` accordingly per the CLAUDE.md "CLI & Skills 同步" rule.

- [ ] **Step 2: Push branch and open PR**

Branch already named per convention (`lumo/LUM-90-...`); push and create PR titled `feat: PR ↔ task comment bidirectional mirror [LUM-90]`. PR description must include the post-deploy steps from the spec's Deployment Checklist (§7):

```
This PR ships the schema + service + handlers. After merge:

Production migration: this PR adds a new required column (Comment.deletedAt with default-null, safe) and 2 new tables. CI/CD `prisma migrate deploy` handles it; verify with `prisma migrate status` against prod after deploy.

GitHub App configuration:
- In github.com/organizations/<org>/settings/apps/<app>/permissions → add subscription to "Issue comment", "Pull request review comment"
- "Pull request review" already subscribed — no change

Manual verification on the Lumo repo after deploy:
- Open a PR linked to a Lumo task (e.g. with branch `lumo/<task-id>-...`)
- Post one of each kind: PR conversation comment, review with state, line-level review comment → verify each mirrors to the task with correct header
- From the task, reply to a mirrored comment → verify it appears on the PR
- Edit and delete one of each → verify the round-trip
```

- [ ] **Step 3: Verify migration applied to production**

After CI/CD completes:

```bash
DOTENV_CONFIG_PATH=.env.production npx prisma migrate status
```

Expected: `Database schema is up to date!`

If migration did not apply automatically, see CLAUDE.md "Database Migrations / Production" — get explicit user authorization before running `prisma migrate deploy` against prod.

---

## Self-Review Notes

- **Spec coverage check:** §1 schema → Tasks 1–4. §2 outbound → Tasks 8–11. §3 inbound → Tasks 12–15. §4 echo + conflict → woven into Tasks 12, 14, 15. §5 retry + dead-letter → Task 19 (now drain-on-event, no cron). §6 testing → tests inside every task plus Task 20 integration. §7 deployment checklist → Task 22. Both open questions (Actor model, Comment soft-delete) resolved during plan write-up and locked into Task 1 / Task 2.
- **Placeholder scan:** no TBDs. The `commentUrl` value in Task 9's `buildOutboundBody` is passed as empty string with a noted comment — acceptable for MVP since the prefix link is best-effort (we don't have a clean way to derive the per-comment URL without the workspace slug and task identifier flowing through the call chain; a follow-up can enrich it).
- **Type consistency:** `OutboundActorKind` is the enum name used in schema (Task 1) and code (Tasks 8–11). `PrCommentSource` values `ISSUE | REVIEW | REVIEW_LINE` are used consistently. `SyncDirection.OUTBOUND | INBOUND` consistent.
- **Known concessions:**
  - Task 17 collapses the per-inbound-event Prisma `$transaction` into separate sequential writes (Comment + Mirror). The trade-off is acknowledged in the task body — duplicate-detection in the next echo path covers the race.
  - Task 19 trades cron-bounded retry latency for "drained on next activity." A workspace with zero further activity leaves DEAD_LETTER / PENDING jobs sitting indefinitely. Acceptable for MVP because (a) failures past 3 attempts are rare, (b) any next webhook on the same PR drains, (c) post-MVP we can add a low-frequency safety-net cron.
  - GitHub review-line threads of depth ≥3 (replies to replies on the same diff line) all chain via `in_reply_to_id`, but Lumo's `Comment.parentId` only allows depth 1. Task 13's parent resolver returns the depth-1 parent in those cases, flattening the chain into siblings. Spec to update post-MVP if real users complain.

## Verification Pass Log

Before kicking off subagent execution, a plan-verification pass surfaced these mismatches (all fixed inline above before commit):

1. **getGithubInstallationToken signature** — actual: `()` returns global Lumo App token. Plan originally called it with `(workspaceId, repo)` in 3 places. Fixed.
2. **memberRepository.findByActorId signature** — actual: `(actorId) → { id, workspaceId } | null`, no displayName. Plan originally tried to "add" it with a different signature. Fixed: use existing method; derive displayName via Clerk SDK with "Someone" fallback.
3. **taskRepository.findById / findForComment** — `findById` does exist but `findForComment` (`TASK_COMMENT_SELECT`) returns exactly the fields needed for `notifyMentionsForMirror`. Fixed: use `findForComment`.
4. **vercel cron `*/1 * * * *`** — Hobby-tier incompatible AND introduces a dependency we don't strictly need. Eliminated entirely; replaced with drain-on-event (Task 19 rewritten).
5. **notification.repository.ts:160** — reads `prisma.comment.findMany` directly; called out as a known offender in Task 2 step 5.
