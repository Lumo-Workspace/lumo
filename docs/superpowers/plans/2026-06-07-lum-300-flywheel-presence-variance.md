# Flywheel Attribution (presence + usage variance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the flywheel merge-rate signal discriminative — exclude zero-presence-variance fragments (Stage 1), and prefer a real "agent actually used it" usage signal collected via session-wrap voting (Stage 2).

**Architecture:** Stage 1 is pure aggregation+render in `lineage-signal.ts` + one repo count method, no schema change. Stage 2 adds two nullable columns to `LineageEdge` (`used`, `usedAt`), repo methods to stamp/aggregate usage, a `session wrap` voting section feeding a new `fragment-usage` endpoint, and a render path that prefers usage over presence. Commits are strictly Stage-1-first so Stage 1 can ship alone to unblock LUM-279.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict, `noUncheckedIndexedAccess`), Prisma/Postgres, Jest, Lumo CLI (Node).

**Working dir:** worktree `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance` on branch `lumo/LUM-300-flywheel-presence-variance`. Run jest from INSIDE the worktree. The Prisma client is shared via node_modules symlink — do NOT run `prisma generate` mid-stream across parallel worktrees; generate atomically once after the schema task (Task 4), and again only at the very end before tsc.

**Spec:** `docs/superpowers/specs/2026-06-07-lum-300-flywheel-presence-variance-design.md`

**Conventions to honor:** all jest commands run with `cwd` pinned to the worktree (`cd <worktree> && npx jest …`); git state-changing commands pin cwd via `git -C <worktree>`; server-side flywheel strings are hardcoded Chinese (NOT react-intl) — no locale-parity work; CLI strings are hardcoded Chinese (existing pattern). Repositories hold Prisma only; services hold logic; routes are thin (auth → validate → service).

---

# STAGE 1 — presence variance (no schema change, ships alone)

## Task 1: `countResolvedTasks` repository method

**Files:**
- Modify: `lib/repositories/lineage-edge.repository.ts`
- Test: `__tests__/lib/repositories/lineage-edge.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/lib/repositories/lineage-edge.repository.test.ts` (follow the existing `prisma` mock style in that file — inspect the top of the file first and mirror how `lineageEdge.groupBy` is mocked for `mergeRateByFragments`):

```ts
describe('countResolvedTasks', () => {
  it('counts distinct taskIds with at least one non-UNKNOWN edge', async () => {
    // groupBy({ by: ['taskId'], where: { outcome: { not: 'UNKNOWN' } } })
    // returns one row per distinct resolved task.
    ;(prisma.lineageEdge.groupBy as jest.Mock).mockResolvedValue([
      { taskId: 't1' },
      { taskId: 't2' },
      { taskId: 't3' },
    ])
    const n = await lineageEdgeRepository.countResolvedTasks()
    expect(n).toBe(3)
    expect(prisma.lineageEdge.groupBy).toHaveBeenCalledWith({
      by: ['taskId'],
      where: { outcome: { not: 'UNKNOWN' } },
    })
  })

  it('returns 0 when there are no resolved edges', async () => {
    ;(prisma.lineageEdge.groupBy as jest.Mock).mockResolvedValue([])
    expect(await lineageEdgeRepository.countResolvedTasks()).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/repositories/lineage-edge.repository.test.ts -t countResolvedTasks`
Expected: FAIL — `lineageEdgeRepository.countResolvedTasks is not a function`.

- [ ] **Step 3: Implement the method**

In `lib/repositories/lineage-edge.repository.ts`, add inside the `lineageEdgeRepository` object (place it just after `mergeRateByFragments`):

```ts
  /**
   * universe for presence-variance gating: the count of distinct tasks that
   * have at least one resolved (non-UNKNOWN) edge. Matches mergeRateByFragments'
   * `resolved` definition (global, NOT workspace-scoped) so equality checks
   * (resolvedTasks === universe) line up exactly.
   */
  async countResolvedTasks(tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['taskId'],
      where: { outcome: { not: 'UNKNOWN' } },
    })
    return rows.length
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/repositories/lineage-edge.repository.test.ts -t countResolvedTasks`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add lib/repositories/lineage-edge.repository.ts __tests__/lib/repositories/lineage-edge.repository.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: countResolvedTasks for presence-variance universe [LUM-300]"
```

---

## Task 2: presence-variance exclusion + transparency note in `lineage-signal.ts`

**Files:**
- Modify: `lib/services/lineage-signal.ts`
- Test: `__tests__/lib/services/lineage-signal.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/services/lineage-signal.test.ts`. These cover the new `renderLineageSection(entries, excludedCount)` signature and the new `countResolvedTasks` dep in `assembleLineageSection`:

```ts
describe('renderLineageSection — presence-variance note', () => {
  it('renders header + note (no list) when all qualifying entries were excluded', () => {
    const out = renderLineageSection([], 7)
    expect(out).toContain('## 飞轮信号 · 历史 merge 贡献')
    expect(out).toContain('已排除 7 个全量加载')
    expect(out).not.toContain('出现在')
  })

  it('renders list + note when some excluded and some survive', () => {
    const out = renderLineageSection(
      [{ label: '[MEMORY] "x"', resolvedTasks: 3, mergedTasks: 2 }],
      2
    )
    expect(out).toContain('- [MEMORY] "x" — 出现在 3 个已闭合任务·2 merged (67%)')
    expect(out).toContain('已排除 2 个全量加载')
  })

  it('omits the note when nothing was excluded', () => {
    const out = renderLineageSection(
      [{ label: '[MEMORY] "x"', resolvedTasks: 3, mergedTasks: 3 }],
      0
    )
    expect(out).not.toContain('已排除')
  })

  it('returns "" when no survivors and nothing excluded', () => {
    expect(renderLineageSection([], 0)).toBe('')
  })
})

describe('assembleLineageSection — zero-variance exclusion', () => {
  const deps = (universe: number, stats: FragmentMergeRate[]) => ({
    resolveCanonicalFragment: async (_t: string, id: string) => id,
    mergeRateByFragments: async () => stats,
    countResolvedTasks: async () => universe,
  })

  it('excludes a fragment present in EVERY resolved task (resolvedTasks === universe)', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      new Map([['mem-1', 'always loaded']]),
      deps(5, [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 5, mergedTasks: 5 },
      ])
    )
    expect(out).toContain('## 飞轮信号') // header still shown
    expect(out).toContain('已排除 1 个全量加载')
    expect(out).not.toContain('always loaded')
  })

  it('keeps a fragment with presence variance (resolvedTasks < universe, >= 3)', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      new Map([['mem-1', 'selective mem']]),
      deps(5, [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 4, mergedTasks: 3 },
      ])
    )
    expect(out).toContain('- [MEMORY] "selective mem" — 出现在 4 个已闭合任务·3 merged (75%)')
    expect(out).not.toContain('已排除')
  })

  it('does NOT exclude when universe is 0 (no resolved edges)', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'mem-1' }],
      new Map([['mem-1', 'x']]),
      deps(0, [
        { fragmentType: 'MEMORY', fragmentId: 'mem-1', resolvedTasks: 0, mergedTasks: 0 },
      ])
    )
    expect(out).toBe('') // 0 < 3 cold-start gate, nothing excluded, nothing shown
  })
})
```

Also update the existing `assembleLineageSection` tests in this file: each `deps`/inline deps object must now include `countResolvedTasks`. For the existing tests that expect a rendered line with `resolvedTasks: 5` or `4` or `3`, set `countResolvedTasks` to a value strictly greater than the entry's `resolvedTasks` (e.g. `async () => 99`) so the entry is NOT excluded and the existing assertions still hold. (Search the file for `mergeRateByFragments:` and add a sibling `countResolvedTasks: async () => 99,` to each deps object.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/services/lineage-signal.test.ts`
Expected: FAIL — `renderLineageSection` takes 1 arg / `countResolvedTasks` missing from `LineageSignalDeps`.

- [ ] **Step 3: Implement**

In `lib/services/lineage-signal.ts`:

(a) Change `renderLineageSection` to accept `excludedCount` and handle the three branches:

```ts
/** Pure render: cold-start gate + format + transparency note. */
export function renderLineageSection(
  entries: LineageSignalEntry[],
  excludedCount: number
): string {
  const qualifying = entries.filter(
    e => e.resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS
  )
  if (qualifying.length === 0 && excludedCount === 0) return ''

  const note =
    excludedCount > 0
      ? [
          '',
          `> 已排除 ${excludedCount} 个全量加载(零存在方差)的 fragment:它们出现在每个已闭合任务里,merge 率等于团队 base rate,无判别力。`,
        ]
      : []

  return [
    '## 飞轮信号 · 历史 merge 贡献',
    '',
    '> 口径:分母 = 该片段出现过且 outcome 已确定(merged/否)的去重任务数;分子 = 其中已 merged 的。仅显示样本 ≥ 3 个已闭合任务。这是历史相关性,非因果。',
    '',
    ...qualifying.map(formatLineageSignalLine),
    ...note,
  ].join('\n')
}
```

(b) Add `countResolvedTasks` to the deps interface:

```ts
export interface LineageSignalDeps {
  resolveCanonicalFragment: (type: string, id: string) => Promise<string>
  mergeRateByFragments: (refs: FragmentRef[]) => Promise<FragmentMergeRate[]>
  countResolvedTasks: () => Promise<number>
}
```

(c) In `assembleLineageSection`, fetch the universe and split into survivors / excluded after the dedupe loop. Replace the dedupe loop tail (`entries.push(...)` block and the final `return renderLineageSection(entries)`) with:

```ts
    const universe = await deps.countResolvedTasks()

    const entries: LineageSignalEntry[] = []
    let excludedCount = 0
    const seen = new Set<string>()
    for (const input of inputs) {
      const key = `${input.ref.fragmentType}::${input.ref.fragmentId}`
      if (seen.has(key)) continue
      seen.add(key)
      const stat = statByKey.get(key)
      if (!stat) continue
      // Zero presence-variance: appears in EVERY resolved task → its merge rate
      // is the base rate, carries no signal. Exclude (count it for the note).
      if (universe > 0 && stat.resolvedTasks === universe) {
        excludedCount++
        continue
      }
      entries.push({
        label: input.label,
        resolvedTasks: stat.resolvedTasks,
        mergedTasks: stat.mergedTasks,
      })
    }
    return renderLineageSection(entries, excludedCount)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/services/lineage-signal.test.ts`
Expected: PASS (all, including the updated pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add lib/services/lineage-signal.ts __tests__/lib/services/lineage-signal.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: exclude zero-presence-variance fragments from flywheel signal [LUM-300]"
```

---

## Task 3: wire `countResolvedTasks` into task-context.service

**Files:**
- Modify: `lib/services/task-context.service.ts` (the `assembleLineageSection(...)` call site, ~line 817-826)

- [ ] **Step 1: Add the dep at the call site**

Find the `assembleLineageSection(` call and add `countResolvedTasks` to the deps object:

```ts
    const lineageSection = await assembleLineageSection(
      fragments,
      memoryContentById,
      {
        resolveCanonicalFragment: (type, id) =>
          memoryProvenanceRepository.resolveCanonicalFragment(type, id),
        mergeRateByFragments: refs =>
          lineageEdgeRepository.mergeRateByFragments(refs),
        countResolvedTasks: () => lineageEdgeRepository.countResolvedTasks(),
      }
    )
```

- [ ] **Step 2: Typecheck the call site**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx tsc --noEmit`
Expected: no errors (in particular, no "missing property countResolvedTasks" on the deps object).

- [ ] **Step 3: Run the touched service's tests**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/services/lineage-signal.test.ts __tests__/lib/repositories/lineage-edge.repository.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add lib/services/task-context.service.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: feed resolved-task universe into flywheel assembly [LUM-300]"
```

> **STAGE 1 COMPLETE — shippable.** At this point the presence-variance fix is done and could be split into its own PR to unblock LUM-279. Continue to Stage 2.

---

# STAGE 2 — usage variance (agent voting at session wrap)

## Task 4: schema — add `used` / `usedAt` to LineageEdge

**Files:**
- Modify: `prisma/schema.prisma` (the `LineageEdge` model)
- Create: `prisma/migrations/<timestamp>_add_lineage_edge_usage/migration.sql` (generated)

- [ ] **Step 1: Edit the model**

In `prisma/schema.prisma`, inside `model LineageEdge`, add after the `outcome` line:

```prisma
  used      Boolean?  // null = not voted, true = agent reported using it, false = injected but unused
  usedAt    DateTime? // when the usage vote was recorded; also "has this session voted?" marker
```

- [ ] **Step 2: Create + apply the migration**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx prisma migrate dev --name add_lineage_edge_usage`
Expected: creates `prisma/migrations/<ts>_add_lineage_edge_usage/migration.sql` adding two nullable columns, applies it, regenerates the client.

> If Prisma rejects with P3008/P3012 drift (dev DB shared with parallel worktrees), use the CLAUDE.md drift workaround: hand-write the SQL (`ALTER TABLE "lineage_edges" ADD COLUMN "used" BOOLEAN, ADD COLUMN "usedAt" TIMESTAMP(3);`) into the migration dir, `npx prisma db execute --file <path>`, `npx prisma migrate resolve --applied add_lineage_edge_usage`, then `npx prisma generate`. Do NOT `migrate reset`.

- [ ] **Step 3: Verify the client has the new fields**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors. (The generated `LineageEdge` type now includes `used` / `usedAt`.)

- [ ] **Step 4: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add prisma/schema.prisma prisma/migrations
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: add used/usedAt columns to LineageEdge [LUM-300]"
```

---

## Task 5: repo `findSessionFragmentEdges`

**Files:**
- Modify: `lib/repositories/lineage-edge.repository.ts`
- Test: `__tests__/lib/repositories/lineage-edge.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('findSessionFragmentEdges', () => {
  it('returns this session edges with current used flag', async () => {
    ;(prisma.lineageEdge.findMany as jest.Mock).mockResolvedValue([
      { fragmentType: 'MEMORY', fragmentId: 'm1', used: null },
      { fragmentType: 'WEB_LINK', fragmentId: 'w1', used: true },
    ])
    const rows = await lineageEdgeRepository.findSessionFragmentEdges('sess-1')
    expect(rows).toHaveLength(2)
    expect(prisma.lineageEdge.findMany).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1' },
      select: { fragmentType: true, fragmentId: true, used: true, usedAt: true },
    })
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/repositories/lineage-edge.repository.test.ts -t findSessionFragmentEdges`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement**

Add the return type near the other interfaces:

```ts
export interface SessionFragmentEdge {
  fragmentType: LineageFragmentType
  fragmentId: string
  used: boolean | null
  usedAt: Date | null
}
```

Add the method:

```ts
  /** All edges born in a session — the candidate set for usage voting. */
  async findSessionFragmentEdges(
    sessionId: string,
    tx?: Prisma.TransactionClient
  ): Promise<SessionFragmentEdge[]> {
    const client = tx ?? prisma
    return client.lineageEdge.findMany({
      where: { sessionId },
      select: { fragmentType: true, fragmentId: true, used: true, usedAt: true },
    })
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/repositories/lineage-edge.repository.test.ts -t findSessionFragmentEdges`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add lib/repositories/lineage-edge.repository.ts __tests__/lib/repositories/lineage-edge.repository.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: findSessionFragmentEdges for usage-vote candidates [LUM-300]"
```

---

## Task 6: repo `applyUsageVote`

**Files:**
- Modify: `lib/repositories/lineage-edge.repository.ts`
- Test: `__tests__/lib/repositories/lineage-edge.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('applyUsageVote', () => {
  it('stamps used=true for voted refs and used=false for the rest, with usedAt', async () => {
    const updateMany = prisma.lineageEdge.updateMany as jest.Mock
    updateMany.mockResolvedValue({ count: 1 })
    const res = await lineageEdgeRepository.applyUsageVote('sess-1', [
      { fragmentType: 'MEMORY', fragmentId: 'm1' },
    ])
    // used=true branch: scoped to session + the voted refs
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: 'sess-1',
          OR: [{ fragmentType: 'MEMORY', fragmentId: 'm1' }],
        }),
        data: expect.objectContaining({ used: true }),
      })
    )
    // used=false branch: scoped to session, NOT the voted refs
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: 'sess-1',
          NOT: { OR: [{ fragmentType: 'MEMORY', fragmentId: 'm1' }] },
        }),
        data: expect.objectContaining({ used: false }),
      })
    )
    expect(res).toEqual({ used: 1, unused: 1 })
  })

  it('marks all session edges used=false when no refs voted', async () => {
    const updateMany = prisma.lineageEdge.updateMany as jest.Mock
    updateMany.mockResolvedValue({ count: 3 })
    const res = await lineageEdgeRepository.applyUsageVote('sess-1', [])
    // only the "all unused" update runs
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 'sess-1' },
        data: expect.objectContaining({ used: false }),
      })
    )
    expect(res).toEqual({ used: 0, unused: 3 })
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/repositories/lineage-edge.repository.test.ts -t applyUsageVote`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement**

```ts
  /**
   * Record an agent usage vote over a session's edges: the voted refs get
   * used=true, every other edge of the session gets used=false, all stamped
   * usedAt=now. Last write wins (re-voting overwrites). Returns counts.
   */
  async applyUsageVote(
    sessionId: string,
    usedRefs: FragmentRef[],
    tx?: Prisma.TransactionClient
  ): Promise<{ used: number; unused: number }> {
    const client = tx ?? prisma
    const now = new Date()
    if (usedRefs.length === 0) {
      const r = await client.lineageEdge.updateMany({
        where: { sessionId },
        data: { used: false, usedAt: now },
      })
      return { used: 0, unused: r.count }
    }
    const or = usedRefs.map(r => ({
      fragmentType: r.fragmentType,
      fragmentId: r.fragmentId,
    }))
    const usedRes = await client.lineageEdge.updateMany({
      where: { sessionId, OR: or },
      data: { used: true, usedAt: now },
    })
    const unusedRes = await client.lineageEdge.updateMany({
      where: { sessionId, NOT: { OR: or } },
      data: { used: false, usedAt: now },
    })
    return { used: usedRes.count, unused: unusedRes.count }
  },
```

> Note: `now` is constructed in a repository method (not a React render / not the flywheel pure-render path), so the "no `new Date()` in render" rule does not apply here.

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/repositories/lineage-edge.repository.test.ts -t applyUsageVote`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add lib/repositories/lineage-edge.repository.ts __tests__/lib/repositories/lineage-edge.repository.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: applyUsageVote stamps used/unused on session edges [LUM-300]"
```

---

## Task 7: repo `usageMergeRateByFragments`

**Files:**
- Modify: `lib/repositories/lineage-edge.repository.ts`
- Test: `__tests__/lib/repositories/lineage-edge.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('usageMergeRateByFragments', () => {
  it('counts only (fragment,task) pairs where the fragment was used=true, task-deduped', async () => {
    // groupBy by [fragmentType, fragmentId, taskId, outcome], filtered used=true
    ;(prisma.lineageEdge.groupBy as jest.Mock).mockResolvedValue([
      { fragmentType: 'MEMORY', fragmentId: 'm1', taskId: 'tA', outcome: 'MERGED', _count: { _all: 1 } },
      { fragmentType: 'MEMORY', fragmentId: 'm1', taskId: 'tB', outcome: 'REJECTED', _count: { _all: 1 } },
      { fragmentType: 'MEMORY', fragmentId: 'm1', taskId: 'tC', outcome: 'UNKNOWN', _count: { _all: 1 } },
    ])
    const [rate] = await lineageEdgeRepository.usageMergeRateByFragments([
      { fragmentType: 'MEMORY', fragmentId: 'm1' },
    ])
    expect(rate).toEqual({
      fragmentType: 'MEMORY',
      fragmentId: 'm1',
      usedResolvedTasks: 2, // tA + tB resolved; tC UNKNOWN excluded
      usedMergedTasks: 1, // tA
    })
    expect(prisma.lineageEdge.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['fragmentType', 'fragmentId', 'taskId', 'outcome'],
        where: expect.objectContaining({ used: true }),
      })
    )
  })

  it('returns [] for empty input', async () => {
    expect(await lineageEdgeRepository.usageMergeRateByFragments([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/repositories/lineage-edge.repository.test.ts -t usageMergeRateByFragments`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement**

Add the type near `FragmentMergeRate`:

```ts
/** Per-fragment merge rate computed ONLY over tasks where the fragment was
 * actually used (used=true), task-deduped. Backs the LUM-300 usage signal. */
export interface FragmentUsageRate {
  fragmentType: LineageFragmentType
  fragmentId: string
  usedResolvedTasks: number
  usedMergedTasks: number
}
```

Add the method (mirror `mergeRateByFragments`, but add `used: true` to the `where` and rename the output fields):

```ts
  /**
   * Usage-gated merge rate: same task-dedupe as mergeRateByFragments, but a
   * (fragment, task) pair only counts when the fragment was voted used=true.
   * Cold-start gating (min sample) is the caller's responsibility.
   */
  async usageMergeRateByFragments(
    fragments: FragmentRef[],
    tx?: Prisma.TransactionClient
  ): Promise<FragmentUsageRate[]> {
    if (fragments.length === 0) return []
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['fragmentType', 'fragmentId', 'taskId', 'outcome'],
      where: {
        used: true,
        OR: fragments.map(f => ({
          fragmentType: f.fragmentType,
          fragmentId: f.fragmentId,
        })),
      },
      _count: { _all: true },
    })

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
        entry = { fragmentType: row.fragmentType, fragmentId: row.fragmentId, tasks: new Map() }
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
        let usedResolvedTasks = 0
        let usedMergedTasks = 0
        for (const task of e.tasks.values()) {
          if (task.resolved) usedResolvedTasks++
          if (task.merged) usedMergedTasks++
        }
        return {
          fragmentType: e.fragmentType,
          fragmentId: e.fragmentId,
          usedResolvedTasks,
          usedMergedTasks,
        }
      })
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/repositories/lineage-edge.repository.test.ts -t usageMergeRateByFragments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add lib/repositories/lineage-edge.repository.ts __tests__/lib/repositories/lineage-edge.repository.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: usageMergeRateByFragments (usage-gated merge rate) [LUM-300]"
```

---

## Task 8: session.service usage draft + apply

**Files:**
- Modify: `lib/services/session.service.ts`
- Test: `__tests__/lib/services/session.service.test.ts` (mirror existing memory-draft tests in that file)

- [ ] **Step 1: Write the failing tests**

Inspect the existing `getSessionMemoryDraft` / `applyMemoryReview` tests in `__tests__/lib/services/session.service.test.ts` and mirror their mock setup (identity, `sessionRepository.findTaskBinding`/session lookup, repo mocks). Add:

```ts
describe('getFragmentUsageDraft', () => {
  it('returns session candidates with labels and alreadyVoted=false when none voted', async () => {
    // mock: session resolves to a bound task; findSessionFragmentEdges returns 2 edges
    // (used=null), memory content lookup yields a label for the MEMORY fragment.
    const draft = await sessionService.getFragmentUsageDraft({
      identity,
      sessionId: 'sess-1',
    })
    expect(draft.alreadyVoted).toBe(false)
    expect(draft.candidates).toHaveLength(2)
    expect(draft.candidates[0]).toMatchObject({ fragmentType: 'MEMORY', used: null })
  })

  it('sets alreadyVoted=true when any edge has usedAt', async () => {
    // mock findSessionFragmentEdges to include one row with usedAt set
    const draft = await sessionService.getFragmentUsageDraft({
      identity,
      sessionId: 'sess-1',
    })
    expect(draft.alreadyVoted).toBe(true)
  })
})

describe('applyFragmentUsage', () => {
  it('delegates to applyUsageVote scoped to the session', async () => {
    const res = await sessionService.applyFragmentUsage({
      identity,
      sessionId: 'sess-1',
      usedRefs: [{ fragmentType: 'MEMORY', fragmentId: 'm1' }],
    })
    expect(lineageEdgeRepository.applyUsageVote).toHaveBeenCalledWith('sess-1', [
      { fragmentType: 'MEMORY', fragmentId: 'm1' },
    ])
    expect(res).toEqual({ used: expect.any(Number), unused: expect.any(Number) })
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/services/session.service.test.ts -t "FragmentUsage"`
Expected: FAIL — methods missing.

- [ ] **Step 3: Implement**

In `lib/services/session.service.ts` add the types and two methods (mirror the auth/session-resolution used by `getSessionMemoryDraft`). For MEMORY labels, reuse whatever memory-content lookup `assembleLineageSection`'s caller uses (`memoryRepository` content by id); for non-MEMORY use `[TYPE] <id-slice>`:

```ts
export interface FragmentUsageCandidate {
  fragmentType: LineageFragmentType
  fragmentId: string
  label: string
  used: boolean | null
}
export interface FragmentUsageDraft {
  taskIdentifier: string | null
  candidates: FragmentUsageCandidate[]
  alreadyVoted: boolean
}
export interface ApplyFragmentUsageInput extends SessionScopedInput {
  usedRefs: { fragmentType: LineageFragmentType; fragmentId: string }[]
}

async getFragmentUsageDraft({
  identity,
  sessionId,
}: SessionScopedInput): Promise<FragmentUsageDraft> {
  // (auth + resolve session/task exactly as getSessionMemoryDraft does)
  const edges = await lineageEdgeRepository.findSessionFragmentEdges(sessionId)
  const memIds = edges.filter(e => e.fragmentType === 'MEMORY').map(e => e.fragmentId)
  const contentById = await memoryRepository.findContentByIds(memIds) // Map<id,string>; add if missing
  const candidates: FragmentUsageCandidate[] = edges.map(e => ({
    fragmentType: e.fragmentType,
    fragmentId: e.fragmentId,
    label:
      e.fragmentType === 'MEMORY' && contentById.get(e.fragmentId)
        ? `[MEMORY] "${contentById.get(e.fragmentId)!.replace(/\s+/g, ' ').trim().slice(0, 60)}"`
        : `[${e.fragmentType}] ${e.fragmentId.slice(0, 8)}`,
    used: e.used,
  }))
  return {
    taskIdentifier: /* from resolved binding, or null */ null,
    candidates,
    alreadyVoted: edges.some(e => e.usedAt !== null),
  }
}

async applyFragmentUsage({
  identity,
  sessionId,
  usedRefs,
}: ApplyFragmentUsageInput): Promise<{ used: number; unused: number }> {
  // (auth: confirm the session belongs to identity's workspace, as applyMemoryReview does)
  return lineageEdgeRepository.applyUsageVote(sessionId, usedRefs)
}
```

> If `memoryRepository.findContentByIds` does not exist, add a thin repo method `findContentByIds(ids: string[]): Promise<Map<string,string>>` (Prisma `findMany({ where: { id: { in: ids } }, select: { id: true, content: true } })`) with its own test, OR reuse the exact lookup `task-context.service.ts` already uses to build `memoryContentById`. Prefer reusing the existing path (DRY).

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/services/session.service.test.ts -t "FragmentUsage"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add lib/services/session.service.ts lib/repositories/memory.repository.ts __tests__/lib/services/session.service.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: fragment-usage draft + apply in session.service [LUM-300]"
```

---

## Task 9: API routes for fragment-usage

**Files:**
- Create: `app/api/sessions/[sessionId]/fragment-usage/route.ts`
- Test: `__tests__/app/api/sessions/fragment-usage.route.test.ts` (mirror `memory-review` route test if one exists)

- [ ] **Step 1: Write the failing route test**

Mirror the existing `memory-review/route.ts` test (auth 401 path + happy path delegating to the service). Assert:
- GET without bearer → 401
- GET with bearer → returns `getFragmentUsageDraft` result
- POST with `{ usedRefs: [{fragmentType:'MEMORY',fragmentId:'m1'}] }` → calls `applyFragmentUsage`, returns `{ used, unused }`
- POST with malformed body → 400

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/app/api/sessions/fragment-usage.route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/verify-bearer'
import { sessionService } from '@/lib/services/session.service'
import { UNAUTHORIZED } from '@/lib/api/errors' // match the constant used by sibling routes

const bodySchema = z.object({
  usedRefs: z
    .array(
      z.object({
        fragmentType: z.enum([
          'MEMORY',
          'SLACK_CONTEXT',
          'WEB_LINK',
          'FIGMA',
          'PR',
          'PR_REVIEW_TODO',
          'SESSION',
        ]),
        fragmentId: z.string(),
      })
    )
    .max(200),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })
  const { sessionId } = await context.params
  const result = await sessionService.getFragmentUsageDraft({ identity, sessionId })
  return NextResponse.json(result)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })
  const { sessionId } = await context.params
  const raw = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const result = await sessionService.applyFragmentUsage({
    identity,
    sessionId,
    usedRefs: parsed.data.usedRefs,
  })
  return NextResponse.json(result)
}
```

> Match the EXACT import paths/constants used by `app/api/sessions/[sessionId]/memory-review/route.ts` (verifyBearer location, UNAUTHORIZED constant, error shape). Adjust the snippet to those.

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/app/api/sessions/fragment-usage.route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add app/api/sessions/[sessionId]/fragment-usage __tests__/app/api/sessions/fragment-usage.route.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: GET/POST fragment-usage session endpoint [LUM-300]"
```

---

## Task 10: CLI — fragment-usage API client + wrap section + `--used` flag

**Files:**
- Create: `cli/src/lib/fragment-usage-api.ts`
- Create: `cli/src/commands/wrap/fragment-usage-section.ts`
- Modify: `cli/src/commands/session-wrap.ts`
- Test: `cli/__tests__/commands/wrap/fragment-usage-section.test.ts` (mirror existing wrap-section tests)

- [ ] **Step 1: Write the failing section test**

Mirror an existing wrap-section test. Cover:
- `prepare()` returns false when no candidates (section skipped)
- with `--used "1,3"` (parsed handles) → `run()` POSTs `usedRefs` = candidates[0],candidates[2]
- with no `--used` → `run()` prints candidates + hint, does NOT POST
- when draft `alreadyVoted` → `run()` prints "已投票" and does NOT POST

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest cli/__tests__/commands/wrap/fragment-usage-section.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the API client** (`cli/src/lib/fragment-usage-api.ts`)

Mirror `cli/src/lib/session-memory-api.ts`:

```ts
export interface ServerUsageCandidate {
  fragmentType: string
  fragmentId: string
  label: string
  used: boolean | null
}
export interface ServerUsageDraft {
  taskIdentifier: string | null
  candidates: ServerUsageCandidate[]
  alreadyVoted: boolean
}
export async function fetchUsageDraft(creds, sessionId): Promise<ServerUsageDraft> { /* GET */ }
export async function applyFragmentUsage(
  creds,
  sessionId,
  body: { usedRefs: { fragmentType: string; fragmentId: string }[] }
): Promise<{ used: number; unused: number }> { /* POST */ }
```

(Use the same fetch/error-handling/sanitize helpers as `session-memory-api.ts`.)

- [ ] **Step 4: Implement the section** (`cli/src/commands/wrap/fragment-usage-section.ts`)

```ts
import type { WrapSection, WrapRunOpts } from '../../lib/wrap-panel'
import { sanitizeField } from '../../lib/sanitize'
import { fetchUsageDraft, applyFragmentUsage, type ServerUsageDraft } from '../../lib/fragment-usage-api'

/** Parse "1,3 5" → 0-based indices. */
export function parseUsedHandles(spec: string): number[] {
  if (spec.trim().toLowerCase() === 'none') return []
  return spec
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => parseInt(s, 10) - 1)
    .filter(n => Number.isInteger(n) && n >= 0)
}

export class FragmentUsageSection implements WrapSection {
  title = '上下文使用投票'
  private draft: ServerUsageDraft | null = null
  constructor(
    private deps: {
      creds: { token: string; apiUrl: string; workspaceSlug: string }
      sessionId: string
      used?: string // raw --used value; undefined = not provided
    }
  ) {}

  async prepare(): Promise<boolean> {
    this.draft = await fetchUsageDraft(this.deps.creds, this.deps.sessionId)
    return this.draft.candidates.length > 0
  }

  async run(opts: WrapRunOpts): Promise<void> {
    const draft = this.draft
    if (!draft || draft.candidates.length === 0) return

    if (draft.alreadyVoted) {
      process.stdout.write('本 session 已投票,跳过。\n')
      return
    }

    process.stdout.write('本次会话注入的 context fragment:\n')
    draft.candidates.forEach((c, i) => {
      process.stdout.write(`  [${i + 1}] ${sanitizeField(c.label)}\n`)
    })

    if (opts.dryRun) {
      process.stdout.write('(dry-run,未改动)\n')
      return
    }
    if (this.deps.used === undefined) {
      process.stdout.write(
        '用 `lumo session wrap --used <序号>`(或 `--used none`)记录你实际用到的 fragment。\n'
      )
      return
    }

    const idx = parseUsedHandles(this.deps.used)
    const inRange = (n: number) => n >= 0 && n < draft.candidates.length
    const usedRefs = idx
      .filter(inRange)
      .map(i => ({
        fragmentType: draft.candidates[i]!.fragmentType,
        fragmentId: draft.candidates[i]!.fragmentId,
      }))
    const { used, unused } = await applyFragmentUsage(this.deps.creds, this.deps.sessionId, { usedRefs })
    process.stdout.write(`已记录:用过 ${used} 个,未用 ${unused} 个。\n`)
  }
}
```

- [ ] **Step 5: Wire into `session-wrap.ts`**

Add `used?: string` to `SessionWrapOptions`, add the section after `MemoryReviewSection`:

```ts
  const sections = [
    new ProgressCommentSection({ creds, sessionId }),
    new MemoryReviewSection({ creds, sessionId }),
    new FragmentUsageSection({ creds, sessionId, used: options.used }),
    new BlockedPromptSection({ creds, sessionId }),
  ]
```

Register the `--used <handles>` flag where the `session wrap` command is defined (the commander/yargs setup that maps to `sessionWrap`). Find the command registration (search `session wrap` / `sessionWrap` in `cli/src/`) and add the option with help text "标记本次会话实际用到的 fragment 序号 (逗号分隔, 或 none)".

- [ ] **Step 6: Run to verify pass**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest cli/__tests__/commands/wrap/fragment-usage-section.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add cli/src cli/__tests__
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: session wrap fragment-usage voting section + --used flag [LUM-300]"
```

---

## Task 11: render path — prefer usage, fall back to presence

**Files:**
- Modify: `lib/services/lineage-signal.ts`
- Modify: `lib/services/task-context.service.ts` (add `usageMergeRateByFragments` dep)
- Test: `__tests__/lib/services/lineage-signal.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('assembleLineageSection — usage preferred over presence', () => {
  const base = {
    resolveCanonicalFragment: async (_t: string, id: string) => id,
    countResolvedTasks: async () => 99,
  }

  it('shows the usage line (真实使用信号) when usedResolvedTasks >= 3', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'm1' }],
      new Map([['m1', 'used mem']]),
      {
        ...base,
        mergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'm1', resolvedTasks: 5, mergedTasks: 5 },
        ],
        usageMergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'm1', usedResolvedTasks: 4, usedMergedTasks: 3 },
        ],
      }
    )
    expect(out).toContain('用过的 4 个已闭合任务·3 merged (75%) · 真实使用信号')
    expect(out).not.toContain('80%') // presence number suppressed in favor of usage
  })

  it('falls back to presence (弱信号) when usage sample < 3', async () => {
    const out = await assembleLineageSection(
      [{ type: 'MEMORY', id: 'm1' }],
      new Map([['m1', 'mem']]),
      {
        ...base,
        countResolvedTasks: async () => 9, // so presence (resolvedTasks 4) is NOT excluded
        mergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'm1', resolvedTasks: 4, mergedTasks: 3 },
        ],
        usageMergeRateByFragments: async () => [
          { fragmentType: 'MEMORY', fragmentId: 'm1', usedResolvedTasks: 1, usedMergedTasks: 1 },
        ],
      }
    )
    expect(out).toContain('出现在 4 个已闭合任务·3 merged (75%) · 仅共同加载,弱信号')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/services/lineage-signal.test.ts -t "usage preferred"`
Expected: FAIL — `usageMergeRateByFragments` missing from deps / render lacks usage line.

- [ ] **Step 3: Implement**

In `lib/services/lineage-signal.ts`:

(a) Add the constant and types:

```ts
export const LINEAGE_MIN_USED_TASKS = 3

export interface UsageSignalEntry {
  label: string
  usedResolvedTasks: number
  usedMergedTasks: number
}
```

(b) Extend deps + import `FragmentUsageRate`:

```ts
import type {
  FragmentMergeRate,
  FragmentUsageRate,
  FragmentRef,
} from '@/lib/repositories/lineage-edge.repository'

export interface LineageSignalDeps {
  resolveCanonicalFragment: (type: string, id: string) => Promise<string>
  mergeRateByFragments: (refs: FragmentRef[]) => Promise<FragmentMergeRate[]>
  usageMergeRateByFragments: (refs: FragmentRef[]) => Promise<FragmentUsageRate[]>
  countResolvedTasks: () => Promise<number>
}
```

(c) Add usage line formatter + extend `renderLineageSection` to 3 args:

```ts
export function formatUsageSignalLine(e: UsageSignalEntry): string {
  const pct = Math.round((e.usedMergedTasks / e.usedResolvedTasks) * 100)
  return `- ${e.label} — 用过的 ${e.usedResolvedTasks} 个已闭合任务·${e.usedMergedTasks} merged (${pct}%) · 真实使用信号`
}

export function renderLineageSection(
  usageEntries: UsageSignalEntry[],
  presenceEntries: LineageSignalEntry[],
  excludedCount: number
): string {
  const presenceQualifying = presenceEntries.filter(
    e => e.resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS
  )
  if (usageEntries.length === 0 && presenceQualifying.length === 0 && excludedCount === 0) {
    return ''
  }
  const presenceLines = presenceQualifying.map(
    e => `${formatLineageSignalLine(e)} · 仅共同加载,弱信号`
  )
  const note =
    excludedCount > 0
      ? ['', `> 已排除 ${excludedCount} 个全量加载(零存在方差)的 fragment:它们出现在每个已闭合任务里,merge 率等于团队 base rate,无判别力。`]
      : []
  return [
    '## 飞轮信号 · 历史 merge 贡献',
    '',
    '> 口径:优先「真实使用信号」(agent 完结时投票用过的);样本不足回退到「仅共同加载」弱信号。分母 = 去重已闭合任务,分子 = 其中 merged。历史相关性,非因果。',
    '',
    ...usageEntries.map(formatUsageSignalLine),
    ...presenceLines,
    ...note,
  ].join('\n')
}
```

> Note: `formatLineageSignalLine` already returns the `…(80%)` line; the presence fallback appends ` · 仅共同加载,弱信号`. Update the Task 2 presence-note tests' expected strings if they asserted an exact presence line WITHOUT the suffix — they should now expect the suffix, OR keep Task 2's `renderLineageSection` assertions migrated to the 3-arg form (`renderLineageSection([], presence, n)`). Update those call sites in the test file accordingly.

(d) Rework `assembleLineageSection` to compute both, choose usage when sample ≥ `LINEAGE_MIN_USED_TASKS`, else presence (with zero-variance exclusion still applied to the presence branch):

```ts
    const [universe, presenceStats, usageStats] = await Promise.all([
      deps.countResolvedTasks(),
      deps.mergeRateByFragments(inputs.map(i => i.ref)),
      deps.usageMergeRateByFragments(inputs.map(i => i.ref)),
    ])
    const presenceByKey = new Map(presenceStats.map(s => [`${s.fragmentType}::${s.fragmentId}`, s]))
    const usageByKey = new Map(usageStats.map(s => [`${s.fragmentType}::${s.fragmentId}`, s]))

    const usageEntries: UsageSignalEntry[] = []
    const presenceEntries: LineageSignalEntry[] = []
    let excludedCount = 0
    const seen = new Set<string>()
    for (const input of inputs) {
      const key = `${input.ref.fragmentType}::${input.ref.fragmentId}`
      if (seen.has(key)) continue
      seen.add(key)
      const usage = usageByKey.get(key)
      if (usage && usage.usedResolvedTasks >= LINEAGE_MIN_USED_TASKS) {
        usageEntries.push({
          label: input.label,
          usedResolvedTasks: usage.usedResolvedTasks,
          usedMergedTasks: usage.usedMergedTasks,
        })
        continue
      }
      const stat = presenceByKey.get(key)
      if (!stat) continue
      if (universe > 0 && stat.resolvedTasks === universe) {
        excludedCount++
        continue
      }
      presenceEntries.push({
        label: input.label,
        resolvedTasks: stat.resolvedTasks,
        mergedTasks: stat.mergedTasks,
      })
    }
    return renderLineageSection(usageEntries, presenceEntries, excludedCount)
```

(e) In `lib/services/task-context.service.ts`, add the dep at the `assembleLineageSection(` call:

```ts
        usageMergeRateByFragments: refs =>
          lineageEdgeRepository.usageMergeRateByFragments(refs),
```

- [ ] **Step 4: Run to verify pass + fix migrated Task-2 assertions**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/services/lineage-signal.test.ts`
Expected: PASS. Fix any Task-2 presence-line assertions to (i) the 3-arg `renderLineageSection` form and (ii) the `· 仅共同加载,弱信号` suffix; add `usageMergeRateByFragments: async () => []` to every `assembleLineageSection` deps object in the file.

- [ ] **Step 5: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add lib/services/lineage-signal.ts lib/services/task-context.service.ts __tests__/lib/services/lineage-signal.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "feat: prefer usage signal over presence in flywheel render [LUM-300]"
```

---

## Task 12: docs — SKILL.md + references/sessions.md sync

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md`
- Modify: `.claude/skills/lumo/references/sessions.md`

- [ ] **Step 1: Update sessions.md**

In `.claude/skills/lumo/references/sessions.md`, in the `session wrap` description, document the new fourth panel section and the flag:
- 第四段「上下文使用投票」:列出本 session 注入的 context fragment;agent 用 `lumo session wrap --used <序号>`(逗号分隔,或 `--used none`)标记实际用到的。
- 口径:勾中 → used=true,其余 → used=false,未传 `--used` → 不记(保持未知)。已投票的 session 会跳过。
- 为什么:把「共同加载」升级成「真实使用」信号,喂飞轮的 usage-based merge 率。

- [ ] **Step 2: Update SKILL.md**

In `.claude/skills/lumo/SKILL.md`, the `session wrap` catalog line and any frontmatter trigger words: mention the usage-vote step / `--used` flag so the agent knows to vote at wrap.

- [ ] **Step 3: Commit**

```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance add .claude/skills/lumo/SKILL.md .claude/skills/lumo/references/sessions.md
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance commit -m "docs: sync lumo SKILL for session wrap usage voting [LUM-300]"
```

---

## Task 13: full verification gate

- [ ] **Step 1: Regenerate Prisma client (atomic, end-of-work)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx prisma generate`

- [ ] **Step 2: Typecheck**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full touched test surface**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npx jest __tests__/lib/services/lineage-signal.test.ts __tests__/lib/repositories/lineage-edge.repository.test.ts __tests__/lib/services/session.service.test.ts __tests__/app/api/sessions/fragment-usage.route.test.ts cli/__tests__/commands/wrap/fragment-usage-section.test.ts`
Expected: all PASS.

- [ ] **Step 4: Build (the only CI gate is the Vercel build)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Lint tokens (if any UI touched — none expected here, but run to be safe)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-300-flywheel-presence-variance && npm run lint:tokens`
Expected: PASS (no UI changes).

---

## Notes for the PR

- **Schema**: adds nullable `LineageEdge.used` / `usedAt`. **Production requires `prisma migrate deploy` on next deploy** (no data deletion). Call this out in the PR body.
- **CLI changed** → SKILL.md updated (Task 12) — required by the PR checklist.
- Stage 1 (Tasks 1-3) is independently shippable and unblocks LUM-279; if reviewers want it sooner, the Stage-1 commits can be cherry-picked into a separate PR.
- Known debt documented in the spec §8: usage self-report hindsight bias; vote coverage depends on agents running `--used`.
