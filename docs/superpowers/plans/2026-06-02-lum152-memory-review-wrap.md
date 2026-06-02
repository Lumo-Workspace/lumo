# memory-review wrap section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "记忆审阅" section to `lumo session wrap` that lists Layer1 memories created in the current session and lets the user delete noise / promote valuable ones to project scope, deduped by a per-session watermark.

**Architecture:** Mirror LUM-151's progress-comment chain end-to-end — a `WrapSection` in the CLI backed by a GET draft endpoint + a POST apply endpoint, a `sessionService` orchestration pair, and thin repository methods. Dedup via a new nullable `Session.lastMemoryReviewAt` column (same pattern as `lastProgressCommentAt`). Delete/promote run server-side in one atomic, session-scoped batch endpoint — never per-id from the client.

**Tech Stack:** Next.js 14 App Router (route handlers), Prisma/Postgres, Zod, TypeScript strict (`exactOptionalPropertyTypes` on), Jest (node env), commander-based CLI under `cli/`.

**Spec:** `docs/superpowers/specs/2026-06-02-lum152-memory-review-wrap-design.md`

**Branch:** `lumo/LUM-152-memory-review-wrap` (already created off origin/main).

---

## File Map

| File                                                                     | Create/Modify        | Responsibility                                                                      |
| ------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                   | Modify               | add `Session.lastMemoryReviewAt DateTime?`                                          |
| `prisma/migrations/<ts>_add_session_last_memory_review_at/migration.sql` | Create (via migrate) | the additive column                                                                 |
| `lib/repositories/memory.repository.ts`                                  | Modify               | `findBySourceSessionId(sessionId, since?)`                                          |
| `lib/repositories/session.repository.ts`                                 | Modify               | `setLastMemoryReviewAt`; add `lastMemoryReviewAt` to `findProgressContextForMember` |
| `lib/services/session.service.ts`                                        | Modify               | `getSessionMemoryDraft`, `applyMemoryReview` + types                                |
| `app/api/sessions/[sessionId]/session-memories/route.ts`                 | Create               | GET draft (thin)                                                                    |
| `app/api/sessions/[sessionId]/memory-review/route.ts`                    | Create               | POST apply (thin, Zod)                                                              |
| `cli/src/lib/session-memory-api.ts`                                      | Create               | CLI fetch/apply client                                                              |
| `cli/src/lib/memory-content.ts`                                          | Modify               | `formatMemoryReviewList(rows)`                                                      |
| `cli/src/commands/wrap/memory-review-section.ts`                         | Create               | `MemoryReviewSection implements WrapSection`                                        |
| `cli/src/commands/session-wrap.ts`                                       | Modify               | add section to the panel                                                            |
| `.claude/skills/lumo/SKILL.md`                                           | Modify               | document the new section                                                            |
| `__tests__/memory.repository.test.ts`                                    | Modify               | repo test                                                                           |
| `__tests__/lib/services/session-memory-review.test.ts`                   | Create               | service tests                                                                       |
| `__tests__/api/sessions/memory-review-route.test.ts`                     | Create               | route tests                                                                         |
| `__tests__/cli/session-memory-api.test.ts`                               | Create               | CLI client tests                                                                    |
| `__tests__/cli/memory-review-section.test.ts`                            | Create               | section tests                                                                       |

**Type contracts (defined once, reused across tasks):**

```ts
// returned by GET /api/sessions/[id]/session-memories
interface MemoryDraftRow {
  id: string
  scope: 'TASK' | 'PROJECT'
  category: 'TRAP' | 'DECISION' | 'CONVENTION' | 'PROCEDURAL'
  content: unknown
  createdByMemberId: string | null
}
interface MemoryReviewDraft {
  taskIdentifier: string | null
  memories: MemoryDraftRow[]
  watermark: string | null // newest createdAt, ISO; null when empty
}
// POST body
interface MemoryReviewPayload {
  watermark: string // ISO
  deleteIds: string[]
  promoteIds: string[]
}
// POST result
interface MemoryReviewResult {
  deleted: number
  promoted: number
}
```

---

## Task 1: Add `Session.lastMemoryReviewAt` column

**Files:**

- Modify: `prisma/schema.prisma` (the `model Session` block, near line 1346 where `lastProgressCommentAt` lives)
- Create: migration via `prisma migrate dev`

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, in `model Session`, directly under `lastProgressCommentAt DateTime?`:

```prisma
  lastMemoryReviewAt    DateTime?
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_session_last_memory_review_at`
Expected: creates `prisma/migrations/<ts>_add_session_last_memory_review_at/migration.sql` containing `ALTER TABLE "Session" ADD COLUMN "lastMemoryReviewAt" TIMESTAMP(3);`, applies it, and regenerates the client.

> If `migrate dev` hits P3008/P3012 checksum drift on a previously-applied migration, use the hand-write-SQL + `db execute` + `migrate resolve --applied` workaround from CLAUDE.md. **Never** `migrate reset` or direct-edit `_prisma_migrations`.

- [ ] **Step 3: Verify the client picks up the field**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: no errors; `lastMemoryReviewAt` is now on the Prisma `Session` type.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Session.lastMemoryReviewAt for memory review watermark [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `memoryRepository.findBySourceSessionId`

**Files:**

- Modify: `lib/repositories/memory.repository.ts` (add after `findByTaskIdWithSession`, ~line 113)
- Test: `__tests__/memory.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/memory.repository.test.ts`:

```ts
describe('memoryRepository.findBySourceSessionId', () => {
  it('filters by sourceSessionId, oldest first, no since', async () => {
    mockFindMany.mockResolvedValue([{ id: 'm1' }])
    const rows = await memoryRepository.findBySourceSessionId('s1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceSessionId: 's1' },
        orderBy: { createdAt: 'asc' },
      })
    )
    expect(rows).toEqual([{ id: 'm1' }])
  })

  it('adds a createdAt gt filter when since is given', async () => {
    mockFindMany.mockResolvedValue([])
    const since = new Date('2026-06-01T10:00:00.000Z')
    await memoryRepository.findBySourceSessionId('s1', since)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceSessionId: 's1', createdAt: { gt: since } },
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/memory.repository.test.ts -t findBySourceSessionId`
Expected: FAIL — `memoryRepository.findBySourceSessionId is not a function`.

- [ ] **Step 3: Implement**

In `lib/repositories/memory.repository.ts`, after `findByTaskIdWithSession` (~line 113):

```ts
  /**
   * Memories sedimented by a specific Claude Code session (Layer 1 sets
   * sourceSessionId; Layer 2 leaves it null so it's naturally excluded).
   * `since` (the review watermark) filters to rows created strictly after it.
   * Oldest-first so the wrap list reads in the order they were learned.
   */
  async findBySourceSessionId(sessionId: string, since?: Date) {
    return prisma.memory.findMany({
      where: {
        sourceSessionId: sessionId,
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: MEMORY_ROW_SELECT,
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/memory.repository.test.ts -t findBySourceSessionId`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/memory.repository.ts __tests__/memory.repository.test.ts
git commit -m "feat: memoryRepository.findBySourceSessionId [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: session repository watermark read + write

**Files:**

- Modify: `lib/repositories/session.repository.ts` (`findProgressContextForMember` ~line 178, add `setLastMemoryReviewAt` after `setLastProgressCommentAt` ~line 219)
- Test: `__tests__/lib/repositories/session-repository-memory-review.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/repositories/session-repository-memory-review.test.ts`:

```ts
/** @jest-environment node */
const mockUpdate = jest.fn()
const mockFindFirst = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    session: {
      update: (...a: any[]) => mockUpdate(...a),
      findFirst: (...a: any[]) => mockFindFirst(...a),
    },
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'

beforeEach(() => jest.clearAllMocks())

describe('sessionRepository.setLastMemoryReviewAt', () => {
  it('updates the watermark column for the session', async () => {
    mockUpdate.mockResolvedValue({ id: 's1' })
    const at = new Date('2026-06-01T10:00:00.000Z')
    await sessionRepository.setLastMemoryReviewAt('s1', at)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { lastMemoryReviewAt: at },
      select: { id: true },
    })
  })
})

describe('sessionRepository.findProgressContextForMember', () => {
  it('returns lastMemoryReviewAt alongside the progress watermark', async () => {
    mockFindFirst.mockResolvedValue({
      lastProgressCommentAt: null,
      lastMemoryReviewAt: new Date('2026-06-01T09:00:00.000Z'),
      task: null,
    })
    const ctx = await sessionRepository.findProgressContextForMember('s1', 'm1')
    expect(ctx).toMatchObject({
      lastMemoryReviewAt: new Date('2026-06-01T09:00:00.000Z'),
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/repositories/session-repository-memory-review.test.ts`
Expected: FAIL — `setLastMemoryReviewAt is not a function` / `lastMemoryReviewAt` missing on result.

- [ ] **Step 3: Implement**

In `lib/repositories/session.repository.ts`, extend the `findProgressContextForMember` select and return type. Change the select block to add `lastMemoryReviewAt: true`:

```ts
      select: {
        lastProgressCommentAt: true,
        lastMemoryReviewAt: true,
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
```

Extend the declared return type to add `lastMemoryReviewAt: Date | null` and the return object to add `lastMemoryReviewAt: row.lastMemoryReviewAt`.

Then after `setLastProgressCommentAt` (~line 219) add:

```ts
  /** Advance the memory-review watermark after a wrap applies a review. */
  async setLastMemoryReviewAt(sessionId: string, at: Date) {
    return prisma.session.update({
      where: { id: sessionId },
      data: { lastMemoryReviewAt: at },
      select: { id: true },
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/repositories/session-repository-memory-review.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/session.repository.ts __tests__/lib/repositories/session-repository-memory-review.test.ts
git commit -m "feat: session repo memory-review watermark read/write [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `sessionService.getSessionMemoryDraft`

**Files:**

- Modify: `lib/services/session.service.ts` (add types near line 59; add method after `getSessionProgressDraft`, ~line 248)
- Test: `__tests__/lib/services/session-memory-review.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/services/session-memory-review.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findProgressContextForMember: jest.fn(),
    setLastMemoryReviewAt: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findBySourceSessionId: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    applyPlansAtomically: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({ taskService: {} }))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {},
}))

import { sessionService } from '@/lib/services/session.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'

const identity = {
  user: { id: 'ck1' },
  workspace: { id: 'w1', slug: 'lumo', name: 'Lumo' },
  apiKey: { id: 'ak1', name: 'test', prefix: 'test' },
} as never
const memberId = miscRepository.findMemberIdForHook as jest.Mock
const ctx = sessionRepository.findProgressContextForMember as jest.Mock
const findMem = memoryRepository.findBySourceSessionId as jest.Mock
const setWm = sessionRepository.setLastMemoryReviewAt as jest.Mock
const apply = memoryRepository.applyPlansAtomically as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  memberId.mockResolvedValue('m1')
})

describe('getSessionMemoryDraft', () => {
  it('returns empty payload when the session is missing/unowned', async () => {
    ctx.mockResolvedValue(null)
    const r = await sessionService.getSessionMemoryDraft({
      identity,
      sessionId: 's1',
    })
    expect(r).toEqual({ taskIdentifier: null, memories: [], watermark: null })
    expect(findMem).not.toHaveBeenCalled()
  })

  it('lists session memories since the watermark and computes the new watermark', async () => {
    ctx.mockResolvedValue({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      lastProgressCommentAt: null,
      lastMemoryReviewAt: new Date('2026-06-01T09:00:00.000Z'),
    })
    findMem.mockResolvedValue([
      {
        id: 'm1',
        scope: 'TASK',
        category: 'TRAP',
        content: { trigger: 'x' },
        createdByMemberId: null,
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
      },
      {
        id: 'm2',
        scope: 'TASK',
        category: 'DECISION',
        content: { what: 'y' },
        createdByMemberId: null,
        createdAt: new Date('2026-06-01T11:00:00.000Z'),
      },
    ])
    const r = await sessionService.getSessionMemoryDraft({
      identity,
      sessionId: 's1',
    })
    expect(findMem).toHaveBeenCalledWith(
      's1',
      new Date('2026-06-01T09:00:00.000Z')
    )
    expect(r.taskIdentifier).toBe('LUM-42')
    expect(r.memories).toEqual([
      {
        id: 'm1',
        scope: 'TASK',
        category: 'TRAP',
        content: { trigger: 'x' },
        createdByMemberId: null,
      },
      {
        id: 'm2',
        scope: 'TASK',
        category: 'DECISION',
        content: { what: 'y' },
        createdByMemberId: null,
      },
    ])
    expect(r.watermark).toBe('2026-06-01T11:00:00.000Z')
  })

  it('null watermark when there are no new memories', async () => {
    ctx.mockResolvedValue({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      lastProgressCommentAt: null,
      lastMemoryReviewAt: null,
    })
    findMem.mockResolvedValue([])
    const r = await sessionService.getSessionMemoryDraft({
      identity,
      sessionId: 's1',
    })
    expect(r.watermark).toBeNull()
    expect(r.memories).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/session-memory-review.test.ts -t getSessionMemoryDraft`
Expected: FAIL — `getSessionMemoryDraft is not a function`.

- [ ] **Step 3: Implement**

In `lib/services/session.service.ts`, add to the imports at top:

```ts
import { memoryRepository } from '@/lib/repositories/memory.repository'
```

Add types after `ProgressDraftResult` (~line 59):

```ts
export interface MemoryDraftRow {
  id: string
  scope: 'TASK' | 'PROJECT'
  category: 'TRAP' | 'DECISION' | 'CONVENTION' | 'PROCEDURAL'
  content: unknown
  createdByMemberId: string | null
}

export interface MemoryReviewDraft {
  taskIdentifier: string | null
  memories: MemoryDraftRow[]
  watermark: string | null
}

interface ApplyMemoryReviewInput {
  identity: VerifyApiKeyResult
  sessionId: string
  watermark: string
  deleteIds: string[]
  promoteIds: string[]
}
```

Add the method to the `sessionService` object after `getSessionProgressDraft` (~line 248):

```ts
  /**
   * Assemble the memory-review draft for `lumo session wrap`: the Layer1
   * memories this session sedimented since the last review. The watermark
   * (newest createdAt, ISO) is carried back on apply so the server advances
   * `lastMemoryReviewAt` to exactly the rows this draft covered. Empty payload
   * when the session is missing/unowned.
   */
  async getSessionMemoryDraft({
    identity,
    sessionId,
  }: SessionScopedInput): Promise<MemoryReviewDraft> {
    const empty: MemoryReviewDraft = {
      taskIdentifier: null,
      memories: [],
      watermark: null,
    }
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) return empty

    const ctx = await sessionRepository.findProgressContextForMember(
      sessionId,
      memberId
    )
    if (!ctx) return empty

    const rows = await memoryRepository.findBySourceSessionId(
      sessionId,
      ctx.lastMemoryReviewAt ?? undefined
    )
    const memories: MemoryDraftRow[] = rows.map(r => ({
      id: r.id,
      scope: r.scope,
      category: r.category,
      content: r.content,
      createdByMemberId: r.createdByMemberId,
    }))
    return {
      taskIdentifier: ctx.taskIdentifier,
      memories,
      watermark:
        rows.length > 0
          ? rows[rows.length - 1]!.createdAt.toISOString()
          : null,
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/session-memory-review.test.ts -t getSessionMemoryDraft`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/session.service.ts __tests__/lib/services/session-memory-review.test.ts
git commit -m "feat: sessionService.getSessionMemoryDraft [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `sessionService.applyMemoryReview`

**Files:**

- Modify: `lib/services/session.service.ts` (add method after `getSessionMemoryDraft`)
- Test: `__tests__/lib/services/session-memory-review.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/services/session-memory-review.test.ts`:

```ts
describe('applyMemoryReview', () => {
  it('throws 404 when the session is missing/unowned', async () => {
    ctx.mockResolvedValue(null)
    await expect(
      sessionService.applyMemoryReview({
        identity,
        sessionId: 's1',
        watermark: '2026-06-01T11:00:00.000Z',
        deleteIds: ['m1'],
        promoteIds: [],
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('drops ids not belonging to this session, runs the rest atomically, advances watermark', async () => {
    ctx.mockResolvedValue({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      lastProgressCommentAt: null,
      lastMemoryReviewAt: null,
    })
    // only m1 and m2 belong to this session; m9 is an outsider id
    findMem.mockResolvedValue([
      {
        id: 'm1',
        scope: 'TASK',
        category: 'TRAP',
        content: {},
        createdByMemberId: null,
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
      },
      {
        id: 'm2',
        scope: 'TASK',
        category: 'DECISION',
        content: {},
        createdByMemberId: null,
        createdAt: new Date('2026-06-01T11:00:00.000Z'),
      },
    ])
    const tx = {} as never
    const del = memoryRepository.delete as jest.Mock
    const upd = memoryRepository.update as jest.Mock
    apply.mockImplementation(
      async (plans: Array<(tx: never) => Promise<void>>) => {
        for (const p of plans) await p(tx)
      }
    )

    const r = await sessionService.applyMemoryReview({
      identity,
      sessionId: 's1',
      watermark: '2026-06-01T11:00:00.000Z',
      deleteIds: ['m1', 'm9'], // m9 not in session → dropped
      promoteIds: ['m2'],
    })

    expect(r).toEqual({ deleted: 1, promoted: 1 })
    expect(del).toHaveBeenCalledWith('m1', tx)
    expect(del).not.toHaveBeenCalledWith('m9', tx)
    expect(upd).toHaveBeenCalledWith('m2', { scope: 'PROJECT' }, tx)
    expect(setWm).toHaveBeenCalledWith(
      's1',
      new Date('2026-06-01T11:00:00.000Z')
    )
    // watermark advances only after the batch
    expect(apply.mock.invocationCallOrder[0]!).toBeLessThan(
      setWm.mock.invocationCallOrder[0]!
    )
  })

  it('advances the watermark even when nothing is deleted/promoted (keep-all)', async () => {
    ctx.mockResolvedValue({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      lastProgressCommentAt: null,
      lastMemoryReviewAt: null,
    })
    findMem.mockResolvedValue([
      {
        id: 'm1',
        scope: 'TASK',
        category: 'TRAP',
        content: {},
        createdByMemberId: null,
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
      },
    ])
    const r = await sessionService.applyMemoryReview({
      identity,
      sessionId: 's1',
      watermark: '2026-06-01T10:00:00.000Z',
      deleteIds: [],
      promoteIds: [],
    })
    expect(r).toEqual({ deleted: 0, promoted: 0 })
    expect(apply).not.toHaveBeenCalled() // no plans → no transaction opened
    expect(setWm).toHaveBeenCalledWith(
      's1',
      new Date('2026-06-01T10:00:00.000Z')
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/session-memory-review.test.ts -t applyMemoryReview`
Expected: FAIL — `applyMemoryReview is not a function`.

- [ ] **Step 3: Implement**

Add to the top imports of `lib/services/session.service.ts`:

```ts
import type { Prisma } from '@prisma/client'
```

Add the method after `getSessionMemoryDraft` in the `sessionService` object:

```ts
  /**
   * Apply a wrap memory review: delete and/or promote-to-PROJECT the chosen
   * memories, then advance `lastMemoryReviewAt`. Authz is session-scoped — ids
   * not sedimented by THIS session are silently dropped, so the endpoint can't
   * be used to touch arbitrary memories. The watermark advances after the batch
   * commits (or immediately on keep-all), so a failed batch leaves the rows
   * eligible for the next wrap.
   */
  async applyMemoryReview({
    identity,
    sessionId,
    watermark,
    deleteIds,
    promoteIds,
  }: ApplyMemoryReviewInput): Promise<{ deleted: number; promoted: number }> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Session not found'), { status: 404 })
    }
    const ctx = await sessionRepository.findProgressContextForMember(
      sessionId,
      memberId
    )
    if (!ctx) {
      throw Object.assign(new Error('Session not found'), { status: 404 })
    }

    // Session-scoped authz: only ids this session sedimented are eligible.
    const ownIds = new Set(
      (await memoryRepository.findBySourceSessionId(sessionId)).map(m => m.id)
    )
    const toDelete = deleteIds.filter(id => ownIds.has(id))
    const toPromote = promoteIds.filter(
      id => ownIds.has(id) && !toDelete.includes(id)
    )

    const plans: Array<(tx: Prisma.TransactionClient) => Promise<void>> = []
    for (const id of toDelete) {
      plans.push(async tx => {
        await memoryRepository.delete(id, tx)
      })
    }
    for (const id of toPromote) {
      plans.push(async tx => {
        await memoryRepository.update(id, { scope: 'PROJECT' }, tx)
      })
    }
    if (plans.length > 0) {
      await memoryRepository.applyPlansAtomically(plans)
    }

    await sessionRepository.setLastMemoryReviewAt(sessionId, new Date(watermark))
    return { deleted: toDelete.length, promoted: toPromote.length }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/session-memory-review.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/services/session.service.ts __tests__/lib/services/session-memory-review.test.ts
git commit -m "feat: sessionService.applyMemoryReview (session-scoped delete/promote) [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: GET `/api/sessions/[sessionId]/session-memories`

**Files:**

- Create: `app/api/sessions/[sessionId]/session-memories/route.ts`
- Test: `__tests__/api/sessions/memory-review-route.test.ts` (create; covers both routes)

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/sessions/memory-review-route.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/services/session.service', () => ({
  sessionService: {
    getSessionMemoryDraft: jest.fn(),
    applyMemoryReview: jest.fn(),
  },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

import { GET } from '@/app/api/sessions/[sessionId]/session-memories/route'
import { POST } from '@/app/api/sessions/[sessionId]/memory-review/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const bearer = verifyBearer as jest.Mock
const getDraft = sessionService.getSessionMemoryDraft as jest.Mock
const apply = sessionService.applyMemoryReview as jest.Mock
const identity = { user: { id: 'ck1' }, workspace: { id: 'w1' } }
const params = (id: string) => ({ params: Promise.resolve({ sessionId: id }) })

beforeEach(() => jest.clearAllMocks())

describe('GET session-memories', () => {
  it('401 without a valid bearer', async () => {
    bearer.mockResolvedValue(null)
    const res = await GET(new Request('http://x'), params('s1'))
    expect(res.status).toBe(401)
  })

  it('returns the draft', async () => {
    bearer.mockResolvedValue(identity)
    getDraft.mockResolvedValue({
      taskIdentifier: 'LUM-42',
      memories: [],
      watermark: null,
    })
    const res = await GET(new Request('http://x'), params('s1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      taskIdentifier: 'LUM-42',
      memories: [],
      watermark: null,
    })
    expect(getDraft).toHaveBeenCalledWith({ identity, sessionId: 's1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/sessions/memory-review-route.test.ts -t "GET session-memories"`
Expected: FAIL — cannot find the route module.

- [ ] **Step 3: Implement**

Create `app/api/sessions/[sessionId]/session-memories/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * GET /api/sessions/[sessionId]/session-memories
 *
 * Returns the memory-review draft for `lumo session wrap`: the Layer1 memories
 * this session sedimented since the last review. Bearer-only, member-scoped (a
 * session that doesn't exist / isn't owned yields an empty payload).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params
  try {
    const result = await sessionService.getSessionMemoryDraft({
      identity,
      sessionId,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error(
      'GET /api/sessions/[sessionId]/session-memories error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api/sessions/memory-review-route.test.ts -t "GET session-memories"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/sessions/'[sessionId]'/session-memories __tests__/api/sessions/memory-review-route.test.ts
git commit -m "feat: GET session-memories route [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: POST `/api/sessions/[sessionId]/memory-review`

**Files:**

- Create: `app/api/sessions/[sessionId]/memory-review/route.ts`
- Test: `__tests__/api/sessions/memory-review-route.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/api/sessions/memory-review-route.test.ts`:

```ts
function postReq(body: unknown): Request {
  return new Request('http://x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST memory-review', () => {
  it('401 without a valid bearer', async () => {
    bearer.mockResolvedValue(null)
    const res = await POST(
      postReq({
        watermark: '2026-06-01T10:00:00.000Z',
        deleteIds: [],
        promoteIds: [],
      }),
      params('s1')
    )
    expect(res.status).toBe(401)
  })

  it('400 on an invalid watermark', async () => {
    bearer.mockResolvedValue(identity)
    const res = await POST(
      postReq({ watermark: 'nope', deleteIds: [], promoteIds: [] }),
      params('s1')
    )
    expect(res.status).toBe(400)
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies the review and returns counts', async () => {
    bearer.mockResolvedValue(identity)
    apply.mockResolvedValue({ deleted: 1, promoted: 0 })
    const res = await POST(
      postReq({
        watermark: '2026-06-01T10:00:00.000Z',
        deleteIds: ['m1'],
        promoteIds: [],
      }),
      params('s1')
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 1, promoted: 0 })
    expect(apply).toHaveBeenCalledWith({
      identity,
      sessionId: 's1',
      watermark: '2026-06-01T10:00:00.000Z',
      deleteIds: ['m1'],
      promoteIds: [],
    })
  })

  it('maps a thrown 404 to a 404 response', async () => {
    bearer.mockResolvedValue(identity)
    apply.mockRejectedValue(
      Object.assign(new Error('Session not found'), { status: 404 })
    )
    const res = await POST(
      postReq({
        watermark: '2026-06-01T10:00:00.000Z',
        deleteIds: [],
        promoteIds: [],
      }),
      params('s1')
    )
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/sessions/memory-review-route.test.ts -t "POST memory-review"`
Expected: FAIL — cannot find the memory-review route module.

- [ ] **Step 3: Implement**

Create `app/api/sessions/[sessionId]/memory-review/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

const bodySchema = z.object({
  watermark: z.string().datetime(),
  deleteIds: z.array(z.string()).max(200).default([]),
  promoteIds: z.array(z.string()).max(200).default([]),
})

/**
 * POST /api/sessions/[sessionId]/memory-review
 *
 * Apply a wrap memory review: delete and/or promote the chosen memories and
 * advance the dedup watermark in one call. Bearer-only, member-scoped; the
 * service drops any id not sedimented by this session. 404 if the session is
 * missing / not owned.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 }
    )
  }

  try {
    const result = await sessionService.applyMemoryReview({
      identity,
      sessionId,
      watermark: parsed.data.watermark,
      deleteIds: parsed.data.deleteIds,
      promoteIds: parsed.data.promoteIds,
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 404 || status === 409 || status === 500) {
      const message = error instanceof Error ? error.message : 'Error'
      return NextResponse.json({ error: message }, { status })
    }
    console.error('POST /api/sessions/[sessionId]/memory-review error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api/sessions/memory-review-route.test.ts`
Expected: PASS (GET + POST blocks).

- [ ] **Step 5: Commit**

```bash
git add app/api/sessions/'[sessionId]'/memory-review __tests__/api/sessions/memory-review-route.test.ts
git commit -m "feat: POST memory-review route [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: CLI client `session-memory-api.ts`

**Files:**

- Create: `cli/src/lib/session-memory-api.ts`
- Test: `__tests__/cli/session-memory-api.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/session-memory-api.test.ts`:

```ts
/**
 * @jest-environment node
 */
import {
  fetchMemoryDraft,
  applyMemoryReview,
  type ServerMemoryDraft,
} from '@/cli/src/lib/session-memory-api'

const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

beforeEach(() => {
  ;(global as { fetch?: unknown }).fetch = jest.fn()
})

it('GETs the session-memories endpoint with bearer auth', async () => {
  const draft: ServerMemoryDraft = {
    taskIdentifier: 'LUM-42',
    memories: [],
    watermark: null,
  }
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => draft,
  })
  const r = await fetchMemoryDraft(creds, 'sess_1')
  expect(r).toEqual(draft)
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://x/api/sessions/sess_1/session-memories')
  expect(init.headers.Authorization).toBe('Bearer t')
})

it('throws on non-200 draft fetch', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => ({}),
  })
  await expect(fetchMemoryDraft(creds, 'sess_1')).rejects.toThrow(/HTTP 500/)
})

it('POSTs the review payload and returns counts', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ deleted: 1, promoted: 2 }),
  })
  const r = await applyMemoryReview(creds, 'sess_1', {
    watermark: '2026-06-01T10:00:00.000Z',
    deleteIds: ['m1'],
    promoteIds: ['m2', 'm3'],
  })
  expect(r).toEqual({ deleted: 1, promoted: 2 })
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://x/api/sessions/sess_1/memory-review')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({
    watermark: '2026-06-01T10:00:00.000Z',
    deleteIds: ['m1'],
    promoteIds: ['m2', 'm3'],
  })
})

it('surfaces the server error message on non-2xx apply', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({ error: 'Session not found' }),
  })
  await expect(
    applyMemoryReview(creds, 'sess_1', {
      watermark: '2026-06-01T10:00:00.000Z',
      deleteIds: [],
      promoteIds: [],
    })
  ).rejects.toThrow('Session not found')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/session-memory-api.test.ts`
Expected: FAIL — cannot find `@/cli/src/lib/session-memory-api`.

- [ ] **Step 3: Implement**

Create `cli/src/lib/session-memory-api.ts` (mirrors `progress-comment-api.ts`):

```ts
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

export interface ServerMemoryRow {
  id: string
  scope: 'TASK' | 'PROJECT'
  category: 'TRAP' | 'DECISION' | 'CONVENTION' | 'PROCEDURAL'
  content: unknown
  createdByMemberId: string | null
}

export interface ServerMemoryDraft {
  taskIdentifier: string | null
  memories: ServerMemoryRow[]
  watermark: string | null
}

export interface MemoryReviewPayload {
  watermark: string
  deleteIds: string[]
  promoteIds: string[]
}

function base(creds: Credentials): string {
  return trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
}

/** GET the memory-review draft for the session. Throws on transport / non-200. */
export async function fetchMemoryDraft(
  creds: Credentials,
  sessionId: string
): Promise<ServerMemoryDraft> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/session-memories`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 401)
    throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (!res.ok) throw new Error(`memory draft fetch failed (HTTP ${res.status})`)
  return (await res.json()) as ServerMemoryDraft
}

/** POST the review (deletes + promotes + watermark). Throws server message on non-2xx. */
export async function applyMemoryReview(
  creds: Credentials,
  sessionId: string,
  payload: MemoryReviewPayload
): Promise<{ deleted: number; promoted: number }> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/memory-review`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (res.status === 401)
    throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (!res.ok) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // body wasn't JSON
    }
    throw new Error(serverMsg ?? `memory review failed (HTTP ${res.status})`)
  }
  return (await res.json()) as { deleted: number; promoted: number }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/session-memory-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/session-memory-api.ts __tests__/cli/session-memory-api.test.ts
git commit -m "feat: CLI session-memory-api client [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `formatMemoryReviewList` in memory-content.ts

**Files:**

- Modify: `cli/src/lib/memory-content.ts` (export a numbered formatter; reuse the existing private `headline`)
- Test: `__tests__/cli/memory-review-section.test.ts` (create; this task covers the formatter, Task 10 the section)

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/memory-review-section.test.ts` with just the formatter block for now:

```ts
/**
 * @jest-environment node
 */
import { formatMemoryReviewList } from '@/cli/src/lib/memory-content'

describe('formatMemoryReviewList', () => {
  it('numbers rows from 1 with [scope] category and a headline', () => {
    const out = formatMemoryReviewList([
      {
        id: 'm1',
        scope: 'TASK',
        category: 'TRAP',
        content: { trigger: 'worktree 缺软链' },
        createdByMemberId: null,
      },
      {
        id: 'm2',
        scope: 'TASK',
        category: 'DECISION',
        content: { what: '用 dynamic import' },
        createdByMemberId: null,
      },
    ])
    const lines = out.split('\n')
    expect(lines[0]).toContain('1.')
    expect(lines[0]).toContain('[TASK]')
    expect(lines[0]).toContain('TRAP')
    expect(lines[0]).toContain('worktree 缺软链')
    expect(lines[1]).toContain('2.')
    expect(lines[1]).toContain('用 dynamic import')
  })

  it('renders (unparseable) when the headline field is missing', () => {
    const out = formatMemoryReviewList([
      {
        id: 'm1',
        scope: 'TASK',
        category: 'TRAP',
        content: {},
        createdByMemberId: null,
      },
    ])
    expect(out).toContain('(unparseable)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/memory-review-section.test.ts -t formatMemoryReviewList`
Expected: FAIL — `formatMemoryReviewList` is not exported.

- [ ] **Step 3: Implement**

In `cli/src/lib/memory-content.ts`, after `formatMemoryList` (~line 106), add (reuses the existing module-private `headline`):

```ts
/** Numbered review list: `  N. [SCOPE] CATEGORY  headline`. 1-indexed. */
export function formatMemoryReviewList(rows: MemoryRowLike[]): string {
  return rows
    .map(
      (r, i) =>
        `  ${i + 1}. [${r.scope}] ${r.category}  ${headline(r.category, r.content)}`
    )
    .join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/memory-review-section.test.ts -t formatMemoryReviewList`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/memory-content.ts __tests__/cli/memory-review-section.test.ts
git commit -m "feat: formatMemoryReviewList numbered formatter [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: `MemoryReviewSection`

**Files:**

- Create: `cli/src/commands/wrap/memory-review-section.ts`
- Test: `__tests__/cli/memory-review-section.test.ts` (append section blocks)

The instruction grammar (one line): empty/`s` → keep all (skip mutations but still advance watermark unless skipped); `d 1,3` → delete rows 1 and 3; `p 2` → promote row 2; combinable `d 1,3 p 2`. Out-of-range indices are ignored with a warning. Distinction: `s` = skip the whole section (no watermark advance); empty Enter = keep all + advance watermark (reviewed, nothing to change).

- [ ] **Step 1: Write the failing test**

Append to `__tests__/cli/memory-review-section.test.ts` (add mocks at the very top of the file, above the existing imports):

```ts
jest.mock('@/cli/src/lib/session-memory-api', () => ({
  fetchMemoryDraft: jest.fn(),
  applyMemoryReview: jest.fn(),
}))
jest.mock('@/cli/src/lib/line-prompt', () => ({ promptLine: jest.fn() }))
```

Then append these blocks (imports go next to the existing `formatMemoryReviewList` import):

```ts
import { MemoryReviewSection } from '@/cli/src/commands/wrap/memory-review-section'
import {
  fetchMemoryDraft,
  applyMemoryReview,
} from '@/cli/src/lib/session-memory-api'
import { promptLine } from '@/cli/src/lib/line-prompt'

const fetchDraft = fetchMemoryDraft as jest.Mock
const apply = applyMemoryReview as jest.Mock
const prompt = promptLine as jest.Mock
const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

const draft = {
  taskIdentifier: 'LUM-42',
  memories: [
    {
      id: 'm1',
      scope: 'TASK',
      category: 'TRAP',
      content: { trigger: 'a' },
      createdByMemberId: null,
    },
    {
      id: 'm2',
      scope: 'TASK',
      category: 'DECISION',
      content: { what: 'b' },
      createdByMemberId: null,
    },
    {
      id: 'm3',
      scope: 'TASK',
      category: 'CONVENTION',
      content: { rule: 'c' },
      createdByMemberId: null,
    },
  ],
  watermark: '2026-06-01T11:00:00.000Z',
}

async function prepared() {
  fetchDraft.mockResolvedValue(draft)
  const s = new MemoryReviewSection({ creds, sessionId: 's1' })
  await s.prepare()
  return s
}

describe('MemoryReviewSection.prepare', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => jest.restoreAllMocks())

  it('returns false when there are no new memories', async () => {
    fetchDraft.mockResolvedValue({
      taskIdentifier: 'LUM-42',
      memories: [],
      watermark: null,
    })
    const s = new MemoryReviewSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(false)
  })

  it('returns true when the session has new memories', async () => {
    fetchDraft.mockResolvedValue(draft)
    const s = new MemoryReviewSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(true)
  })
})

describe('MemoryReviewSection.run', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => jest.restoreAllMocks())

  it('--yes keeps all and advances the watermark with empty id lists', async () => {
    const s = await prepared()
    apply.mockResolvedValue({ deleted: 0, promoted: 0 })
    await s.run({ yes: true, dryRun: false })
    expect(prompt).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledWith(creds, 's1', {
      watermark: '2026-06-01T11:00:00.000Z',
      deleteIds: [],
      promoteIds: [],
    })
  })

  it('dry-run never calls apply', async () => {
    const s = await prepared()
    await s.run({ yes: false, dryRun: true })
    expect(apply).not.toHaveBeenCalled()
  })

  it('empty Enter keeps all and advances watermark', async () => {
    const s = await prepared()
    prompt.mockResolvedValueOnce('')
    apply.mockResolvedValue({ deleted: 0, promoted: 0 })
    await s.run({ yes: false, dryRun: false })
    expect(apply).toHaveBeenCalledWith(creds, 's1', {
      watermark: '2026-06-01T11:00:00.000Z',
      deleteIds: [],
      promoteIds: [],
    })
  })

  it('s skips the section without advancing watermark', async () => {
    const s = await prepared()
    prompt.mockResolvedValueOnce('s')
    await s.run({ yes: false, dryRun: false })
    expect(apply).not.toHaveBeenCalled()
  })

  it('parses "d 1,3 p 2" into the right id lists', async () => {
    const s = await prepared()
    prompt.mockResolvedValueOnce('d 1,3 p 2')
    apply.mockResolvedValue({ deleted: 2, promoted: 1 })
    await s.run({ yes: false, dryRun: false })
    expect(apply).toHaveBeenCalledWith(creds, 's1', {
      watermark: '2026-06-01T11:00:00.000Z',
      deleteIds: ['m1', 'm3'],
      promoteIds: ['m2'],
    })
  })

  it('ignores out-of-range indices', async () => {
    const s = await prepared()
    prompt.mockResolvedValueOnce('d 9')
    apply.mockResolvedValue({ deleted: 0, promoted: 0 })
    await s.run({ yes: false, dryRun: false })
    expect(apply).toHaveBeenCalledWith(creds, 's1', {
      watermark: '2026-06-01T11:00:00.000Z',
      deleteIds: [],
      promoteIds: [],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/memory-review-section.test.ts -t MemoryReviewSection`
Expected: FAIL — cannot find `memory-review-section`.

- [ ] **Step 3: Implement**

Create `cli/src/commands/wrap/memory-review-section.ts`:

```ts
import type { WrapSection, WrapRunOpts } from '../../lib/wrap-panel'
import { sanitizeField } from '../../lib/sanitize'
import { promptLine } from '../../lib/line-prompt'
import { formatMemoryReviewList } from '../../lib/memory-content'
import {
  fetchMemoryDraft,
  applyMemoryReview,
  type ServerMemoryDraft,
} from '../../lib/session-memory-api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

/** Parse a one-line review instruction into 0-based row indices. */
export function parseReviewInstruction(line: string): {
  deleteIdx: number[]
  promoteIdx: number[]
} {
  const result = { deleteIdx: [] as number[], promoteIdx: [] as number[] }
  // tokens: "d 1,3" / "p 2" — letter then a comma/space list of numbers
  const re = /([dp])\s*([\d,\s]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const nums = m[2]!
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => parseInt(s, 10) - 1)
      .filter(n => Number.isInteger(n) && n >= 0)
    if (m[1]!.toLowerCase() === 'd') result.deleteIdx.push(...nums)
    else result.promoteIdx.push(...nums)
  }
  return result
}

/**
 * Wrap-panel section that lists the Layer1 memories this session sedimented and
 * lets the user delete noise / promote keepers to project scope. Keeps its own
 * draft state between prepare() and run(). Dedup is server-side via watermark.
 */
export class MemoryReviewSection implements WrapSection {
  title = '记忆审阅'
  private draft: ServerMemoryDraft | null = null

  constructor(private deps: { creds: Credentials; sessionId: string }) {}

  async prepare(): Promise<boolean> {
    this.draft = await fetchMemoryDraft(this.deps.creds, this.deps.sessionId)
    return this.draft.memories.length > 0
  }

  async run(opts: WrapRunOpts): Promise<void> {
    const draft = this.draft
    if (!draft || !draft.watermark || draft.memories.length === 0) return

    process.stdout.write(
      `本次会话新增了这 ${draft.memories.length} 条 memory：\n`
    )
    process.stdout.write(
      `${sanitizeField(formatMemoryReviewList(draft.memories))}\n`
    )

    if (opts.dryRun) {
      process.stdout.write('(dry-run，未改动)\n')
      return
    }

    if (opts.yes) {
      await this.apply(draft.watermark, [], [])
      return
    }

    const line = (
      await promptLine(
        '[回车] 全部保留  [d 1,3] 删除  [p 2] 提升到项目级  [s] 跳过 > '
      )
    ).trim()

    if (line.toLowerCase() === 's') {
      process.stdout.write('已跳过本节。\n')
      return
    }
    if (line === '') {
      await this.apply(draft.watermark, [], [])
      return
    }

    const { deleteIdx, promoteIdx } = parseReviewInstruction(line)
    const inRange = (n: number) => n >= 0 && n < draft.memories.length
    const deleteIds = deleteIdx.filter(inRange).map(i => draft.memories[i]!.id)
    const promoteIds = promoteIdx
      .filter(inRange)
      .map(i => draft.memories[i]!.id)
      .filter(id => !deleteIds.includes(id))
    await this.apply(draft.watermark, deleteIds, promoteIds)
  }

  private async apply(
    watermark: string,
    deleteIds: string[],
    promoteIds: string[]
  ): Promise<void> {
    const { deleted, promoted } = await applyMemoryReview(
      this.deps.creds,
      this.deps.sessionId,
      { watermark, deleteIds, promoteIds }
    )
    process.stdout.write(
      `已删除 ${deleted} 条，提升 ${promoted} 条到项目级。\n`
    )
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/memory-review-section.test.ts`
Expected: PASS (formatter + prepare + run blocks).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/wrap/memory-review-section.ts __tests__/cli/memory-review-section.test.ts
git commit -m "feat: MemoryReviewSection for session wrap [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Wire the section into `session wrap`

**Files:**

- Modify: `cli/src/commands/session-wrap.ts`

- [ ] **Step 1: Add the import + section**

In `cli/src/commands/session-wrap.ts`, add the import:

```ts
import { MemoryReviewSection } from './wrap/memory-review-section'
```

Change the sections array (line 36) from:

```ts
const sections = [new ProgressCommentSection({ creds, sessionId })]
```

to:

```ts
const sections = [
  new ProgressCommentSection({ creds, sessionId }),
  new MemoryReviewSection({ creds, sessionId }),
]
```

Update the JSDoc on `sessionWrap` (lines 10-17) to note it now has two sections (progress comment + memory review), dropping the "LUM-152's memory-review section slots in" forward-reference.

- [ ] **Step 2: Verify types + full CLI test suite**

Run: `npx tsc --noEmit && npx jest __tests__/cli`
Expected: no type errors; all CLI tests pass.

- [ ] **Step 3: Commit**

```bash
git add cli/src/commands/session-wrap.ts
git commit -m "feat: add memory-review section to session wrap panel [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Update SKILL.md

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md` (the `lumo session wrap` section)

- [ ] **Step 1: Document the new section**

In `.claude/skills/lumo/SKILL.md`, find the `### \`lumo session wrap ...\`` section. After the existing description of the progress-comment behavior, add a paragraph describing the memory-review section:

```markdown
The panel now has two sections, run in order:

1. **进度评论** — drafts a progress comment from unposted `turnSummary` rows (as above).
2. **记忆审阅** — lists the Layer1 memories this session sedimented since the
   last review (deduped by a per-session watermark). For each new memory it
   shows `[SCOPE] CATEGORY  headline`, numbered from 1. You curate with a single
   line: `d 1,3` deletes rows 1 and 3, `p 2` promotes row 2 to project scope,
   and they combine (`d 1,3 p 2`); **Enter keeps all**, `s` skips the section.
   Keeping all (Enter or `--yes`) still advances the watermark so the next wrap
   won't re-list reviewed memories; `s` leaves them for next time. Out-of-range
   indices are ignored. Deletes/promotes run server-side, scoped to memories
   this session created.

- `--yes`: keep all + advance watermark (no deletes/promotes), for both sections.
- `--dry-run`: print both drafts; never post, never mutate, never advance watermarks.
```

Adjust surrounding wording so the section's "v1 has a single section" framing (if present) is removed.

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: document memory-review section in session wrap [LUM-152]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Full verification

- [ ] **Step 1: Types**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: no errors. (Re-run `prisma generate` here in case the client is stale — see CLAUDE.md memory.)

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green, including the 5 new/modified test files.

- [ ] **Step 3: No console.log / lint**

Run: `grep -rn "console.log" cli/src/commands/wrap/memory-review-section.ts cli/src/lib/session-memory-api.ts app/api/sessions/'[sessionId]'/session-memories app/api/sessions/'[sessionId]'/memory-review`
Expected: no matches (route `console.error` in catch blocks is allowed — those mirror the existing routes).

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Manual smoke (optional, requires a live session with sedimented memories)**

```bash
CLAUDE_CODE_SESSION_ID=<this session> lumo session wrap --dry-run
```

Expected: prints the 进度评论 draft then a 记忆审阅 list of this session's Layer1 memories; mutates nothing.

---

## Notes for the implementer

- **`exactOptionalPropertyTypes` is on.** When an interface field can receive `undefined`, declare it `field?: T | undefined`. The `findBySourceSessionId(sessionId, ctx.lastMemoryReviewAt ?? undefined)` call relies on `since?: Date` accepting `undefined` — fine since it's a plain optional param, but watch react-query/service input shapes if you add any. `tsc --noEmit` catches these; jest does not.
- **Don't reach into nested props** (LoD): the service maps repo rows to a flat `MemoryDraftRow` before returning; the CLI never sees Prisma shapes.
- **CLI strings are Chinese, not i18n'd** — react-intl is the web app only. Match the existing wrap-panel Chinese strings.
- **Git safety in worktrees**: if you run this in a worktree, never `git checkout`/`switch`/`reset`/`stash` — stay on `lumo/LUM-152-memory-review-wrap`.
- **Publishing the CLI**: this touches `cli/src` user-facing behavior. Per repo convention, after merge a `cli/package.json` minor bump + manual `cd cli && npm publish` is needed for `lumo update` to deliver it. Note this in the PR description (don't publish from the plan).
- **PR description must note**: requires `prisma migrate deploy` on next deploy (additive nullable column, no data loss, order-safe).
