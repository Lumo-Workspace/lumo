# Lineage Edge Birth at Session-Start — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a bound Claude Code session consumes its injected context bundle at session-start, automatically record one `LineageEdge` per actually-injected fragment, keyed by `(sessionId, taskId, fragmentType, fragmentId)`.

**Architecture:** The `session-start` hook's `afterRecord` already builds 4 context sections. Each builder is extended to also return the fragments it injected (`FragmentRef[]`). The route aggregates them and fires a non-blocking `waitUntil(lineageService.recordSessionStartEdges(...))`, which canonicalizes MEMORY ids, de-dupes, and batch-inserts with `skipDuplicates`. A new unique index makes re-fires (resume/clear/compact) idempotent.

**Tech Stack:** Next.js App Router route handler, Prisma (Neon Postgres), `@vercel/functions` `waitUntil`, Jest (SWC, Prisma mocked).

**Worktree:** `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth` (branch `lumo/LUM-276-lineage-edge-birth`). Run **all** jest from inside this worktree (`cd` first) to avoid the cli/package.json haste collision. Do **not** run `prisma generate` mid-work — it clobbers the shared symlinked client; generate once atomically in Task 5.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `prisma/schema.prisma` | `LineageEdge` model | Add `@@unique([sessionId, taskId, fragmentType, fragmentId])` |
| `prisma/migrations/20260606150000_lineage_edge_session_task_unique/migration.sql` | DB unique index | Create |
| `lib/repositories/lineage-edge.repository.ts` | `createMany` | Pass `skipDuplicates: true` |
| `lib/services/lineage.service.ts` | `recordSessionStartEdges` write orchestration | Create |
| `lib/services/task-context.service.ts` | 4 session-start builders + `PreviousSessionRecovery` | Modify to emit `FragmentRef[]` / `sessionId` |
| `app/api/hooks/session-start/route.ts` | Aggregate fragments, fire `waitUntil` | Modify |
| `__tests__/lineage-edge.repository.test.ts` | repo `skipDuplicates` | Extend |
| `__tests__/services/lineage.service.test.ts` | service unit | Create |
| `__tests__/services/session-start-fragments.test.ts` | builder manifests | Create |
| `__tests__/api/hooks/session-start-memory-injection.test.ts` | existing route test | Update mocks for new return shapes |
| `__tests__/api/hooks/session-start-lineage.test.ts` | route wiring → recordSessionStartEdges | Create |
| `__tests__/context/session-start-sections.test.ts` | existing builder test | Update for `fragments` field |

---

## Task 1: Unique index + repo `skipDuplicates`

**Files:**
- Modify: `prisma/schema.prisma` (LineageEdge model, ~line 1879-1906)
- Create: `prisma/migrations/20260606150000_lineage_edge_session_task_unique/migration.sql`
- Modify: `lib/repositories/lineage-edge.repository.ts:57-67`
- Test: `__tests__/lineage-edge.repository.test.ts`

- [ ] **Step 1: Add the unique constraint to the schema**

In `prisma/schema.prisma`, inside `model LineageEdge`, add the `@@unique` line alongside the existing `@@index` lines (just before `@@map("lineage_edges")`):

```prisma
  @@unique([sessionId, taskId, fragmentType, fragmentId])
  @@index([fragmentType, fragmentId])
  @@index([taskId])
  @@index([workspaceId])
  @@map("lineage_edges")
```

- [ ] **Step 2: Hand-author the migration SQL**

Create `prisma/migrations/20260606150000_lineage_edge_session_task_unique/migration.sql`:

```sql
-- CreateIndex
CREATE UNIQUE INDEX "lineage_edges_sessionId_taskId_fragmentType_fragmentId_key" ON "lineage_edges"("sessionId", "taskId", "fragmentType", "fragmentId");
```

> Note: `sessionId` is nullable; Postgres treats NULLs as distinct, so existing/future runId-only rows (sessionId NULL) never collide. Table is empty in all envs (no writers shipped yet), so the index applies cleanly.

- [ ] **Step 3: Add a failing repo test for `skipDuplicates`**

In `__tests__/lineage-edge.repository.test.ts`, inside `describe('createMany', ...)`, add:

```ts
    it('passes skipDuplicates: true so re-injection is idempotent at the DB layer', async () => {
      mockCreateMany.mockResolvedValue({ count: 1 })

      await lineageEdgeRepository.createMany([
        {
          workspaceId: 'ws-1',
          taskId: 't-1',
          fragmentType: 'MEMORY',
          fragmentId: 'mem-1',
          sessionId: 's-1',
        },
      ])

      expect(mockCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true })
      )
    })
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx jest __tests__/lineage-edge.repository.test.ts -t "skipDuplicates"`
Expected: FAIL — `skipDuplicates` not present in the call.

- [ ] **Step 5: Add `skipDuplicates` in the repository**

In `lib/repositories/lineage-edge.repository.ts`, update the `createMany` call (lines 57-67):

```ts
    return client.lineageEdge.createMany({
      skipDuplicates: true,
      data: inputs.map(i => ({
        workspaceId: i.workspaceId,
        taskId: i.taskId,
        fragmentType: i.fragmentType,
        fragmentId: i.fragmentId,
        sessionId: i.sessionId ?? null,
        runId: i.runId ?? null,
        ...(i.outcome ? { outcome: i.outcome } : {}),
      })),
    })
```

Also update the JSDoc on `createMany` (line 45-50) to mention idempotence:

```ts
  /**
   * Batch-insert lineage edges. No-op (returns `{ count: 0 }`) for an empty
   * batch so callers can pass the result of a filter without guarding. Optional
   * `sessionId`/`runId` default to NULL; `outcome` is omitted unless provided so
   * the column default (UNKNOWN) applies. `skipDuplicates` makes re-injection of
   * the same (sessionId, taskId, fragmentType, fragmentId) a no-op — session-start
   * fires more than once per session (resume/clear/compact).
   */
```

- [ ] **Step 6: Run the repo test suite**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx jest __tests__/lineage-edge.repository.test.ts`
Expected: PASS (all existing + new test).

- [ ] **Step 7: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth
git add prisma/schema.prisma prisma/migrations/20260606150000_lineage_edge_session_task_unique/migration.sql lib/repositories/lineage-edge.repository.ts __tests__/lineage-edge.repository.test.ts
git commit -m "feat: unique index + skipDuplicates for idempotent lineage edges [LUM-276]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `lineage.service.ts` — `recordSessionStartEdges`

**Files:**
- Create: `lib/services/lineage.service.ts`
- Test: `__tests__/services/lineage.service.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `__tests__/services/lineage.service.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
}))
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    resolveCanonicalFragment: jest.fn(async (_type: string, id: string) => id),
  },
}))

import { lineageService } from '@/lib/services/lineage.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'

const mockCreateMany = lineageEdgeRepository.createMany as jest.Mock
const mockResolve = memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockResolve.mockImplementation(async (_type: string, id: string) => id)
})

describe('lineageService.recordSessionStartEdges', () => {
  it('no-ops (no createMany call) for an empty fragment list', async () => {
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [],
    })
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('stamps workspace/task/session and leaves runId/outcome unset', async () => {
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [{ fragmentType: 'WEB_LINK', fragmentId: 'web-1' }],
    })
    expect(mockCreateMany).toHaveBeenCalledWith([
      {
        workspaceId: 'ws-1',
        taskId: 't-1',
        fragmentType: 'WEB_LINK',
        fragmentId: 'web-1',
        sessionId: 's-1',
      },
    ])
  })

  it('resolves MEMORY fragments to their canonical id', async () => {
    mockResolve.mockImplementation(async (type: string, id: string) =>
      type === 'MEMORY' && id === 'mem-task' ? 'mem-project' : id
    )
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [{ fragmentType: 'MEMORY', fragmentId: 'mem-task' }],
    })
    expect(mockResolve).toHaveBeenCalledWith('MEMORY', 'mem-task')
    expect(mockCreateMany).toHaveBeenCalledWith([
      expect.objectContaining({ fragmentType: 'MEMORY', fragmentId: 'mem-project' }),
    ])
  })

  it('de-dupes fragments that collapse to the same type+id after canonicalization', async () => {
    // A TASK memory and its promoted PROJECT memory both injected this session.
    mockResolve.mockImplementation(async (_type: string, id: string) =>
      id === 'mem-task' ? 'mem-project' : id
    )
    await lineageService.recordSessionStartEdges({
      workspaceId: 'ws-1',
      taskId: 't-1',
      sessionId: 's-1',
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'mem-task' },
        { fragmentType: 'MEMORY', fragmentId: 'mem-project' },
      ],
    })
    const arg = mockCreateMany.mock.calls[0][0]
    expect(arg).toHaveLength(1)
    expect(arg[0]).toMatchObject({ fragmentType: 'MEMORY', fragmentId: 'mem-project' })
  })

  it('swallows a repository failure (best-effort side effect)', async () => {
    mockCreateMany.mockRejectedValueOnce(new Error('db down'))
    await expect(
      lineageService.recordSessionStartEdges({
        workspaceId: 'ws-1',
        taskId: 't-1',
        sessionId: 's-1',
        fragments: [{ fragmentType: 'PR', fragmentId: 'pr-1' }],
      })
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx jest __tests__/services/lineage.service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/lineage.service'`.

- [ ] **Step 3: Implement the service**

Create `lib/services/lineage.service.ts`:

```ts
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'

export interface SessionStartEdgeInput {
  workspaceId: string
  taskId: string
  /** Always present — callers must guard `binding.bound` + sessionId first. */
  sessionId: string
  /** Fragments actually injected this session-start (post-budget). */
  fragments: FragmentRef[]
}

/** Stable key for in-memory de-dup, mirrors the DB unique constraint's fragment half. */
function fragmentKey(f: FragmentRef): string {
  return `${f.fragmentType}::${f.fragmentId}`
}

export const lineageService = {
  /**
   * Persist one lineage edge per fragment a bound session consumed at
   * session-start. MEMORY ids are canonicalized (promoted PROJECT id, not the
   * pre-consolidation TASK cuid). Duplicates that collapse after canonicalization
   * are dropped in-memory; the DB unique index + `skipDuplicates` absorb re-fires
   * of the same session. `outcome` is left UNKNOWN (stamped later by LUM-277);
   * `runId` stays NULL (session-start precedes any agent run).
   *
   * Best-effort: must never throw — it runs inside the hook's `waitUntil` and a
   * failure must not affect context injection.
   */
  async recordSessionStartEdges(input: SessionStartEdgeInput): Promise<void> {
    try {
      const { workspaceId, taskId, sessionId, fragments } = input
      if (fragments.length === 0) return

      const resolved: FragmentRef[] = await Promise.all(
        fragments.map(async f => ({
          fragmentType: f.fragmentType,
          fragmentId: await memoryProvenanceRepository.resolveCanonicalFragment(
            f.fragmentType,
            f.fragmentId
          ),
        }))
      )

      const seen = new Set<string>()
      const unique = resolved.filter(f => {
        const key = fragmentKey(f)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      await lineageEdgeRepository.createMany(
        unique.map(f => ({
          workspaceId,
          taskId,
          fragmentType: f.fragmentType,
          fragmentId: f.fragmentId,
          sessionId,
        }))
      )
    } catch (err) {
      // Best-effort: mirror _handler/task-state.service error logging.
      console.error('lineageService.recordSessionStartEdges failed:', err)
    }
  },
}
```

- [ ] **Step 4: Run the service test**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx jest __tests__/services/lineage.service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth
git add lib/services/lineage.service.ts __tests__/services/lineage.service.test.ts
git commit -m "feat: lineageService.recordSessionStartEdges with canonical+dedup [LUM-276]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Extend the 4 session-start builders to emit fragments

**Files:**
- Modify: `lib/services/task-context.service.ts` (`PreviousSessionRecovery` interface ~line 63; `buildSessionStartSections` ~456-511; `buildReviewTodosSectionForTask` ~525-528; `buildLayer2ReviewSectionForTask` ~583-607)
- Test: `__tests__/services/session-start-fragments.test.ts` (create)
- Update: `__tests__/context/session-start-sections.test.ts` (existing assertions on builder return shapes)

- [ ] **Step 1: Write failing builder-manifest tests**

Create `__tests__/services/session-start-fragments.test.ts`:

```ts
/** @jest-environment node */
// LUM-276: each session-start builder must return the fragments it actually
// injected (post-budget), so the route can record one lineage edge per fragment.

jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findById: jest.fn(async () => ({ id: 't-1', projectId: 'proj-1' })),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: jest.fn().mockResolvedValue([]),
    findActiveProjectMemories: jest.fn().mockResolvedValue([]),
    findProjectMemoriesBySession: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/task-slack-context.repository', () => ({
  taskSlackContextRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/services/task-figma-link.service', () => ({
  taskFigmaLinkService: { listForTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { listByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findPreviousSessionIdForMember: jest.fn().mockResolvedValue(null),
  },
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'

describe('buildSessionStartSections — fragment manifest', () => {
  it('records every candidate memory + linked resource (overflow degrades to manifest, not dropped)', async () => {
    ;(memoryRepository.findActiveProjectMemories as jest.Mock).mockResolvedValue([
      { id: 'mem-p', category: 'TRAP', content: { trigger: 'x', mitigation: 'y' } },
    ])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([
      { id: 'mem-t', category: 'DECISION', content: { what: 'a', why: 'b' } },
    ])
    ;(taskWebLinkRepository.listByTask as jest.Mock).mockResolvedValue([
      { id: 'web-1', url: 'http://x', title: 'X' },
    ])

    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual(
      expect.arrayContaining([
        { fragmentType: 'MEMORY', fragmentId: 'mem-p' },
        { fragmentType: 'MEMORY', fragmentId: 'mem-t' },
        { fragmentType: 'WEB_LINK', fragmentId: 'web-1' },
      ])
    )
  })

  it('returns an empty manifest when the task has nothing attached', async () => {
    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual([])
  })
})

describe('buildLayer2ReviewSectionForTask — fragment manifest', () => {
  it('records only the budget survivors as MEMORY fragments', async () => {
    ;(memoryRepository.findProjectMemoriesBySession as jest.Mock).mockResolvedValue([
      { id: 'mem-a', category: 'TRAP', content: { trigger: 't', mitigation: 'm' } },
    ])
    const { sessionRepository } = jest.requireMock(
      '@/lib/repositories/session.repository'
    )
    sessionRepository.findPreviousSessionIdForMember.mockResolvedValue('prev-s')

    const out = await taskContextService.buildLayer2ReviewSectionForTask('t-1', 'cur-s')
    expect(out.fragments).toEqual([{ fragmentType: 'MEMORY', fragmentId: 'mem-a' }])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx jest __tests__/services/session-start-fragments.test.ts`
Expected: FAIL — `out.fragments` is `undefined`.

- [ ] **Step 3: Add the `FragmentRef` import**

In `lib/services/task-context.service.ts`, near the other `@/lib/repositories` imports, add:

```ts
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
```

- [ ] **Step 4: Extend `buildSessionStartSections`**

Change its return type and body. Update the signature (line ~456-458):

```ts
  async buildSessionStartSections(
    taskId: string
  ): Promise<{
    memorySection: string
    linkedResourcesSection: string
    fragments: FragmentRef[]
  }> {
    const empty = { memorySection: '', linkedResourcesSection: '', fragments: [] }
```

Then, just before the final `return { ... }` (after `linkedJoined` is computed, ~line 505), build the manifest from the already-fetched candidate lists and return it (overflow degrades to a manifest line, so **all** candidates count as injected):

```ts
    const fragments: FragmentRef[] = [
      ...orderedMemories.map(m => ({
        fragmentType: 'MEMORY' as const,
        fragmentId: m.id,
      })),
      ...slack.map(s => ({ fragmentType: 'SLACK_CONTEXT' as const, fragmentId: s.id })),
      ...web.map(w => ({ fragmentType: 'WEB_LINK' as const, fragmentId: w.id })),
      ...figma.map(f => ({ fragmentType: 'FIGMA' as const, fragmentId: f.id })),
      ...prs.map(p => ({ fragmentType: 'PR' as const, fragmentId: p.id })),
    ]

    return {
      memorySection: wrapUntrustedMemory(memoryOut),
      linkedResourcesSection: wrapUntrustedLinked(linkedJoined),
      fragments,
    }
```

> `orderedMemories` already carries `.id` for both PROJECT and TASK memories; `slack`/`web`/`figma`/`prs` are the raw repository rows (each has `.id`) — the `as unknown as …Card[]` casts elsewhere are only for the budget renderers and don't affect `.id` access here.

- [ ] **Step 5: Extend `buildLayer2ReviewSectionForTask`**

Change its return type to an object and capture the budget survivors. Replace the method body's tail (lines ~599-607):

```ts
  async buildLayer2ReviewSectionForTask(
    taskId: string,
    currentSessionId: string
  ): Promise<{ section: string; fragments: FragmentRef[] }> {
    const empty = { section: '', fragments: [] }
    const task = await taskRepository.findById(taskId)
    if (!task) return empty

    const prevSessionId =
      await sessionRepository.findPreviousSessionIdForMember(currentSessionId)
    if (!prevSessionId) return empty

    const promoted = await memoryRepository.findProjectMemoriesBySession(
      prevSessionId,
      task.projectId
    )
    if (promoted.length === 0) return empty

    const ordered: RenderableMemory[] = promoted.map(m => ({
      id: m.id,
      scope: 'PROJECT' as const,
      category: m.category,
      content: m.content,
    }))
    const survivors = applyTokenBudget(ordered)
    return {
      section: renderLayer2ReviewSection(survivors),
      fragments: survivors.map(m => ({
        fragmentType: 'MEMORY' as const,
        fragmentId: m.id,
      })),
    }
  },
```

- [ ] **Step 6: Extend `buildReviewTodosSectionForTask`**

`collectReviewTodos` already returns `fragmentIds`. Change the wrapper to surface them as `PR_REVIEW_TODO` fragments. Replace the method (lines ~525-528):

```ts
  async buildReviewTodosSectionForTask(
    taskId: string
  ): Promise<{ section: string; fragments: FragmentRef[] }> {
    const { todos, fragmentIds } = await collectReviewTodos(taskId)
    return {
      section: renderPrReviewTodosSection(todos),
      fragments: fragmentIds.map(id => ({
        fragmentType: 'PR_REVIEW_TODO' as const,
        fragmentId: id,
      })),
    }
  },
```

- [ ] **Step 7: Add `sessionId` to `PreviousSessionRecovery`**

Update the interface (line ~63):

```ts
export interface PreviousSessionRecovery {
  /** The prior session's id — recorded as a SESSION lineage fragment (LUM-276). */
  sessionId: string
  headline: string
  unresolved: string[]
  durationMs: number
  lastActivityAt: string
}
```

Then populate it in `buildPreviousSessionRecoveryForTask` (the `return { ... }` at ~line 550):

```ts
      return {
        sessionId: s.id,
        headline,
        unresolved: summaryUnresolved(s.summary, s.summaryType),
        durationMs: Math.max(
          0,
          s.lastActivityAt.getTime() - s.startedAt.getTime()
        ),
        lastActivityAt: s.lastActivityAt.toISOString(),
      }
```

- [ ] **Step 8: Update the existing builder test for the new shapes**

In `__tests__/context/session-start-sections.test.ts`, any assertion comparing the full `buildSessionStartSections` return with `toEqual({ memorySection, linkedResourcesSection })` must add `fragments`. Find such assertions:

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && grep -n "linkedResourcesSection" __tests__/context/session-start-sections.test.ts`

For each strict `toEqual`/`toMatchObject` on the whole object, either switch to `toMatchObject` (ignores the extra `fragments` key) or append `fragments: expect.any(Array)`. Leave assertions that read individual fields (`.memorySection`) unchanged.

- [ ] **Step 9: Run both builder test files**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx jest __tests__/services/session-start-fragments.test.ts __tests__/context/session-start-sections.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth
git add lib/services/task-context.service.ts __tests__/services/session-start-fragments.test.ts __tests__/context/session-start-sections.test.ts
git commit -m "feat: session-start builders emit injected fragment manifests [LUM-276]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire the session-start route

**Files:**
- Modify: `app/api/hooks/session-start/route.ts`
- Update: `__tests__/api/hooks/session-start-memory-injection.test.ts` (mocks now return new shapes)
- Test: `__tests__/api/hooks/session-start-lineage.test.ts` (create)

- [ ] **Step 1: Write the failing route-wiring test**

Create `__tests__/api/hooks/session-start-lineage.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findTaskBinding: jest.fn() },
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildSessionStartSections: jest.fn(),
    buildReviewTodosSectionForTask: jest.fn(),
    buildPreviousSessionRecoveryForTask: jest.fn(),
    buildLayer2ReviewSectionForTask: jest.fn(),
  },
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: { recordSessionStartEdges: jest.fn().mockResolvedValue(undefined) },
}))
// waitUntil must run its argument synchronously so the test can observe the call.
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskContextService } from '@/lib/services/task-context.service'
import { lineageService } from '@/lib/services/lineage.service'
import { POST } from '@/app/api/hooks/session-start/route'

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function post(body: unknown) {
  return new Request('http://x/api/hooks/session-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lum_ok' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(authService.verifyApiKey as jest.Mock).mockResolvedValue(identity)
  ;(hookEventService.recordHookEvent as jest.Mock).mockResolvedValue({
    id: 'he_1',
    sessionId: 's-1',
    taskId: 'task-1',
  })
})

describe('POST /api/hooks/session-start — lineage edge birth', () => {
  it('aggregates fragments from all builders and records edges for the bound session', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: true,
      taskId: 'task-1',
    })
    ;(taskContextService.buildSessionStartSections as jest.Mock).mockResolvedValue({
      memorySection: 'm',
      linkedResourcesSection: 'l',
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
        { fragmentType: 'PR', fragmentId: 'pr-1' },
      ],
    })
    ;(taskContextService.buildReviewTodosSectionForTask as jest.Mock).mockResolvedValue({
      section: '',
      fragments: [{ fragmentType: 'PR_REVIEW_TODO', fragmentId: 'todo-1' }],
    })
    ;(taskContextService.buildLayer2ReviewSectionForTask as jest.Mock).mockResolvedValue({
      section: '',
      fragments: [{ fragmentType: 'MEMORY', fragmentId: 'mem-proj' }],
    })
    ;(taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock).mockResolvedValue({
      sessionId: 'prev-s',
      headline: 'h',
      unresolved: [],
      durationMs: 0,
      lastActivityAt: '2026-06-06T00:00:00.000Z',
    })

    const res = await POST(post({ sessionId: 's-1' }))
    expect((await res.json()).ok).toBe(true)

    expect(lineageService.recordSessionStartEdges).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      taskId: 'task-1',
      sessionId: 's-1',
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
        { fragmentType: 'PR', fragmentId: 'pr-1' },
        { fragmentType: 'PR_REVIEW_TODO', fragmentId: 'todo-1' },
        { fragmentType: 'MEMORY', fragmentId: 'mem-proj' },
        { fragmentType: 'SESSION', fragmentId: 'prev-s' },
      ],
    })
  })

  it('does not record edges when the session is unbound', async () => {
    ;(sessionRepository.findTaskBinding as jest.Mock).mockResolvedValue({
      bound: false,
    })
    await POST(post({ sessionId: 's-1' }))
    expect(lineageService.recordSessionStartEdges).not.toHaveBeenCalled()
  })

  it('does not record edges when there is no sessionId', async () => {
    ;(hookEventService.recordHookEvent as jest.Mock).mockResolvedValue({
      id: 'he_2',
      sessionId: null,
      taskId: null,
    })
    await POST(post({}))
    expect(lineageService.recordSessionStartEdges).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx jest __tests__/api/hooks/session-start-lineage.test.ts`
Expected: FAIL — route doesn't call `recordSessionStartEdges` / new builder shapes not consumed.

- [ ] **Step 3: Rewrite the route**

Replace `app/api/hooks/session-start/route.ts` with:

```ts
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'
import {
  taskContextService,
  type PreviousSessionRecovery,
} from '@/lib/services/task-context.service'
import { lineageService } from '@/lib/services/lineage.service'
import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
import { waitUntil } from '@vercel/functions'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const sessionId = ctx.sessionId
      const binding = await sessionRepository.findTaskBinding(sessionId)
      let memorySection = ''
      let linkedResourcesSection = ''
      let reviewTodosSection = ''
      let layer2ReviewSection = ''
      let previousSession: PreviousSessionRecovery | null = null
      if (binding.bound === true) {
        const [sections, todos, previous, layer2Review] = await Promise.all([
          taskContextService.buildSessionStartSections(binding.taskId),
          taskContextService.buildReviewTodosSectionForTask(binding.taskId),
          taskContextService.buildPreviousSessionRecoveryForTask(
            binding.taskId,
            sessionId
          ),
          taskContextService.buildLayer2ReviewSectionForTask(
            binding.taskId,
            sessionId
          ),
        ])
        memorySection = sections.memorySection
        linkedResourcesSection = sections.linkedResourcesSection
        reviewTodosSection = todos.section
        previousSession = previous
        layer2ReviewSection = layer2Review.section

        // LUM-276: record one lineage edge per fragment this session consumed.
        // Fire-and-forget — must not block or fail the context injection.
        const fragments: FragmentRef[] = [
          ...sections.fragments,
          ...todos.fragments,
          ...layer2Review.fragments,
          ...(previous
            ? [
                {
                  fragmentType: 'SESSION' as const,
                  fragmentId: previous.sessionId,
                },
              ]
            : []),
        ]
        if (fragments.length > 0) {
          waitUntil(
            lineageService.recordSessionStartEdges({
              workspaceId: ctx.workspaceId,
              taskId: binding.taskId,
              sessionId,
              fragments,
            })
          )
        }
      }
      return {
        sessionId,
        taskBinding: binding,
        memorySection,
        linkedResourcesSection,
        reviewTodosSection,
        layer2ReviewSection,
        previousSession,
      }
    },
  })
}
```

- [ ] **Step 4: Update the existing route test's builder mocks**

The new return shapes break `__tests__/api/hooks/session-start-memory-injection.test.ts` (its mocks return a bare `''` for review-todos and an object without `fragments`). Update the top-level `jest.mock` defaults and every per-test `mockResolvedValue`:

- `buildSessionStartSections` mocks must include `fragments: []` (or a real array).
- `buildReviewTodosSectionForTask` default → `mockResolvedValue({ section: '', fragments: [] })`.
- `buildLayer2ReviewSectionForTask` default → `mockResolvedValue({ section: '', fragments: [] })`.
- Add a `jest.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => p }))` and `jest.mock('@/lib/services/lineage.service', () => ({ lineageService: { recordSessionStartEdges: jest.fn().mockResolvedValue(undefined) } }))` so the route's new imports resolve.

Run the grep to find every occurrence to update:

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && grep -n "buildReviewTodosSectionForTask\|buildLayer2ReviewSectionForTask\|buildSessionStartSections" __tests__/api/hooks/session-start-memory-injection.test.ts`

For each `buildSessionStartSections` mock that returns `{ memorySection, linkedResourcesSection }`, append `, fragments: []`. For the two `…SectionForTask` mocks returning `''`, change to `{ section: '', fragments: [] }`. If any test asserts `body.reviewTodosSection` equals a string, ensure its mock returns `{ section: '<that string>', fragments: [] }`.

- [ ] **Step 5: Run both route test files**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx jest __tests__/api/hooks/session-start-lineage.test.ts __tests__/api/hooks/session-start-memory-injection.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth
git add app/api/hooks/session-start/route.ts __tests__/api/hooks/session-start-lineage.test.ts __tests__/api/hooks/session-start-memory-injection.test.ts
git commit -m "feat: record lineage edges at session-start when a session consumes context [LUM-276]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Atomic verification + PR

**Files:** none (verification + integration)

- [ ] **Step 1: Regenerate the Prisma client (atomic, end-of-work)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx prisma generate`
Expected: client regenerated with the new `@@unique` (no schema errors).

- [ ] **Step 2: Typecheck**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx tsc --noEmit`
Expected: no errors. (Catches `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` issues that SWC jest misses.)

- [ ] **Step 3: Run the full affected jest set**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && npx jest __tests__/lineage-edge.repository.test.ts __tests__/services/lineage.service.test.ts __tests__/services/session-start-fragments.test.ts __tests__/context/session-start-sections.test.ts __tests__/api/hooks/session-start-memory-injection.test.ts __tests__/api/hooks/session-start-lineage.test.ts`
Expected: all PASS.

- [ ] **Step 4: Confirm no migration deletions / stale base**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth && git fetch origin main && git merge origin/main && git diff --name-status origin/main -- prisma/migrations | grep '^D' || echo "no migration deletions"`
Expected: `no migration deletions`. If the merge pulled new migrations, re-run `npx prisma generate` and Step 3.

- [ ] **Step 5: Open the PR**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-276-lineage-edge-birth
git push -u origin lumo/LUM-276-lineage-edge-birth
gh pr create --title "feat: record lineage edges when a session consumes context [LUM-276]" --body "$(cat <<'EOF'
## What
Edges are now *born*: when a bound Claude Code session consumes its session-start context bundle, one `LineageEdge` is recorded per actually-injected fragment (MEMORY / SLACK_CONTEXT / WEB_LINK / FIGMA / PR / PR_REVIEW_TODO / SESSION), keyed by `(sessionId, taskId, fragmentType, fragmentId)`.

## Coverage (DoD ⑥)
Scoped to the **session-start hook** path only — the richest injection surface (memory + linked resources + PR-review todos + Layer-2 review). Manual `task context` (no session) is intentionally skipped so the LUM-278 flywheel denominator isn't biased by non-run reads. Cloud agent-sandbox (runId) instrumentation is a deferred follow-up.

## Key decisions
- "Actually-injected" semantics: `allocateBudget` overflow degrades to a one-line manifest (still injected) → record all candidates; `applyTokenBudget` (Layer-2) drops the tail → record survivors only.
- MEMORY ids canonicalized via `resolveCanonicalFragment` (promoted PROJECT id, LUM-280 drift).
- Idempotent re-fires (resume/clear/compact) via new unique index + `createMany({ skipDuplicates })`.
- Write runs in `waitUntil`, self-catching — never blocks or fails context injection.

## DB
Adds **one additive migration** `20260606150000_lineage_edge_session_task_unique` (a unique index only, no data change). **Requires `prisma migrate deploy` on next deploy.**

## Out of scope
Outcome stamping (LUM-277), per-fragment merge contribution display + audit command (LUM-278), stale-fragment-id cleanup on source delete (known debt).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Coverage scope (session-start only, skip manual, defer sandbox) → Tasks 3+4 + PR body. ✓
- Actually-injected manifest (degrade vs drop) → Task 3 Steps 4-5 + tests. ✓
- All injected fragment types → Task 3 (memory/slack/web/figma/pr/todo/layer2-memory/session). ✓
- Canonical MEMORY resolution → Task 2 service. ✓
- Cross-builder dedup → Task 2 service test. ✓
- Idempotence via unique index + skipDuplicates → Task 1. ✓
- `taskId` in unique key (rebind safety) → Task 1 Step 1-2. ✓
- waitUntil isolation, best-effort → Task 2 (try/catch) + Task 4 (waitUntil). ✓
- "only when bound + sessionId" → Task 4 route guard + tests. ✓
- Migration prod note → PR body. ✓
- Tests (service/builders/route/repo) → Tasks 1-4. ✓

**Placeholder scan:** none — all steps carry concrete code/commands.

**Type consistency:** `FragmentRef { fragmentType, fragmentId }` (from `lineage-edge.repository`) used uniformly across builders, service, and route. Builder returns: `buildSessionStartSections → { memorySection, linkedResourcesSection, fragments }`; `buildReviewTodosSectionForTask → { section, fragments }`; `buildLayer2ReviewSectionForTask → { section, fragments }`; `PreviousSessionRecovery.sessionId` added and consumed in the route as a `SESSION` fragment. `recordSessionStartEdges({ workspaceId, taskId, sessionId, fragments })` signature matches caller in Task 4. ✓
