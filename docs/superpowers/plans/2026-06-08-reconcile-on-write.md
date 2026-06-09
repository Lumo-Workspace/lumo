# LUM-324 Reconcile-on-Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Layer 1 (STOP) and Layer 2 (DONE) memory writes from single-pass append to two-pass reconcile-on-write: extract candidate facts blind, retrieve each candidate's top-k similar existing memories, then have the LLM decide ADD / UPDATE / DELETE / SUPERSEDE / NOOP per candidate.

**Architecture:** Each layer goes `Extract(LLM) → Retrieve(NeighborRetriever, no LLM) → Reconcile(LLM) → Apply`. Neighbor retrieval sits behind a pluggable `NeighborRetriever` interface whose only implementation this task ships is lexical (bigram). SUPERSEDE routes to a dedicated `supersedeInPlace` seam that interim-executes as UPDATE-in-place (preserving the row id so provenance/lineage edges survive); LUM-325 swaps that seam to invalidate-not-delete. Zero schema change.

**Tech Stack:** TypeScript (strict), Zod, `@ai-sdk/gateway` + `generateObject` (model `deepseek/deepseek-v4-flash`), Prisma, Jest. Tests run from **inside this worktree** across both roots (`__tests__/` and `tests/`).

---

## Working rules (read before starting)

- **Worktree:** all work happens in `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-324-reconcile-on-write`. Run every `git`/`jest`/`tsc` command pinned to this dir (`cd` into it first). Branch is `lumo/LUM-324-reconcile-on-write`.
- **Prisma client is shared via node_modules symlink.** Do NOT run `prisma generate` mid-work. There is no schema change in this task, so you never need it. Verify only with jest + `tsc --noEmit`.
- **Run jest from inside the worktree**, e.g. `npx jest __tests__/lib/memory/content-text.test.ts`. Running from the repo root risks the cli/package.json haste collision (wrong tests).
- **Gateway calls don't run locally** (no `AI_GATEWAY_API_KEY`). Every test that touches an LLM function mocks the model — never hits the network. Pure functions (`memoryContentToText`, `lexicalNeighborRetriever`) run for real.
- **`@ai-sdk/gateway` breaks jest via TransformStream** when statically imported into a test's module graph. The extract/reconcile modules already `import { gateway } from '@ai-sdk/gateway'` statically and their existing tests pass by mocking `ai`'s `generateObject` and the `@ai-sdk/gateway` module. Follow the existing mock pattern in `__tests__/lib/services/memory/layer2-extract-schema.test.ts` (read it before writing extract/reconcile tests).
- **No `console.log`** — use `@/lib/logger`. The extract/apply files already use `console.error` for the fire-and-forget degrade path; keep that existing pattern (don't add new console.* elsewhere).
- **Commit after each task.** Commit message format: `feat: <desc> [LUM-324]` (or `test:`/`refactor:` as fits).

## File structure (locked decomposition)

**New files**

| File | Responsibility |
| --- | --- |
| `lib/memory/content-text.ts` | Pure `memoryContentToText(category, content)` — flatten per-category JSON to a comparable string. Shared by retriever query + pool. |
| `lib/services/memory/neighbor-retriever.ts` | `NeighborRetriever` interface + `lexicalNeighborRetriever` (bigram). The embedding swap point. |
| `lib/services/memory/layer1-reconcile-prompt.ts` | Pass-2 prompt builder for Layer 1 (candidates + neighbors → op decision, incl. SUPERSEDE). |
| `lib/services/memory/layer2-reconcile-prompt.ts` | Pass-2 prompt builder for Layer 2. |

**Modified files**

| File | Change |
| --- | --- |
| `lib/repositories/memory.repository.ts` | Add `supersedeInPlace(id, content, tx?)` — LUM-325 swap seam; interim body delegates to the same update as `updateContent`. |
| `lib/services/memory/layer1-extract.ts` | Add SUPERSEDE to op schema; add candidate schema + `extractLayer1Candidates` (Pass 1) + `reconcileLayer1Candidates` (Pass 2); remove `extractLayer1Operations`. |
| `lib/services/memory/layer1-prompt.ts` | Rename/repurpose `buildLayer1Prompt` → `buildLayer1ExtractPrompt`: drop the `# Operations` section, reframe output as a `candidates` list. |
| `lib/services/memory/layer1-apply.ts` | Add SUPERSEDE branch (`superseded` counter); result type gains `superseded`. |
| `lib/services/memory/layer1.service.ts` | Rewire orchestration: extract → retrieve → reconcile → apply. |
| `lib/services/memory/layer2-extract.ts` | Same as layer1-extract but L2 vocabulary (no DELETE; candidate carries `sourceMemoryIds`). |
| `lib/services/memory/layer2-prompt.ts` | → `buildLayer2ExtractPrompt`: drop operations framing, output `candidates`. |
| `lib/services/memory/layer2-apply.ts` | Add SUPERSEDE branch. |
| `lib/services/memory/layer2.service.ts` | Rewire `runForProject` to two-pass (keep lease claim/release untouched). |

**Constants:** `NEIGHBOR_K = 10` (defined in `neighbor-retriever.ts`, exported).

---

## Task 1: `memoryContentToText` pure flattener

**Files:**
- Create: `lib/memory/content-text.ts`
- Test: `__tests__/lib/memory/content-text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/memory/content-text.test.ts
import { memoryContentToText } from '@/lib/memory/content-text'

describe('memoryContentToText', () => {
  it('flattens a TRAP in field order, skipping absent optionals', () => {
    const text = memoryContentToText('TRAP', {
      summary: 'enum trap',
      trigger: 'add enum value and use it same migration',
      outcome: 'P3009',
    })
    expect(text).toBe('enum trap add enum value and use it same migration P3009')
  })

  it('flattens DECISION fields including alternatives/implications', () => {
    const text = memoryContentToText('DECISION', {
      what: 'soft-delete → hard-delete',
      why: 'nothing read archived rows',
      alternatives: 'shared read-helper',
      implications: 'delete is irreversible',
    })
    expect(text).toBe(
      'soft-delete → hard-delete nothing read archived rows shared read-helper delete is irreversible'
    )
  })

  it('expands PROCEDURAL steps array into the text', () => {
    const text = memoryContentToText('PROCEDURAL', {
      workflow: 'add enum safely',
      trigger: 'adding an enum value',
      steps: ['migration 1: add value', 'migration 2: use it'],
    })
    expect(text).toBe(
      'add enum safely adding an enum value migration 1: add value migration 2: use it'
    )
  })

  it('returns empty string for null/non-object content', () => {
    expect(memoryContentToText('TRAP', null)).toBe('')
    expect(memoryContentToText('TRAP', 'oops')).toBe('')
  })

  it('skips empty/whitespace-only string fields', () => {
    expect(memoryContentToText('CONVENTION', { rule: 'use Zod', scope: '   ' })).toBe('use Zod')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/memory/content-text.test.ts`
Expected: FAIL — `Cannot find module '@/lib/memory/content-text'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/memory/content-text.ts
import type { MemoryCategory } from '@prisma/client'

/**
 * Flatten a per-category memory content object into a single comparable
 * string, in headline-first field order. Used as both the query text and the
 * pool text for neighbor retrieval — so two memories about the same thing
 * produce overlapping bigrams regardless of which fields they fill.
 *
 * Defensive: content comes from the DB as `unknown` (JSON). Non-object or
 * null content yields '' (no neighbors, never throws).
 */
export function memoryContentToText(
  category: MemoryCategory,
  content: unknown
): string {
  if (content === null || typeof content !== 'object') return ''
  const c = content as Record<string, unknown>
  const parts: string[] = []
  const push = (v: unknown): void => {
    if (typeof v === 'string') {
      const t = v.trim()
      if (t) parts.push(t)
    } else if (Array.isArray(v)) {
      for (const item of v) push(item)
    }
  }
  switch (category) {
    case 'TRAP':
      push(c.summary)
      push(c.trigger)
      push(c.outcome)
      push(c.workaround)
      break
    case 'DECISION':
      push(c.summary)
      push(c.what)
      push(c.why)
      push(c.alternatives)
      push(c.implications)
      break
    case 'CONVENTION':
      push(c.summary)
      push(c.rule)
      push(c.scope)
      break
    case 'PROCEDURAL':
      push(c.summary)
      push(c.workflow)
      push(c.trigger)
      push(c.steps)
      break
  }
  return parts.join(' ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/memory/content-text.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-324-reconcile-on-write
git add lib/memory/content-text.ts __tests__/lib/memory/content-text.test.ts
git commit -m "feat: memoryContentToText flattener for neighbor retrieval [LUM-324]"
```

---

## Task 2: `NeighborRetriever` interface + lexical implementation

**Files:**
- Create: `lib/services/memory/neighbor-retriever.ts`
- Test: `__tests__/lib/services/memory/neighbor-retriever.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/services/memory/neighbor-retriever.test.ts
import {
  lexicalNeighborRetriever,
  NEIGHBOR_K,
} from '@/lib/services/memory/neighbor-retriever'

const pool = [
  {
    id: 'm_enum',
    category: 'TRAP' as const,
    content: { trigger: 'add a postgres enum value and use it same migration', outcome: 'P3009' },
  },
  {
    id: 'm_zod',
    category: 'CONVENTION' as const,
    content: { rule: 'new schemas use zod', scope: 'all new schemas' },
  },
]

describe('lexicalNeighborRetriever', () => {
  it('NEIGHBOR_K is 10', () => {
    expect(NEIGHBOR_K).toBe(10)
  })

  it('ranks the lexically-closest pool item first', () => {
    const out = lexicalNeighborRetriever.retrieve(
      { category: 'TRAP', text: 'adding a postgres enum value in the same migration fails' },
      pool,
      10
    )
    expect(out[0]!.id).toBe('m_enum')
  })

  it('returns at most k items', () => {
    const big = Array.from({ length: 25 }, (_, i) => ({
      id: `m_${i}`,
      category: 'TRAP' as const,
      content: { trigger: 'enum value same migration fails', outcome: 'P3009' },
    }))
    const out = lexicalNeighborRetriever.retrieve(
      { category: 'TRAP', text: 'enum value same migration fails' },
      big,
      10
    )
    expect(out).toHaveLength(10)
  })

  it('drops items below the floor (totally unrelated)', () => {
    const out = lexicalNeighborRetriever.retrieve(
      { category: 'TRAP', text: 'zzzzz qqqqq wwwww unrelated gibberish' },
      [{ id: 'm_x', category: 'TRAP' as const, content: { trigger: 'kubernetes pod eviction', outcome: 'oom' } }],
      10
    )
    expect(out).toHaveLength(0)
  })

  it('boosts a same-category item over an equally-similar cross-category one', () => {
    const same = { id: 'same', category: 'TRAP' as const, content: { trigger: 'token budget overflow', outcome: 'x' } }
    const cross = { id: 'cross', category: 'DECISION' as const, content: { what: 'token budget overflow', why: 'x' } }
    const out = lexicalNeighborRetriever.retrieve(
      { category: 'TRAP', text: 'token budget overflow' },
      [cross, same],
      10
    )
    expect(out[0]!.id).toBe('same')
  })

  it('returns an empty array for an empty pool', () => {
    expect(
      lexicalNeighborRetriever.retrieve({ category: 'TRAP', text: 'anything' }, [], 10)
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/memory/neighbor-retriever.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/memory/neighbor-retriever'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/services/memory/neighbor-retriever.ts
import type { MemoryCategory } from '@prisma/client'
import { bigramSimilarity } from '@/lib/similarity'
import { memoryContentToText } from '@/lib/memory/content-text'

/** Top-k neighbors fetched per candidate (Mem0 uses top-10). */
export const NEIGHBOR_K = 10

/** A small bump so a same-category near-duplicate outranks a cross-category
 * coincidence. SUPERSEDE/UPDATE can only target a same-category neighbor (apply
 * re-validates against the existing row's category), so same-category is the
 * decision-relevant case. */
const SAME_CATEGORY_BOOST = 0.1

/** Below this, a "neighbor" is lexical noise — feeding it to the LLM only
 * invites spurious UPDATE/SUPERSEDE. Tuned conservatively; revisit via the
 * LUM-329 eval harness. */
const SCORE_FLOOR = 0.05

export interface NeighborPoolItem {
  id: string
  category: MemoryCategory
  content: unknown
}

export interface NeighborQuery {
  category: MemoryCategory
  text: string
}

export interface ScoredNeighbor extends NeighborPoolItem {
  score: number
}

/**
 * Rank existing memories by similarity to a candidate fact and return the
 * top-k. The ONLY implementation shipped in LUM-324 is lexical
 * (`lexicalNeighborRetriever`); the interface exists so an
 * `EmbeddingNeighborRetriever` (pgvector) can replace it later without
 * touching callers. See the LUM-324 DECISION memory for the swap trigger.
 */
export interface NeighborRetriever {
  retrieve(
    query: NeighborQuery,
    pool: NeighborPoolItem[],
    k: number
  ): ScoredNeighbor[]
}

export const lexicalNeighborRetriever: NeighborRetriever = {
  retrieve(query, pool, k) {
    const scored: ScoredNeighbor[] = []
    for (const item of pool) {
      const base = bigramSimilarity(
        query.text,
        memoryContentToText(item.category, item.content)
      )
      if (base <= 0) continue
      const score =
        item.category === query.category
          ? Math.min(1, base + SAME_CATEGORY_BOOST)
          : base
      if (score < SCORE_FLOOR) continue
      scored.push({ ...item, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/memory/neighbor-retriever.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/neighbor-retriever.ts __tests__/lib/services/memory/neighbor-retriever.test.ts
git commit -m "feat: pluggable NeighborRetriever with lexical implementation [LUM-324]"
```

---

## Task 3: Add `supersedeInPlace` repository seam

**Files:**
- Modify: `lib/repositories/memory.repository.ts` (add a method next to `updateContent`, ~line 262-273)
- Test: `__tests__/memory.repository.supersede.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/memory.repository.supersede.test.ts
import { memoryRepository } from '@/lib/repositories/memory.repository'

jest.mock('@/lib/prisma', () => ({
  prisma: { memory: { update: jest.fn().mockResolvedValue({ id: 'mem_1' }) } },
}))
import { prisma } from '@/lib/prisma'

describe('memoryRepository.supersedeInPlace', () => {
  it('overwrites content on the existing row, preserving its id (LUM-325 swap seam)', async () => {
    await memoryRepository.supersedeInPlace('mem_1', { rule: 'new', scope: 'all' })
    expect(prisma.memory.update).toHaveBeenCalledWith({
      where: { id: 'mem_1' },
      data: { content: { rule: 'new', scope: 'all' } },
      select: { id: true },
    })
  })
})
```

> Before writing, open `lib/repositories/memory.repository.ts` and confirm the prisma import path used in the file header (it may be `@/lib/prisma` or a local `prisma` singleton). Match the mock to the real import. Also confirm `updateContent`'s exact shape (line ~262) and mirror it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/memory.repository.supersede.test.ts`
Expected: FAIL — `memoryRepository.supersedeInPlace is not a function`.

- [ ] **Step 3: Add the method** (immediately after `updateContent` in `lib/repositories/memory.repository.ts`)

```ts
  /**
   * SUPERSEDE seam (LUM-324). A new memory contradicts/replaces an existing
   * one. INTERIM behavior: overwrite the existing row's content in place —
   * same write as `updateContent`, but a distinct method so LUM-325 can swap
   * this body to invalidate-not-delete (keep the old row, stamp invalidatedAt,
   * insert the replacement, link supersededById) WITHOUT touching any caller.
   * Preserving the row id keeps provenance / lineage edges pointing at it
   * intact — the reason SUPERSEDE is not DELETE+ADD.
   */
  async supersedeInPlace(
    id: string,
    content: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.memory.update({
      where: { id },
      data: { content },
      select: { id: true },
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/memory.repository.supersede.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/memory.repository.ts __tests__/memory.repository.supersede.test.ts
git commit -m "feat: supersedeInPlace repository seam for LUM-325 [LUM-324]"
```

---

## Task 4: Layer 1 op schema — add SUPERSEDE

**Files:**
- Modify: `lib/services/memory/layer1-extract.ts:25-51` (op schema + types)
- Test: `__tests__/lib/services/memory/layer1-operation-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/services/memory/layer1-operation-schema.test.ts
import { layer1OperationSchema } from '@/lib/services/memory/layer1-extract'

describe('layer1OperationSchema SUPERSEDE', () => {
  it('accepts a SUPERSEDE op with id + content', () => {
    const parsed = layer1OperationSchema.parse({
      type: 'SUPERSEDE',
      id: 'mem_old',
      content: { rule: 'new rule', scope: 'all' },
    })
    expect(parsed).toEqual({ type: 'SUPERSEDE', id: 'mem_old', content: { rule: 'new rule', scope: 'all' } })
  })

  it('rejects a SUPERSEDE op missing id', () => {
    expect(() =>
      layer1OperationSchema.parse({ type: 'SUPERSEDE', content: {} })
    ).toThrow()
  })

  it('still accepts ADD / UPDATE / DELETE / NOOP', () => {
    expect(() => layer1OperationSchema.parse({ type: 'NOOP' })).not.toThrow()
    expect(() => layer1OperationSchema.parse({ type: 'DELETE', id: 'x' })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/memory/layer1-operation-schema.test.ts`
Expected: FAIL — SUPERSEDE not in the discriminated union (parse throws on the first test).

- [ ] **Step 3: Add SUPERSEDE to the union** in `lib/services/memory/layer1-extract.ts` — insert this object into `layer1OperationSchema`'s `z.discriminatedUnion('type', [...])` array, after the DELETE entry (between lines 40 and 41):

```ts
  z.object({
    type: z.literal('SUPERSEDE'),
    id: z.string().min(1),
    content: z.unknown(),
  }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/memory/layer1-operation-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer1-extract.ts __tests__/lib/services/memory/layer1-operation-schema.test.ts
git commit -m "feat: add SUPERSEDE to Layer 1 op schema [LUM-324]"
```

---

## Task 5: Layer 1 apply — SUPERSEDE branch (UPDATE-in-place interim)

**Files:**
- Modify: `lib/services/memory/layer1-apply.ts` (result type ~line 23-30; op loop ~line 64-143)
- Test: `__tests__/lib/services/memory/layer1-apply.test.ts` (existing file — add cases; first read it to match its mock setup)

- [ ] **Step 1: Write the failing test** (append to the existing describe block in `layer1-apply.test.ts`)

```ts
  it('SUPERSEDE overwrites the target row content in place and counts it', async () => {
    const supersede = jest
      .spyOn(memoryRepository, 'supersedeInPlace')
      .mockResolvedValue({ id: 'mem_old' } as never)

    const result = await applyLayer1Operations({
      operations: [
        { type: 'SUPERSEDE', id: 'mem_old', content: { rule: 'REST is fine now', scope: 'all new endpoints' } },
      ],
      taskId: 'task_1',
      projectId: 'proj_1',
      workspaceId: 'ws_1',
      sessionId: 'sess_1',
      existingMemories: [{ id: 'mem_old', category: 'CONVENTION' }],
    })

    expect(result.superseded).toBe(1)
    expect(supersede).toHaveBeenCalledWith(
      'mem_old',
      { rule: 'REST is fine now', scope: 'all new endpoints' },
      expect.anything()
    )
  })

  it('drops SUPERSEDE targeting an unknown id', async () => {
    const result = await applyLayer1Operations({
      operations: [{ type: 'SUPERSEDE', id: 'ghost', content: { rule: 'x', scope: 'y' } }],
      taskId: 'task_1',
      projectId: 'proj_1',
      workspaceId: 'ws_1',
      sessionId: 'sess_1',
      existingMemories: [],
    })
    expect(result.superseded).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('drops SUPERSEDE whose content fails the target category schema', async () => {
    const result = await applyLayer1Operations({
      operations: [{ type: 'SUPERSEDE', id: 'mem_old', content: { what: 'wrong shape for a TRAP' } }],
      taskId: 'task_1',
      projectId: 'proj_1',
      workspaceId: 'ws_1',
      sessionId: 'sess_1',
      existingMemories: [{ id: 'mem_old', category: 'TRAP' }],
    })
    expect(result.superseded).toBe(0)
    expect(result.skipped).toBe(1)
  })
```

> Read the top of `__tests__/lib/services/memory/layer1-apply.test.ts` first. It already mocks `memoryRepository` (including `applyPlansAtomically`, which runs each plan against a fake tx). Confirm the existing mock invokes plan callbacks so `supersedeInPlace` is actually called — if `applyPlansAtomically` is mocked to run the plans, the spy above fires; if it's a bare `jest.fn()`, extend it to `mockImplementation(async (plans) => { for (const p of plans) await p({}) })` as the existing ADD/UPDATE tests require.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/memory/layer1-apply.test.ts`
Expected: FAIL — `result.superseded` is `undefined`; `supersedeInPlace` not called.

- [ ] **Step 3: Implement.** Three edits in `lib/services/memory/layer1-apply.ts`:

(a) Add `superseded` to the result interface (`ApplyOperationsResult`, ~line 23):

```ts
export interface ApplyOperationsResult {
  added: number
  updated: number
  deleted: number
  superseded: number
  noop: number
  /** Operations dropped because content/category/id failed second-pass validation. */
  skipped: number
}
```

(b) Initialize it in the `result` object (~line 47):

```ts
  const result: ApplyOperationsResult = {
    added: 0,
    updated: 0,
    deleted: 0,
    superseded: 0,
    noop: 0,
    skipped: 0,
  }
```

(c) Add the SUPERSEDE branch inside the `for (const op of input.operations)` loop, right after the `DELETE` block (after line 79, before the `ADD` block). It mirrors UPDATE's validation (content must match the existing row's category) but routes to `supersedeInPlace`:

```ts
    if (op.type === 'SUPERSEDE') {
      const existingCategory = knownCategoryById.get(op.id)
      if (!existingCategory) {
        result.skipped++
        continue
      }
      let validated: unknown
      try {
        validated = parseMemoryContent(existingCategory, op.content)
      } catch (error) {
        logger.warn(
          `[memory.layer1] dropped SUPERSEDE id=${op.id} (content failed ${existingCategory} schema):`,
          error instanceof Error ? error.message : error
        )
        result.skipped++
        continue
      }
      plans.push(async tx => {
        await memoryRepository.supersedeInPlace(
          op.id,
          validated as Prisma.InputJsonValue,
          tx
        )
        result.superseded++
      })
      continue
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/memory/layer1-apply.test.ts`
Expected: PASS (existing cases + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer1-apply.ts __tests__/lib/services/memory/layer1-apply.test.ts
git commit -m "feat: Layer 1 apply SUPERSEDE branch (UPDATE-in-place interim) [LUM-324]"
```

---

## Task 6: Layer 1 Pass 1 — `extractLayer1Candidates` + extract prompt

**Files:**
- Modify: `lib/services/memory/layer1-extract.ts` (add candidate schema + Pass-1 function)
- Modify: `lib/services/memory/layer1-prompt.ts` (rename `buildLayer1Prompt` → `buildLayer1ExtractPrompt`, drop the `# Operations` section, reframe output)
- Test: `__tests__/lib/services/memory/layer1-candidates.test.ts`

- [ ] **Step 1: Write the failing test** (mock the model — copy the mock header from `__tests__/lib/services/memory/layer2-extract-schema.test.ts`)

```ts
// __tests__/lib/services/memory/layer1-candidates.test.ts
const generateObjectMock = jest.fn()
jest.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObjectMock(...a) }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import {
  extractLayer1Candidates,
  layer1CandidatesOutputSchema,
} from '@/lib/services/memory/layer1-extract'

const baseInput = {
  task: { id: 'task_1', title: 'T', description: null, projectId: 'p1', workspaceId: 'w1' },
  turnEvents: [],
  existingMemories: [],
} as const

beforeEach(() => {
  generateObjectMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('extractLayer1Candidates', () => {
  it('returns the model candidates list', async () => {
    generateObjectMock.mockResolvedValue({
      object: { candidates: [{ category: 'TRAP', content: { trigger: 'x', outcome: 'y' } }] },
    })
    const out = await extractLayer1Candidates(baseInput)
    expect(out).toEqual([{ category: 'TRAP', content: { trigger: 'x', outcome: 'y' } }])
  })

  it('degrades to [] when the model call throws', async () => {
    generateObjectMock.mockRejectedValue(new Error('gateway down'))
    expect(await extractLayer1Candidates(baseInput)).toEqual([])
  })

  it('candidate schema accepts optional scope', () => {
    expect(() =>
      layer1CandidatesOutputSchema.parse({
        candidates: [{ category: 'CONVENTION', scope: 'PROJECT', content: { rule: 'r', scope: 's' } }],
      })
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/memory/layer1-candidates.test.ts`
Expected: FAIL — `extractLayer1Candidates` / `layer1CandidatesOutputSchema` not exported.

- [ ] **Step 3a: Add the candidate schema + Pass-1 call** to `lib/services/memory/layer1-extract.ts`. Keep the existing `memoryCategorySchema` / `memoryScopeSchema` / `MODEL_ID`. Add:

```ts
import { buildLayer1ExtractPrompt } from './layer1-prompt'

// ── Pass 1: candidate extraction ───────────────────────────────────────────

export const layer1CandidateSchema = z.object({
  category: memoryCategorySchema,
  scope: memoryScopeSchema.optional(),
  content: z.unknown(),
})

export const layer1CandidatesOutputSchema = z.object({
  candidates: z.array(layer1CandidateSchema),
})

export type Layer1Candidate = z.infer<typeof layer1CandidateSchema>

/**
 * Pass 1: read the turn and emit candidate facts worth remembering — blind to
 * existing memories. Reconciliation (ADD vs UPDATE vs SUPERSEDE vs NOOP) is a
 * separate pass that sees each candidate's neighbors. Failures degrade to [].
 */
export async function extractLayer1Candidates(
  input: Layer1Input
): Promise<Layer1Candidate[]> {
  const { system, user } = buildLayer1ExtractPrompt({
    task: { title: input.task.title, description: input.task.description },
    turnEvents: input.turnEvents,
  })
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer1CandidatesOutputSchema,
      system,
      prompt: user,
    })
    return object.candidates
  } catch (error) {
    console.error(
      `[memory.layer1] candidate extraction failed task=${input.task.id}:`,
      error
    )
    return []
  }
}
```

Then DELETE the old `extractLayer1Operations` function (lines 64-88) and its `buildLayer1Prompt` import — it is replaced by `extractLayer1Candidates` (Pass 1) + `reconcileLayer1Candidates` (Task 7). Leave `layer1OperationSchema` / `Layer1Operation` / `layer1OutputSchema` in place (the reconcile pass and apply still use them).

- [ ] **Step 3b: Repurpose the extract prompt** in `lib/services/memory/layer1-prompt.ts`:
  - Rename the exported `buildLayer1Prompt` to `buildLayer1ExtractPrompt`.
  - Change its `BuildPromptInput` to drop `existingMemories` (Pass 1 is blind):

```ts
interface BuildPromptInput {
  task: { title: string; description: string | null }
  turnEvents: RawEvent[]
}
```

  - In `SYSTEM_PROMPT`, replace the `# Operations` section (lines 83-88) with a candidate-extraction framing:

```ts
// Replaces the old "# Operations" section
`# Output — candidate facts

You output a JSON list of *candidate facts* worth remembering from this turn —
each a { category, content, scope? } object (same content shapes as above).
You do NOT decide ADD vs UPDATE vs delete here; a later step compares each
candidate against existing memories. Your only job: emit the genuinely
memory-worthy facts as candidates. If nothing in the turn is memory-worthy,
return an empty candidates list.`
```

  - Remove the `# Existing task memories` block from the user prompt (lines 316-317) and the `memoryLines` computation (lines 128-135) — Pass 1 sees no existing memories.
  - In the examples section, change every `{ "operations": [ ... ] }` wrapper to `{ "candidates": [ ... ] }` and strip the `"type": "ADD"` / UPDATE / DELETE / NOOP envelopes so each example item is a bare `{ category, scope?, content }`. The NOOP example (Example 3) becomes `{ "candidates": [] }`. Examples 4 (UPDATE) and 6 (DELETE+ADD) are reconciliation behaviors — MOVE them to the reconcile prompt in Task 7; delete them from this file.
  - Change the final user-prompt instruction (lines 324-325) to:

```ts
`# Your output
Return a JSON object { "candidates": [...] } matching the schema. If nothing in the turn is memory-worthy, return { "candidates": [] }.`
```

  - Update the function signature/return at the bottom: `export function buildLayer1ExtractPrompt(input: BuildPromptInput): BuiltPrompt { ... }` and drop the now-unused `MemoryCategory` import if no longer referenced.

- [ ] **Step 3c: Update the existing prompt test** `__tests__/lib/services/memory/layer1-prompt.test.ts` — rename calls `buildLayer1Prompt` → `buildLayer1ExtractPrompt`, drop the `existingMemories` argument, and replace any assertion on the "Existing task memories" block with an assertion that the prompt does NOT include existing memories and that the user prompt mentions "candidates". (Read the file first; adjust assertions to the new shape.)

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/lib/services/memory/layer1-candidates.test.ts __tests__/lib/services/memory/layer1-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer1-extract.ts lib/services/memory/layer1-prompt.ts __tests__/lib/services/memory/layer1-candidates.test.ts __tests__/lib/services/memory/layer1-prompt.test.ts
git commit -m "feat: Layer 1 Pass-1 candidate extraction + extract prompt [LUM-324]"
```

---

## Task 7: Layer 1 Pass 2 — `reconcileLayer1Candidates` + reconcile prompt

**Files:**
- Create: `lib/services/memory/layer1-reconcile-prompt.ts`
- Modify: `lib/services/memory/layer1-extract.ts` (add `reconcileLayer1Candidates`)
- Test: `__tests__/lib/services/memory/layer1-reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/services/memory/layer1-reconcile.test.ts
const generateObjectMock = jest.fn()
jest.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObjectMock(...a) }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { reconcileLayer1Candidates } from '@/lib/services/memory/layer1-extract'

const task = { id: 'task_1', title: 'T', description: null }

beforeEach(() => {
  generateObjectMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('reconcileLayer1Candidates', () => {
  it('passes candidates + neighbors to the model and returns its operations', async () => {
    generateObjectMock.mockResolvedValue({
      object: { operations: [{ type: 'SUPERSEDE', id: 'mem_old', content: { rule: 'r', scope: 's' } }] },
    })
    const ops = await reconcileLayer1Candidates({
      task,
      candidates: [{ category: 'CONVENTION', content: { rule: 'r2', scope: 's2' } }],
      neighborsByCandidate: [[{ id: 'mem_old', category: 'CONVENTION', content: { rule: 'r', scope: 's' }, score: 0.8 }]],
    })
    expect(ops).toEqual([{ type: 'SUPERSEDE', id: 'mem_old', content: { rule: 'r', scope: 's' } }])
    // sanity: the model actually received a prompt mentioning the neighbor id
    const callArg = generateObjectMock.mock.calls[0]![0] as { prompt: string }
    expect(callArg.prompt).toContain('mem_old')
  })

  it('degrades to [] on model error', async () => {
    generateObjectMock.mockRejectedValue(new Error('down'))
    const ops = await reconcileLayer1Candidates({ task, candidates: [], neighborsByCandidate: [] })
    expect(ops).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/memory/layer1-reconcile.test.ts`
Expected: FAIL — `reconcileLayer1Candidates` not exported.

- [ ] **Step 3a: Create the reconcile prompt** `lib/services/memory/layer1-reconcile-prompt.ts`:

```ts
import type { MemoryCategory } from '@prisma/client'

interface ReconcileInput {
  task: { title: string; description: string | null }
  candidates: Array<{ category: MemoryCategory; scope?: 'TASK' | 'PROJECT'; content: unknown }>
  neighborsByCandidate: Array<
    Array<{ id: string; category: MemoryCategory; content: unknown; score: number }>
  >
}

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You reconcile newly-extracted candidate memories against the existing task memory store.

You are given a list of CANDIDATES (new facts just extracted from a coding turn). For each candidate you are shown its NEIGHBORS — the most similar existing memories already on file (with their ids). Decide, per candidate, exactly one operation. Output a flat JSON list of operations across all candidates.

# Operations
- ADD — the candidate is genuinely new; no neighbor already says it. Provide { category, content, scope? } (keep the candidate's category/content/scope).
- UPDATE — a neighbor says ALMOST the same thing and the candidate refines or extends it. Provide the neighbor's id + a full replacement content object (SAME category as that neighbor). Use this for near-duplicates — never emit a second ADD for something a neighbor already covers.
- SUPERSEDE — a neighbor is now CONTRADICTED or replaced by the candidate (the old fact is wrong/outdated). Provide the neighbor's id + the new content (SAME category as that neighbor). SUPERSEDE is only for same-category contradiction; if the replacement is a different category, emit DELETE on the neighbor + ADD the candidate instead.
- DELETE — a neighbor is obsolete and the candidate merely confirms it should go (rare). Provide the neighbor's id.
- NOOP — the candidate is already fully represented by a neighbor; nothing to write. Emitting nothing for a candidate is equivalent — prefer NOOP explicitly when a neighbor already covers it.

# Decision rules
- Near-duplicate (a neighbor already says it) → UPDATE if the candidate adds signal, else NOOP. NEVER ADD.
- Contradiction (candidate says the opposite of a neighbor) → SUPERSEDE that neighbor (same category) — do not leave both.
- No relevant neighbor → ADD.
- Only reference an id that appears in that candidate's neighbor list. Never invent ids.
- Content shapes per category are unchanged (TRAP/DECISION/CONVENTION/PROCEDURAL). Keep the same terse, plain-words writing style as the candidates.`

export function buildLayer1ReconcilePrompt(input: ReconcileInput): BuiltPrompt {
  const description = input.task.description?.trim() || '(no description)'
  const blocks = input.candidates.map((c, i) => {
    const neighbors = input.neighborsByCandidate[i] ?? []
    const neighborLines = neighbors.length
      ? neighbors
          .map(
            n =>
              `    - id=${n.id} category=${n.category} content=${JSON.stringify(n.content)}`
          )
          .join('\n')
      : '    (no similar existing memories)'
    return `Candidate #${i} category=${c.category}${c.scope ? ` scope=${c.scope}` : ''}
  content=${JSON.stringify(c.content)}
  Neighbors:
${neighborLines}`
  })

  const user = `# Task context
Title: ${input.task.title}
Description: ${description}

# Candidates and their neighbors
${blocks.join('\n\n') || '(no candidates)'}

# Your output
Return { "operations": [...] } — one decision per candidate (ADD / UPDATE / SUPERSEDE / DELETE / NOOP). Reference only neighbor ids shown above.`

  return { system: SYSTEM_PROMPT, user }
}
```

- [ ] **Step 3b: Add the Pass-2 call** to `lib/services/memory/layer1-extract.ts`:

```ts
import { buildLayer1ReconcilePrompt } from './layer1-reconcile-prompt'
import type { ScoredNeighbor } from './neighbor-retriever'

// ── Pass 2: reconciliation ──────────────────────────────────────────────────

export interface ReconcileLayer1Input {
  task: { id: string; title: string; description: string | null }
  candidates: Layer1Candidate[]
  neighborsByCandidate: ScoredNeighbor[][]
}

/**
 * Pass 2: given each candidate and its top-k neighbors, decide the operation
 * (ADD / UPDATE / DELETE / SUPERSEDE / NOOP). Failures degrade to [].
 */
export async function reconcileLayer1Candidates(
  input: ReconcileLayer1Input
): Promise<Layer1Operation[]> {
  const { system, user } = buildLayer1ReconcilePrompt({
    task: { title: input.task.title, description: input.task.description },
    candidates: input.candidates,
    neighborsByCandidate: input.neighborsByCandidate,
  })
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer1OutputSchema,
      system,
      prompt: user,
    })
    return object.operations
  } catch (error) {
    console.error(
      `[memory.layer1] reconciliation failed task=${input.task.id}:`,
      error
    )
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/memory/layer1-reconcile.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer1-extract.ts lib/services/memory/layer1-reconcile-prompt.ts __tests__/lib/services/memory/layer1-reconcile.test.ts
git commit -m "feat: Layer 1 Pass-2 reconciliation + reconcile prompt [LUM-324]"
```

---

## Task 8: Layer 1 service — rewire to four-step orchestration

**Files:**
- Modify: `lib/services/memory/layer1.service.ts`
- Test: `__tests__/lib/services/memory/layer1.service.test.ts` (existing — rewrite mocks to the new pipeline)

- [ ] **Step 1: Rewrite the failing test.** Replace the mock surface in `__tests__/lib/services/memory/layer1.service.test.ts`:

```ts
jest.mock('@/lib/services/memory/layer1-input', () => ({ getLayer1Input: jest.fn() }))
jest.mock('@/lib/services/memory/layer1-extract', () => ({
  extractLayer1Candidates: jest.fn(),
  reconcileLayer1Candidates: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer1-apply', () => ({ applyLayer1Operations: jest.fn() }))

import { getLayer1Input } from '@/lib/services/memory/layer1-input'
import {
  extractLayer1Candidates,
  reconcileLayer1Candidates,
} from '@/lib/services/memory/layer1-extract'
import { applyLayer1Operations } from '@/lib/services/memory/layer1-apply'
import { layer1Service } from '@/lib/services/memory/layer1.service'

const getInput = getLayer1Input as jest.MockedFunction<typeof getLayer1Input>
const extract = extractLayer1Candidates as jest.MockedFunction<typeof extractLayer1Candidates>
const reconcile = reconcileLayer1Candidates as jest.MockedFunction<typeof reconcileLayer1Candidates>
const apply = applyLayer1Operations as jest.MockedFunction<typeof applyLayer1Operations>

const fullInput = {
  task: { id: 'task_1', title: 't', description: null, projectId: 'proj_1', workspaceId: 'ws_1' },
  turnEvents: [],
  existingMemories: [{ id: 'mem_a', category: 'TRAP' as const, content: { trigger: 'x', outcome: 'y' } }],
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('layer1Service.triggerLayer1Extraction (two-pass)', () => {
  it('skips when taskId is null', async () => {
    await layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: null, workspaceId: 'w' })
    expect(getInput).not.toHaveBeenCalled()
    expect(extract).not.toHaveBeenCalled()
  })

  it('skips reconcile + apply when no candidates', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue([])
    await layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: 'task_1', workspaceId: 'ws_1' })
    expect(reconcile).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('skips apply when reconcile returns no operations', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue([{ category: 'TRAP', content: { trigger: 'x', outcome: 'y' } }])
    reconcile.mockResolvedValue([])
    await layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: 'task_1', workspaceId: 'ws_1' })
    expect(apply).not.toHaveBeenCalled()
  })

  it('runs extract → reconcile → apply, feeding neighbors per candidate', async () => {
    getInput.mockResolvedValue(fullInput)
    extract.mockResolvedValue([{ category: 'TRAP', content: { trigger: 'enum value same migration', outcome: 'P3009' } }])
    reconcile.mockResolvedValue([{ type: 'NOOP' }])
    apply.mockResolvedValue({ added: 0, updated: 0, deleted: 0, superseded: 0, noop: 1, skipped: 0 })

    await layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: 'task_1', workspaceId: 'ws_1' })

    // reconcile received one neighbor list, one entry per candidate
    const reconcileArg = reconcile.mock.calls[0]![0]
    expect(reconcileArg.candidates).toHaveLength(1)
    expect(reconcileArg.neighborsByCandidate).toHaveLength(1)
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ existingMemories: [{ id: 'mem_a', category: 'TRAP' }] })
    )
  })

  it('swallows unexpected errors (fire-and-forget contract)', async () => {
    getInput.mockRejectedValue(new Error('db down'))
    await expect(
      layer1Service.triggerLayer1Extraction({ sessionId: 's', taskId: 'task_1', workspaceId: 'ws_1' })
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/services/memory/layer1.service.test.ts`
Expected: FAIL — service still imports `extractLayer1Operations`; new mocks unused.

- [ ] **Step 3: Rewire the service** `lib/services/memory/layer1.service.ts`:

```ts
import { logger } from '@/lib/logger'
import { getLayer1Input } from './layer1-input'
import {
  extractLayer1Candidates,
  reconcileLayer1Candidates,
} from './layer1-extract'
import { applyLayer1Operations } from './layer1-apply'
import { memoryContentToText } from '@/lib/memory/content-text'
import { lexicalNeighborRetriever, NEIGHBOR_K } from './neighbor-retriever'
import type { NeighborRetriever } from './neighbor-retriever'

interface TriggerLayer1Input {
  sessionId: string
  taskId: string | null
  workspaceId: string
}

/**
 * Neighbor retriever for reconcile-on-write. LUM-324 ships the lexical
 * implementation; swap this single binding for an embedding-backed retriever
 * (pgvector) when the LUM-324 DECISION trigger fires.
 */
const retriever: NeighborRetriever = lexicalNeighborRetriever

export const layer1Service = {
  async triggerLayer1Extraction(input: TriggerLayer1Input): Promise<void> {
    try {
      if (!input.taskId) {
        logger.debug(`[memory.layer1] skip session=${input.sessionId} reason=no-task-tag`)
        return
      }
      logger.debug(`[memory.layer1] triggered session=${input.sessionId} task=${input.taskId}`)

      const layer1Input = await getLayer1Input(input.sessionId, input.taskId)
      if (!layer1Input) {
        logger.debug(`[memory.layer1] skip session=${input.sessionId} reason=no-input`)
        return
      }

      // Pass 1 — extract candidate facts blind to existing memories.
      const candidates = await extractLayer1Candidates(layer1Input)
      if (candidates.length === 0) {
        logger.debug(`[memory.layer1] no-candidates session=${input.sessionId}`)
        return
      }

      // Retrieve — per candidate, top-k similar existing task memories.
      const neighborsByCandidate = candidates.map(c =>
        retriever.retrieve(
          { category: c.category, text: memoryContentToText(c.category, c.content) },
          layer1Input.existingMemories,
          NEIGHBOR_K
        )
      )

      // Pass 2 — reconcile each candidate against its neighbors.
      const operations = await reconcileLayer1Candidates({
        task: {
          id: layer1Input.task.id,
          title: layer1Input.task.title,
          description: layer1Input.task.description,
        },
        candidates,
        neighborsByCandidate,
      })
      if (operations.length === 0) {
        logger.debug(`[memory.layer1] no-ops session=${input.sessionId}`)
        return
      }

      const result = await applyLayer1Operations({
        operations,
        taskId: layer1Input.task.id,
        projectId: layer1Input.task.projectId,
        workspaceId: layer1Input.task.workspaceId,
        sessionId: input.sessionId,
        ...(layer1Input.agent !== undefined ? { agent: layer1Input.agent } : {}),
        existingMemories: layer1Input.existingMemories.map(m => ({
          id: m.id,
          category: m.category,
        })),
      })

      logger.debug(`[memory.layer1] applied session=${input.sessionId} task=${input.taskId}`, result)
    } catch (error) {
      console.error(`[memory.layer1] unexpected error session=${input.sessionId}:`, error)
    }
  },
}
```

> Note: `Layer1Input.task` already carries `title` + `description` (see `layer1-input.ts:8-14`), so reconcile gets them with no input-gathering change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/services/memory/layer1.service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer1.service.ts __tests__/lib/services/memory/layer1.service.test.ts
git commit -m "feat: rewire Layer 1 service to two-pass reconcile-on-write [LUM-324]"
```

---

## Task 9: Layer 2 op schema + apply — add SUPERSEDE

**Files:**
- Modify: `lib/services/memory/layer2-extract.ts:29-54` (op schema)
- Modify: `lib/services/memory/layer2-apply.ts` (result type + SUPERSEDE branch)
- Test: `__tests__/lib/services/memory/layer2-extract-schema.test.ts` (existing — add SUPERSEDE case), `__tests__/lib/services/memory/layer2-apply.test.ts` (existing — add cases)

- [ ] **Step 1: Write failing tests.** Add to `layer2-extract-schema.test.ts`:

```ts
  it('accepts a SUPERSEDE op with id + content', () => {
    expect(() =>
      layer2OperationSchema.parse({ type: 'SUPERSEDE', id: 'mem_old', content: { rule: 'r', scope: 's' } })
    ).not.toThrow()
  })

  it('still rejects DELETE (Layer 2 has no hard delete)', () => {
    expect(() => layer2OperationSchema.parse({ type: 'DELETE', id: 'x' })).toThrow()
  })
```

Add to `layer2-apply.test.ts` (mirror Task 5's SUPERSEDE cases; L2 input has `projectId`/`workspaceId`/`existingProjectMemories` — read the existing file's helper shape and match it):

```ts
  it('SUPERSEDE overwrites the target PROJECT memory in place and counts it', async () => {
    const supersede = jest
      .spyOn(memoryRepository, 'supersedeInPlace')
      .mockResolvedValue({ id: 'mem_old' } as never)
    const result = await applyLayer2Operations({
      operations: [{ type: 'SUPERSEDE', id: 'mem_old', content: { rule: 'new', scope: 'all' } }],
      projectId: 'proj_1',
      workspaceId: 'ws_1',
      existingProjectMemories: [{ id: 'mem_old', category: 'CONVENTION' }],
    })
    expect(result.superseded).toBe(1)
    expect(supersede).toHaveBeenCalledWith('mem_old', { rule: 'new', scope: 'all' }, expect.anything())
  })

  it('drops SUPERSEDE targeting an unknown id', async () => {
    const result = await applyLayer2Operations({
      operations: [{ type: 'SUPERSEDE', id: 'ghost', content: { rule: 'x', scope: 'y' } }],
      projectId: 'proj_1',
      workspaceId: 'ws_1',
      existingProjectMemories: [],
    })
    expect(result.superseded).toBe(0)
    expect(result.skipped).toBe(1)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/services/memory/layer2-extract-schema.test.ts __tests__/lib/services/memory/layer2-apply.test.ts`
Expected: FAIL — SUPERSEDE not in union; `result.superseded` undefined.

- [ ] **Step 3a: Add SUPERSEDE to `layer2OperationSchema`** in `lib/services/memory/layer2-extract.ts` — insert after the UPDATE entry (after line 43), keeping the no-DELETE contract:

```ts
  z.object({
    type: z.literal('SUPERSEDE'),
    id: z.string().min(1),
    content: z.unknown(),
  }),
```

Update the docstring above the schema (lines 16-28) to note SUPERSEDE is now the contradiction path (still no DELETE).

- [ ] **Step 3b: Add `superseded` + the SUPERSEDE branch** to `lib/services/memory/layer2-apply.ts`:

(a) `ApplyOperationsResult` (line 35) gains `superseded: number`; initialize it in `result` (line 61).

(b) Insert the SUPERSEDE branch after the NOOP block (after line 79), before ADD:

```ts
    if (op.type === 'SUPERSEDE') {
      const existingCategory = knownCategoryById.get(op.id)
      if (!existingCategory) {
        result.skipped++
        continue
      }
      let validated: unknown
      try {
        validated = parseMemoryContent(existingCategory, op.content)
      } catch (error) {
        logger.warn(
          `[memory.layer2] dropped SUPERSEDE id=${op.id} (content failed ${existingCategory} schema):`,
          error instanceof Error ? error.message : error
        )
        result.skipped++
        continue
      }
      plans.push(async tx => {
        await memoryRepository.supersedeInPlace(
          op.id,
          validated as Prisma.InputJsonValue,
          tx
        )
        result.superseded++
      })
      continue
    }
```

(c) `runForProject` in `layer2.service.ts` builds its return object from `result` (lines 140-145) — add `superseded: result.superseded` there and to `Layer2ProjectResult` (line 14-19) so the count propagates. Update any test asserting the full `Layer2ProjectResult` shape.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/services/memory/layer2-extract-schema.test.ts __tests__/lib/services/memory/layer2-apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer2-extract.ts lib/services/memory/layer2-apply.ts lib/services/memory/layer2.service.ts __tests__/lib/services/memory/layer2-extract-schema.test.ts __tests__/lib/services/memory/layer2-apply.test.ts
git commit -m "feat: add SUPERSEDE to Layer 2 op schema + apply [LUM-324]"
```

---

## Task 10: Layer 2 two-pass — candidates + reconcile + prompts

**Files:**
- Modify: `lib/services/memory/layer2-extract.ts` (candidate schema + `extractLayer2Candidates` + `reconcileLayer2Candidates`; remove `extractLayer2Operations`)
- Modify: `lib/services/memory/layer2-prompt.ts` (`buildLayer2Prompt` → `buildLayer2ExtractPrompt`, drop existing-PROJECT-memory block + operations framing, output `candidates` carrying `sourceMemoryIds`)
- Create: `lib/services/memory/layer2-reconcile-prompt.ts`
- Test: `__tests__/lib/services/memory/layer2-candidates.test.ts`, `__tests__/lib/services/memory/layer2-reconcile.test.ts`; update `__tests__/lib/services/memory/layer2-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/services/memory/layer2-candidates.test.ts
const generateObjectMock = jest.fn()
jest.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObjectMock(...a) }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import {
  extractLayer2Candidates,
  layer2CandidatesOutputSchema,
} from '@/lib/services/memory/layer2-extract'

const input = {
  project: { id: 'p1', name: 'P', workspaceId: 'w1' },
  taskMemories: [{ id: 'tm_1', taskId: 't1', category: 'TRAP' as const, content: { trigger: 'x', outcome: 'y' } }],
  existingProjectMemories: [],
  constitution: { claudeMd: null, agentsMd: null },
}

beforeEach(() => {
  generateObjectMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('extractLayer2Candidates', () => {
  it('returns model candidates incl. sourceMemoryIds', async () => {
    generateObjectMock.mockResolvedValue({
      object: { candidates: [{ category: 'TRAP', content: { trigger: 'x', outcome: 'y' }, sourceMemoryIds: ['tm_1'] }] },
    })
    const out = await extractLayer2Candidates(input)
    expect(out[0]!.sourceMemoryIds).toEqual(['tm_1'])
  })

  it('degrades to [] on model error', async () => {
    generateObjectMock.mockRejectedValue(new Error('down'))
    expect(await extractLayer2Candidates(input)).toEqual([])
  })

  it('candidate schema allows omitting sourceMemoryIds', () => {
    expect(() =>
      layer2CandidatesOutputSchema.parse({ candidates: [{ category: 'CONVENTION', content: { rule: 'r', scope: 's' } }] })
    ).not.toThrow()
  })
})
```

```ts
// __tests__/lib/services/memory/layer2-reconcile.test.ts
const generateObjectMock = jest.fn()
jest.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObjectMock(...a) }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { reconcileLayer2Candidates } from '@/lib/services/memory/layer2-extract'

beforeEach(() => {
  generateObjectMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('reconcileLayer2Candidates', () => {
  it('returns operations and forwards neighbor ids into the prompt', async () => {
    generateObjectMock.mockResolvedValue({
      object: { operations: [{ type: 'UPDATE', id: 'pm_old', content: { rule: 'r', scope: 's' } }] },
    })
    const ops = await reconcileLayer2Candidates({
      project: { id: 'p1', name: 'P' },
      candidates: [{ category: 'CONVENTION', content: { rule: 'r2', scope: 's2' }, sourceMemoryIds: ['tm_1'] }],
      neighborsByCandidate: [[{ id: 'pm_old', category: 'CONVENTION', content: { rule: 'r', scope: 's' }, score: 0.7 }]],
    })
    expect(ops).toEqual([{ type: 'UPDATE', id: 'pm_old', content: { rule: 'r', scope: 's' } }])
    const callArg = generateObjectMock.mock.calls[0]![0] as { prompt: string }
    expect(callArg.prompt).toContain('pm_old')
  })

  it('degrades to [] on model error', async () => {
    generateObjectMock.mockRejectedValue(new Error('down'))
    expect(await reconcileLayer2Candidates({ project: { id: 'p1', name: 'P' }, candidates: [], neighborsByCandidate: [] })).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/services/memory/layer2-candidates.test.ts __tests__/lib/services/memory/layer2-reconcile.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3a: Add candidate schema + Pass-1 + Pass-2** to `lib/services/memory/layer2-extract.ts` (keep `layer2OperationSchema`/`layer2OutputSchema`/`MODEL_ID`; remove old `extractLayer2Operations`):

```ts
import { buildLayer2ExtractPrompt } from './layer2-prompt'
import { buildLayer2ReconcilePrompt } from './layer2-reconcile-prompt'
import type { ScoredNeighbor } from './neighbor-retriever'

// ── Pass 1: candidate extraction ───────────────────────────────────────────

export const layer2CandidateSchema = z.object({
  category: memoryCategorySchema,
  content: z.unknown(),
  sourceMemoryIds: z.array(z.string().min(1)).optional(),
})
export const layer2CandidatesOutputSchema = z.object({
  candidates: z.array(layer2CandidateSchema),
})
export type Layer2Candidate = z.infer<typeof layer2CandidateSchema>

export async function extractLayer2Candidates(
  input: Layer2Input
): Promise<Layer2Candidate[]> {
  const { system, user } = buildLayer2ExtractPrompt(input)
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer2CandidatesOutputSchema,
      system,
      prompt: user,
    })
    return object.candidates
  } catch (error) {
    console.error(`[memory.layer2] candidate extraction failed project=${input.project.id}:`, error)
    return []
  }
}

// ── Pass 2: reconciliation ──────────────────────────────────────────────────

export interface ReconcileLayer2Input {
  project: { id: string; name: string }
  candidates: Layer2Candidate[]
  neighborsByCandidate: ScoredNeighbor[][]
}

export async function reconcileLayer2Candidates(
  input: ReconcileLayer2Input
): Promise<Layer2Operation[]> {
  const { system, user } = buildLayer2ReconcilePrompt({
    project: input.project,
    candidates: input.candidates,
    neighborsByCandidate: input.neighborsByCandidate,
  })
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer2OutputSchema,
      system,
      prompt: user,
    })
    return object.operations
  } catch (error) {
    console.error(`[memory.layer2] reconciliation failed project=${input.project.id}:`, error)
    return []
  }
}
```

- [ ] **Step 3b: Repurpose `layer2-prompt.ts`** → export `buildLayer2ExtractPrompt`. Open the file first. Apply the same transformation as Task 6 Step 3b: keep the task-memory grouping + constitution sections (Pass 1 still needs the recurring-lesson signal + must not promote what the constitution documents), but DROP the existing-PROJECT-memory block and the operations framing, and change the output to a `candidates` list where each candidate carries `category`, `content`, and `sourceMemoryIds` (the source TASK-memory ids it was synthesized from). Update the final instruction to `Return { "candidates": [...] }`. Move any UPDATE/dedup examples that reference existing PROJECT memories into the reconcile prompt.

- [ ] **Step 3c: Create `lib/services/memory/layer2-reconcile-prompt.ts`** — mirror Task 7's reconcile prompt with L2 vocabulary:

```ts
import type { MemoryCategory } from '@prisma/client'

interface ReconcileInput {
  project: { id: string; name: string }
  candidates: Array<{ category: MemoryCategory; content: unknown; sourceMemoryIds?: string[] }>
  neighborsByCandidate: Array<
    Array<{ id: string; category: MemoryCategory; content: unknown; score: number }>
  >
}

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You reconcile candidate PROJECT-scope lessons against the existing PROJECT memory store.

You are given CANDIDATES (recurring lessons proposed for promotion to project scope). For each candidate you see its NEIGHBORS — the most similar existing PROJECT memories (with ids). Decide one operation per candidate. Output a flat JSON list of operations.

# Operations
- ADD — genuinely new project lesson; no neighbor covers it. Provide { category, content, sourceMemoryIds? } (keep the candidate's sourceMemoryIds — they record which task memories it came from).
- UPDATE — a neighbor says almost the same thing; refine it. Provide the neighbor's id + replacement content (SAME category). Never ADD a near-duplicate.
- SUPERSEDE — a neighbor is contradicted/outdated; replace it. Provide the neighbor's id + new content (SAME category). Same-category only.
- NOOP — already represented by a neighbor; nothing to write.

There is NO DELETE at this layer — retraction is a user action, not consolidation.

# Decision rules
- Near-duplicate → UPDATE (if it adds signal) or NOOP. Never a second ADD.
- Contradiction → SUPERSEDE that neighbor.
- No relevant neighbor → ADD.
- Only reference ids shown in that candidate's neighbor list. Never invent ids.`

export function buildLayer2ReconcilePrompt(input: ReconcileInput): BuiltPrompt {
  const blocks = input.candidates.map((c, i) => {
    const neighbors = input.neighborsByCandidate[i] ?? []
    const neighborLines = neighbors.length
      ? neighbors.map(n => `    - id=${n.id} category=${n.category} content=${JSON.stringify(n.content)}`).join('\n')
      : '    (no similar existing PROJECT memories)'
    const src = c.sourceMemoryIds?.length ? ` sourceMemoryIds=${JSON.stringify(c.sourceMemoryIds)}` : ''
    return `Candidate #${i} category=${c.category}${src}
  content=${JSON.stringify(c.content)}
  Neighbors:
${neighborLines}`
  })

  const user = `# Project: ${input.project.name}

# Candidates and their neighbors
${blocks.join('\n\n') || '(no candidates)'}

# Your output
Return { "operations": [...] } — one decision per candidate (ADD / UPDATE / SUPERSEDE / NOOP). Reference only neighbor ids shown above.`

  return { system: SYSTEM_PROMPT, user }
}
```

- [ ] **Step 3d: Update `layer2-prompt.test.ts`** to call `buildLayer2ExtractPrompt`, assert the output now talks about `candidates` and no longer renders the existing-PROJECT-memory block. (Read the file first; adapt assertions.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/services/memory/layer2-candidates.test.ts __tests__/lib/services/memory/layer2-reconcile.test.ts __tests__/lib/services/memory/layer2-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer2-extract.ts lib/services/memory/layer2-prompt.ts lib/services/memory/layer2-reconcile-prompt.ts __tests__/lib/services/memory/layer2-candidates.test.ts __tests__/lib/services/memory/layer2-reconcile.test.ts __tests__/lib/services/memory/layer2-prompt.test.ts
git commit -m "feat: Layer 2 two-pass candidate extraction + reconciliation [LUM-324]"
```

---

## Task 11: Layer 2 service — rewire `runForProject` to four-step (lease untouched)

**Files:**
- Modify: `lib/services/memory/layer2.service.ts` (`runForProject` body only — claim/release lease lines unchanged)
- Test: `__tests__/lib/services/memory/layer2.service.test.ts` and `__tests__/lib/services/memory/layer2-consolidation-race.test.ts` (existing — update mocks to two-pass; the race test asserts lease behavior, which must stay green)

- [ ] **Step 1: Update the failing tests.** In `layer2.service.test.ts`, change the extract mock to the two new functions and add a neighbor-feed assertion (read the file's existing mock setup first; preserve its lease/claim mocks):

```ts
jest.mock('@/lib/services/memory/layer2-extract', () => ({
  extractLayer2Candidates: jest.fn(),
  reconcileLayer2Candidates: jest.fn(),
}))
// ...import both; mock getLayer2Input + applyLayer2Operations as before.

it('runs extract → reconcile → apply and feeds neighbors per candidate', async () => {
  // getLayer2Input → input with one existing PROJECT memory in the pool
  // extractLayer2Candidates → one candidate
  // reconcileLayer2Candidates → [{ type: 'NOOP' }]
  // assert reconcile got neighborsByCandidate length === candidates length
  // assert applyLayer2Operations received validSourceMemoryIds from input.taskMemories
})
```

> Fill the bodies following Task 8's pattern. The race test (`layer2-consolidation-race.test.ts`) mocks at the repository lease level — it should keep passing as long as claim/release calls are untouched; if it mocks `extractLayer2Operations`, repoint that mock to `extractLayer2Candidates`/`reconcileLayer2Candidates` returning empty so the run still claims+releases the lease.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/services/memory/layer2.service.test.ts __tests__/lib/services/memory/layer2-consolidation-race.test.ts`
Expected: FAIL — service imports old `extractLayer2Operations`.

- [ ] **Step 3: Rewire `runForProject`** in `lib/services/memory/layer2.service.ts`. Keep lines 99-109 (lease claim) and 146-148 (release) EXACTLY as-is. Replace the body between them (the `try` block, lines 111-145):

```ts
import { extractLayer2Candidates, reconcileLayer2Candidates } from './layer2-extract'
import { memoryContentToText } from '@/lib/memory/content-text'
import { lexicalNeighborRetriever, NEIGHBOR_K } from './neighbor-retriever'
import type { NeighborRetriever } from './neighbor-retriever'

// module-level, next to LAYER2_LEASE_TTL_MS — the embedding swap point:
const retriever: NeighborRetriever = lexicalNeighborRetriever

// inside runForProject, replacing the old extract→apply body:
  try {
    const input = await getLayer2Input(projectId)
    if (!input) {
      logger.debug(`[memory.layer2] skip project=${projectId} reason=no-input`)
      return null
    }

    // Pass 1 — candidate project lessons, blind to existing PROJECT memories.
    const candidates = await extractLayer2Candidates(input)
    if (candidates.length === 0) {
      logger.debug(`[memory.layer2] no-candidates project=${projectId}`)
      return { added: 0, updated: 0, superseded: 0, noop: 0, skipped: 0 }
    }

    // Retrieve — per candidate, top-k similar existing PROJECT memories.
    const neighborsByCandidate = candidates.map(c =>
      retriever.retrieve(
        { category: c.category, text: memoryContentToText(c.category, c.content) },
        input.existingProjectMemories,
        NEIGHBOR_K
      )
    )

    // Pass 2 — reconcile.
    const operations = await reconcileLayer2Candidates({
      project: { id: input.project.id, name: input.project.name },
      candidates,
      neighborsByCandidate,
    })
    if (operations.length === 0) {
      logger.debug(`[memory.layer2] no-ops project=${projectId}`)
      return { added: 0, updated: 0, superseded: 0, noop: 0, skipped: 0 }
    }

    const result = await applyLayer2Operations({
      operations,
      projectId: input.project.id,
      workspaceId: input.project.workspaceId,
      existingProjectMemories: input.existingProjectMemories.map(m => ({
        id: m.id,
        category: m.category,
      })),
      validSourceMemoryIds: input.taskMemories.map(m => m.id),
      sourceSessionId,
    })

    logger.debug(`[memory.layer2] applied project=${projectId}`, result)
    return {
      added: result.added,
      updated: result.updated,
      superseded: result.superseded,
      noop: result.noop,
      skipped: result.skipped,
    }
  } finally {
    await memoryRepository.releaseLayer2Lease(projectId)
  }
```

> `Layer2ProjectResult` (line 14-19) must already include `superseded` from Task 9 Step 3c. If not, add it now.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/services/memory/layer2.service.test.ts __tests__/lib/services/memory/layer2-consolidation-race.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer2.service.ts __tests__/lib/services/memory/layer2.service.test.ts __tests__/lib/services/memory/layer2-consolidation-race.test.ts
git commit -m "feat: rewire Layer 2 service to two-pass reconcile-on-write [LUM-324]"
```

---

## Task 12: Full verification + DECISION memory + PR

**Files:** none (verification + bookkeeping)

- [ ] **Step 1: Full memory test sweep, both roots**

Run (from inside the worktree):
```bash
npx jest __tests__/lib/services/memory __tests__/lib/memory __tests__/memory.repository.supersede.test.ts
```
Expected: all PASS. Investigate and fix any red before continuing — do not proceed on a failure.

- [ ] **Step 2: Grep for stale references to the removed single-pass functions**

Run:
```bash
grep -rn "extractLayer1Operations\|extractLayer2Operations\|buildLayer1Prompt\b\|buildLayer2Prompt\b" lib app __tests__ tests
```
Expected: NO hits in `lib/`/`app/` (production). Any remaining `__tests__`/`tests` hit is a test that still calls the old name — fix it. If `app/` references either extract function (e.g. an admin reprocess route), update it to the two-pass service entrypoint.

- [ ] **Step 3: Whole-suite regression across both test roots**

Run:
```bash
npx jest
```
Expected: green. The cross-cutting risks are (a) anything importing the removed functions, (b) anything asserting the old `ApplyOperationsResult` / `Layer2ProjectResult` shape without `superseded`. Fix forward.

- [ ] **Step 4: Type check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. (`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are on — watch `neighborsByCandidate[i]` access in prompts, already guarded with `?? []`.)

- [ ] **Step 5: Confirm zero schema drift**

Run:
```bash
git diff --name-only origin/main | grep -E '^prisma/' || echo "no prisma changes (expected)"
```
Expected: `no prisma changes (expected)`. This task ships zero schema change; a prisma diff here is a mistake.

- [ ] **Step 6: Record the DECISION memory** (the task's expected output). Session is already attached to LUM-324. Run from the worktree:

```bash
lumo task memory add LUM-324 --category decision \
  --what "Memory writes: single-pass append → two-pass reconcile-on-write (extract → retrieve top-k neighbors → reconcile) on both Layer 1 and Layer 2" \
  --why "Mem0 (2504.19413): write-time reconciliation reaches near-full-context quality at ~10% the latency/token cost; the pipeline already did ADD/UPDATE/DELETE but lacked semantic neighbor retrieval and a SUPERSEDE (contradiction) op" \
  --alternatives "pgvector embeddings now / external embedding API now — rejected: local dev has no AI_GATEWAY_API_KEY so embeddings can't be generated or verified locally, and both add a dependency + schema. Chose a pluggable NeighborRetriever seam with a lexical (bigram) implementation: zero dependency, zero schema, locally testable" \
  --implications "NeighborRetriever interface reserves the embedding swap point — upgrade to EmbeddingNeighborRetriever (pgvector) when a single project's PROJECT-memory count exceeds ~50 or the LUM-329 eval shows lexical recall@k below threshold. SUPERSEDE interim-executes as UPDATE-in-place via memoryRepository.supersedeInPlace; LUM-325 swaps that seam to invalidate-not-delete. Reconcile doubles LLM calls per layer (deepseek-v4-flash, background — acceptable)"
```

> Verify the exact flag names against the memory reference before running: `lumo task memory add --help` (the skill's [memory.md](.claude/skills/lumo/references/memory.md) documents the DECISION flags). Adjust `--category`/`--what`/etc. to the real flag spelling if they differ.

- [ ] **Step 7: Push + open the PR**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-324-reconcile-on-write
git push -u origin lumo/LUM-324-reconcile-on-write
```
Then open a PR titled `feat: reconcile-on-write — two-pass neighbor retrieval + SUPERSEDE [LUM-324]`. Body must note:
  - **No schema change** (SUPERSEDE = UPDATE-in-place via `supersedeInPlace`; lifecycle fields land in LUM-325).
  - **No new npm dependency.**
  - Behavior change: memory writes are now two-pass; op distribution shifts by design.
  - Follow-ups: LUM-325 (lifecycle fields → swap `supersedeInPlace`), LUM-329 (eval → embedding-upgrade trigger).

- [ ] **Step 8: Verification gate before marking the task.** Per the team's "no done without verification" rule: the PR stays in review with the green `npx jest` + `npx tsc --noEmit` output as evidence. Do NOT mark LUM-324 DONE from "code reads complete" — wait for the run evidence and review. (Marking the task DONE also triggers Layer 2 consolidation for this very project — fitting, but make sure tests are green first.)

---

## Self-review notes (author)

- **Spec coverage:** create-time neighbor retrieval (Tasks 1-2, wired in 8/11) ✓; 4-op incl. SUPERSEDE (Tasks 4, 7, 9, 10) ✓; dup→UPDATE/NOOP, contradiction→SUPERSEDE (reconcile prompts, Tasks 7/10) ✓; triggers + lease untouched (Tasks 8/11 keep claim/release; race test stays green) ✓; both layers (Tasks 4-8 L1, 9-11 L2) ✓; zero schema (Task 12 Step 5 guard) ✓; pluggable embedding seam + trigger (Task 2 + DECISION in Task 12) ✓; SUPERSEDE→UPDATE-in-place, 325 swap (Task 3 seam) ✓.
- **Type consistency:** `ApplyOperationsResult` gains `superseded` in BOTH layers (Tasks 5 + 9) and propagates to `Layer2ProjectResult` (Task 9c/11). `extractLayer{1,2}Candidates` return `Layer{1,2}Candidate[]`; `reconcileLayer{1,2}Candidates` return `Layer{1,2}Operation[]`; `ScoredNeighbor` is the shared retriever output consumed by both reconcile inputs.
- **Known coupling to fix forward:** any caller of the removed `extractLayer{1,2}Operations` (Task 12 Step 2 grep) and any test asserting the pre-`superseded` result shape (Task 12 Step 3).
