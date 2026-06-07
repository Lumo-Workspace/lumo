# Lineage Outcome Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp lineage-edge outcomes for edges born *after* their task reached a terminal state, via a birth-time stamp plus a resident cron sweep — so the 546 permanently-UNKNOWN prod edges (and future stragglers) get their MERGED verdict.

**Architecture:** Two complementary paths, both reusing the existing idempotent, monotonic `stampOutcomeByTask` ladder (`STAMPABLE_FROM`). (1) Birth-time: after `recordSessionStartEdges` inserts edges, if the task is already `DONE`, immediately stamp MERGED. (2) Self-heal: a Vercel cron runs a single relation-filtered `updateMany` over all DONE-task edges still eligible to advance; its first post-deploy run is the one-time backfill. Terminal-success = `task.status === 'DONE'` only (reopened tasks are `!= DONE`, so rework edges correctly stay UNKNOWN; REWORKED is never in the advance set).

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Prisma, Jest. No schema change — reads `task.status`, writes the existing `outcome` column.

---

## File Structure

- `lib/repositories/task.repository.ts` — **modify**: add `getStatus(id)` (lightweight status read for the hot session-start path).
- `lib/repositories/lineage-edge.repository.ts` — **modify**: add `stampDoneTaskEdges()` (the system-wide sweep `updateMany`).
- `lib/services/lineage-outcome.service.ts` — **modify**: add `sweepDoneTaskEdges()` (service wrapper the cron calls; keeps the route off the repo).
- `lib/services/lineage.service.ts` — **modify**: `recordSessionStartEdges` stamps MERGED at birth when the task is DONE.
- `app/api/cron/backfill-lineage-outcomes/route.ts` — **create**: `CRON_SECRET`-guarded GET that invokes the sweep.
- `vercel.json` — **modify**: register the cron (`0 * * * *`).
- Tests (all mock Prisma / repos, matching existing lineage test style):
  - `__tests__/lib/repositories/task.repository.getStatus.test.ts` — **create**
  - `__tests__/repositories/lineage-edge.repository.test.ts` — **create**
  - `__tests__/lib/services/lineage-outcome.service.test.ts` — **modify**
  - `__tests__/services/lineage.service.test.ts` — **modify**
  - `__tests__/api/cron-backfill-lineage-outcomes.test.ts` — **create**

> **Worktree git-safety:** every git command below is pinned to the worktree with `git -C <worktree>`. Run all `npx jest` from inside the worktree (`cd` first) — see the worktree gotcha about haste collisions.
> Worktree path: `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes`

---

## Task 1: `taskRepository.getStatus` — lightweight status read

**Files:**
- Modify: `lib/repositories/task.repository.ts` (insert after `findById`, ~line 329)
- Test: `__tests__/lib/repositories/task.repository.getStatus.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/repositories/task.repository.getStatus.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { task: { findUnique: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { taskRepository } from '@/lib/repositories/task.repository'

const mockFindUnique = (prisma as unknown as {
  task: { findUnique: jest.Mock }
}).task.findUnique

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.getStatus', () => {
  it('returns the task status, selecting only the status column', async () => {
    mockFindUnique.mockResolvedValue({ status: 'DONE' })
    const status = await taskRepository.getStatus('t-1')
    expect(status).toBe('DONE')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 't-1' },
      select: { status: true },
    })
  })

  it('returns null when the task does not exist', async () => {
    mockFindUnique.mockResolvedValue(null)
    expect(await taskRepository.getStatus('missing')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/lib/repositories/task.repository.getStatus.test.ts`
Expected: FAIL — `taskRepository.getStatus is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/repositories/task.repository.ts`, insert immediately after the `findById` method (after its closing `},`, ~line 329). `TaskStatus` is already imported at the top:

```ts
  /**
   * Lightweight status read for the lineage birth-time backfill (LUM-296).
   * Selects only `status` to avoid hydrating the full detail graph on the hot
   * session-start path. Returns null when the task doesn't exist.
   */
  async getStatus(id: string): Promise<TaskStatus | null> {
    const row = await prisma.task.findUnique({
      where: { id },
      select: { status: true },
    })
    return row?.status ?? null
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/lib/repositories/task.repository.getStatus.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes add lib/repositories/task.repository.ts __tests__/lib/repositories/task.repository.getStatus.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes commit -m "feat: add taskRepository.getStatus lightweight status read [LUM-296]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `lineageEdgeRepository.stampDoneTaskEdges` — the sweep query

**Files:**
- Modify: `lib/repositories/lineage-edge.repository.ts` (add method after `stampOutcomeByTask`, ~line 250)
- Test: `__tests__/repositories/lineage-edge.repository.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/repositories/lineage-edge.repository.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: { lineageEdge: { updateMany: jest.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

const mockUpdateMany = (prisma as unknown as {
  lineageEdge: { updateMany: jest.Mock }
}).lineageEdge.updateMany

beforeEach(() => jest.clearAllMocks())

describe('lineageEdgeRepository.stampDoneTaskEdges', () => {
  it('stamps MERGED on advance-eligible edges of DONE tasks, sparing REWORKED', async () => {
    mockUpdateMany.mockResolvedValue({ count: 546 })

    const result = await lineageEdgeRepository.stampDoneTaskEdges()

    expect(result).toEqual({ count: 546 })
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        // STAMPABLE_FROM.MERGED — UNKNOWN/REJECTED advance; REWORKED excluded.
        outcome: { in: ['UNKNOWN', 'REJECTED'] },
        task: { status: 'DONE' },
      },
      data: { outcome: 'MERGED' },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/repositories/lineage-edge.repository.test.ts`
Expected: FAIL — `stampDoneTaskEdges is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/repositories/lineage-edge.repository.ts`, add this method to the `lineageEdgeRepository` object immediately after `stampOutcomeByTask` (after its closing `},`, ~line 250):

```ts
  /**
   * Self-heal sweep for the lineage backfill (LUM-296). Stamps MERGED onto
   * every edge whose task is DONE and whose current outcome is still eligible
   * to advance (see {@link STAMPABLE_FROM}). This is the reconciliation path
   * for edges born *after* their task reached a terminal state: the
   * event-forward triggers (PR webhook / task→DONE) fired before the edge
   * existed and never re-fire, leaving it permanently UNKNOWN without this.
   *
   * System-wide (no workspace filter) — the caller is a system cron. Reuses the
   * same STAMPABLE_FROM.MERGED set as stampOutcomeByTask, so it is monotonic
   * (REWORKED is never in that set → reopened-then-remerged history is
   * preserved) and idempotent (a re-run after a full sweep changes nothing).
   * Returns Prisma's `{ count }` of rows changed.
   */
  async stampDoneTaskEdges(tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.lineageEdge.updateMany({
      where: {
        outcome: { in: STAMPABLE_FROM.MERGED },
        task: { status: 'DONE' },
      },
      data: { outcome: 'MERGED' },
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/repositories/lineage-edge.repository.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes add lib/repositories/lineage-edge.repository.ts __tests__/repositories/lineage-edge.repository.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes commit -m "feat: add lineageEdgeRepository.stampDoneTaskEdges sweep [LUM-296]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `lineageOutcomeService.sweepDoneTaskEdges` — service wrapper

**Files:**
- Modify: `lib/services/lineage-outcome.service.ts` (add method to `lineageOutcomeService`, ~after line 45)
- Test: `__tests__/lib/services/lineage-outcome.service.test.ts` (modify — add the repo mock method + a describe block)

- [ ] **Step 1: Write the failing test**

In `__tests__/lib/services/lineage-outcome.service.test.ts`, extend the existing repository mock to include the new method. Change the mock factory near the top:

```ts
const mockStampOutcomeByTask = jest.fn()
const mockStampDoneTaskEdges = jest.fn()

jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    stampOutcomeByTask: (...args: any[]) => mockStampOutcomeByTask(...args),
    stampDoneTaskEdges: (...args: any[]) => mockStampDoneTaskEdges(...args),
  },
}))
```

Add `mockStampDoneTaskEdges.mockResolvedValue({ count: 0 })` inside the existing top-level `beforeEach`, alongside the existing `mockStampOutcomeByTask.mockResolvedValue(...)`.

Then add a new describe block (e.g. after the `stampForTaskReopened` block):

```ts
  describe('sweepDoneTaskEdges', () => {
    it('delegates to the repository sweep and returns its count', async () => {
      mockStampDoneTaskEdges.mockResolvedValue({ count: 546 })

      const result = await lineageOutcomeService.sweepDoneTaskEdges()

      expect(result).toEqual({ count: 546 })
      expect(mockStampDoneTaskEdges).toHaveBeenCalledTimes(1)
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/lib/services/lineage-outcome.service.test.ts`
Expected: FAIL — `lineageOutcomeService.sweepDoneTaskEdges is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/services/lineage-outcome.service.ts`, add this method to the `lineageOutcomeService` object (after `stampForTaskReopened`, before the closing `}` of the object, ~line 45):

```ts
  /**
   * Sweep every DONE task's still-open lineage edges to MERGED (LUM-296, DoD
   * ③/⑤). Reconciles edges born *after* their task's terminal event — which the
   * event-forward triggers can never reach. Called by the resident cron; its
   * first post-deploy run backfills the existing UNKNOWN backlog. Idempotent.
   */
  async sweepDoneTaskEdges() {
    return lineageEdgeRepository.stampDoneTaskEdges()
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/lib/services/lineage-outcome.service.test.ts`
Expected: PASS (all prior tests + the new one).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes add lib/services/lineage-outcome.service.ts __tests__/lib/services/lineage-outcome.service.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes commit -m "feat: add lineageOutcomeService.sweepDoneTaskEdges [LUM-296]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Birth-time stamp in `recordSessionStartEdges`

**Files:**
- Modify: `lib/services/lineage.service.ts` (import `taskRepository`; stamp after `createMany`, ~line 101–109)
- Test: `__tests__/services/lineage.service.test.ts` (modify — extend repo mock + add cases)

- [ ] **Step 1: Write the failing test**

In `__tests__/services/lineage.service.test.ts`, the repository is mocked at the top with only `createMany`. Extend that mock and add a `taskRepository` mock. Replace the existing `jest.mock('@/lib/repositories/lineage-edge.repository', ...)` block with:

```ts
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    stampOutcomeByTask: jest.fn().mockResolvedValue({ count: 0 }),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { getStatus: jest.fn().mockResolvedValue('TODO') },
}))
```

Add these imports/handles near the other mock handles (below the existing imports):

```ts
import { taskRepository } from '@/lib/repositories/task.repository'
const mockStampOutcomeByTask = lineageEdgeRepository.stampOutcomeByTask as jest.Mock
const mockGetStatus = taskRepository.getStatus as jest.Mock
```

In the existing `beforeEach`, after the `mockResolve.mockImplementation(...)` line, add:

```ts
  mockGetStatus.mockResolvedValue('TODO')
```

Then add a new describe block at the end of the file (before the final closing brace of the file if any, otherwise at top level):

```ts
describe('recordSessionStartEdges — birth-time outcome stamp (LUM-296)', () => {
  const input = {
    workspaceId: 'ws-1',
    taskId: 't-1',
    sessionId: 's-1',
    fragments: [{ fragmentType: 'WEB_LINK' as const, fragmentId: 'web-1' }],
  }

  it('stamps MERGED at birth when the task is already DONE', async () => {
    mockGetStatus.mockResolvedValue('DONE')

    await lineageService.recordSessionStartEdges(input)

    expect(mockCreateMany).toHaveBeenCalledTimes(1)
    expect(mockGetStatus).toHaveBeenCalledWith('t-1')
    expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'MERGED')
  })

  it('does NOT stamp when the task is not DONE (edges stay UNKNOWN)', async () => {
    mockGetStatus.mockResolvedValue('IN_PROGRESS')

    await lineageService.recordSessionStartEdges(input)

    expect(mockCreateMany).toHaveBeenCalledTimes(1)
    expect(mockStampOutcomeByTask).not.toHaveBeenCalled()
  })

  it('does NOT stamp for an empty fragment list (returns before any work)', async () => {
    mockGetStatus.mockResolvedValue('DONE')

    await lineageService.recordSessionStartEdges({ ...input, fragments: [] })

    expect(mockCreateMany).not.toHaveBeenCalled()
    expect(mockStampOutcomeByTask).not.toHaveBeenCalled()
  })

  it('swallows a stamp failure (best-effort, never throws)', async () => {
    mockGetStatus.mockResolvedValue('DONE')
    mockStampOutcomeByTask.mockRejectedValueOnce(new Error('db down'))

    await expect(
      lineageService.recordSessionStartEdges(input)
    ).resolves.toBeUndefined()
  })
})
```

> Note: the reopen/REWORKED case is covered structurally — a reopened task has `status != 'DONE'`, which the second test exercises (no stamp), and `stampOutcomeByTask(MERGED)` cannot overwrite REWORKED regardless (Task 2's ladder). No extra case needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/services/lineage.service.test.ts`
Expected: FAIL — the "stamps MERGED at birth" test fails because `getStatus`/`stampOutcomeByTask` are never called.

- [ ] **Step 3: Write minimal implementation**

In `lib/services/lineage.service.ts`, add the import near the top with the other repository imports:

```ts
import { taskRepository } from '@/lib/repositories/task.repository'
```

Then, inside `recordSessionStartEdges`, after the existing `await lineageEdgeRepository.createMany(...)` call (ends ~line 109) and before the `catch`, add:

```ts

      // LUM-296: edges are usually born *after* the task's terminal event, so
      // the event-forward outcome triggers (webhook / task→DONE) already fired
      // and will never re-fire. If the task is already DONE, stamp the new
      // edges MERGED now. Monotonic + idempotent (stampOutcomeByTask), and
      // safe for reopened tasks: a reopened task is status != DONE, so its
      // rework edges correctly stay UNKNOWN until it is DONE again. Stragglers
      // (and pre-existing edges) are caught by the cron sweep.
      const status = await taskRepository.getStatus(taskId)
      if (status === 'DONE') {
        await lineageEdgeRepository.stampOutcomeByTask(taskId, 'MERGED')
      }
```

Update the method's JSDoc line that currently reads `` `outcome` is left UNKNOWN (stamped later by LUM-277);`` to reflect the new behavior — replace that clause with:

```ts
   * `outcome` is left UNKNOWN at insert; if the task is already DONE it is then
   * stamped MERGED in the same call (LUM-296), else stamped later by LUM-277.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/services/lineage.service.test.ts`
Expected: PASS (all existing tests + 4 new ones).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes add lib/services/lineage.service.ts __tests__/services/lineage.service.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes commit -m "feat: stamp lineage edges MERGED at birth when task already DONE [LUM-296]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Cron route + `vercel.json` registration

**Files:**
- Create: `app/api/cron/backfill-lineage-outcomes/route.ts`
- Modify: `vercel.json` (add to the `crons` array)
- Test: `__tests__/api/cron-backfill-lineage-outcomes.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/cron-backfill-lineage-outcomes.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/services/lineage-outcome.service', () => ({
  lineageOutcomeService: { sweepDoneTaskEdges: jest.fn() },
}))

import { GET } from '@/app/api/cron/backfill-lineage-outcomes/route'
import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'

const mockSweep = lineageOutcomeService.sweepDoneTaskEdges as jest.Mock

const OLD_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...OLD_ENV, CRON_SECRET: 'secret' }
})
afterAll(() => {
  process.env = OLD_ENV
})

function req(auth?: string) {
  return new NextRequest('http://localhost/api/cron/backfill-lineage-outcomes', {
    headers: auth ? { authorization: auth } : {},
  })
}

it('rejects an unauthorized request', async () => {
  const res = await GET(req('Bearer wrong'))
  expect(res.status).toBe(401)
  expect(mockSweep).not.toHaveBeenCalled()
})

it('runs the sweep for an authorized cron request', async () => {
  mockSweep.mockResolvedValue({ count: 546 })
  const res = await GET(req('Bearer secret'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ count: 546 })
  expect(mockSweep).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/api/cron-backfill-lineage-outcomes.test.ts`
Expected: FAIL — cannot find module `@/app/api/cron/backfill-lineage-outcomes/route`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/cron/backfill-lineage-outcomes/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'

/**
 * GET /api/cron/backfill-lineage-outcomes
 * Hourly Vercel Cron (LUM-296). Stamps MERGED onto every DONE task's
 * still-open lineage edges — the reconciliation path for edges born *after*
 * their task's terminal event, which the event-forward triggers (PR webhook /
 * task→DONE) can never reach. The first post-deploy run backfills the existing
 * UNKNOWN backlog; subsequent runs catch stragglers. Idempotent.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await lineageOutcomeService.sweepDoneTaskEdges()
  return NextResponse.json(result)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest __tests__/api/cron-backfill-lineage-outcomes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Register the cron in `vercel.json`**

Add this entry to the `crons` array in `vercel.json` (after the existing `check-agent-timeouts` entry, keeping valid JSON — comma-separate):

```json
    {
      "path": "/api/cron/backfill-lineage-outcomes",
      "schedule": "0 * * * *"
    }
```

The resulting `crons` array:

```json
{
  "crons": [
    {
      "path": "/api/cron/check-agent-timeouts",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/backfill-lineage-outcomes",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/summaries/generate",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/roll-sprints",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/cron/prune-document-revisions",
      "schedule": "0 3 * * *"
    }
  ]
}
```

- [ ] **Step 6: Verify JSON is valid**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('vercel.json OK')"`
Expected: `vercel.json OK`.

- [ ] **Step 7: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes add app/api/cron/backfill-lineage-outcomes/route.ts vercel.json __tests__/api/cron-backfill-lineage-outcomes.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes commit -m "feat: hourly cron to backfill + self-heal lineage outcomes [LUM-296]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full lineage + cron test surface**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest \
  __tests__/lib/repositories/task.repository.getStatus.test.ts \
  __tests__/repositories/lineage-edge.repository.test.ts \
  __tests__/lib/services/lineage-outcome.service.test.ts \
  __tests__/services/lineage.service.test.ts \
  __tests__/api/cron-backfill-lineage-outcomes.test.ts
```
Expected: all suites PASS.

- [ ] **Step 2: Guard against regressions in the broader lineage/task suites**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx jest lineage task.repository task-state task.service`
Expected: PASS (no regression in the 85 existing lineage tests or the task suites). Investigate any failure before proceeding.

- [ ] **Step 3: Type-check (atomic prisma generate + tsc per worktree gotcha)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npx prisma generate && npx tsc --noEmit`
Expected: no errors. (No schema change, but `prisma generate` ensures the shared client matches before trusting `tsc` — see `project_prisma_client_reset_before_tsc`.)

- [ ] **Step 4: Confirm no `console.log` / forbidden patterns were introduced**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && git -C . diff main --name-only && grep -rn "console.log" app/api/cron/backfill-lineage-outcomes lib/services/lineage.service.ts lib/services/lineage-outcome.service.ts lib/repositories/lineage-edge.repository.ts lib/repositories/task.repository.ts || echo "no console.log"`
Expected: `no console.log`.

- [ ] **Step 5: Final verification before PR**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-296-backfill-lineage-outcomes && npm run build`
Expected: build succeeds (the only CI gate is the Vercel build — see `project_lumo_shared_into_next_build_needs_prebuild`). If `build` is too slow/heavy locally, at minimum the `tsc --noEmit` in Step 3 must pass.

---

## Notes on production rollout (no migration)

- **No schema change** → no `prisma migrate deploy` needed. The `outcome` column already exists.
- The **first post-deploy cron run** (top of the next hour, or trigger manually with the `CRON_SECRET` bearer) performs the one-time backfill of the existing ~546 edges.
- **Post-deploy DoD check (read-only):** `lumo task lineage LUM-263` should no longer be all-UNKNOWN; `lumo task context` for a fragment with merged history should render the merge-rate signal. Prod verification stays read-only.
- The sweep `updateMany` joins on `task.status` (no index on `outcome`); fine at current table size (~546 rows). Revisit an index only if the table grows large.

---

## Self-Review

- **Spec coverage:** Birth-time stamp → Task 4. Sweep repo method → Task 2. Service wrapper → Task 3. Cron + vercel.json → Task 5. `task.status==='DONE'` criterion → Tasks 2 & 4. Reuse of `STAMPABLE_FROM` single source → Task 2. Born-after-merge test scenario → Tasks 2/3/4 (the cases the existing 85 mock-Prisma tests miss). Terminal-rollout/no-migration → Notes. All spec sections covered.
- **Placeholder scan:** none — every code/test step contains full code.
- **Type consistency:** `getStatus(id): Promise<TaskStatus | null>` (Task 1) used in Task 4; `stampDoneTaskEdges()` (Task 2) called by `sweepDoneTaskEdges()` (Task 3) called by the cron route (Task 5); `stampOutcomeByTask(taskId, 'MERGED')` matches the existing repo signature. `STAMPABLE_FROM.MERGED = ['UNKNOWN','REJECTED']` matches the asserted literal in Task 2's test. Consistent throughout.
