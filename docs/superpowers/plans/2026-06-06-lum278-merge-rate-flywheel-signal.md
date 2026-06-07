# LUM-278 — per-fragment merge-rate flywheel signal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `lumo task context` 输出末尾,为每个达到样本阈值的 context fragment 打印一条历史 merge 贡献信号(例:`出现在 5 个已闭合任务·4 merged (80%)`)。

**Architecture:** 新增一个按 `taskId` 去重的聚合查询(repository),一个 type 映射 helper,一个可注入依赖、可独立单测的 lineage 装配模块(service 层),并把渲染出的 `lineageSection` 字符串透过既有 API(route 直接 `NextResponse.json(result)`,无需改)送到 CLI,在 Previous Sessions 之后追加。口径与冷启动门控全部写死在服务端。

**Tech Stack:** TypeScript (strict), Prisma (groupBy), Jest (mock `@/lib/db/prisma`), Next.js App Router, 自研 CLI。

**Spec:** `docs/superpowers/specs/2026-06-06-lum278-merge-rate-flywheel-signal-design.md`

**No schema change / no migration** — `LineageEdge` 表与枚举已存在(LUM-275)。本任务只读不写边。

---

## File Structure

- **Create** `lib/lineage/fragment-type.ts` — `toLineageFragmentType(t)` 映射 helper(可被未来 LUM-275 边出生复用)。
- **Create** `__tests__/lib/lineage/fragment-type.test.ts`
- **Modify** `lib/repositories/lineage-edge.repository.ts` — 新增 `mergeRateByFragments` + `FragmentMergeRate` 接口。
- **Modify** `__tests__/lineage-edge.repository.test.ts` — 新增 `mergeRateByFragments` 测试组。
- **Create** `lib/services/lineage-signal.ts` — 纯渲染 + 可注入依赖的 `assembleLineageSection`、`renderLineageSection`、`formatLineageSignalLine`、`LINEAGE_MIN_RESOLVED_TASKS`。
- **Create** `__tests__/lib/services/lineage-signal.test.ts`
- **Modify** `lib/services/task-context.service.ts` — `TaskContext` 加 `lineageSection: string`;在 `getContextForIdentifier` 末尾装配并返回。
- **Modify** `cli/src/commands/task-context.ts` — `TaskContextResponse` 加 `lineageSection?: string`;修早返回;末尾追加。
- **Modify** `__tests__/...` CLI 渲染测试(若存在;否则新建 `__tests__/cli/task-context-format.test.ts`,见 Task 5)。

---

## Task 1: Repository — `mergeRateByFragments`(按任务去重聚合)

**Files:**
- Modify: `lib/repositories/lineage-edge.repository.ts`
- Test: `__tests__/lineage-edge.repository.test.ts`

- [ ] **Step 1: 写失败测试**(追加到 `__tests__/lineage-edge.repository.test.ts` 的 `describe('lineageEdgeRepository', …)` 内,`listByTask` 组之后):

```ts
  describe('mergeRateByFragments', () => {
    it('returns [] and does not query for an empty fragment list', async () => {
      const result = await lineageEdgeRepository.mergeRateByFragments([])
      expect(result).toEqual([])
      expect(mockGroupBy).not.toHaveBeenCalled()
    })

    it('groups by fragment + task + outcome scoped to the requested fragments', async () => {
      mockGroupBy.mockResolvedValue([])
      await lineageEdgeRepository.mergeRateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
      ])
      expect(mockGroupBy).toHaveBeenCalledWith({
        by: ['fragmentType', 'fragmentId', 'taskId', 'outcome'],
        where: { OR: [{ fragmentType: 'MEMORY', fragmentId: 'mem-1' }] },
        _count: { _all: true },
      })
    })

    it('dedupes by task: many edges for one task count as one resolved/merged task', async () => {
      // mem-1 in task A: two MERGED edges (2 runs) + one UNKNOWN → A is 1 resolved, 1 merged
      mockGroupBy.mockResolvedValue([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'A', outcome: 'MERGED', _count: { _all: 2 } },
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'A', outcome: 'UNKNOWN', _count: { _all: 1 } },
      ])
      const result = await lineageEdgeRepository.mergeRateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
      ])
      expect(result).toEqual([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 1, mergedTasks: 1 },
      ])
    })

    it('excludes UNKNOWN-only tasks from the denominator', async () => {
      // mem-1: task A merged, task B rejected (resolved, not merged), task C unknown-only (excluded)
      mockGroupBy.mockResolvedValue([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'A', outcome: 'MERGED', _count: { _all: 1 } },
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'B', outcome: 'REJECTED', _count: { _all: 1 } },
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', taskId: 'C', outcome: 'UNKNOWN', _count: { _all: 3 } },
      ])
      const result = await lineageEdgeRepository.mergeRateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' },
      ])
      expect(result).toEqual([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 2, mergedTasks: 1 },
      ])
    })

    it('omits fragments with no edges and preserves requested order', async () => {
      mockGroupBy.mockResolvedValue([
        { fragmentType: 'PR', fragmentId: 'pr-7', taskId: 'A', outcome: 'MERGED', _count: { _all: 1 } },
      ])
      const result = await lineageEdgeRepository.mergeRateByFragments([
        { fragmentType: 'MEMORY', fragmentId: 'mem-1' }, // no edges → omitted
        { fragmentType: 'PR', fragmentId: 'pr-7' },
      ])
      expect(result).toEqual([
        { fragmentType: 'PR', fragmentId: 'pr-7', resolvedTasks: 1, mergedTasks: 1 },
      ])
    })
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-278-merge-rate-flywheel-signal && npx jest __tests__/lineage-edge.repository.test.ts -t mergeRateByFragments`
Expected: FAIL — `lineageEdgeRepository.mergeRateByFragments is not a function`

- [ ] **Step 3: 实现**(在 `lib/repositories/lineage-edge.repository.ts`)。先在 `FragmentStats` 接口下方加新接口:

```ts
/** Per-fragment, task-deduped merge counts. Backs the LUM-278 flywheel signal. */
export interface FragmentMergeRate {
  fragmentType: LineageFragmentType
  fragmentId: string
  /** Distinct tasks where this fragment appeared with a resolved (non-UNKNOWN) outcome. */
  resolvedTasks: number
  /** Distinct tasks (subset of resolvedTasks) where this fragment appeared with a MERGED edge. */
  mergedTasks: number
}
```

然后在 `lineageEdgeRepository` 对象里、`aggregateByFragments` 之后加方法:

```ts
  /**
   * Per-fragment merge rate, DEDUPED BY TASK. A (fragment, task) pair counts as
   * `resolved` if it has any non-UNKNOWN edge and `merged` if it has any MERGED
   * edge — so multiple runs/sessions of the same task collapse to one. This is
   * the correct denominator for the "merge contribution" signal; do NOT use
   * `aggregateByFragments` (it counts edges, double-counting multi-run tasks).
   * Cold-start gating (min sample size) is the caller's responsibility.
   */
  async mergeRateByFragments(
    fragments: FragmentRef[],
    tx?: Prisma.TransactionClient
  ): Promise<FragmentMergeRate[]> {
    if (fragments.length === 0) return []
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['fragmentType', 'fragmentId', 'taskId', 'outcome'],
      where: {
        OR: fragments.map(f => ({
          fragmentType: f.fragmentType,
          fragmentId: f.fragmentId,
        })),
      },
      _count: { _all: true },
    })

    // fragmentKey → (taskId → {resolved, merged}); collapse runs within a task.
    const perFragment = new Map<
      string,
      {
        fragmentType: LineageFragmentType
        fragmentId: string
        tasks: Map<string, { resolved: boolean; merged: boolean }>
      }
    >()
    for (const row of rows) {
      const fKey = fragmentKey(row.fragmentType, row.fragmentId)
      let entry = perFragment.get(fKey)
      if (!entry) {
        entry = {
          fragmentType: row.fragmentType,
          fragmentId: row.fragmentId,
          tasks: new Map(),
        }
        perFragment.set(fKey, entry)
      }
      let task = entry.tasks.get(row.taskId)
      if (!task) {
        task = { resolved: false, merged: false }
        entry.tasks.set(row.taskId, task)
      }
      if (row.outcome !== 'UNKNOWN') task.resolved = true
      if (row.outcome === 'MERGED') task.merged = true
    }

    return fragments
      .map(f => perFragment.get(fragmentKey(f.fragmentType, f.fragmentId)))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map(e => {
        let resolvedTasks = 0
        let mergedTasks = 0
        for (const task of e.tasks.values()) {
          if (task.resolved) resolvedTasks++
          if (task.merged) mergedTasks++
        }
        return {
          fragmentType: e.fragmentType,
          fragmentId: e.fragmentId,
          resolvedTasks,
          mergedTasks,
        }
      })
  },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/lineage-edge.repository.test.ts`
Expected: PASS (全组,含原有 `createMany`/`aggregateByFragments`/`listByTask`)

- [ ] **Step 5: 提交**

```bash
git add lib/repositories/lineage-edge.repository.ts __tests__/lineage-edge.repository.test.ts
git commit -m "feat: task-deduped mergeRateByFragments lineage query [LUM-278]"
```

---

## Task 2: Type 映射 helper `toLineageFragmentType`

**Files:**
- Create: `lib/lineage/fragment-type.ts`
- Test: `__tests__/lib/lineage/fragment-type.test.ts`

- [ ] **Step 1: 写失败测试**(`__tests__/lib/lineage/fragment-type.test.ts`):

```ts
import { toLineageFragmentType } from '@/lib/lineage/fragment-type'

describe('toLineageFragmentType', () => {
  it('maps tracked fragment types to the LineageFragmentType enum', () => {
    expect(toLineageFragmentType('MEMORY')).toBe('MEMORY')
    expect(toLineageFragmentType('SLACK_CONTEXT')).toBe('SLACK_CONTEXT')
    expect(toLineageFragmentType('WEB_LINK')).toBe('WEB_LINK')
    expect(toLineageFragmentType('FIGMA_LINK')).toBe('FIGMA')
    expect(toLineageFragmentType('PULL_REQUEST')).toBe('PR')
    expect(toLineageFragmentType('PR_REVIEW_TODO')).toBe('PR_REVIEW_TODO')
    expect(toLineageFragmentType('SESSION')).toBe('SESSION')
  })

  it('returns null for fragment types with no lineage edge counterpart', () => {
    expect(toLineageFragmentType('ARTIFACT')).toBeNull()
    expect(toLineageFragmentType('DOCUMENT')).toBeNull()
    expect(toLineageFragmentType('COMMENT')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/lib/lineage/fragment-type.test.ts`
Expected: FAIL — cannot find module `@/lib/lineage/fragment-type`

- [ ] **Step 3: 实现**(`lib/lineage/fragment-type.ts`):

```ts
import type { LineageFragmentType } from '@prisma/client'
import type { ContextFragmentType } from '@/lib/services/task-context.service'

/**
 * Map a context-assembly fragment type to its LineageEdge enum value. Returns
 * null for fragment types that have no lineage counterpart (ARTIFACT, DOCUMENT,
 * COMMENT) — those are never edge-recorded, so they get no merge-rate signal.
 * Single source of truth for read (LUM-278) and future edge-birth (LUM-275).
 */
export function toLineageFragmentType(
  t: ContextFragmentType
): LineageFragmentType | null {
  switch (t) {
    case 'MEMORY':
      return 'MEMORY'
    case 'SLACK_CONTEXT':
      return 'SLACK_CONTEXT'
    case 'WEB_LINK':
      return 'WEB_LINK'
    case 'FIGMA_LINK':
      return 'FIGMA'
    case 'PULL_REQUEST':
      return 'PR'
    case 'PR_REVIEW_TODO':
      return 'PR_REVIEW_TODO'
    case 'SESSION':
      return 'SESSION'
    case 'ARTIFACT':
    case 'DOCUMENT':
    case 'COMMENT':
      return null
  }
}
```

> Note: `ContextFragmentType` 是 `import type`,不会产生运行时循环(service 在 Task 4 会 import 本文件的 `assembleLineageSection`,但反向只是类型边)。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/lib/lineage/fragment-type.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/lineage/fragment-type.ts __tests__/lib/lineage/fragment-type.test.ts
git commit -m "feat: ContextFragmentType -> LineageFragmentType mapping helper [LUM-278]"
```

---

## Task 3: Service 层纯模块 `lineage-signal.ts`(渲染 + 可注入装配)

**Files:**
- Create: `lib/services/lineage-signal.ts`
- Test: `__tests__/lib/services/lineage-signal.test.ts`

- [ ] **Step 1: 写失败测试**(`__tests__/lib/services/lineage-signal.test.ts`):

```ts
import {
  LINEAGE_MIN_RESOLVED_TASKS,
  renderLineageSection,
  assembleLineageSection,
} from '@/lib/services/lineage-signal'
import type { FragmentMergeRate } from '@/lib/repositories/lineage-edge.repository'

describe('LINEAGE_MIN_RESOLVED_TASKS', () => {
  it('is 3', () => {
    expect(LINEAGE_MIN_RESOLVED_TASKS).toBe(3)
  })
})

describe('renderLineageSection', () => {
  it('returns "" when no entry meets the threshold', () => {
    expect(
      renderLineageSection([{ label: '[MEMORY] "x"', resolvedTasks: 2, mergedTasks: 2 }])
    ).toBe('')
  })

  it('renders a header, caveat, and one line per qualifying entry with percent + fraction', () => {
    const out = renderLineageSection([
      { label: '[MEMORY] "use color-mix"', resolvedTasks: 5, mergedTasks: 4 },
      { label: '[PR] #123', resolvedTasks: 2, mergedTasks: 2 }, // below threshold → dropped
    ])
    expect(out).toContain('## 飞轮信号 · 历史 merge 贡献')
    expect(out).toContain('历史相关性,非因果')
    expect(out).toContain('- [MEMORY] "use color-mix" — 出现在 5 个已闭合任务·4 merged (80%)')
    expect(out).not.toContain('#123')
  })
})

describe('assembleLineageSection', () => {
  const memContent = new Map([['mem-1', '   use color-mix not hsl(var())   ']])

  it('maps + resolves canonical + joins stats + gates, returning the section', async () => {
    const resolveCanonicalFragment = jest
      .fn()
      .mockImplementation(async (_t: string, id: string) =>
        id === 'mem-1' ? 'mem-canon' : id
      )
    const mergeRateByFragments = jest
      .fn()
      .mockResolvedValue([
        { fragmentType: 'MEMORY', fragmentId: 'mem-canon', resolvedTasks: 5, mergedTasks: 4 },
      ] as FragmentMergeRate[])

    const out = await assembleLineageSection(
      [
        { type: 'MEMORY', id: 'mem-1' },
        { type: 'ARTIFACT', id: 'art-1' }, // no lineage type → skipped
      ],
      memContent,
      { resolveCanonicalFragment, mergeRateByFragments }
    )

    // ARTIFACT never reaches the query
    expect(mergeRateByFragments).toHaveBeenCalledWith([
      { fragmentType: 'MEMORY', fragmentId: 'mem-canon' },
    ])
    // label uses original mem-1 content, joined on canonical id
    expect(out).toContain('- [MEMORY] "use color-mix not hsl(var())" — 出现在 5 个已闭合任务·4 merged (80%)')
  })

  it('returns "" when a fragment has stats but is below threshold', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      memContent,
      {
        resolveCanonicalFragment: async (_t, id) => id,
        mergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 2, mergedTasks: 2 },
        ],
      }
    )
    expect(out).toBe('')
  })

  it('degrades to "" (does not throw) when the query errors', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      memContent,
      {
        resolveCanonicalFragment: async (_t, id) => id,
        mergeRateByFragments: async () => {
          throw new Error('db down')
        },
      }
    )
    expect(out).toBe('')
  })

  it('falls back to a generic label when no friendly label is available', async () => {
    const out = await assembleLineageSection(
      [{ type: 'WEB_LINK', id: 'weblink12345678' }],
      new Map(),
      {
        resolveCanonicalFragment: async (_t, id) => id,
        mergeRateByFragments: async () => [
          { fragmentType: 'WEB_LINK', fragmentId: 'weblink12345678', resolvedTasks: 3, mergedTasks: 3 },
        ],
      }
    )
    expect(out).toContain('- [WEB_LINK] weblink1 — 出现在 3 个已闭合任务·3 merged (100%)')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/lib/services/lineage-signal.test.ts`
Expected: FAIL — cannot find module `@/lib/services/lineage-signal`

- [ ] **Step 3: 实现**(`lib/services/lineage-signal.ts`):

```ts
import type {
  FragmentMergeRate,
  FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'
import type { ContextFragmentType } from '@/lib/services/task-context.service'
import { toLineageFragmentType } from '@/lib/lineage/fragment-type'
import { logger } from '@/lib/logger'

/**
 * Cold-start gate: a fragment must have appeared in at least this many RESOLVED
 * (non-UNKNOWN-outcome) tasks before we print a merge-rate signal for it.
 * Hardwired — "don't promise intelligence" below the sample floor.
 */
export const LINEAGE_MIN_RESOLVED_TASKS = 3

const LABEL_MAX = 60

export interface LineageSignalEntry {
  label: string
  resolvedTasks: number
  mergedTasks: number
}

/** Pure render: gate + format. Returns "" when nothing qualifies. */
export function renderLineageSection(entries: LineageSignalEntry[]): string {
  const qualifying = entries.filter(
    e => e.resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS
  )
  if (qualifying.length === 0) return ''
  return [
    '## 飞轮信号 · 历史 merge 贡献',
    '',
    '> 口径:分母 = 该片段出现过且 outcome 已确定(merged/否)的去重任务数;分子 = 其中已 merged 的。仅显示样本 ≥ 3 个已闭合任务。这是历史相关性,非因果。',
    '',
    ...qualifying.map(formatLineageSignalLine),
  ].join('\n')
}

export function formatLineageSignalLine(e: LineageSignalEntry): string {
  // resolvedTasks ≥ LINEAGE_MIN_RESOLVED_TASKS (≥1) here, so no divide-by-zero.
  const pct = Math.round((e.mergedTasks / e.resolvedTasks) * 100)
  return `- ${e.label} — 出现在 ${e.resolvedTasks} 个已闭合任务·${e.mergedTasks} merged (${pct}%)`
}

function fragmentLabel(
  type: ContextFragmentType,
  id: string,
  memoryContentById: Map<string, string>
): string {
  if (type === 'MEMORY') {
    const content = memoryContentById.get(id)
    if (content && content.trim().length > 0) {
      const oneLine = content.replace(/\s+/g, ' ').trim()
      const snippet =
        oneLine.length > LABEL_MAX ? `${oneLine.slice(0, LABEL_MAX)}…` : oneLine
      return `[MEMORY] "${snippet}"`
    }
  }
  // Generic fallback for non-memory types and memories with no content on hand.
  return `[${type}] ${id.slice(0, 8)}`
}

export interface LineageSignalDeps {
  resolveCanonicalFragment: (type: string, id: string) => Promise<string>
  mergeRateByFragments: (refs: FragmentRef[]) => Promise<FragmentMergeRate[]>
}

/**
 * Build the trailing flywheel-signal markdown for a task's context fragments.
 * Maps each fragment to its lineage type, resolves MEMORY ids to canonical
 * (matching how edges were keyed at birth), joins task-deduped merge stats,
 * applies the cold-start gate, and renders. Never throws — any failure degrades
 * to "" so the rest of the context handoff is unaffected.
 */
export async function assembleLineageSection(
  fragments: { type: ContextFragmentType; id: string }[],
  memoryContentById: Map<string, string>,
  deps: LineageSignalDeps
): Promise<string> {
  try {
    const inputs: { ref: FragmentRef; label: string }[] = []
    for (const f of fragments) {
      const lineageType = toLineageFragmentType(f.type)
      if (!lineageType) continue
      const canonicalId = await deps.resolveCanonicalFragment(lineageType, f.id)
      inputs.push({
        ref: { fragmentType: lineageType, fragmentId: canonicalId },
        label: fragmentLabel(f.type, f.id, memoryContentById),
      })
    }
    if (inputs.length === 0) return ''

    const stats = await deps.mergeRateByFragments(inputs.map(i => i.ref))
    const statByKey = new Map(
      stats.map(s => [`${s.fragmentType}::${s.fragmentId}`, s])
    )

    const entries: LineageSignalEntry[] = []
    const seen = new Set<string>()
    for (const input of inputs) {
      const key = `${input.ref.fragmentType}::${input.ref.fragmentId}`
      if (seen.has(key)) continue // two manifest memories → same canonical: first wins
      seen.add(key)
      const stat = statByKey.get(key)
      if (!stat) continue
      entries.push({
        label: input.label,
        resolvedTasks: stat.resolvedTasks,
        mergedTasks: stat.mergedTasks,
      })
    }
    return renderLineageSection(entries)
  } catch (err) {
    logger.error('assembleLineageSection failed; omitting flywheel signal', {
      err,
    })
    return ''
  }
}
```

> Confirm the logger import: `grep -n "logger" lib/services/task-context.service.ts` and reuse the same import path (likely `@/lib/logger`). If the project uses a different logger wrapper, match it.

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/lib/services/lineage-signal.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/services/lineage-signal.ts __tests__/lib/services/lineage-signal.test.ts
git commit -m "feat: lineage flywheel signal assembly + render module [LUM-278]"
```

---

## Task 4: 接线 service — `getContextForIdentifier` 产出 `lineageSection`

**Files:**
- Modify: `lib/services/task-context.service.ts`

- [ ] **Step 1: 给 `TaskContext` 接口加字段。** 在 `memorySection: string`(约 line 122)同级、`fragments: ContextFragment[]`(约 line 146)之前或之后加:

```ts
  /**
   * Pre-rendered "## 飞轮信号 · 历史 merge 贡献" block appended at the very end
   * of the context handoff. Empty string when no fragment clears the cold-start
   * sample floor (LUM-278 DoD⑤). Caliber is fixed server-side.
   */
  lineageSection: string
```

- [ ] **Step 2: import 装配函数。** 在 task-context.service.ts 顶部 import 区加:

```ts
import { assembleLineageSection } from '@/lib/services/lineage-signal'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
```

> 先 `grep -n "lineageEdgeRepository\|memoryProvenanceRepository\|assembleLineageSection" lib/services/task-context.service.ts` 看是否已 import,避免重复声明。

- [ ] **Step 3: 在 `return { … }` 之前装配 section。** 在 `fragments` 常量定义之后(约 line 719)、`return {` 之前插入:

```ts
    // Trailing flywheel signal (LUM-278). Reads accumulated lineage edges,
    // task-deduped, gated on a cold-start sample floor. Best-effort: any
    // failure degrades to "" inside assembleLineageSection.
    const memoryContentById = new Map(
      budgetedMemories.map(m => [m.id, m.content])
    )
    const lineageSection = await assembleLineageSection(
      fragments,
      memoryContentById,
      {
        resolveCanonicalFragment: (type, id) =>
          memoryProvenanceRepository.resolveCanonicalFragment(type, id),
        mergeRateByFragments: refs =>
          lineageEdgeRepository.mergeRateByFragments(refs),
      }
    )
```

- [ ] **Step 4: 在返回对象里加 `lineageSection`。** 在 `return { … }` 中 `fragments,`(约 line 767)旁加一行:

```ts
      lineageSection,
      fragments,
```

- [ ] **Step 5: 跑相关测试 + 类型检查。**

Run: `npx jest __tests__/lib/services/lineage-signal.test.ts __tests__/lineage-edge.repository.test.ts && npx tsc --noEmit`
Expected: jest PASS;tsc 无错(确认 `TaskContext` 新字段在 service 内被赋值、`budgetedMemories[].content` 存在)。

> 若有既有 `task-context.service` 的测试因新增必填字段 `lineageSection` 报缺字段,在其 fixture/断言里补 `lineageSection: ''`。先 `grep -rln "memorySection" __tests__` 找。

- [ ] **Step 6: 提交**

```bash
git add lib/services/task-context.service.ts
git commit -m "feat: emit lineageSection from task-context service [LUM-278]"
```

---

## Task 5: CLI — `TaskContextResponse` + 末尾渲染(修早返回)

**Files:**
- Modify: `cli/src/commands/task-context.ts`
- Test: `__tests__/cli/task-context-format.test.ts`(若已有 CLI format 测试则就地扩展)

- [ ] **Step 1: 定位现有 CLI format 测试。**

Run: `grep -rln "formatTaskContextMarkdown" __tests__`
- 若有 → Step 2 改在该文件;若无 → 在 `__tests__/cli/task-context-format.test.ts` 新建,顶部:
```ts
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'
```
> 确认 jest `moduleNameMapper` 能解析 `@/cli/...`;若不能,改用相对路径 `../../cli/src/commands/task-context`。先看现有 import cli 的测试怎么写:`grep -rln "cli/src/commands" __tests__ | head`。

- [ ] **Step 2: 写失败测试。** 加两个用例(用最小 response;`base` 按现有测试的 fixture 风格构造,至少含 `task`、空 `sessions: []`):

```ts
function base(overrides: any = {}) {
  return {
    task: { identifier: 'LUM-1', title: 'T', status: 'TODO', description: null },
    sessions: [],
    ...overrides,
  }
}
const NOW = new Date('2026-06-06T00:00:00Z')

it('appends lineageSection at the very end when sessions is empty', () => {
  const out = formatTaskContextMarkdown(
    base({ lineageSection: '## 飞轮信号 · 历史 merge 贡献\n\n- [MEMORY] "x" — 出现在 3 个已闭合任务·3 merged (100%)' }),
    NOW
  )
  expect(out).toContain('## Previous Sessions (0)')
  // lineage block comes AFTER the sessions block
  expect(out.indexOf('飞轮信号')).toBeGreaterThan(out.indexOf('Previous Sessions'))
  expect(out).toContain('出现在 3 个已闭合任务·3 merged (100%)')
})

it('appends lineageSection after a non-empty sessions block', () => {
  const out = formatTaskContextMarkdown(
    base({
      sessions: [
        {
          id: 'abcdef1234',
          startedAt: '2026-06-05T00:00:00Z',
          lastActivityAt: '2026-06-05T01:00:00Z',
          durationMs: 3600000,
          eventCount: 1,
          summaryType: null,
          headline: 'did things',
          unresolved: [],
        },
      ],
      lineageSection: '## 飞轮信号 · 历史 merge 贡献\n\n- [PR] #1 — 出现在 4 个已闭合任务·3 merged (75%)',
    }),
    NOW
  )
  expect(out.indexOf('飞轮信号')).toBeGreaterThan(out.indexOf('Previous Sessions (1)'))
})

it('omits the lineage block when lineageSection is absent/empty', () => {
  const out = formatTaskContextMarkdown(base({ lineageSection: '' }), NOW)
  expect(out).not.toContain('飞轮信号')
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx jest __tests__/cli/task-context-format.test.ts`
Expected: FAIL — lineage 块未出现 / `lineageSection` 不是已知字段(或断言顺序失败)。

- [ ] **Step 4: 改 CLI 源。**

(a) 在 `interface TaskContextResponse`(cli/src/commands/task-context.ts:6-41)`prReviewTodosSection?: string`(line 30)下方加:
```ts
  lineageSection?: string
```

(b) 重构 `formatTaskContextMarkdown` 尾部(当前 line 174-198)。把 sessions==0 的**早返回去掉**,改成 if/else 渲染 sessions,再统一追加 lineage,最后单一 return:

```ts
  if (data.sessions.length === 0) {
    lines.push('## Previous Sessions (0)')
    lines.push('')
    lines.push('_No prior coding sessions for this task._')
    lines.push('')
  } else {
    lines.push(`## Previous Sessions (${data.sessions.length})`)
    lines.push('')

    for (const s of data.sessions) {
      const shortId = s.id.slice(0, 8)
      const ago = relativeTime(new Date(s.lastActivityAt), now)
      const dur = formatDuration(s.durationMs)
      lines.push(`### Session ${shortId} · ${ago} · ${dur}`)
      lines.push(`**Summary**: ${sanitizeField(s.headline)}`)
      if (s.unresolved.length > 0) {
        lines.push('**Unresolved**:')
        for (const u of s.unresolved) lines.push(`- ${sanitizeField(u)}`)
      }
      lines.push('')
    }
  }

  // Flywheel signal goes last so it reads as a closing "historical payoff"
  // footer (LUM-278). Server returns "" below the cold-start floor.
  if (data.lineageSection && data.lineageSection.trim().length > 0) {
    lines.push(sanitizeField(data.lineageSection.trimEnd()))
    lines.push('')
  }

  return lines.join('\n')
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest __tests__/cli/task-context-format.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add cli/src/commands/task-context.ts __tests__/cli/task-context-format.test.ts
git commit -m "feat: render lineage flywheel signal at end of task context CLI output [LUM-278]"
```

---

## Task 6: 全量验证 + 文档同步检查

**Files:** 无新增(仅验证)。

- [ ] **Step 1: 类型检查全绿**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-278-merge-rate-flywheel-signal && npx tsc --noEmit`
Expected: 无错误。若报 `LineageEdge`/`taskArtifact` 之类"不存在",是 generated client 过期 → `npx prisma generate` 后重跑(本任务无 schema 改动,通常不需要)。

- [ ] **Step 2: 跑本任务全部测试**

Run: `npx jest __tests__/lineage-edge.repository.test.ts __tests__/lib/lineage/fragment-type.test.ts __tests__/lib/services/lineage-signal.test.ts __tests__/cli/task-context-format.test.ts`
Expected: 全 PASS。

- [ ] **Step 3: 跑可能受影响的既有测试**(task-context service / CLI)

Run: `grep -rln "task-context\|taskContextService\|formatTaskContextMarkdown" __tests__` 然后对命中的文件 `npx jest <files>`
Expected: 全 PASS(尤其确认新增必填字段 `lineageSection` 没让既有 fixture 红)。

- [ ] **Step 4: SKILL.md 同步判定。** 本任务**未改 `cli/src/commands/` 的调用方式**(无新子命令/flag,只是 `task context` 输出末尾多了一段)。按 CLAUDE.md「纯输出增补、不影响调用方式」属例外,**无需**改 `.claude/skills/lumo/SKILL.md`。确认无误即可(若 SKILL.md 有"task context 输出包含哪些段"的明细清单,可补一行飞轮信号;否则跳过)。

Run: `grep -n "task context" .claude/skills/lumo/references/task-context.md | head`
Expected: 人工判断是否需补一行;默认跳过。

- [ ] **Step 5: 提交(若 Step 3/4 有改动)**

```bash
git add -A && git commit -m "test: backfill lineageSection in affected fixtures [LUM-278]"
```

---

## Self-Review(plan 作者已核对)

**Spec coverage:**
- 分母按任务去重·排除在途 → Task 1。
- 阈值 3 + 不足不显示 → Task 3(`LINEAGE_MIN_RESOLVED_TASKS`、`renderLineageSection` 门控)。
- 百分比+分式展示 → Task 3(`formatLineageSignalLine`)。
- caveat 行 → Task 3(`renderLineageSection` 头部)。
- canonical 解析 → Task 3(`assembleLineageSection` 调 `resolveCanonicalFragment`)。
- type 映射(FIGMA_LINK→FIGMA 等、ARTIFACT/DOC/COMMENT 跳过)→ Task 2。
- 降级不拖垮主体 → Task 3(`assembleLineageSection` try/catch)。
- API 透传 → 无需改 route(`NextResponse.json(result)` 自动带上)→ 由 Task 4 的 service 字段实现。
- CLI 末尾渲染 + 修早返回 → Task 5。
- 标签 best-effort + 回退 → Task 3(`fragmentLabel`;v1 仅 MEMORY 友好标签,其余走 `[TYPE] <id前缀>` 回退,见下方"已知简化")。

**已知简化(v1,符合 spec "best-effort"):** 友好标签目前只对 MEMORY(content 截断)实现;SLACK/WEB/FIGMA/PR/PR_REVIEW_TODO/SESSION 用 `[TYPE] <id前缀>` 回退。理由:冷启动门控下早期极少有非-memory fragment 达阈值,且避免猜源对象字段名引入脆弱耦合。富标签可作后续增强。

**Type consistency:** `FragmentMergeRate`(repo)字段 `resolvedTasks/mergedTasks` 在 Task 3 测试与实现、Task 4 join 中一致;`LineageSignalEntry`、`assembleLineageSection(fragments, memoryContentById, deps)` 签名跨 Task 3/4 一致;`toLineageFragmentType` 返回 `LineageFragmentType | null` 跨 Task 2/3 一致。

**Placeholder scan:** 无 TBD/TODO;每个改码步骤都给了完整代码。两处"先 grep 确认"是环境自检(logger 路径、jest 路径别名、既有测试位置),非占位——已给出命中后的确切动作。
