# `lumo task lineage <id>` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `lumo task lineage <id>` command that aggregates the `LineageEdge` table into the causal trail of a task — which context fragments went in (type + readable source) + each one's outcome + the token/loop cost of the run that consumed it.

**Architecture:** Layered, no new infrastructure. New repository read method (`listByTaskWithCost`) + new source-label hydration repository → new `lineage.service.ts` that groups edges by run/session and attributes cost **once per group** → thin API route → CLI command with a pure markdown formatter. All dependencies (LineageEdge table, cost fields, canonical-fragment resolver, `getEdgeCost`) already exist.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Next.js App Router route handler, Prisma, Jest (SWC), commander (CLI).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/repositories/lineage-edge.repository.ts` (modify) | Add `listByTaskWithCost` — edges + run/session cost columns included. |
| `lib/repositories/lineage-source.repository.ts` (create) | Batched per-fragment-type source-label hydration (≤7 queries). |
| `lib/services/lineage.service.ts` (create) | `getLineageForIdentifier` — resolve task, canonicalize, hydrate, group, attribute cost once/group, totals. Exports `LineageDto`. |
| `app/api/tasks/lineage/[identifier]/route.ts` (create) | Thin GET handler: `requireIdentity` → service → 404. |
| `cli/src/commands/task-lineage.ts` (create) | `taskLineage(identifier)` fetch + `formatLineageMarkdown(dto)` pure formatter (incl. cold-start empty state). |
| `cli/src/index.ts` (modify) | Register `task lineage <identifier>`. |
| `.claude/skills/lumo/SKILL.md` (modify) | Catalog entry + frontmatter trigger words. |
| `.claude/skills/lumo/references/task-context.md` (modify) | Command section. |
| `__tests__/lineage-source.repository.test.ts` (create) | Hydration buckets + labels + missing-row omission. |
| `__tests__/services/lineage-service.test.ts` (create) | Grouping, **cost-once-per-group**, canonical resolution, totals, fallback label, empty. |
| `__tests__/cli/task-lineage-format.test.ts` (create) | Formatter render + empty/cold-start state. |

**Type contract (defined in `lineage.service.ts`, consumed everywhere):**

```ts
import type { LineageOutcome } from '@prisma/client'

export interface LineageCost {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  loopCount: number
}
export interface LineageFragmentEntry {
  fragmentType: string
  fragmentId: string // canonical
  sourceLabel: string
  outcome: LineageOutcome
}
export interface LineageGroup {
  kind: 'run' | 'session' | 'orphan'
  runId: string | null
  sessionId: string | null
  label: string
  includedAt: string // ISO
  cost: LineageCost | null
  fragments: LineageFragmentEntry[]
}
export interface LineageDto {
  task: { identifier: string; title: string; status: string }
  totals: {
    runCount: number
    fragmentCount: number
    edgeCount: number
    tokens: { input: number; output: number; cacheRead: number; cacheCreation: number; total: number }
    loopCount: number
    outcomes: Record<LineageOutcome, number>
  }
  groups: LineageGroup[]
}
```

---

## Task 1: Repository — `listByTaskWithCost`

**Files:**
- Modify: `lib/repositories/lineage-edge.repository.ts`
- Test: `__tests__/lineage-edge.repository.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('lineageEdgeRepository', …)` block in `__tests__/lineage-edge.repository.test.ts`:

```ts
  describe('listByTaskWithCost', () => {
    it('queries edges for the task, oldest first, with run+session cost included', async () => {
      mockFindMany.mockResolvedValue([])

      await lineageEdgeRepository.listByTaskWithCost('tsk_1')

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { taskId: 'tsk_1' },
        orderBy: { includedAt: 'asc' },
        include: {
          run: {
            select: {
              id: true,
              inputTokens: true,
              outputTokens: true,
              cacheReadTokens: true,
              cacheCreationTokens: true,
              loopCount: true,
            },
          },
          session: {
            select: {
              id: true,
              inputTokens: true,
              outputTokens: true,
              cacheReadTokens: true,
              cacheCreationTokens: true,
              loopCount: true,
            },
          },
        },
      })
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage && npx jest __tests__/lineage-edge.repository.test.ts -t listByTaskWithCost`
Expected: FAIL — `lineageEdgeRepository.listByTaskWithCost is not a function`.

- [ ] **Step 3: Write minimal implementation** — add this method to the `lineageEdgeRepository` object in `lib/repositories/lineage-edge.repository.ts`, right after `listByTask` (keep `listByTask` unchanged — OCP):

```ts
  /**
   * List a task's edges (oldest first) with the run and session cost columns
   * needed by the lineage audit view (`lumo task lineage <id>`). Separate from
   * `listByTask` so the lighter query stays available for callers that don't
   * need cost. The selected shape is accepted directly by `getEdgeCost`.
   */
  async listByTaskWithCost(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.lineageEdge.findMany({
      where: { taskId },
      orderBy: { includedAt: 'asc' },
      include: {
        run: {
          select: {
            id: true,
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
            loopCount: true,
          },
        },
        session: {
          select: {
            id: true,
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
            loopCount: true,
          },
        },
      },
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage && npx jest __tests__/lineage-edge.repository.test.ts`
Expected: PASS (all cases in the file).

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
git add lib/repositories/lineage-edge.repository.ts __tests__/lineage-edge.repository.test.ts
git commit -m "feat: add lineageEdgeRepository.listByTaskWithCost [LUM-282]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Repository — source-label hydration

**Files:**
- Create: `lib/repositories/lineage-source.repository.ts`
- Test: `__tests__/lineage-source.repository.test.ts`

`LineageFragmentType` has exactly 7 values: `MEMORY`, `SLACK_CONTEXT`, `WEB_LINK`, `FIGMA`, `PR`, `PR_REVIEW_TODO`, `SESSION`. One batched query per type that actually appears. Missing source rows (deleted) are simply absent from the returned map; the service supplies a fallback label.

- [ ] **Step 1: Write the failing test** — create `__tests__/lineage-source.repository.test.ts`:

```ts
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import type { LineageFragmentType } from '@prisma/client'

const mockMemory = jest.fn()
const mockPr = jest.fn()
const mockSlack = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memory: { findMany: (...a: any[]) => mockMemory(...a) },
    pullRequest: { findMany: (...a: any[]) => mockPr(...a) },
    taskSlackContext: { findMany: (...a: any[]) => mockSlack(...a) },
    taskWebLink: { findMany: jest.fn().mockResolvedValue([]) },
    taskFigmaLink: { findMany: jest.fn().mockResolvedValue([]) },
    prCommentMirror: { findMany: jest.fn().mockResolvedValue([]) },
    session: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('lineageSourceRepository.labelsByType', () => {
  it('only queries the fragment types present, and keys labels by type::id', async () => {
    mockMemory.mockResolvedValue([
      { id: 'mem-1', scope: 'PROJECT', category: 'CONVENTION', content: { rule: 'Use the service layer' } },
    ])
    mockPr.mockResolvedValue([{ id: 'pr-1', number: 42, title: 'Add lineage table' }])

    const refs = new Map<LineageFragmentType, string[]>([
      ['MEMORY', ['mem-1']],
      ['PR', ['pr-1']],
    ])
    const labels = await lineageSourceRepository.labelsByType(refs)

    expect(mockMemory).toHaveBeenCalledWith({
      where: { id: { in: ['mem-1'] } },
      select: { id: true, scope: true, category: true, content: true },
    })
    expect(mockSlack).not.toHaveBeenCalled()
    expect(labels.get('MEMORY::mem-1')).toContain('Use the service layer')
    expect(labels.get('PR::pr-1')).toBe('#42 Add lineage table')
  })

  it('omits ids whose source row no longer exists', async () => {
    mockPr.mockResolvedValue([]) // pr-gone deleted
    const refs = new Map<LineageFragmentType, string[]>([['PR', ['pr-gone']]])
    const labels = await lineageSourceRepository.labelsByType(refs)
    expect(labels.has('PR::pr-gone')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage && npx jest __tests__/lineage-source.repository.test.ts`
Expected: FAIL — cannot find module `lineage-source.repository`.

- [ ] **Step 3: Write minimal implementation** — create `lib/repositories/lineage-source.repository.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { LineageFragmentType, MemoryScope, MemoryCategory } from '@prisma/client'
import { memoryManifestLine } from '@/lib/memory/render'

/** Map keyed `${fragmentType}::${fragmentId}` → human-readable source label. */
export type SourceLabelMap = Map<string, string>

function key(type: string, id: string): string {
  return `${type}::${id}`
}

function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve human-readable labels for lineage fragments, one batched query per
 * fragment type that appears (≤ 7 queries total — not a per-edge N+1). Source
 * rows that were deleted are simply absent from the returned map; the lineage
 * service renders a fallback for those. `fragmentId`s passed here are already
 * canonical (LUM-280 resolution happens in the service).
 */
export const lineageSourceRepository = {
  async labelsByType(
    refsByType: Map<LineageFragmentType, string[]>
  ): Promise<SourceLabelMap> {
    const out: SourceLabelMap = new Map()
    const ids = (t: LineageFragmentType): string[] => refsByType.get(t) ?? []

    const memIds = ids('MEMORY')
    if (memIds.length > 0) {
      const rows = await prisma.memory.findMany({
        where: { id: { in: memIds } },
        select: { id: true, scope: true, category: true, content: true },
      })
      for (const r of rows) {
        // memoryManifestLine returns "- [SCOPE] headline…"; drop the bullet.
        const line = memoryManifestLine({
          id: r.id,
          scope: r.scope as MemoryScope,
          category: r.category as MemoryCategory,
          content: r.content,
        }).replace(/^- /, '')
        out.set(key('MEMORY', r.id), line)
      }
    }

    const slackIds = ids('SLACK_CONTEXT')
    if (slackIds.length > 0) {
      const rows = await prisma.taskSlackContext.findMany({
        where: { id: { in: slackIds } },
        select: { id: true, slackChannelName: true, permalink: true },
      })
      for (const r of rows) {
        out.set(
          key('SLACK_CONTEXT', r.id),
          r.slackChannelName ? `#${r.slackChannelName}` : truncate(r.permalink)
        )
      }
    }

    const webIds = ids('WEB_LINK')
    if (webIds.length > 0) {
      const rows = await prisma.taskWebLink.findMany({
        where: { id: { in: webIds } },
        select: { id: true, title: true, url: true },
      })
      for (const r of rows) {
        out.set(key('WEB_LINK', r.id), truncate(r.title ?? r.url))
      }
    }

    const figmaIds = ids('FIGMA')
    if (figmaIds.length > 0) {
      const rows = await prisma.taskFigmaLink.findMany({
        where: { id: { in: figmaIds } },
        select: { id: true, fileName: true, frameName: true },
      })
      for (const r of rows) {
        out.set(
          key('FIGMA', r.id),
          r.frameName ? `${r.fileName} / ${r.frameName}` : r.fileName
        )
      }
    }

    const prIds = ids('PR')
    if (prIds.length > 0) {
      const rows = await prisma.pullRequest.findMany({
        where: { id: { in: prIds } },
        select: { id: true, number: true, title: true },
      })
      for (const r of rows) {
        out.set(key('PR', r.id), `#${r.number} ${truncate(r.title)}`)
      }
    }

    const todoIds = ids('PR_REVIEW_TODO')
    if (todoIds.length > 0) {
      const rows = await prisma.prCommentMirror.findMany({
        where: { id: { in: todoIds } },
        select: { id: true, filePath: true, comment: { select: { body: true } } },
      })
      for (const r of rows) {
        const loc = r.filePath ? `${r.filePath}: ` : ''
        out.set(
          key('PR_REVIEW_TODO', r.id),
          truncate(loc + stripHtml(r.comment?.body ?? ''))
        )
      }
    }

    const sessionIds = ids('SESSION')
    if (sessionIds.length > 0) {
      const rows = await prisma.session.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, summaryType: true },
      })
      for (const r of rows) {
        out.set(
          key('SESSION', r.id),
          `Session ${r.id.slice(0, 8)}${r.summaryType ? ` (${r.summaryType})` : ''}`
        )
      }
    }

    return out
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage && npx jest __tests__/lineage-source.repository.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
git add lib/repositories/lineage-source.repository.ts __tests__/lineage-source.repository.test.ts
git commit -m "feat: add lineageSourceRepository for fragment source labels [LUM-282]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Service — `getLineageForIdentifier`

**Files:**
- Create: `lib/services/lineage.service.ts`
- Test: `__tests__/services/lineage-service.test.ts`

The central correctness guarantee: **cost is attributed once per run/session group, never per edge.** A run that injected 3 fragments contributes its cost exactly once to `totals.tokens`.

- [ ] **Step 1: Write the failing test** — create `__tests__/services/lineage-service.test.ts`:

```ts
/** @jest-environment node */
import { lineageService } from '@/lib/services/lineage.service'

jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { listByTaskWithCost: jest.fn() },
}))
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: { resolveCanonicalFragment: jest.fn() },
}))
jest.mock('@/lib/repositories/lineage-source.repository', () => ({
  lineageSourceRepository: { labelsByType: jest.fn() },
}))

import { taskService } from '@/lib/services/task.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'

const mockResolve = taskService.resolveIdentifier as jest.Mock
const mockEdges = lineageEdgeRepository.listByTaskWithCost as jest.Mock
const mockCanon = memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
const mockLabels = lineageSourceRepository.labelsByType as jest.Mock

const RUN_COST = {
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 200,
  cacheCreationTokens: 100,
  loopCount: 4,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockResolve.mockResolvedValue({ id: 'tsk_1', identifier: 'LUM-1', title: 'T', status: 'DONE' })
  mockCanon.mockImplementation(async (_t: string, id: string) =>
    id === 'mem-old' ? 'mem-new' : id
  )
  mockLabels.mockResolvedValue(
    new Map([
      ['MEMORY::mem-new', '[PROJECT] canonical memory'],
      ['PR::pr-1', '#42 Add table'],
    ])
  )
})

it('returns null when the identifier does not resolve', async () => {
  mockResolve.mockResolvedValue(null)
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-404')
  expect(dto).toBeNull()
})

it('counts a run cost ONCE even when the run injected multiple fragments', async () => {
  mockEdges.mockResolvedValue([
    { fragmentType: 'MEMORY', fragmentId: 'mem-old', runId: 'run-1', sessionId: 's-1', outcome: 'MERGED', includedAt: new Date('2026-06-01T00:00:00Z'), run: { id: 'run-1', ...RUN_COST }, session: null },
    { fragmentType: 'PR', fragmentId: 'pr-1', runId: 'run-1', sessionId: 's-1', outcome: 'MERGED', includedAt: new Date('2026-06-01T00:01:00Z'), run: { id: 'run-1', ...RUN_COST }, session: null },
  ])

  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')

  expect(dto).not.toBeNull()
  expect(dto!.groups).toHaveLength(1)
  expect(dto!.groups[0]!.kind).toBe('run')
  expect(dto!.groups[0]!.fragments).toHaveLength(2)
  // cost attributed once: 1000+500+200+100 = 1800, not doubled
  expect(dto!.totals.tokens.total).toBe(1800)
  expect(dto!.totals.loopCount).toBe(4)
  expect(dto!.totals.runCount).toBe(1)
  expect(dto!.totals.edgeCount).toBe(2)
})

it('applies canonical fragment resolution and source labels', async () => {
  mockEdges.mockResolvedValue([
    { fragmentType: 'MEMORY', fragmentId: 'mem-old', runId: 'run-1', sessionId: null, outcome: 'MERGED', includedAt: new Date('2026-06-01T00:00:00Z'), run: { id: 'run-1', ...RUN_COST }, session: null },
  ])
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')
  const frag = dto!.groups[0]!.fragments[0]!
  expect(frag.fragmentId).toBe('mem-new') // drift-resolved
  expect(frag.sourceLabel).toBe('[PROJECT] canonical memory')
})

it('uses a fallback label when the source row is gone, and falls back to session cost', async () => {
  mockLabels.mockResolvedValue(new Map())
  mockEdges.mockResolvedValue([
    { fragmentType: 'WEB_LINK', fragmentId: 'web-gone', runId: null, sessionId: 's-1', outcome: 'UNKNOWN', includedAt: new Date('2026-06-01T00:00:00Z'), run: null, session: { id: 's-1', ...RUN_COST } },
  ])
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')
  expect(dto!.groups[0]!.kind).toBe('session')
  expect(dto!.groups[0]!.fragments[0]!.sourceLabel).toBe('WEB_LINK (source removed)')
  expect(dto!.totals.tokens.total).toBe(1800) // session cost used
})

it('returns empty groups for a task with no edges', async () => {
  mockEdges.mockResolvedValue([])
  mockLabels.mockResolvedValue(new Map())
  const dto = await lineageService.getLineageForIdentifier('ws', 'mem', 'LUM-1')
  expect(dto!.groups).toEqual([])
  expect(dto!.totals.edgeCount).toBe(0)
  expect(dto!.totals.runCount).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage && npx jest __tests__/services/lineage-service.test.ts`
Expected: FAIL — cannot find module `lineage.service`.

- [ ] **Step 3: Write minimal implementation** — create `lib/services/lineage.service.ts`:

```ts
import { taskService } from '@/lib/services/task.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { getEdgeCost } from '@/lib/repositories/lineage-cost'
import type { LineageFragmentType, LineageOutcome } from '@prisma/client'

export interface LineageCost {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  loopCount: number
}
export interface LineageFragmentEntry {
  fragmentType: string
  fragmentId: string
  sourceLabel: string
  outcome: LineageOutcome
}
export interface LineageGroup {
  kind: 'run' | 'session' | 'orphan'
  runId: string | null
  sessionId: string | null
  label: string
  includedAt: string
  cost: LineageCost | null
  fragments: LineageFragmentEntry[]
}
export interface LineageDto {
  task: { identifier: string; title: string; status: string }
  totals: {
    runCount: number
    fragmentCount: number
    edgeCount: number
    tokens: { input: number; output: number; cacheRead: number; cacheCreation: number; total: number }
    loopCount: number
    outcomes: Record<LineageOutcome, number>
  }
  groups: LineageGroup[]
}

const ORPHAN = '__orphan__'

function emptyOutcomes(): Record<LineageOutcome, number> {
  return { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 }
}

export const lineageService = {
  /**
   * Aggregate a task's LineageEdge rows into its causal trail: fragments
   * (canonicalized + source-labelled) grouped by the run/session that consumed
   * them, with cost attributed ONCE per group (never per edge — a run that
   * injected many fragments must not multiply its token cost). Returns null
   * when the identifier doesn't resolve (caller → 404).
   */
  async getLineageForIdentifier(
    workspaceId: string,
    _memberId: string,
    identifier: string
  ): Promise<LineageDto | null> {
    const resolved = await taskService.resolveIdentifier(workspaceId, identifier)
    if (!resolved) return null

    const edges = await lineageEdgeRepository.listByTaskWithCost(resolved.id)

    // 1. Canonicalize each fragment id (MEMORY may drift across consolidation).
    //    Zip edge+canonical so later steps never index a parallel array under
    //    noUncheckedIndexedAccess.
    const withCanon = await Promise.all(
      edges.map(async e => ({
        e,
        cid: await memoryProvenanceRepository.resolveCanonicalFragment(
          e.fragmentType,
          e.fragmentId
        ),
      }))
    )

    // 2. Bucket canonical ids by type and hydrate human-readable labels.
    const refsByType = new Map<LineageFragmentType, string[]>()
    for (const { e, cid } of withCanon) {
      const arr = refsByType.get(e.fragmentType) ?? []
      arr.push(cid)
      refsByType.set(e.fragmentType, arr)
    }
    const labels = await lineageSourceRepository.labelsByType(refsByType)
    const labelFor = (type: string, id: string): string =>
      labels.get(`${type}::${id}`) ?? `${type} (source removed)`

    // 3. Group by run ?? session ?? orphan, preserving first-seen order
    //    (edges arrive oldest-first).
    const order: string[] = []
    const groups = new Map<string, LineageGroup>()
    const seenFragment = new Set<string>()
    const outcomes = emptyOutcomes()

    for (const { e, cid } of withCanon) {
      outcomes[e.outcome] += 1
      seenFragment.add(`${e.fragmentType}::${cid}`)

      const gkey = e.runId ?? e.sessionId ?? ORPHAN
      let g = groups.get(gkey)
      if (!g) {
        // Cost is identical across every edge in a run/session group (same run
        // object), so resolve it once from this representative edge.
        const c = getEdgeCost({
          runId: e.runId,
          run: e.run,
          sessionId: e.sessionId,
          session: e.session,
        })
        g = {
          kind: e.runId ? 'run' : e.sessionId ? 'session' : 'orphan',
          runId: e.runId,
          sessionId: e.sessionId,
          label: e.runId
            ? `Run ${e.runId.slice(0, 8)}`
            : e.sessionId
              ? `Session ${e.sessionId.slice(0, 8)}`
              : 'Unattributed',
          includedAt: e.includedAt.toISOString(),
          cost: c
            ? {
                input: c.inputTokens,
                output: c.outputTokens,
                cacheRead: c.cacheReadTokens,
                cacheCreation: c.cacheCreationTokens,
                total:
                  c.inputTokens +
                  c.outputTokens +
                  c.cacheReadTokens +
                  c.cacheCreationTokens,
                loopCount: c.loopCount,
              }
            : null,
          fragments: [],
        }
        groups.set(gkey, g)
        order.push(gkey)
      }
      g.fragments.push({
        fragmentType: e.fragmentType,
        fragmentId: cid,
        sourceLabel: labelFor(e.fragmentType, cid),
        outcome: e.outcome,
      })
    }

    const groupList = order.map(k => groups.get(k)!)

    // 4. Totals — cost summed ONCE per group.
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }
    let loopCount = 0
    let runCount = 0
    for (const g of groupList) {
      if (g.kind !== 'orphan') runCount += 1
      if (g.cost) {
        tokens.input += g.cost.input
        tokens.output += g.cost.output
        tokens.cacheRead += g.cost.cacheRead
        tokens.cacheCreation += g.cost.cacheCreation
        tokens.total += g.cost.total
        loopCount += g.cost.loopCount
      }
    }

    return {
      task: {
        identifier: resolved.identifier,
        title: resolved.title,
        status: resolved.status,
      },
      totals: {
        runCount,
        fragmentCount: seenFragment.size,
        edgeCount: edges.length,
        tokens,
        loopCount,
        outcomes,
      },
      groups: groupList,
    }
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage && npx jest __tests__/services/lineage-service.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
git add lib/services/lineage.service.ts __tests__/services/lineage-service.test.ts
git commit -m "feat: add lineageService.getLineageForIdentifier [LUM-282]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: API route

**Files:**
- Create: `app/api/tasks/lineage/[identifier]/route.ts`

No unit test (thin handler mirroring the already-tested `tasks/context/[identifier]/route.ts`; covered by service tests + manual verification in Task 7). This matches the existing context route, which also has no dedicated route test.

- [ ] **Step 1: Write the route** — create `app/api/tasks/lineage/[identifier]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { lineageService } from '@/lib/services/lineage.service'

export async function GET(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { identifier } = await context.params
  const result = await lineageService.getLineageForIdentifier(
    identity.workspaceId,
    identity.memberId,
    identifier
  )
  if (!result) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage && npx tsc --noEmit`
Expected: no errors (if "TaskArtifact not exported"-style errors appear, run `npx prisma generate` first — stale client).

- [ ] **Step 3: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
git add "app/api/tasks/lineage/[identifier]/route.ts"
git commit -m "feat: add GET /api/tasks/lineage/[identifier] [LUM-282]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: CLI command + formatter

**Files:**
- Create: `cli/src/commands/task-lineage.ts`
- Modify: `cli/src/index.ts`
- Test: `__tests__/cli/task-lineage-format.test.ts`

- [ ] **Step 1: Write the failing test** — create `__tests__/cli/task-lineage-format.test.ts`:

```ts
import { formatLineageMarkdown } from '../../cli/src/commands/task-lineage'
import type { LineageResponse } from '../../cli/src/commands/task-lineage'

const base: LineageResponse = {
  task: { identifier: 'LUM-1', title: 'Add lineage', status: 'DONE' },
  totals: {
    runCount: 1,
    fragmentCount: 2,
    edgeCount: 2,
    tokens: { input: 1000, output: 500, cacheRead: 200, cacheCreation: 100, total: 1800 },
    loopCount: 4,
    outcomes: { MERGED: 2, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
  },
  groups: [
    {
      kind: 'run',
      runId: 'run-12345678',
      sessionId: null,
      label: 'Run run-1234',
      includedAt: '2026-06-01T00:00:00.000Z',
      cost: { input: 1000, output: 500, cacheRead: 200, cacheCreation: 100, total: 1800, loopCount: 4 },
      fragments: [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', sourceLabel: '[PROJECT] use the service layer', outcome: 'MERGED' },
        { fragmentType: 'PR', fragmentId: 'pr-1', sourceLabel: '#42 Add table', outcome: 'MERGED' },
      ],
    },
  ],
}

describe('formatLineageMarkdown', () => {
  it('renders the totals banner, the group cost once, and per-fragment outcomes', () => {
    const out = formatLineageMarkdown(base)
    expect(out).toContain('# Lineage: LUM-1')
    expect(out).toContain('Add lineage')
    expect(out).toContain('1,800') // grouped-thousands cost
    expect(out).toContain('Run run-1234')
    expect(out).toContain('[MERGED] MEMORY')
    expect(out).toContain('use the service layer')
    expect(out).toContain('[MERGED] PR')
    expect(out).toContain('#42 Add table')
    expect(out).toContain('2 MERGED') // group summary + totals
  })

  it('renders a cold-start note when there are no edges', () => {
    const empty: LineageResponse = {
      ...base,
      totals: { ...base.totals, runCount: 0, fragmentCount: 0, edgeCount: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }, loopCount: 0, outcomes: { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 } },
      groups: [],
    }
    const out = formatLineageMarkdown(empty)
    expect(out).toContain('# Lineage: LUM-1')
    expect(out).toContain('No lineage edges recorded yet')
    expect(out).not.toContain('## Totals')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage && npx jest __tests__/cli/task-lineage-format.test.ts`
Expected: FAIL — cannot find module `task-lineage`.

- [ ] **Step 3: Write the command + formatter** — create `cli/src/commands/task-lineage.ts`:

```ts
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

type Outcome = 'MERGED' | 'REJECTED' | 'REWORKED' | 'UNKNOWN'

interface LineageCost {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  loopCount: number
}
interface LineageFragmentEntry {
  fragmentType: string
  fragmentId: string
  sourceLabel: string
  outcome: Outcome
}
interface LineageGroup {
  kind: 'run' | 'session' | 'orphan'
  runId: string | null
  sessionId: string | null
  label: string
  includedAt: string
  cost: LineageCost | null
  fragments: LineageFragmentEntry[]
}
export interface LineageResponse {
  task: { identifier: string; title: string; status: string }
  totals: {
    runCount: number
    fragmentCount: number
    edgeCount: number
    tokens: { input: number; output: number; cacheRead: number; cacheCreation: number; total: number }
    loopCount: number
    outcomes: Record<Outcome, number>
  }
  groups: LineageGroup[]
}

export async function taskLineage(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo task lineage <LUM-42>'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/lineage/${encodeURIComponent(identifier)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: lineage fetch failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as LineageResponse
  process.stdout.write(formatLineageMarkdown(data))
}

/** Deterministic thousands separator (no locale dependency, test-stable). */
function groupThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const OUTCOME_ORDER: Outcome[] = ['MERGED', 'REWORKED', 'REJECTED', 'UNKNOWN']

/** "2 MERGED · 1 UNKNOWN", fixed order, zeros omitted. */
function outcomeSummary(counts: Record<Outcome, number>): string {
  const parts = OUTCOME_ORDER.filter(o => counts[o] > 0).map(
    o => `${counts[o]} ${o}`
  )
  return parts.join(' · ')
}

function fragmentOutcomeCounts(
  fragments: LineageFragmentEntry[]
): Record<Outcome, number> {
  const c: Record<Outcome, number> = {
    MERGED: 0,
    REJECTED: 0,
    REWORKED: 0,
    UNKNOWN: 0,
  }
  for (const f of fragments) c[f.outcome] += 1
  return c
}

/**
 * Render a LineageResponse as the audit-facing markdown trail. Pure function
 * (no clock / env) so the CLI output is deterministic and unit-testable.
 */
export function formatLineageMarkdown(data: LineageResponse): string {
  const lines: string[] = []
  lines.push(`# Lineage: ${data.task.identifier} — ${sanitizeField(data.task.title)}`)
  lines.push(`**Status**: ${data.task.status}`)
  lines.push('')

  if (data.groups.length === 0) {
    lines.push(
      '_No lineage edges recorded yet. Lineage is captured when a ' +
        "session-bound run consumes this task's context; once that happens " +
        '(and a PR merges / the task closes), the causal trail and its cost ' +
        'will appear here._'
    )
    lines.push('')
    return lines.join('\n')
  }

  const t = data.totals
  lines.push('## Totals')
  lines.push(`- Runs/sessions: ${t.runCount}`)
  lines.push(`- Fragments: ${t.fragmentCount}`)
  lines.push(`- Edges: ${t.edgeCount}`)
  lines.push(
    `- Tokens: ${groupThousands(t.tokens.total)} ` +
      `(in ${groupThousands(t.tokens.input)} · out ${groupThousands(t.tokens.output)} · ` +
      `cache-read ${groupThousands(t.tokens.cacheRead)} · cache-create ${groupThousands(t.tokens.cacheCreation)})`
  )
  lines.push(`- Loops: ${t.loopCount}`)
  const totalsOutcome = outcomeSummary(t.outcomes)
  if (totalsOutcome) lines.push(`- Outcomes: ${totalsOutcome}`)
  lines.push('')

  for (const g of data.groups) {
    lines.push(`## ${sanitizeField(g.label)} · ${g.includedAt.slice(0, 10)}`)
    if (g.cost) {
      lines.push(
        `**Cost**: ${groupThousands(g.cost.total)} tokens · ${g.cost.loopCount} loops`
      )
    } else {
      lines.push('**Cost**: (no captured cost)')
    }
    const summary = outcomeSummary(fragmentOutcomeCounts(g.fragments))
    lines.push(
      `**Fragments** (${g.fragments.length}${summary ? `: ${summary}` : ''}):`
    )
    for (const f of g.fragments) {
      lines.push(
        `- [${f.outcome}] ${f.fragmentType} — ${sanitizeField(f.sourceLabel)}`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}
```

- [ ] **Step 4: Register the command** — in `cli/src/index.ts`, add the import near the other task-command imports (top of file, alongside `taskContext`):

```ts
import { taskLineage } from './commands/task-lineage'
```

Then add the leaf command in the Tier-2 retrieval block (after the `taskPr` block around line 420, before `const taskMemory`):

```ts
task
  .command('lineage <identifier>')
  .description(
    'Show the causal trail: which context fragments fed this task, each fragment\'s outcome, and the token/loop cost of the run that consumed it'
  )
  .action(wrap(id => taskLineage(id as string)))
```

- [ ] **Step 5: Run formatter test + verify CLI builds**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage && npx jest __tests__/cli/task-lineage-format.test.ts && cd cli && npx tsc --noEmit && cd ..`
Expected: tests PASS; CLI tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
git add cli/src/commands/task-lineage.ts cli/src/index.ts __tests__/cli/task-lineage-format.test.ts
git commit -m "feat: add 'lumo task lineage <id>' CLI command [LUM-282]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: SKILL.md + reference sync (CLAUDE.md requirement)

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md`
- Modify: `.claude/skills/lumo/references/task-context.md`

- [ ] **Step 1: Add the catalog entry** — in `.claude/skills/lumo/SKILL.md`, in the "**Task context & retrieval**" catalog list, add after the `task pr show` bullet:

```markdown
- `lumo task lineage <id>` — show the causal trail: fragments that fed the task + each one's outcome + the run's token/loop cost (read-only audit view)
```

- [ ] **Step 2: Add trigger words** — in the SKILL.md frontmatter `description`, append these triggers to the existing trigger list (inside the same string, before the closing): `"task lineage", "lineage", "causal trail", "审计", "因果链", "成本归因", "trace context"`.

- [ ] **Step 3: Document the command** — in `.claude/skills/lumo/references/task-context.md`, add a new section:

```markdown
## `lumo task lineage <id>`

Read-only audit view over the task's `LineageEdge` rows. Given a task
identifier (`LUM-N`), prints the causal trail:

- **Totals banner** — distinct runs/sessions, fragment count, edge count,
  total tokens (input/output/cache split) and loops, and the outcome
  distribution.
- **One block per run/session** — the group's cost shown **once** (token/loop),
  the date it consumed context, then each context fragment as
  `[OUTCOME] TYPE — <source label>`, plus a per-group outcome summary.

Cost is attributed once per run/session (a run that injected many fragments is
not double-counted). Fragment ids are canonical — MEMORY fragments survive
consolidation drift.

**Cold start:** a task with no edges prints a friendly note (lineage is captured
when a session-bound run consumes the task's context), not an error.

**When to suggest:** the user wants to audit "what context did the AI actually
use, and what did it cost" for a task / merged PR — CFO / compliance / trust
narratives.

Entry point is the task identifier only; PR-number lookup is a future addition.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
git add .claude/skills/lumo/SKILL.md .claude/skills/lumo/references/task-context.md
git commit -m "docs: document 'lumo task lineage' in lumo SKILL [LUM-282]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full verification + PR

**Files:** none (verification + delivery)

- [ ] **Step 1: Regenerate the Prisma client + full typecheck (atomic)**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
npx prisma generate && npx tsc --noEmit
```
Expected: prisma generate succeeds; tsc reports no errors. (Per CLAUDE.md, do `prisma generate` + `tsc` together at the end to avoid the shared-client clobber across parallel worktrees.)

- [ ] **Step 2: Run the full lineage test surface from inside the worktree**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
npx jest __tests__/lineage-edge.repository.test.ts __tests__/lineage-source.repository.test.ts __tests__/services/lineage-service.test.ts __tests__/cli/task-lineage-format.test.ts
```
Expected: all suites PASS. (Run jest from inside the worktree — running from the main checkout hits the cli/package.json haste collision.)

- [ ] **Step 3: Lint (no console.log, token-lint unaffected)**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
npm run lint
```
Expected: clean. (No styles touched → `lint:tokens` baseline unaffected.)

- [ ] **Step 4: Confirm no migrations were deleted in the diff** (stale-base guard)

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
git fetch origin main
git diff --name-status origin/main...HEAD -- prisma/migrations | grep '^D' || echo "no migration deletions"
```
Expected: `no migration deletions`. If any deletions show, merge `origin/main` into the branch before opening the PR.

- [ ] **Step 5: Push + open PR**

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-282-task-lineage
git push -u origin lumo/LUM-282-task-lineage
gh pr create --title "feat: add 'lumo task lineage <id>' [LUM-282]" --body "$(cat <<'EOF'
## Summary
Adds `lumo task lineage <id>` — a read-only audit command that aggregates the
`LineageEdge` table into a task's causal trail: which context fragments fed the
task (type + readable source), each fragment's outcome, and the token/loop cost
of the run that consumed it. The milestone's audit/trust exit (DoD ⑥).

No new infrastructure — builds on LineageEdge (LUM-275), outcome stamping
(LUM-277), per-run cost (LUM-281), and the canonical-fragment resolver (LUM-280).

## Changes
- `lineageEdgeRepository.listByTaskWithCost` — edges + run/session cost.
- `lineageSourceRepository` — batched per-type source-label hydration (≤7 queries).
- `lineageService.getLineageForIdentifier` — groups edges by run/session, cost
  attributed **once per group**, totals + outcome distribution.
- `GET /api/tasks/lineage/[identifier]` — thin authed handler.
- `lumo task lineage <id>` CLI command + pure markdown formatter (cold-start note).
- SKILL.md + task-context.md updated per CLAUDE.md CLI-sync rule.

## Notes
- **No schema change → no migration.**
- **CLI surface changed** → ship requires a `cli/package.json` minor bump +
  `npm publish` (no CI publishes the CLI; `lumo update` only delivers published versions).

## Test plan
- Repository: query shape + label bucketing + missing-row omission.
- Service: grouping, **cost counted once per group**, canonical resolution,
  fallback label, empty/cold-start.
- CLI formatter: full render + cold-start state.
- `tsc --noEmit` clean; `npm run lint` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR created. Report the URL.

- [ ] **Step 6: Move task to in_review**

Run: `lumo task update LUM-282 --status in_review` (a feature task isn't done until the PR lands on `origin/main`).

---

## Self-Review

**Spec coverage:**
- CLI command `task lineage <id>` (task id only) → Task 5. ✓
- Read-only API route → Task 4. ✓
- Service aggregation → Task 3. ✓
- Human-readable source hydration (batched, not N+1) → Task 2. ✓
- Group by run/session; cost once per group → Task 3 (+ test). ✓
- Per-fragment outcome + group summary → Task 5 formatter. ✓
- Canonical fragment resolution (MEMORY drift) → Task 3. ✓
- Totals (tokens/loops/outcomes) → Task 3. ✓
- Cold-start empty state → Task 5 formatter (+ test). ✓
- SKILL.md + reference sync → Task 6. ✓
- Tests for every new function → Tasks 1,2,3,5. ✓
- PR delivery, no migration, CLI publish note → Task 7. ✓
- Out of scope (PR entry, outcome filters, ranking, billing UI) → not implemented. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `LineageDto`/`LineageGroup`/`LineageFragmentEntry`/`LineageCost` defined in Task 3 and mirrored as `LineageResponse` (CLI-local) in Task 5; field names (`runCount`, `fragmentCount`, `edgeCount`, `tokens.{input,output,cacheRead,cacheCreation,total}`, `loopCount`, `outcomes`, group `kind/runId/sessionId/label/includedAt/cost/fragments`) match across service, route, and CLI. `listByTaskWithCost` select shape matches `getEdgeCost`'s `EdgeCostInput`. `labelsByType(Map<LineageFragmentType,string[]>)` signature consistent between Task 2 and Task 3.
