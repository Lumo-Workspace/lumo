# Session Wrap Progress Comment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `lumo session wrap` command that reads back the current session's per-turn `turnSummary` rows, drafts a single progress comment, and posts it to the bound task after an interactive `[y]发送 / [e]编辑 / [s]跳过` confirmation — with a server-side watermark so re-running never re-posts the same turns.

**Architecture:** Component (CLI `session wrap`) → CLI api helper → API Route (`GET /api/sessions/[sessionId]/turn-summaries`, `POST /api/sessions/[sessionId]/progress-comment`) → Service (`sessionService`) → Repository (`hookEventRepository` / `sessionRepository`) → Prisma. A new nullable `Session.lastProgressCommentAt` column is the dedup watermark. The CLI is structured around a small multi-section "wrap panel" so LUM-152's memory-review section can plug in later with zero rework.

**Tech Stack:** Next.js 14 App Router (route handlers), Prisma, TypeScript strict (+ `exactOptionalPropertyTypes`), Jest, commander (CLI). Bearer auth via `verifyBearer`. Comment creation reuses `commentService.createCommentWithSideEffects`.

---

## File Structure

**Server (create):**

- _(none — all server changes extend existing files)_

**Server (modify):**

- `prisma/schema.prisma` — add `lastProgressCommentAt DateTime?` to `Session`.
- `prisma/migrations/<ts>_add_session_last_progress_comment_at/migration.sql` — generated.
- `lib/repositories/hook-event.repository.ts` — add `findTurnSummariesBySession`.
- `lib/repositories/session.repository.ts` — add `findProgressContextForMember` + `setLastProgressCommentAt`.
- `lib/services/session.service.ts` — add `getSessionProgressDraft` + `postProgressComment`.

**Server (create routes):**

- `app/api/sessions/[sessionId]/turn-summaries/route.ts` — GET draft.
- `app/api/sessions/[sessionId]/progress-comment/route.ts` — POST comment + advance watermark.

**CLI (create):**

- `cli/src/lib/editor.ts` — `$EDITOR` round-trip helper.
- `cli/src/lib/wrap-panel.ts` — `WrapSection` interface + `runWrapPanel` runner.
- `cli/src/lib/progress-comment-api.ts` — fetch helpers for the two new endpoints.
- `cli/src/commands/wrap/progress-comment-section.ts` — `ProgressCommentSection` + `formatProgressBody`.
- `cli/src/commands/session-wrap.ts` — the `lumo session wrap` command entry.

**CLI (modify):**

- `cli/src/index.ts` — register `session wrap` subcommand.

**Docs (modify):**

- `.claude/skills/lumo/SKILL.md` — document `session wrap` + frontmatter triggers.

**Tests (create):**

- `__tests__/lib/repositories/hook-event-turn-summaries.test.ts`
- `__tests__/lib/repositories/session-progress-watermark.test.ts`
- `__tests__/lib/services/session-progress-draft.test.ts`
- `__tests__/lib/services/session-progress-comment.test.ts`
- `__tests__/api/sessions/turn-summaries-route.test.ts`
- `__tests__/api/sessions/progress-comment-route.test.ts`
- `__tests__/cli/editor.test.ts`
- `__tests__/cli/wrap-panel.test.ts`
- `__tests__/cli/progress-comment-section.test.ts`
- `__tests__/cli/session-wrap.test.ts`

---

## Type & API Contract (referenced by every task — keep names exact)

Server `GET /api/sessions/[sessionId]/turn-summaries` response body:

```ts
interface ProgressDraftResponse {
  taskIdentifier: string | null // null when session has no bound task
  taskTitle: string | null
  summaries: { id: string; turnSummary: string; createdAt: string }[] // ISO strings, oldest-first
  watermark: string | null // ISO createdAt of the newest summary; null when summaries is empty
}
```

Server `POST /api/sessions/[sessionId]/progress-comment` request body / response:

```ts
interface PostProgressCommentBody {
  body: string // 1–5000 chars (createCommentSchema)
  watermark: string // ISO date string the CLI carried back from the draft
}
interface PostProgressCommentResponse {
  commentId: string
}
```

Both routes are bearer-only (`verifyBearer`), member-scoped. A session that doesn't exist or belongs to another member → 404 (no enumeration). POST with an unbound session → 409.

---

### Task 1: Schema migration — `Session.lastProgressCommentAt`

**Files:**

- Modify: `prisma/schema.prisma` (the `Session` model, near the other nullable summary columns)

- [ ] **Step 1: Add the column to the Session model**

Find the `Session` model and add this line alongside the existing `summary* `columns (e.g. right after `summaryEventCount`):

```prisma
  /// Watermark for `lumo session wrap`: createdAt of the newest turnSummary
  /// already posted as a progress comment. NULL = nothing posted yet. Turn
  /// summaries with createdAt > this are "unposted" and eligible for the next
  /// wrap draft.
  lastProgressCommentAt DateTime?
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_session_last_progress_comment_at`
Expected: a new folder `prisma/migrations/<ts>_add_session_last_progress_comment_at/` with `migration.sql` containing `ALTER TABLE "Session" ADD COLUMN "lastProgressCommentAt" TIMESTAMP(3);`, and "Your database is now in sync".

> If `migrate dev` hits P3008/P3012 checksum drift on an unrelated prior migration, use the CLAUDE.md drift workaround (hand-write SQL → `prisma db execute` → `migrate resolve --applied`). Do NOT `migrate reset`.

- [ ] **Step 3: Regenerate the client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client". (Required before tsc trusts the new field — see project memory.)

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Session.lastProgressCommentAt watermark column [LUM-151]"
```

---

### Task 2: Repository — `hookEventRepository.findTurnSummariesBySession`

**Files:**

- Modify: `lib/repositories/hook-event.repository.ts`
- Test: `__tests__/lib/repositories/hook-event-turn-summaries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { hookEvent: { findMany: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const findMany = prisma.hookEvent.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('findTurnSummariesBySession', () => {
  it('queries STOP/STOP_FAILURE rows with a non-null turnSummary, oldest-first', async () => {
    findMany.mockResolvedValue([
      {
        id: 'e1',
        turnSummary: '改了 a.ts',
        createdAt: new Date('2026-06-01T10:00:00Z'),
      },
    ])
    const rows = await hookEventRepository.findTurnSummariesBySession('sess_1')
    expect(rows).toHaveLength(1)
    const arg = findMany.mock.calls[0][0]
    expect(arg.where.sessionId).toBe('sess_1')
    expect(arg.where.type.in).toEqual(['STOP', 'STOP_FAILURE'])
    expect(arg.where.turnSummary.not).toBeNull()
    expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
    expect(arg.select).toEqual({ id: true, turnSummary: true, createdAt: true })
  })

  it('adds a createdAt > since filter when since is given', async () => {
    findMany.mockResolvedValue([])
    const since = new Date('2026-06-01T09:00:00Z')
    await hookEventRepository.findTurnSummariesBySession('sess_1', since)
    expect(findMany.mock.calls[0][0].where.createdAt).toEqual({ gt: since })
  })

  it('omits the createdAt filter when since is undefined', async () => {
    findMany.mockResolvedValue([])
    await hookEventRepository.findTurnSummariesBySession('sess_1')
    expect(findMany.mock.calls[0][0].where.createdAt).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/repositories/hook-event-turn-summaries.test.ts`
Expected: FAIL — `findTurnSummariesBySession is not a function`.

- [ ] **Step 3: Implement the method**

Add inside the `hookEventRepository` object in `lib/repositories/hook-event.repository.ts` (after `findByTaskId`):

```ts
  /**
   * Turn summaries for a session, oldest-first. Only STOP / STOP_FAILURE rows
   * carry a turnSummary; `turnSummary IS NOT NULL` drops turns the LLM skipped.
   * `since` (the session's lastProgressCommentAt watermark) excludes already-
   * posted turns so `lumo session wrap` never re-posts the same progress.
   */
  async findTurnSummariesBySession(sessionId: string, since?: Date) {
    return prisma.hookEvent.findMany({
      where: {
        sessionId,
        type: { in: ['STOP', 'STOP_FAILURE'] },
        turnSummary: { not: null },
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, turnSummary: true, createdAt: true },
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/repositories/hook-event-turn-summaries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/hook-event.repository.ts __tests__/lib/repositories/hook-event-turn-summaries.test.ts
git commit -m "feat: hookEventRepository.findTurnSummariesBySession [LUM-151]"
```

---

### Task 3: Repository — session progress context + watermark setter

**Files:**

- Modify: `lib/repositories/session.repository.ts`
- Test: `__tests__/lib/repositories/session-progress-watermark.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { session: { findFirst: jest.fn(), update: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'

const findFirst = prisma.session.findFirst as jest.Mock
const update = prisma.session.update as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('findProgressContextForMember', () => {
  it('returns null when the session is not owned by the member', async () => {
    findFirst.mockResolvedValue(null)
    const r = await sessionRepository.findProgressContextForMember('s1', 'm1')
    expect(r).toBeNull()
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: 's1',
      workspaceMemberId: 'm1',
    })
  })

  it('flattens task identifier and returns the watermark', async () => {
    findFirst.mockResolvedValue({
      lastProgressCommentAt: new Date('2026-06-01T09:00:00Z'),
      task: {
        id: 't1',
        number: 42,
        title: 'Fix bug',
        team: { identifier: 'LUM' },
      },
    })
    const r = await sessionRepository.findProgressContextForMember('s1', 'm1')
    expect(r).toEqual({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Fix bug',
      lastProgressCommentAt: new Date('2026-06-01T09:00:00Z'),
    })
  })

  it('returns null task fields when the session has no binding', async () => {
    findFirst.mockResolvedValue({ lastProgressCommentAt: null, task: null })
    const r = await sessionRepository.findProgressContextForMember('s1', 'm1')
    expect(r).toEqual({
      taskId: null,
      taskIdentifier: null,
      taskTitle: null,
      lastProgressCommentAt: null,
    })
  })
})

describe('setLastProgressCommentAt', () => {
  it('updates the watermark for the session', async () => {
    update.mockResolvedValue({ id: 's1' })
    const at = new Date('2026-06-01T10:00:00Z')
    await sessionRepository.setLastProgressCommentAt('s1', at)
    expect(update.mock.calls[0][0]).toEqual({
      where: { id: 's1' },
      data: { lastProgressCommentAt: at },
      select: { id: true },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/repositories/session-progress-watermark.test.ts`
Expected: FAIL — `findProgressContextForMember is not a function`.

- [ ] **Step 3: Implement both methods**

Add inside the `sessionRepository` object in `lib/repositories/session.repository.ts` (after `findForMemberWithBinding`):

```ts
  /**
   * Member-scoped read for `lumo session wrap`: returns the bound task (flat
   * identifier) plus the progress-comment watermark, or null if the session
   * doesn't exist / belongs to another member. Task fields are null when the
   * session has no binding.
   */
  async findProgressContextForMember(
    sessionId: string,
    workspaceMemberId: string
  ): Promise<{
    taskId: string | null
    taskIdentifier: string | null
    taskTitle: string | null
    lastProgressCommentAt: Date | null
  } | null> {
    const row = await prisma.session.findFirst({
      where: { id: sessionId, workspaceMemberId },
      select: {
        lastProgressCommentAt: true,
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    if (!row) return null
    return {
      taskId: row.task?.id ?? null,
      taskIdentifier: row.task
        ? `${row.task.team.identifier}-${row.task.number}`
        : null,
      taskTitle: row.task?.title ?? null,
      lastProgressCommentAt: row.lastProgressCommentAt,
    }
  },

  /** Advance the progress-comment watermark after a wrap posts a comment. */
  async setLastProgressCommentAt(sessionId: string, at: Date) {
    return prisma.session.update({
      where: { id: sessionId },
      data: { lastProgressCommentAt: at },
      select: { id: true },
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/repositories/session-progress-watermark.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/session.repository.ts __tests__/lib/repositories/session-progress-watermark.test.ts
git commit -m "feat: session repo progress context + watermark setter [LUM-151]"
```

---

### Task 4: Service — `sessionService.getSessionProgressDraft`

**Files:**

- Modify: `lib/services/session.service.ts`
- Test: `__tests__/lib/services/session-progress-draft.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findProgressContextForMember: jest.fn(),
    setLastProgressCommentAt: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findTurnSummariesBySession: jest.fn() },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))

import { sessionService } from '@/lib/services/session.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'

const identity = { user: { id: 'u1' }, workspace: { id: 'w1' } } as never
const memberId = miscRepository.findMemberIdForHook as jest.Mock
const ctx = sessionRepository.findProgressContextForMember as jest.Mock
const summaries = hookEventRepository.findTurnSummariesBySession as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  memberId.mockResolvedValue('m1')
})

describe('getSessionProgressDraft', () => {
  it('returns empty payload when session is missing/not owned', async () => {
    ctx.mockResolvedValue(null)
    const r = await sessionService.getSessionProgressDraft({
      identity,
      sessionId: 's1',
    })
    expect(r).toEqual({
      taskIdentifier: null,
      taskTitle: null,
      summaries: [],
      watermark: null,
    })
    expect(summaries).not.toHaveBeenCalled()
  })

  it('passes the watermark as the since filter and computes a new watermark', async () => {
    const since = new Date('2026-06-01T09:00:00Z')
    ctx.mockResolvedValue({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      lastProgressCommentAt: since,
    })
    const newest = new Date('2026-06-01T11:00:00Z')
    summaries.mockResolvedValue([
      {
        id: 'e1',
        turnSummary: 'A',
        createdAt: new Date('2026-06-01T10:00:00Z'),
      },
      { id: 'e2', turnSummary: 'B', createdAt: newest },
    ])
    const r = await sessionService.getSessionProgressDraft({
      identity,
      sessionId: 's1',
    })
    expect(summaries).toHaveBeenCalledWith('s1', since)
    expect(r.taskIdentifier).toBe('LUM-42')
    expect(r.summaries.map(s => s.turnSummary)).toEqual(['A', 'B'])
    expect(r.summaries[0].createdAt).toBe('2026-06-01T10:00:00.000Z') // ISO string
    expect(r.watermark).toBe(newest.toISOString())
  })

  it('returns null watermark when there are no unposted summaries', async () => {
    ctx.mockResolvedValue({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      lastProgressCommentAt: null,
    })
    summaries.mockResolvedValue([])
    const r = await sessionService.getSessionProgressDraft({
      identity,
      sessionId: 's1',
    })
    expect(summaries).toHaveBeenCalledWith('s1', undefined)
    expect(r.watermark).toBeNull()
    expect(r.summaries).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/session-progress-draft.test.ts`
Expected: FAIL — `getSessionProgressDraft is not a function`.

- [ ] **Step 3: Implement the method**

In `lib/services/session.service.ts`, first add this exported type near the other result types (after `UnbindSessionResult`):

```ts
export interface ProgressDraftResult {
  taskIdentifier: string | null
  taskTitle: string | null
  summaries: { id: string; turnSummary: string; createdAt: string }[]
  watermark: string | null
}
```

Then add this method inside the `sessionService` object (after `unbindSession`). Note `hookEventRepository` is already imported at the top of the file:

```ts
  /**
   * Assemble the unposted progress draft for `lumo session wrap`: the bound
   * task plus every turnSummary written since the last progress comment. The
   * watermark (newest summary's createdAt, ISO) is carried back by the CLI on
   * post so the server can advance `lastProgressCommentAt` to exactly the turns
   * this draft covered. Empty payload when the session is missing/unowned.
   */
  async getSessionProgressDraft({
    identity,
    sessionId,
  }: SessionScopedInput): Promise<ProgressDraftResult> {
    const empty: ProgressDraftResult = {
      taskIdentifier: null,
      taskTitle: null,
      summaries: [],
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

    const rows = await hookEventRepository.findTurnSummariesBySession(
      sessionId,
      ctx.lastProgressCommentAt ?? undefined
    )
    const summaries = rows.map(r => ({
      id: r.id,
      turnSummary: r.turnSummary as string,
      createdAt: r.createdAt.toISOString(),
    }))
    return {
      taskIdentifier: ctx.taskIdentifier,
      taskTitle: ctx.taskTitle,
      summaries,
      watermark:
        summaries.length > 0
          ? summaries[summaries.length - 1].createdAt
          : null,
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/session-progress-draft.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/session.service.ts __tests__/lib/services/session-progress-draft.test.ts
git commit -m "feat: sessionService.getSessionProgressDraft [LUM-151]"
```

---

### Task 5: Service — `sessionService.postProgressComment`

**Files:**

- Modify: `lib/services/session.service.ts`
- Test: `__tests__/lib/services/session-progress-comment.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findProgressContextForMember: jest.fn(),
    setLastProgressCommentAt: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForComment: jest.fn() },
}))
jest.mock('@/lib/services/comment.service', () => ({
  commentService: { createCommentWithSideEffects: jest.fn() },
}))
jest.mock('@/lib/actor', () => ({ getHumanActorId: jest.fn() }))

import { sessionService } from '@/lib/services/session.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { commentService } from '@/lib/services/comment.service'
import { getHumanActorId } from '@/lib/actor'

const identity = {
  user: { id: 'u1' },
  workspace: { id: 'w1' },
  clerkId: 'ck1',
} as never
const memberId = miscRepository.findMemberIdForHook as jest.Mock
const ctx = sessionRepository.findProgressContextForMember as jest.Mock
const setWm = sessionRepository.setLastProgressCommentAt as jest.Mock
const findForComment = taskRepository.findForComment as jest.Mock
const createComment = commentService.createCommentWithSideEffects as jest.Mock
const actor = getHumanActorId as jest.Mock
const waitUntil = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  memberId.mockResolvedValue('m1')
  actor.mockResolvedValue('actor1')
})

describe('postProgressComment', () => {
  it('throws 409 when the session has no bound task', async () => {
    ctx.mockResolvedValue({
      taskId: null,
      taskIdentifier: null,
      taskTitle: null,
      lastProgressCommentAt: null,
    })
    await expect(
      sessionService.postProgressComment({
        identity,
        sessionId: 's1',
        body: 'x',
        watermark: '2026-06-01T10:00:00.000Z',
        waitUntil,
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(createComment).not.toHaveBeenCalled()
  })

  it('throws 404 when the session is missing/unowned', async () => {
    ctx.mockResolvedValue(null)
    await expect(
      sessionService.postProgressComment({
        identity,
        sessionId: 's1',
        body: 'x',
        watermark: '2026-06-01T10:00:00.000Z',
        waitUntil,
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('creates the comment then advances the watermark', async () => {
    ctx.mockResolvedValue({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      lastProgressCommentAt: null,
    })
    findForComment.mockResolvedValue({
      projectId: 'p1',
      title: 'T',
      number: 42,
      team: { identifier: 'LUM' },
      project: { workspaceId: 'w1', workspace: { slug: 'lumo' } },
    })
    createComment.mockResolvedValue({ id: 'c1' })
    const r = await sessionService.postProgressComment({
      identity,
      sessionId: 's1',
      body: '本次会话进度\n- A',
      watermark: '2026-06-01T10:00:00.000Z',
      waitUntil,
    })
    expect(r).toEqual({ commentId: 'c1' })
    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        body: '本次会话进度\n- A',
        authorActorId: 'actor1',
        parentId: null,
        quotedCommentId: null,
        authorClerkId: 'ck1',
        workspaceId: 'w1',
        projectId: 'p1',
        taskTitle: 'T',
        taskNumber: 42,
        teamIdentifier: 'LUM',
        workspaceSlug: 'lumo',
      })
    )
    expect(setWm).toHaveBeenCalledWith(
      's1',
      new Date('2026-06-01T10:00:00.000Z')
    )
    // watermark advances only after a successful comment create
    expect(createComment.mock.invocationCallOrder[0]).toBeLessThan(
      setWm.mock.invocationCallOrder[0]
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/session-progress-comment.test.ts`
Expected: FAIL — `postProgressComment is not a function`.

- [ ] **Step 3: Implement the method**

In `lib/services/session.service.ts`, add the input type near the other interfaces (after `SessionScopedInput`):

```ts
interface PostProgressCommentInput {
  identity: VerifyApiKeyResult
  sessionId: string
  body: string
  watermark: string
  waitUntil: (promise: Promise<unknown>) => void
}
```

Add these imports at the top of the file (alongside the existing repository imports). Import from the **specific modules**, not the `@/lib/services` / `@/lib/repositories` barrels — `session.service` is itself re-exported from the services barrel, so importing the barrel here would risk a circular import:

```ts
import { taskRepository } from '@/lib/repositories/task.repository'
import { commentService } from '@/lib/services/comment.service'
import { getHumanActorId } from '@/lib/actor'
```

> If a circular-import / undefined-at-load error still appears, switch these to lazy `await import('...')` inside the method body — the codebase already uses that pattern (see `comment.service.ts:365`).

Add this method inside the `sessionService` object (after `getSessionProgressDraft`):

```ts
  /**
   * Post a wrap progress comment to the session's bound task, then advance the
   * watermark to `watermark` (the newest turn the draft covered). Reuses the
   * same comment context the POST /api/tasks/[id]/comments route assembles.
   * Watermark advances ONLY after the comment create succeeds, so a failed
   * post leaves the turns eligible for the next wrap (no silent data loss).
   */
  async postProgressComment({
    identity,
    sessionId,
    body,
    watermark,
    waitUntil,
  }: PostProgressCommentInput): Promise<{ commentId: string }> {
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
    if (!ctx.taskId) {
      throw Object.assign(
        new Error(
          'Session is not bound to a task. Run `lumo session attach <LUM-N>` first.'
        ),
        { status: 409 }
      )
    }

    const task = await taskRepository.findForComment(ctx.taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }

    const authorActorId = await getHumanActorId(memberId)
    if (!authorActorId) {
      throw Object.assign(new Error('Actor not found'), { status: 500 })
    }

    const comment = await commentService.createCommentWithSideEffects({
      taskId: ctx.taskId,
      authorActorId,
      body,
      parentId: null,
      quotedCommentId: null,
      authorClerkId: identity.clerkId,
      workspaceId: task.project.workspaceId,
      projectId: task.projectId,
      taskTitle: task.title,
      taskNumber: task.number,
      teamIdentifier: task.team?.identifier ?? '',
      workspaceSlug: task.project.workspace?.slug ?? '',
      waitUntil,
    })

    await sessionRepository.setLastProgressCommentAt(
      sessionId,
      new Date(watermark)
    )

    return { commentId: comment.id }
  },
```

> `identity.clerkId`: confirm the field name on `VerifyApiKeyResult` in `lib/services/auth.service.ts`. If the clerk id is nested (e.g. `identity.user.clerkId`), use that path instead — match whatever the type exposes. (The test stubs `identity.clerkId`; adjust the stub to match the real shape.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/session-progress-comment.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/session.service.ts __tests__/lib/services/session-progress-comment.test.ts
git commit -m "feat: sessionService.postProgressComment [LUM-151]"
```

---

### Task 6: Route — `GET /api/sessions/[sessionId]/turn-summaries`

**Files:**

- Create: `app/api/sessions/[sessionId]/turn-summaries/route.ts`
- Test: `__tests__/api/sessions/turn-summaries-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/services/session.service', () => ({
  sessionService: { getSessionProgressDraft: jest.fn() },
}))

import { GET } from '@/app/api/sessions/[sessionId]/turn-summaries/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const bearer = verifyBearer as jest.Mock
const draft = sessionService.getSessionProgressDraft as jest.Mock
const params = { params: Promise.resolve({ sessionId: 's1' }) }

beforeEach(() => jest.clearAllMocks())

it('401 when bearer invalid', async () => {
  bearer.mockResolvedValue(null)
  const res = await GET(
    new Request('http://x/api/sessions/s1/turn-summaries'),
    params
  )
  expect(res.status).toBe(401)
})

it('returns the draft payload', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  draft.mockResolvedValue({
    taskIdentifier: 'LUM-42',
    taskTitle: 'T',
    summaries: [],
    watermark: null,
  })
  const res = await GET(
    new Request('http://x/api/sessions/s1/turn-summaries'),
    params
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    taskIdentifier: 'LUM-42',
    taskTitle: 'T',
    summaries: [],
    watermark: null,
  })
  expect(draft).toHaveBeenCalledWith({
    identity: expect.anything(),
    sessionId: 's1',
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/sessions/turn-summaries-route.test.ts`
Expected: FAIL — cannot find module `route`.

- [ ] **Step 3: Implement the route**

Create `app/api/sessions/[sessionId]/turn-summaries/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * GET /api/sessions/[sessionId]/turn-summaries
 *
 * Returns the unposted progress draft for `lumo session wrap`: the session's
 * bound task plus every turnSummary written since the last progress comment.
 * Bearer-only, member-scoped (a session that doesn't exist / isn't owned
 * yields an empty payload, never an enumeration signal).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params
  const result = await sessionService.getSessionProgressDraft({
    identity,
    sessionId,
  })
  return NextResponse.json(result)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api/sessions/turn-summaries-route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/sessions/[sessionId]/turn-summaries/route.ts __tests__/api/sessions/turn-summaries-route.test.ts
git commit -m "feat: GET /api/sessions/[id]/turn-summaries route [LUM-151]"
```

---

### Task 7: Route — `POST /api/sessions/[sessionId]/progress-comment`

**Files:**

- Create: `app/api/sessions/[sessionId]/progress-comment/route.ts`
- Test: `__tests__/api/sessions/progress-comment-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/services/session.service', () => ({
  sessionService: { postProgressComment: jest.fn() },
}))

import { POST } from '@/app/api/sessions/[sessionId]/progress-comment/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const bearer = verifyBearer as jest.Mock
const post = sessionService.postProgressComment as jest.Mock
const params = { params: Promise.resolve({ sessionId: 's1' }) }

const req = (body: unknown) =>
  new Request('http://x/api/sessions/s1/progress-comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => jest.clearAllMocks())

it('401 when bearer invalid', async () => {
  bearer.mockResolvedValue(null)
  const res = await POST(
    req({ body: 'x', watermark: '2026-06-01T10:00:00.000Z' }),
    params
  )
  expect(res.status).toBe(401)
})

it('400 when body fails validation (empty)', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  const res = await POST(
    req({ body: '', watermark: '2026-06-01T10:00:00.000Z' }),
    params
  )
  expect(res.status).toBe(400)
  expect(post).not.toHaveBeenCalled()
})

it('400 when watermark is missing', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  const res = await POST(req({ body: 'hello' }), params)
  expect(res.status).toBe(400)
})

it('201 with commentId on success', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  post.mockResolvedValue({ commentId: 'c1' })
  const res = await POST(
    req({ body: 'hello', watermark: '2026-06-01T10:00:00.000Z' }),
    params
  )
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ commentId: 'c1' })
})

it('maps service status errors (409 unbound)', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  post.mockRejectedValue(Object.assign(new Error('not bound'), { status: 409 }))
  const res = await POST(
    req({ body: 'hello', watermark: '2026-06-01T10:00:00.000Z' }),
    params
  )
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'not bound' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/sessions/progress-comment-route.test.ts`
Expected: FAIL — cannot find module `route`.

- [ ] **Step 3: Implement the route**

Create `app/api/sessions/[sessionId]/progress-comment/route.ts`:

```ts
import { waitUntil } from '@vercel/functions'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

const bodySchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000),
  watermark: z.string().datetime(),
})

/**
 * POST /api/sessions/[sessionId]/progress-comment
 *
 * Post a wrap progress comment to the session's bound task and advance the
 * dedup watermark in one call. Bearer-only, member-scoped. 409 if the session
 * has no bound task; 404 if the session is missing / not owned.
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
    const result = await sessionService.postProgressComment({
      identity,
      sessionId,
      body: parsed.data.body,
      watermark: parsed.data.watermark,
      waitUntil,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 404 || status === 409 || status === 500) {
      const message = error instanceof Error ? error.message : 'Error'
      return NextResponse.json({ error: message }, { status })
    }
    console.error(
      'POST /api/sessions/[sessionId]/progress-comment error:',
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

Run: `npx jest __tests__/api/sessions/progress-comment-route.test.ts`
Expected: PASS (5 tests).

> Note `z.string().datetime()` requires an ISO-8601 string with timezone — `new Date().toISOString()` (what the CLI carries back) satisfies it.

- [ ] **Step 5: Commit**

```bash
git add app/api/sessions/[sessionId]/progress-comment/route.ts __tests__/api/sessions/progress-comment-route.test.ts
git commit -m "feat: POST /api/sessions/[id]/progress-comment route [LUM-151]"
```

---

### Task 8: CLI — `$EDITOR` helper

**Files:**

- Create: `cli/src/lib/editor.ts`
- Test: `__tests__/cli/editor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
jest.mock('child_process', () => ({ spawnSync: jest.fn() }))
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  rmSync: jest.fn(),
  mkdtempSync: jest.fn(() => '/tmp/lumo-wrap-xxx'),
}))

import { spawnSync } from 'child_process'
import * as fs from 'fs'
import { editInEditor } from '@/cli/src/lib/editor'

const spawn = spawnSync as jest.Mock
const read = fs.readFileSync as jest.Mock

const originalEditor = process.env.EDITOR
const originalTTY = process.stdin.isTTY

afterEach(() => {
  process.env.EDITOR = originalEditor
  Object.defineProperty(process.stdin, 'isTTY', {
    value: originalTTY,
    configurable: true,
  })
})

it('returns the initial text unchanged when stdin is not a TTY', async () => {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: false,
    configurable: true,
  })
  const out = await editInEditor('initial')
  expect(out).toBe('initial')
  expect(spawn).not.toHaveBeenCalled()
})

it('spawns $EDITOR and returns the edited file contents', async () => {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: true,
    configurable: true,
  })
  process.env.EDITOR = 'vim'
  spawn.mockReturnValue({ status: 0 })
  read.mockReturnValue('edited body')
  const out = await editInEditor('initial')
  expect(spawn).toHaveBeenCalledWith(
    'vim',
    [expect.stringContaining('/tmp/lumo-wrap-xxx')],
    { stdio: 'inherit' }
  )
  expect(out).toBe('edited body')
})

it('falls back to vi when $EDITOR is unset', async () => {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: true,
    configurable: true,
  })
  delete process.env.EDITOR
  spawn.mockReturnValue({ status: 0 })
  read.mockReturnValue('x')
  await editInEditor('initial')
  expect(spawn.mock.calls[0][0]).toBe('vi')
})

it('returns initial text when the editor exits non-zero', async () => {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: true,
    configurable: true,
  })
  process.env.EDITOR = 'vim'
  spawn.mockReturnValue({ status: 1 })
  const out = await editInEditor('initial')
  expect(out).toBe('initial')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/editor.test.ts`
Expected: FAIL — cannot find module `editor`.

- [ ] **Step 3: Implement the helper**

Create `cli/src/lib/editor.ts`:

```ts
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Open `initial` in the user's $EDITOR (fallback vi → nano), return the edited
 * text. Degrades gracefully: when stdin is not a TTY (piped / agent) or the
 * editor exits non-zero, the original text is returned unchanged so the caller
 * can proceed without an interactive editor.
 */
export async function editInEditor(initial: string): Promise<string> {
  if (!process.stdin.isTTY) return initial

  const editor = process.env.EDITOR || process.env.VISUAL || 'vi'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-wrap-'))
  const file = path.join(dir, 'progress.md')
  try {
    fs.writeFileSync(file, initial, 'utf8')
    const result = spawnSync(editor, [file], { stdio: 'inherit' })
    if (result.status !== 0) return initial
    return fs.readFileSync(file, 'utf8')
  } catch {
    return initial
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/editor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/editor.ts __tests__/cli/editor.test.ts
git commit -m "feat: CLI $EDITOR round-trip helper [LUM-151]"
```

---

### Task 9: CLI — wrap-panel framework

**Files:**

- Create: `cli/src/lib/wrap-panel.ts`
- Test: `__tests__/cli/wrap-panel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
import { runWrapPanel, type WrapSection } from '@/cli/src/lib/wrap-panel'

function makeSection(
  over: Partial<WrapSection> & { title: string }
): WrapSection & {
  prepared: boolean
  ran: boolean
} {
  const s: WrapSection & { prepared: boolean; ran: boolean } = {
    title: over.title,
    prepared: false,
    ran: false,
    prepare:
      over.prepare ??
      (async () => {
        s.prepared = true
        return true
      }),
    run:
      over.run ??
      (async () => {
        s.ran = true
      }),
  }
  return s
}

let out: string[]
beforeEach(() => {
  out = []
  jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((c: string | Uint8Array) => {
      out.push(String(c))
      return true
    })
})
afterEach(() => jest.restoreAllMocks())

it('runs only sections whose prepare() returns true', async () => {
  const a = makeSection({ title: 'A' })
  const b = makeSection({ title: 'B', prepare: async () => false })
  await runWrapPanel([a, b], { yes: false, dryRun: false })
  expect(a.ran).toBe(true)
  expect(b.ran).toBe(false)
})

it('skips run() entirely in dry-run but still prepares', async () => {
  const a = makeSection({ title: 'A' })
  await runWrapPanel([a], { yes: false, dryRun: true })
  expect(a.prepared).toBe(true)
  expect(a.ran).toBe(true) // run() is still invoked; dryRun is passed through for the section to honor
})

it('passes opts through to run()', async () => {
  let seen: unknown
  const a = makeSection({
    title: 'A',
    run: async opts => {
      seen = opts
    },
  })
  await runWrapPanel([a], { yes: true, dryRun: false })
  expect(seen).toEqual({ yes: true, dryRun: false })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/wrap-panel.test.ts`
Expected: FAIL — cannot find module `wrap-panel`.

- [ ] **Step 3: Implement the framework**

Create `cli/src/lib/wrap-panel.ts`:

```ts
export interface WrapRunOpts {
  /** Auto-confirm: post the drafted content without prompting (agent-friendly). */
  yes: boolean
  /** Print the draft but never post or mutate server state. */
  dryRun: boolean
}

/**
 * One pane of the session wrap-up panel. Each section owns its own draft state
 * internally: `prepare()` gathers data and reports whether there's anything to
 * show; `run()` renders the preview and handles the y/e/s confirmation. This is
 * the seam LUM-152's memory-review section plugs into — same interface, no
 * runner changes.
 */
export interface WrapSection {
  title: string
  /** Gather data. Return false when there's nothing to show (runner skips run()). */
  prepare(): Promise<boolean>
  /** Render preview + handle confirmation. Only called when prepare() returned true. */
  run(opts: WrapRunOpts): Promise<void>
}

/** Run each section in order; print its title, prepare, then run if it has content. */
export async function runWrapPanel(
  sections: WrapSection[],
  opts: WrapRunOpts
): Promise<void> {
  for (const section of sections) {
    process.stdout.write(`\n━━ ${section.title} ━━\n`)
    const hasContent = await section.prepare()
    if (!hasContent) {
      process.stdout.write('(无内容)\n')
      continue
    }
    await section.run(opts)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/wrap-panel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/wrap-panel.ts __tests__/cli/wrap-panel.test.ts
git commit -m "feat: CLI wrap-panel section framework [LUM-151]"
```

---

### Task 10: CLI — progress-comment API helpers

**Files:**

- Create: `cli/src/lib/progress-comment-api.ts`
- Test: `__tests__/cli/progress-comment-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
import {
  fetchProgressDraft,
  postProgressComment,
  type ServerProgressDraft,
} from '@/cli/src/lib/progress-comment-api'

const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

beforeEach(() => {
  ;(global as { fetch?: unknown }).fetch = jest.fn()
})

it('GETs the turn-summaries endpoint with bearer auth', async () => {
  const draft: ServerProgressDraft = {
    taskIdentifier: 'LUM-42',
    taskTitle: 'T',
    summaries: [],
    watermark: null,
  }
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => draft,
  })
  const r = await fetchProgressDraft(creds, 'sess_1')
  expect(r).toEqual(draft)
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://x/api/sessions/sess_1/turn-summaries')
  expect(init.headers.Authorization).toBe('Bearer t')
})

it('throws a useful error on non-200 draft fetch', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => ({}),
  })
  await expect(fetchProgressDraft(creds, 'sess_1')).rejects.toThrow(/HTTP 500/)
})

it('POSTs body + watermark and returns the commentId', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    status: 201,
    json: async () => ({ commentId: 'c1' }),
  })
  const r = await postProgressComment(creds, 'sess_1', {
    body: 'hi',
    watermark: '2026-06-01T10:00:00.000Z',
  })
  expect(r).toEqual({ commentId: 'c1' })
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://x/api/sessions/sess_1/progress-comment')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({
    body: 'hi',
    watermark: '2026-06-01T10:00:00.000Z',
  })
})

it('surfaces the server error message on non-201 post', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({
    status: 409,
    json: async () => ({ error: 'not bound' }),
  })
  await expect(
    postProgressComment(creds, 'sess_1', {
      body: 'hi',
      watermark: '2026-06-01T10:00:00.000Z',
    })
  ).rejects.toThrow('not bound')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/progress-comment-api.test.ts`
Expected: FAIL — cannot find module `progress-comment-api`.

- [ ] **Step 3: Implement the helpers**

Create `cli/src/lib/progress-comment-api.ts`:

```ts
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

export interface ServerProgressDraft {
  taskIdentifier: string | null
  taskTitle: string | null
  summaries: { id: string; turnSummary: string; createdAt: string }[]
  watermark: string | null
}

function base(creds: Credentials): string {
  return trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
}

/** GET the unposted progress draft for the session. Throws on transport / non-200. */
export async function fetchProgressDraft(
  creds: Credentials,
  sessionId: string
): Promise<ServerProgressDraft> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/turn-summaries`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (res.status === 401)
    throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  if (!res.ok)
    throw new Error(`progress draft fetch failed (HTTP ${res.status})`)
  return (await res.json()) as ServerProgressDraft
}

/** POST the (possibly edited) body + watermark. Throws the server message on non-201. */
export async function postProgressComment(
  creds: Credentials,
  sessionId: string,
  payload: { body: string; watermark: string }
): Promise<{ commentId: string }> {
  const url = `${base(creds)}/api/sessions/${encodeURIComponent(sessionId)}/progress-comment`
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
  if (res.status !== 201) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // body wasn't JSON
    }
    throw new Error(serverMsg ?? `progress comment failed (HTTP ${res.status})`)
  }
  return (await res.json()) as { commentId: string }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/progress-comment-api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/progress-comment-api.ts __tests__/cli/progress-comment-api.test.ts
git commit -m "feat: CLI progress-comment API helpers [LUM-151]"
```

---

### Task 11: CLI — `ProgressCommentSection` + body formatter

**Files:**

- Create: `cli/src/commands/wrap/progress-comment-section.ts`
- Test: `__tests__/cli/progress-comment-section.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/progress-comment-api', () => ({
  fetchProgressDraft: jest.fn(),
  postProgressComment: jest.fn(),
}))
jest.mock('@/cli/src/lib/line-prompt', () => ({ promptLine: jest.fn() }))
jest.mock('@/cli/src/lib/editor', () => ({ editInEditor: jest.fn() }))

import {
  formatProgressBody,
  ProgressCommentSection,
} from '@/cli/src/commands/wrap/progress-comment-section'
import {
  fetchProgressDraft,
  postProgressComment,
} from '@/cli/src/lib/progress-comment-api'
import { promptLine } from '@/cli/src/lib/line-prompt'
import { editInEditor } from '@/cli/src/lib/editor'

const fetchDraft = fetchProgressDraft as jest.Mock
const post = postProgressComment as jest.Mock
const prompt = promptLine as jest.Mock
const edit = editInEditor as jest.Mock
const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => jest.restoreAllMocks())

describe('formatProgressBody', () => {
  it('builds a bulleted body under a Chinese header', () => {
    expect(formatProgressBody(['改了 a.ts', '跑了测试'])).toBe(
      '本次会话进度\n- 改了 a.ts\n- 跑了测试'
    )
  })
})

describe('ProgressCommentSection.prepare', () => {
  it('returns false when there is no bound task', async () => {
    fetchDraft.mockResolvedValue({
      taskIdentifier: null,
      taskTitle: null,
      summaries: [],
      watermark: null,
    })
    const s = new ProgressCommentSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(false)
  })

  it('returns false when there are no unposted summaries', async () => {
    fetchDraft.mockResolvedValue({
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      summaries: [],
      watermark: null,
    })
    const s = new ProgressCommentSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(false)
  })

  it('returns true and stores a draft when there are summaries', async () => {
    fetchDraft.mockResolvedValue({
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      summaries: [
        {
          id: 'e1',
          turnSummary: '改了 a.ts',
          createdAt: '2026-06-01T10:00:00.000Z',
        },
      ],
      watermark: '2026-06-01T10:00:00.000Z',
    })
    const s = new ProgressCommentSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(true)
  })
})

describe('ProgressCommentSection.run', () => {
  const draft = {
    taskIdentifier: 'LUM-42',
    taskTitle: 'T',
    summaries: [
      {
        id: 'e1',
        turnSummary: '改了 a.ts',
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    ],
    watermark: '2026-06-01T10:00:00.000Z',
  }
  async function prepared() {
    fetchDraft.mockResolvedValue(draft)
    const s = new ProgressCommentSection({ creds, sessionId: 's1' })
    await s.prepare()
    return s
  }

  it('--yes posts the drafted body without prompting', async () => {
    const s = await prepared()
    post.mockResolvedValue({ commentId: 'c1' })
    await s.run({ yes: true, dryRun: false })
    expect(prompt).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(creds, 's1', {
      body: '本次会话进度\n- 改了 a.ts',
      watermark: '2026-06-01T10:00:00.000Z',
    })
  })

  it('dry-run never posts', async () => {
    const s = await prepared()
    await s.run({ yes: false, dryRun: true })
    expect(post).not.toHaveBeenCalled()
  })

  it('y posts, s skips, e edits then posts', async () => {
    // y
    let s = await prepared()
    prompt.mockResolvedValueOnce('y')
    post.mockResolvedValue({ commentId: 'c1' })
    await s.run({ yes: false, dryRun: false })
    expect(post).toHaveBeenCalledTimes(1)

    // s (skip)
    post.mockClear()
    s = await prepared()
    prompt.mockResolvedValueOnce('s')
    await s.run({ yes: false, dryRun: false })
    expect(post).not.toHaveBeenCalled()

    // e (edit → then confirm y)
    post.mockClear()
    s = await prepared()
    prompt.mockResolvedValueOnce('e').mockResolvedValueOnce('y')
    edit.mockResolvedValue('本次会话进度\n- 改了 a.ts(edited)')
    await s.run({ yes: false, dryRun: false })
    expect(edit).toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(creds, 's1', {
      body: '本次会话进度\n- 改了 a.ts(edited)',
      watermark: '2026-06-01T10:00:00.000Z',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/progress-comment-section.test.ts`
Expected: FAIL — cannot find module `progress-comment-section`.

- [ ] **Step 3: Implement the section**

Create `cli/src/commands/wrap/progress-comment-section.ts`:

```ts
import type { WrapSection, WrapRunOpts } from '../../lib/wrap-panel'
import { sanitizeField } from '../../lib/sanitize'
import { promptLine } from '../../lib/line-prompt'
import { editInEditor } from '../../lib/editor'
import {
  fetchProgressDraft,
  postProgressComment,
  type ServerProgressDraft,
} from '../../lib/progress-comment-api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

const HEADER = '本次会话进度'

/** Join turn summaries into a bulleted progress comment body under a header. */
export function formatProgressBody(summaries: string[]): string {
  return [HEADER, ...summaries.map(s => `- ${s}`)].join('\n')
}

/**
 * Wrap-panel section that drafts a progress comment from the session's
 * unposted turnSummaries and posts it after y/e/s confirmation. Holds its own
 * draft + body state between prepare() and run().
 */
export class ProgressCommentSection implements WrapSection {
  title = '进度评论'
  private draft: ServerProgressDraft | null = null
  private body = ''

  constructor(private deps: { creds: Credentials; sessionId: string }) {}

  async prepare(): Promise<boolean> {
    this.draft = await fetchProgressDraft(this.deps.creds, this.deps.sessionId)
    if (!this.draft.taskIdentifier || this.draft.summaries.length === 0) {
      return false
    }
    this.body = formatProgressBody(this.draft.summaries.map(s => s.turnSummary))
    return true
  }

  async run(opts: WrapRunOpts): Promise<void> {
    const draft = this.draft
    if (!draft || !draft.watermark) return

    // Preview: sanitize the server free-text before it hits the terminal.
    process.stdout.write(
      `将发到 ${draft.taskIdentifier} "${sanitizeField(draft.taskTitle ?? '')}":\n`
    )
    process.stdout.write(`${sanitizeField(this.body)}\n`)

    if (opts.dryRun) {
      process.stdout.write('(dry-run，未发送)\n')
      return
    }

    if (opts.yes) {
      await this.post(draft.watermark, this.body)
      return
    }

    const choice = (
      await promptLine('[y] 发送  [e] 编辑  [s] 跳过 > ')
    ).toLowerCase()

    if (choice === 's' || choice === '') {
      process.stdout.write('已跳过。\n')
      return
    }
    if (choice === 'e') {
      const edited = (await editInEditor(this.body)).trim()
      if (edited.length === 0) {
        process.stdout.write('正文为空，已跳过。\n')
        return
      }
      process.stdout.write(`${sanitizeField(edited)}\n`)
      const confirm = (await promptLine('[y] 发送  [s] 跳过 > ')).toLowerCase()
      if (confirm !== 'y') {
        process.stdout.write('已跳过。\n')
        return
      }
      await this.post(draft.watermark, edited)
      return
    }
    if (choice === 'y') {
      await this.post(draft.watermark, this.body)
      return
    }
    process.stdout.write('无法识别的选择，已跳过。\n')
  }

  private async post(watermark: string, body: string): Promise<void> {
    const { commentId } = await postProgressComment(
      this.deps.creds,
      this.deps.sessionId,
      { body, watermark }
    )
    process.stdout.write(`已发送进度评论 (comment ${commentId})\n`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/progress-comment-section.test.ts`
Expected: PASS (formatProgressBody + prepare ×3 + run ×3).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/wrap/progress-comment-section.ts __tests__/cli/progress-comment-section.test.ts
git commit -m "feat: CLI ProgressCommentSection + body formatter [LUM-151]"
```

---

### Task 12: CLI — `session wrap` command + registration

**Files:**

- Create: `cli/src/commands/session-wrap.ts`
- Modify: `cli/src/index.ts`
- Test: `__tests__/cli/session-wrap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/wrap-panel', () => ({ runWrapPanel: jest.fn() }))
jest.mock('@/cli/src/commands/wrap/progress-comment-section', () => ({
  ProgressCommentSection: jest
    .fn()
    .mockImplementation(() => ({ tag: 'progress' })),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { runWrapPanel } from '@/cli/src/lib/wrap-panel'
import { ProgressCommentSection } from '@/cli/src/commands/wrap/progress-comment-section'
import { sessionWrap } from '@/cli/src/commands/session-wrap'

const mockRead = readCredentials as jest.Mock
const mockRun = runWrapPanel as jest.Mock
const originalEnv = process.env.CLAUDE_CODE_SESSION_ID

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
  mockRead.mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  jest.restoreAllMocks()
  if (originalEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = originalEnv
})

it('exits 1 when CLAUDE_CODE_SESSION_ID is not set', async () => {
  const code = await sessionWrap({})
  expect(code).toBe(1)
  expect(mockRun).not.toHaveBeenCalled()
})

it('exits 1 when not logged in', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
  mockRead.mockReturnValue(null)
  const code = await sessionWrap({})
  expect(code).toBe(1)
})

it('runs the panel with a ProgressCommentSection and passes opts', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
  await sessionWrap({ yes: true })
  expect(ProgressCommentSection).toHaveBeenCalledWith({
    creds: { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' },
    sessionId: 'sess_1',
  })
  expect(mockRun).toHaveBeenCalledWith([{ tag: 'progress' }], {
    yes: true,
    dryRun: false,
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/session-wrap.test.ts`
Expected: FAIL — cannot find module `session-wrap`.

- [ ] **Step 3: Implement the command**

Create `cli/src/commands/session-wrap.ts`:

```ts
import { readCredentials } from '../lib/config'
import { runWrapPanel } from '../lib/wrap-panel'
import { ProgressCommentSection } from './wrap/progress-comment-section'

interface SessionWrapOptions {
  yes?: boolean
  dryRun?: boolean
}

/**
 * `lumo session wrap [--yes] [--dry-run]`
 *
 * Session-end wrap-up panel. v1 has a single section: draft a progress comment
 * from this session's unposted turnSummaries and post it (after y/e/s
 * confirmation) to the bound task. Designed as a multi-section panel so
 * LUM-152's memory-review section slots in without touching this command.
 */
export async function sessionWrap(
  options: SessionWrapOptions
): Promise<number | void> {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!sessionId) {
    console.error(
      'Error: $CLAUDE_CODE_SESSION_ID is not set.\n' +
        '`lumo session wrap` must be run inside a Claude Code session.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const sections = [new ProgressCommentSection({ creds, sessionId })]
  await runWrapPanel(sections, {
    yes: options.yes === true,
    dryRun: options.dryRun === true,
  })
}
```

- [ ] **Step 4: Register the command in `cli/src/index.ts`**

Add the import near the other session command imports (after line 13, `import { sessionStatus } ...`):

```ts
import { sessionWrap } from './commands/session-wrap'
```

Add the subcommand registration in the `session` block (after the `detach` registration, around line 220):

```ts
session
  .command('wrap')
  .description(
    "Session-end wrap-up: draft a progress comment from this session's turn summaries and post it to the bound task after confirmation."
  )
  .option(
    '-y, --yes',
    'Post the drafted comment without prompting (agent-friendly)'
  )
  .option(
    '--dry-run',
    'Print the draft but do not post or advance the watermark'
  )
  .action(
    wrap(options => sessionWrap(options as { yes?: boolean; dryRun?: boolean }))
  )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/cli/session-wrap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/session-wrap.ts cli/src/index.ts __tests__/cli/session-wrap.test.ts
git commit -m "feat: lumo session wrap command [LUM-151]"
```

---

### Task 13: Docs — update SKILL.md

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: Add the command section**

In the "Session Management" area of `.claude/skills/lumo/SKILL.md` (after the `lumo session detach` section), add:

````markdown
### `lumo session wrap [--yes] [--dry-run]` — draft + post a progress comment at wrap-up

Session-end wrap-up panel. Reads back the current Claude Code session's per-turn
`turnSummary` rows (the one-line Chinese summaries written each STOP), aggregates
every turn **since the last progress comment** into one bulleted body, and — after
a `[y] 发送 / [e] 编辑 / [s] 跳过` confirmation — posts it as a comment on the
session's bound task. A server-side watermark (`Session.lastProgressCommentAt`)
means re-running never re-posts the same turns.

```bash
lumo session wrap            # interactive: preview draft, choose y / e / s
lumo session wrap --yes      # post the drafted body without prompting (agent-friendly)
lumo session wrap --dry-run  # print the draft only; never posts, never advances watermark
```

- Requires `$CLAUDE_CODE_SESSION_ID` (must run inside Claude Code) and a bound
  task (`lumo session attach <LUM-N>` first). With no bound task or no new turn
  summaries, the panel prints "(无内容)" and posts nothing.
- `[e] 编辑` opens `$EDITOR` (fallback vi/nano) on the drafted body; the edited
  text is posted and the watermark still advances to the turns the draft covered.
- Non-TTY without `--yes`: prints the draft and does **not** post (safe default).

When to suggest: at the end of a working session on a bound task, to record what
was done as a progress comment — offer `lumo session wrap` rather than composing
a `task comment` by hand.
````

- [ ] **Step 2: Update the frontmatter `description` triggers**

In the frontmatter `description:` field, add wrap triggers to the existing trigger list, e.g. append:
`"session wrap", "wrap up session", "收尾", "post progress", "把进度发出去", "progress comment", "进度评论"`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: document lumo session wrap in SKILL.md [LUM-151]"
```

---

### Task 14: Full verification

**Files:** _(none — verification only)_

- [ ] **Step 1: Regenerate Prisma client (guards against stale-client tsc errors)**

Run: `npx prisma generate`
Expected: "Generated Prisma Client".

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Pay attention to `exactOptionalPropertyTypes` on any new optional fields — declare `field?: T | undefined` if tsc complains.)

- [ ] **Step 3: Run the full new test set**

Run: `npx jest __tests__/lib/repositories/hook-event-turn-summaries.test.ts __tests__/lib/repositories/session-progress-watermark.test.ts __tests__/lib/services/session-progress-draft.test.ts __tests__/lib/services/session-progress-comment.test.ts __tests__/api/sessions/turn-summaries-route.test.ts __tests__/api/sessions/progress-comment-route.test.ts __tests__/cli/editor.test.ts __tests__/cli/wrap-panel.test.ts __tests__/cli/progress-comment-api.test.ts __tests__/cli/progress-comment-section.test.ts __tests__/cli/session-wrap.test.ts`
Expected: all PASS.

- [ ] **Step 4: Run the full suite to catch regressions**

Run: `npm test`
Expected: green (or only pre-existing unrelated failures).

- [ ] **Step 5: Build the CLI (confirms it compiles in its own tsconfig)**

Run: `cd cli && npm run build && cd ..` (or the repo's CLI build script — check `cli/package.json`)
Expected: clean build.

- [ ] **Step 6: Final commit if anything changed during verification**

```bash
git add -A
git commit -m "chore: verification fixups for session wrap [LUM-151]" || echo "nothing to commit"
```

---

## Notes for the implementer

- **Layered architecture (CLAUDE.md):** routes stay thin (auth → validate → service → respond); all Prisma access is in repositories; business orchestration is in `sessionService`. Don't add Prisma calls to routes.
- **No console.log** in production code — the CLI writes user output via `process.stdout.write` / `console.error` (matching existing commands); `console.error` for diagnostics in routes matches the existing pattern.
- **Sanitize** server free-text only for terminal display (`sanitizeField`), never the body sent to the comment API.
- **i18n:** the CLI prints plain strings (not react-intl — that's the web app only), so the Chinese literals here need no locale-file changes. The web app already renders comment bodies as-is.
- **Migration → prod:** the PR description must note `Session.lastProgressCommentAt` requires `prisma migrate deploy` on the next deploy (nullable add, non-destructive, no data deletion).
- **PR checklist (CLAUDE.md):** branch `lumo/LUM-151-...`, PR title `feat: ... [LUM-151]`, SKILL.md updated (Task 13), tsc clean, no console.log, tests passing.
- **Deliberate v1 omission — `--task LUM-N`:** the design spec's non-interactive matrix listed a `--task` override, but it's dropped here. The watermark is session-scoped and the target task is derived from the session binding; posting one session's turn summaries to an _arbitrary_ other task breaks that model and adds a server-side override path for negligible benefit. v1 always posts to the session's bound task. If a different task is wanted, re-bind with `lumo session attach <LUM-N>` first. Revisit only if a real need appears.
