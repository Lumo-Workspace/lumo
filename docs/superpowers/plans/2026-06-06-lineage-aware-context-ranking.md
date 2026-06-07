# Lineage-aware Context Ranking + Budget Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the session-start auto-injection path, reorder each context section so historically high-merge fragments survive the 2500-token budget, sink proven-low-merge fragments to the manifest tail, and collapse pre/post-consolidation memory duplicates.

**Architecture:** A pure three-tier ranking module (`lib/lineage/ranking.ts`) plus a never-throwing async orchestrator (`lib/lineage/session-rank.ts`) that dedupes memories by canonical id, scores all fragments via the existing LUM-278 `mergeRateByFragments`, and stable-sorts each section. `buildSessionStartSections` calls the orchestrator before `allocateBudget`. The budget layer, the 2500 number, and the five section builders are untouched.

**Tech Stack:** TypeScript (strict), Next.js service layer, Prisma (via existing repositories), Jest (node env).

**Reference spec:** `docs/superpowers/specs/2026-06-06-lineage-aware-context-ranking-design.md`

**Key facts verified before planning:**

- `mergeRateByFragments(refs: FragmentRef[]): Promise<FragmentMergeRate[]>` returns `{ fragmentType, fragmentId, resolvedTasks, mergedTasks }`, task-deduped, omitting fragments with no history (cold-start gating is the caller's job).
- `resolveCanonicalFragment(type, id)` collapses a TASK memory's cuid to its promoted PROJECT cuid; non-MEMORY types return the id unchanged.
- Edge birth (`lib/services/lineage.service.ts`) already canonicalizes fragmentId AND uses `createMany({ skipDuplicates })`. **Therefore dedup never changes the edge set** — dropping the TASK duplicate from `fragments` only stops double-rendering; the edge it would have produced is the same canonical row that the kept PROJECT entry already produces. Implementers do not need to worry about edge consistency.
- `LINEAGE_MIN_RESOLVED_TASKS = 3` is exported from `@/lib/services/lineage-signal` (reuse it; do not redefine).
- `RenderableMemory` (`@/lib/memory/render`) = `{ id: string; scope: MemoryScope; category: MemoryCategory; content: unknown }`.
- In `buildSessionStartSections`, the section arrays already carry lineage-native ids: memory id, slack `.id`, web `.id`, figma `.id`, pr `.id`; fragment types used are `MEMORY | SLACK_CONTEXT | WEB_LINK | FIGMA | PR`.

---

### Task 1: Pure three-tier ranking module

**Files:**

- Create: `lib/lineage/ranking.ts`
- Test: `__tests__/lib/lineage/ranking.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/lineage/ranking.test.ts`:

```ts
import { tierOf, rankByLineage, type LineageStat } from '@/lib/lineage/ranking'

describe('tierOf', () => {
  it('cold (tier 1) when no stat', () => {
    expect(tierOf(undefined)).toBe(1)
  })
  it('cold (tier 1) below the resolved-tasks floor', () => {
    expect(tierOf({ resolvedTasks: 2, mergedTasks: 2 })).toBe(1)
  })
  it('high (tier 0) at or above 50% with enough samples', () => {
    expect(tierOf({ resolvedTasks: 3, mergedTasks: 2 })).toBe(0) // 66%
    expect(tierOf({ resolvedTasks: 4, mergedTasks: 2 })).toBe(0) // exactly 50% -> high
  })
  it('low (tier 2) below 50% with enough samples', () => {
    expect(tierOf({ resolvedTasks: 4, mergedTasks: 1 })).toBe(2) // 25%
  })
})

describe('rankByLineage', () => {
  const key = (s: string) => s
  const stats = (entries: [string, LineageStat][]) => new Map(entries)

  it('orders high -> cold -> low', () => {
    const items = ['low', 'cold', 'high']
    const out = rankByLineage(
      items,
      key,
      stats([
        ['high', { resolvedTasks: 3, mergedTasks: 3 }], // 100% -> high
        ['low', { resolvedTasks: 4, mergedTasks: 1 }], // 25% -> low
        // 'cold' has no stat -> cold
      ])
    )
    expect(out).toEqual(['high', 'cold', 'low'])
  })

  it('sorts the high tier by merge% descending', () => {
    const out = rankByLineage(
      ['a', 'b'],
      key,
      stats([
        ['a', { resolvedTasks: 4, mergedTasks: 2 }], // 50%
        ['b', { resolvedTasks: 4, mergedTasks: 4 }], // 100%
      ])
    )
    expect(out).toEqual(['b', 'a'])
  })

  it('breaks high-tier ties by evidence (resolvedTasks) descending', () => {
    const out = rankByLineage(
      ['few', 'many'],
      key,
      stats([
        ['few', { resolvedTasks: 3, mergedTasks: 3 }], // 100%, 3 samples
        ['many', { resolvedTasks: 6, mergedTasks: 6 }], // 100%, 6 samples
      ])
    )
    expect(out).toEqual(['many', 'few'])
  })

  it('preserves input order within the cold tier (stable)', () => {
    const out = rankByLineage(['x', 'y', 'z'], key, stats([]))
    expect(out).toEqual(['x', 'y', 'z'])
  })

  it('is the identity permutation when everything is cold', () => {
    const items = ['p', 'q', 'r']
    expect(rankByLineage(items, key, stats([]))).toEqual(items)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/lineage/ranking.test.ts`
Expected: FAIL — `Cannot find module '@/lib/lineage/ranking'`.

- [ ] **Step 3: Write the implementation**

Create `lib/lineage/ranking.ts`:

```ts
import { LINEAGE_MIN_RESOLVED_TASKS } from '@/lib/services/lineage-signal'

/** Merge rate at or above this lands a sampled fragment in the high tier. 50%
 * inclusive: "merged more often than not". */
export const LINEAGE_RANK_HIGH_THRESHOLD = 0.5

/** 0 = high (top), 1 = cold/no-signal (middle), 2 = proven-low (bottom). */
export type LineageTier = 0 | 1 | 2

export interface LineageStat {
  resolvedTasks: number
  mergedTasks: number
}

/**
 * Bucket a fragment by its task-deduped merge stat. A fragment without enough
 * resolved tasks (or no stat at all) is "cold" — we don't promise intelligence
 * below the sample floor, so it stays in its original position (tier 1).
 */
export function tierOf(stat: LineageStat | undefined): LineageTier {
  if (!stat || stat.resolvedTasks < LINEAGE_MIN_RESOLVED_TASKS) return 1
  const rate = stat.mergedTasks / stat.resolvedTasks
  return rate >= LINEAGE_RANK_HIGH_THRESHOLD ? 0 : 2
}

/**
 * Stable three-tier reorder of a single section's cards. High-merge fragments
 * float to the top (so they survive the token budget), proven-low-merge sink to
 * the bottom (degraded to manifest first), and cold fragments keep their
 * incoming order in the middle. Within the high tier: merge% descending, then
 * evidence (resolvedTasks) descending. Index is the final tiebreak so cold/low
 * tiers and exact ties preserve input order regardless of sort stability.
 */
export function rankByLineage<T>(
  items: T[],
  keyOf: (item: T) => string,
  statByKey: Map<string, LineageStat>
): T[] {
  return items
    .map((item, index) => ({ item, index, stat: statByKey.get(keyOf(item)) }))
    .sort((a, b) => {
      const ta = tierOf(a.stat)
      const tb = tierOf(b.stat)
      if (ta !== tb) return ta - tb
      if (ta === 0) {
        // tier 0 guarantees both stats are defined with resolvedTasks >= floor.
        const sa = a.stat as LineageStat
        const sb = b.stat as LineageStat
        const ra = sa.mergedTasks / sa.resolvedTasks
        const rb = sb.mergedTasks / sb.resolvedTasks
        if (rb !== ra) return rb - ra
        if (sb.resolvedTasks !== sa.resolvedTasks)
          return sb.resolvedTasks - sa.resolvedTasks
      }
      return a.index - b.index
    })
    .map(d => d.item)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/lineage/ranking.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/lineage/ranking.ts __tests__/lib/lineage/ranking.test.ts
git commit -m "feat: pure three-tier lineage ranking module [LUM-279]"
```

---

### Task 2: Session-start ranking orchestrator (dedup + score + rank, never-throws)

**Files:**

- Create: `lib/lineage/session-rank.ts`
- Test: `__tests__/lib/lineage/session-rank.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/lineage/session-rank.test.ts`:

```ts
import { rankSessionStartCards } from '@/lib/lineage/session-rank'
import type { RenderableMemory } from '@/lib/memory/render'
import type { FragmentMergeRate } from '@/lib/repositories/lineage-edge.repository'

const mem = (id: string, scope: 'PROJECT' | 'TASK'): RenderableMemory => ({
  id,
  scope,
  category: 'TRAP',
  content: { trigger: id, mitigation: id },
})

const identityResolve = async (_t: string, id: string) => id

describe('rankSessionStartCards', () => {
  it('dedupes memories that share a canonical id, keeping the first (PROJECT) row', async () => {
    // task row 'mem-t' resolves to the promoted project row 'mem-p'.
    const resolveCanonical = async (_t: string, id: string) =>
      id === 'mem-t' ? 'mem-p' : id
    const out = await rankSessionStartCards(
      {
        memories: [mem('mem-p', 'PROJECT'), mem('mem-t', 'TASK')],
        slack: [],
        web: [],
        figma: [],
        prs: [],
      },
      { resolveCanonical, mergeRateByFragments: async () => [] }
    )
    expect(out.memories.map(m => m.id)).toEqual(['mem-p'])
  })

  it('floats a high-merge memory above a cold one, scoring by canonical id', async () => {
    // 'mem-hot' is a TASK row whose canonical is 'mem-canon'; the merge stat is
    // keyed by the canonical id, proving scoring resolves before lookup.
    const resolveCanonical = async (_t: string, id: string) =>
      id === 'mem-hot' ? 'mem-canon' : id
    const mergeRateByFragments = async (): Promise<FragmentMergeRate[]> => [
      {
        fragmentType: 'MEMORY',
        fragmentId: 'mem-canon',
        resolvedTasks: 4,
        mergedTasks: 4,
      },
    ]
    const out = await rankSessionStartCards(
      {
        memories: [mem('mem-cold', 'PROJECT'), mem('mem-hot', 'TASK')],
        slack: [],
        web: [],
        figma: [],
        prs: [],
      },
      { resolveCanonical, mergeRateByFragments }
    )
    expect(out.memories.map(m => m.id)).toEqual(['mem-hot', 'mem-cold'])
  })

  it('ranks non-memory sections by raw id and preserves cross-section grouping', async () => {
    const mergeRateByFragments = async (): Promise<FragmentMergeRate[]> => [
      {
        fragmentType: 'WEB_LINK',
        fragmentId: 'web-hot',
        resolvedTasks: 3,
        mergedTasks: 3,
      },
    ]
    const out = await rankSessionStartCards(
      {
        memories: [],
        slack: [],
        web: [{ id: 'web-cold' }, { id: 'web-hot' }],
        figma: [],
        prs: [],
      },
      { resolveCanonical: identityResolve, mergeRateByFragments }
    )
    expect(out.web.map(w => w.id)).toEqual(['web-hot', 'web-cold'])
  })

  it('falls back to the input unchanged when scoring throws (never blocks session-start)', async () => {
    const out = await rankSessionStartCards(
      {
        memories: [mem('mem-p', 'PROJECT'), mem('mem-t', 'TASK')],
        slack: [{ id: 's-1' }],
        web: [],
        figma: [],
        prs: [],
      },
      {
        resolveCanonical: identityResolve,
        mergeRateByFragments: async () => {
          throw new Error('db down')
        },
      }
    )
    expect(out.memories.map(m => m.id)).toEqual(['mem-p', 'mem-t'])
    expect(out.slack.map(s => s.id)).toEqual(['s-1'])
  })

  it('falls back when canonical resolution throws', async () => {
    const out = await rankSessionStartCards(
      {
        memories: [mem('mem-p', 'PROJECT')],
        slack: [],
        web: [],
        figma: [],
        prs: [],
      },
      {
        resolveCanonical: async () => {
          throw new Error('resolve down')
        },
        mergeRateByFragments: async () => [],
      }
    )
    expect(out.memories.map(m => m.id)).toEqual(['mem-p'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/lineage/session-rank.test.ts`
Expected: FAIL — `Cannot find module '@/lib/lineage/session-rank'`.

- [ ] **Step 3: Write the implementation**

Create `lib/lineage/session-rank.ts`:

```ts
import type {
  FragmentMergeRate,
  FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'
import type { RenderableMemory } from '@/lib/memory/render'
import { logger } from '@/lib/logger'
import { rankByLineage, type LineageStat } from '@/lib/lineage/ranking'

export interface SessionRankDeps {
  resolveCanonical: (type: string, id: string) => Promise<string>
  mergeRateByFragments: (refs: FragmentRef[]) => Promise<FragmentMergeRate[]>
}

export interface SessionStartCards<
  S extends { id: string },
  W extends { id: string },
  F extends { id: string },
  P extends { id: string },
> {
  memories: RenderableMemory[]
  slack: S[]
  web: W[]
  figma: F[]
  prs: P[]
}

const statKey = (type: string, id: string): string => `${type}::${id}`

/**
 * Lineage-aware reorder of the session-start sections (LUM-279). Dedupes
 * memories by canonical id (one resolve each, reused for scoring), scores every
 * fragment via the LUM-278 merge-rate query, then stable three-tier sorts each
 * section so high-merge fragments survive the token budget and proven-low ones
 * degrade first. Cross-type priority is the caller's concern — this only
 * reorders within each section and never mixes types.
 *
 * Never throws and never drops a section: any lineage failure (DB down, resolve
 * error) returns the input unchanged, so session-start keeps injecting today's
 * fixed-order payload within its 3-second budget.
 */
export async function rankSessionStartCards<
  S extends { id: string },
  W extends { id: string },
  F extends { id: string },
  P extends { id: string },
>(
  cards: SessionStartCards<S, W, F, P>,
  deps: SessionRankDeps
): Promise<SessionStartCards<S, W, F, P>> {
  try {
    // 1. Dedup memories by canonical id. orderedMemories is project-first, so
    //    keep-first retains the promoted PROJECT row and drops the TASK dup.
    const resolved: { memory: RenderableMemory; canonicalId: string }[] = []
    const seen = new Set<string>()
    for (const memory of cards.memories) {
      const canonicalId = await deps.resolveCanonical('MEMORY', memory.id)
      if (seen.has(canonicalId)) continue
      seen.add(canonicalId)
      resolved.push({ memory, canonicalId })
    }

    // 2. Score every fragment in one query. Memory by canonical id; the other
    //    types never re-key, so their raw id is the lineage key.
    const refs: FragmentRef[] = [
      ...resolved.map(m => ({
        fragmentType: 'MEMORY' as const,
        fragmentId: m.canonicalId,
      })),
      ...cards.slack.map(s => ({
        fragmentType: 'SLACK_CONTEXT' as const,
        fragmentId: s.id,
      })),
      ...cards.web.map(w => ({
        fragmentType: 'WEB_LINK' as const,
        fragmentId: w.id,
      })),
      ...cards.figma.map(f => ({
        fragmentType: 'FIGMA' as const,
        fragmentId: f.id,
      })),
      ...cards.prs.map(p => ({
        fragmentType: 'PR' as const,
        fragmentId: p.id,
      })),
    ]
    const stats = await deps.mergeRateByFragments(refs)
    const statByKey = new Map<string, LineageStat>(
      stats.map(s => [
        statKey(s.fragmentType, s.fragmentId),
        { resolvedTasks: s.resolvedTasks, mergedTasks: s.mergedTasks },
      ])
    )

    // 3. Stable three-tier reorder within each section.
    const memories = rankByLineage(
      resolved,
      m => statKey('MEMORY', m.canonicalId),
      statByKey
    ).map(m => m.memory)

    return {
      memories,
      slack: rankByLineage(
        cards.slack,
        s => statKey('SLACK_CONTEXT', s.id),
        statByKey
      ),
      web: rankByLineage(cards.web, w => statKey('WEB_LINK', w.id), statByKey),
      figma: rankByLineage(cards.figma, f => statKey('FIGMA', f.id), statByKey),
      prs: rankByLineage(cards.prs, p => statKey('PR', p.id), statByKey),
    }
  } catch (err) {
    logger.error('rankSessionStartCards failed; using fixed order', err)
    return cards
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/lineage/session-rank.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/lineage/session-rank.ts __tests__/lib/lineage/session-rank.test.ts
git commit -m "feat: never-throwing session-start lineage ranking orchestrator [LUM-279]"
```

---

### Task 3: Wire the orchestrator into `buildSessionStartSections`

**Files:**

- Modify: `lib/services/task-context.service.ts` (imports near line 1-50; `buildSessionStartSections` body lines ~492-532)
- Modify: `__tests__/services/session-start-fragments.test.ts` (add provenance + lineage repo mocks so the existing suite stays hermetic)
- Test: `__tests__/services/session-start-ranking.test.ts` (new)

- [ ] **Step 1: Add provenance + lineage mocks to the existing session-start suite**

In `__tests__/services/session-start-fragments.test.ts`, add these two mocks alongside the other `jest.mock(...)` calls (after the `pull-request.repository` mock, before the imports). Without them the new orchestrator would call the real Prisma client:

```ts
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    resolveCanonicalFragment: jest.fn(async (_t: string, id: string) => id),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { mergeRateByFragments: jest.fn(async () => []) },
}))
```

- [ ] **Step 2: Run the existing suite to confirm it still passes with the new mocks**

Run: `npx jest __tests__/services/session-start-fragments.test.ts`
Expected: PASS (no behavior change yet — orchestrator isn't wired in).

- [ ] **Step 3: Write the failing integration test**

Create `__tests__/services/session-start-ranking.test.ts`:

```ts
/** @jest-environment node */
// LUM-279: session-start sections are reordered by historical merge contribution
// before the token budget is applied, and pre/post-consolidation memory dups
// collapse by canonical id.

jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))
jest.mock('@/lib/services/document.service', () => ({
  scheduleDocumentSummary: jest.fn(),
}))
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
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    resolveCanonicalFragment: jest.fn(async (_t: string, id: string) => id),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { mergeRateByFragments: jest.fn(async () => []) },
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

const memRow = (id: string, category = 'TRAP') => ({
  id,
  category,
  content: { trigger: id, mitigation: id },
})

describe('buildSessionStartSections — lineage-aware ranking', () => {
  it('orders a high-merge memory ahead of a cold one in the fragment manifest', async () => {
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([memRow('mem-cold'), memRow('mem-hot')])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue(
      []
    )
    ;(
      lineageEdgeRepository.mergeRateByFragments as jest.Mock
    ).mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'mem-hot',
        resolvedTasks: 4,
        mergedTasks: 4,
      },
    ])

    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'mem-hot' },
      { fragmentType: 'MEMORY', fragmentId: 'mem-cold' },
    ])
  })

  it('collapses a pre/post-consolidation memory duplicate by canonical id', async () => {
    // project row 'mem-p' is the promoted canonical of task row 'mem-t'.
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([memRow('mem-p')])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([
      memRow('mem-t'),
    ])
    ;(
      memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
    ).mockImplementation(async (_t: string, id: string) =>
      id === 'mem-t' ? 'mem-p' : id
    )
    ;(
      lineageEdgeRepository.mergeRateByFragments as jest.Mock
    ).mockResolvedValue([])

    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'mem-p' },
    ])
  })

  it('falls back to fixed order (project-first) when the merge-rate query throws', async () => {
    ;(
      memoryRepository.findActiveProjectMemories as jest.Mock
    ).mockResolvedValue([memRow('mem-p')])
    ;(memoryRepository.findActiveTaskMemories as jest.Mock).mockResolvedValue([
      memRow('mem-t'),
    ])
    ;(
      memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
    ).mockImplementation(async (_t: string, id: string) => id)
    ;(
      lineageEdgeRepository.mergeRateByFragments as jest.Mock
    ).mockRejectedValue(new Error('db down'))

    const out = await taskContextService.buildSessionStartSections('t-1')
    expect(out.fragments).toEqual([
      { fragmentType: 'MEMORY', fragmentId: 'mem-p' },
      { fragmentType: 'MEMORY', fragmentId: 'mem-t' },
    ])
  })
})
```

- [ ] **Step 4: Run the integration test to verify it fails**

Run: `npx jest __tests__/services/session-start-ranking.test.ts`
Expected: FAIL — first test gets `['mem-cold', 'mem-hot']` (fixed order, no ranking yet); dedup test gets two MEMORY fragments instead of one.

- [ ] **Step 5: Add the import**

In `lib/services/task-context.service.ts`, add to the import block (near the other `@/lib/lineage` / service imports, e.g. just after the `lineage-signal` / `fragment-type` imports):

```ts
import { rankSessionStartCards } from '@/lib/lineage/session-rank'
```

- [ ] **Step 6: Wire the orchestrator into `buildSessionStartSections`**

In `lib/services/task-context.service.ts`, the current body builds `orderedMemories` then calls `allocateBudget` and the `fragments` manifest off the raw arrays. Replace the block that starts at `const orderedMemories: RenderableMemory[] = [` and runs through the end of the `fragments` array literal with:

```ts
const orderedMemories: RenderableMemory[] = [
  ...projectMemories.map(m => ({
    id: m.id,
    scope: 'PROJECT' as const,
    category: m.category,
    content: m.content,
  })),
  ...taskMemories.map(m => ({
    id: m.id,
    scope: 'TASK' as const,
    category: m.category,
    content: m.content,
  })),
]

// LUM-279: reorder each section by historical merge contribution (high-merge
// survives the budget, proven-low degrades first) and collapse pre/post-
// consolidation memory dups. Never throws — falls back to the fixed order.
const ranked = await rankSessionStartCards(
  { memories: orderedMemories, slack, web, figma, prs },
  {
    resolveCanonical: (type, id) =>
      memoryProvenanceRepository.resolveCanonicalFragment(type, id),
    mergeRateByFragments: refs =>
      lineageEdgeRepository.mergeRateByFragments(refs),
  }
)

// Priority order: memory > PR > Slack > Figma > web.
const [memoryOut, prOut, slackOut, figmaOut, webOut] = allocateBudget(
  [
    memoryBudgetSection(ranked.memories),
    prBudgetSection(ranked.prs as unknown as PRCard[]),
    slackBudgetSection(ranked.slack as unknown as SlackContextCard[]),
    figmaBudgetSection(ranked.figma),
    webLinkBudgetSection(ranked.web as unknown as WebLinkCard[]),
  ],
  SESSION_START_BUDGET_TOKENS
) as [string, string, string, string, string]

const linkedJoined = [prOut, slackOut, figmaOut, webOut]
  .filter(s => s !== '')
  .join('\n\n')

const fragments: FragmentRef[] = [
  ...ranked.memories.map(m => ({
    fragmentType: 'MEMORY' as const,
    fragmentId: m.id,
  })),
  ...ranked.slack.map(s => ({
    fragmentType: 'SLACK_CONTEXT' as const,
    fragmentId: s.id,
  })),
  ...ranked.web.map(w => ({
    fragmentType: 'WEB_LINK' as const,
    fragmentId: w.id,
  })),
  ...ranked.figma.map(f => ({
    fragmentType: 'FIGMA' as const,
    fragmentId: f.id,
  })),
  ...ranked.prs.map(p => ({ fragmentType: 'PR' as const, fragmentId: p.id })),
]
```

Notes for the implementer:

- `slack`, `web`, `figma`, `prs` are the same variables destructured from the existing `Promise.all`; `rankSessionStartCards` infers their element types and returns them reordered with identical types, so the existing `as unknown as XxxCard[]` casts are unchanged.
- `fragments` still emits the memory's raw `m.id` (not the canonical id) — exactly as before. Edge birth canonicalizes on write, so this stays write-key-consistent; dedup simply means the dropped TASK row no longer appears.

- [ ] **Step 7: Run the integration test to verify it passes**

Run: `npx jest __tests__/services/session-start-ranking.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 8: Run the full session-start + lineage suites for regressions**

Run: `npx jest __tests__/services/session-start-fragments.test.ts __tests__/services/session-start-ranking.test.ts __tests__/context/session-start-sections.test.ts __tests__/lib/lineage`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add lib/services/task-context.service.ts \
  __tests__/services/session-start-fragments.test.ts \
  __tests__/services/session-start-ranking.test.ts
git commit -m "feat: lineage-aware session-start context ranking + dedup [LUM-279]"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS. If any unrelated pre-existing failure appears, note it but do not fix it in this branch.

- [ ] **Step 2: Final typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Token-lint (no raw colors introduced)**

Run: `npm run lint:tokens`
Expected: PASS (no UI/CSS touched, so this should be unaffected — confirm it doesn't regress).

---

## Out of scope (do NOT implement here)

- Path B (`getContextForIdentifier` / `lumo task context`) ranking or trimming.
- Cross-section unified ranking (mixing types into one ranked list).
- Adaptive (workspace-mean) high/low threshold.
- Dedup of non-memory fragment types.
- Any Prisma schema change, new npm package, or change to `lib/context/budget.ts`.

## CLI docs

No `cli/src/commands/` change in this plan (session-start injection is server-side), so `.claude/skills/lumo/SKILL.md` does not need updating.
