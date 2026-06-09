# Manual `memory add` Reconcile + English-Canonical Cross-Language Dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **AMENDED 2026-06-09 (measurement):** The live cross-language eval (Task 8b) measured ZH↔EN synonym cosine = **0.886 (min 0.821), all above the 0.78 floor** — so cross-language dedup already works at the embedding layer and root cause (b) does NOT hold. Effects on this plan: (1) **Task 9b (existing-corpus canonicalization backfill) is DROPPED** — dedup needs no backfill; existing-row normalization is a deferred optional convention follow-up. (2) English-canonicalization (Tasks 1, 3-canon, 4) is KEPT but reframed as a **workspace convention** (single-language store), not a dedup correctness fix. (3) Task 8 was fixed to exclude the xlang cases from the same-language AR calibration (which stays at floor 0.78). Tasks 1–8b as written are otherwise correct; read the goal/architecture below through this amendment.

**Goal:** Make manual `lumo memory add` reconcile against existing memories (hybrid-gated) and normalize all human-written memory content to English, so near-duplicate (incl. cross-language ZH↔EN) facts stop creating second rows.

**Architecture:** Two new gateway-deferring modules — `canonicalize-language.ts` (translate non-English content → English) and `manual-dedup.ts` (retrieve neighbors → minimal LLM reconcile → ADD/UPDATE/SUPERSEDE/NOOP). Both **dynamic-import** the AI gateway *inside their functions*, so static-importing them stays jest-safe. `memory-management.service.ts` calls canonicalize on every human-content write and dedup on the two create paths. The store becomes uniformly English, so dedup degrades to same-language and the existing `EMBEDDING_SCORE_FLOOR=0.78` works as calibrated.

**Tech Stack:** TypeScript (strict), Next.js App Router API routes, Prisma (Neon Postgres + pgvector), Vercel AI Gateway (`@ai-sdk/gateway` + `ai`'s `generateObject`/`embedMany`), deepseek-v4-flash (reconcile + translate) / qwen3-embedding-0.6b (embeddings), Jest, the `lumo` CLI (`cli/src`).

**Worktree:** `.worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup` on branch `lumo/LUM-336-manual-add-reconcile-cross-lang-dedup` (already created). Run ALL `jest`/`tsc`/git commands from INSIDE this worktree (`cd` first), per the worktree gotchas.

---

## File Structure

**Create:**
- `lib/services/memory/canonicalize-language.ts` — `canonicalizeToEnglish(category, content)` + `containsCjk(text)`. Dynamic-imports gateway inside.
- `lib/services/memory/manual-dedup.ts` — `resolveManualDedup(input)` → `ManualDedupResolution`. Static-imports `compositeNeighborRetriever` + `reconcile-parse` (both gateway-free); dynamic-imports gateway inside the reconcile call.
- `__tests__/memory-canonicalize-language.test.ts`
- `__tests__/memory-manual-dedup.test.ts`

**Modify:**
- `lib/services/memory-management.service.ts` — wire canonicalize into all 4 write paths; wire dedup into `createForProject`/`createForTask`; change their return type to `{ outcome, memory: { id } }`.
- `__tests__/memory-management.service.test.ts` — extend.
- `app/api/projects/[id]/memories/route.ts` + `app/api/tasks/[id]/memories/route.ts` — return `outcome`.
- `lib/api-client/memories.ts` — create return types gain `outcome`.
- `cli/src/commands/memory-project-add.ts` + `cli/src/commands/memory-task-add.ts` — print the dedup outcome line.
- `.claude/skills/lumo/SKILL.md` — document the new dedup/canonicalization behavior + output lines.
- `scripts/eval/memory/eval-set.ts` — add ZH↔EN synonym pairs.
- `scripts/eval/memory/eval-set.test.ts` — assert cross-language coverage.
- `scripts/eval/memory/run.ts` — add cross-lingual cosine before/after report.
- `scripts/eval/memory/vectors.fixture.json` — regenerate (live, key-gated).

**No schema change. No new npm dependency.**

---

## Task 1: `canonicalize-language.ts` — translate non-English content to English

**Files:**
- Create: `lib/services/memory/canonicalize-language.ts`
- Test: `__tests__/memory-canonicalize-language.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/memory-canonicalize-language.test.ts`:

```ts
// Mock the gateway + ai BEFORE importing the module under test so the real
// @ai-sdk/gateway (TransformStream) never loads in jest.
const mockGenerateObject = jest.fn()
jest.mock('ai', () => ({ generateObject: (...a: any[]) => mockGenerateObject(...a) }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import {
  canonicalizeToEnglish,
  containsCjk,
} from '@/lib/services/memory/canonicalize-language'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('containsCjk', () => {
  it('detects Chinese characters', () => {
    expect(containsCjk('手动 add 绕过 reconcile')).toBe(true)
  })
  it('returns false for pure ASCII/English', () => {
    expect(containsCjk('Manual add bypasses reconcile')).toBe(false)
  })
})

describe('canonicalizeToEnglish', () => {
  it('returns English content unchanged WITHOUT calling the LLM', async () => {
    const content = { trigger: 'Merging a schema PR', outcome: 'prod drifts' }
    const out = await canonicalizeToEnglish('TRAP', content)
    expect(out).toEqual(content)
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('translates Chinese content to English via the LLM', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { trigger: 'Merging a schema PR', outcome: 'prod schema drifts' },
    })
    const out = await canonicalizeToEnglish('TRAP', {
      trigger: '合并 schema PR',
      outcome: '生产 schema 漂移',
    })
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ trigger: 'Merging a schema PR', outcome: 'prod schema drifts' })
  })

  it('fail-open: returns the ORIGINAL content when the LLM throws', async () => {
    mockGenerateObject.mockRejectedValue(new Error('gateway down'))
    const original = { trigger: '合并 schema PR', outcome: '生产漂移' }
    const out = await canonicalizeToEnglish('TRAP', original)
    expect(out).toBe(original)
  })

  it('fail-open: returns the ORIGINAL content when the translation fails schema validation', async () => {
    // Missing required `outcome` → parseMemoryContent throws → keep original.
    mockGenerateObject.mockResolvedValue({ object: { trigger: 'only trigger' } })
    const original = { trigger: '触发', outcome: '后果' }
    const out = await canonicalizeToEnglish('TRAP', original)
    expect(out).toBe(original)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest memory-canonicalize-language -i`
Expected: FAIL — `Cannot find module '@/lib/services/memory/canonicalize-language'`.

- [ ] **Step 3: Write the implementation**

Create `lib/services/memory/canonicalize-language.ts`:

```ts
import { logger } from '@/lib/logger'
import {
  parseMemoryContent,
  trapContentSchema,
  decisionContentSchema,
  conventionContentSchema,
  proceduralContentSchema,
} from '@/lib/memory/schemas'
import { memoryContentToText } from '@/lib/memory/content-text'
import type { MemoryCategory } from '@prisma/client'
import type { MemoryContent } from '@/lib/memory/schemas'
import type { z } from 'zod'

/** deepseek-v4-flash via the gateway — same model as the auto reconcile path. */
const MODEL_ID = 'deepseek/deepseek-v4-flash'

const schemaByCategory: Record<MemoryCategory, z.ZodTypeAny> = {
  TRAP: trapContentSchema,
  DECISION: decisionContentSchema,
  CONVENTION: conventionContentSchema,
  PROCEDURAL: proceduralContentSchema,
}

/**
 * CJK detection. Lumo's store is bilingual EN/ZH; CJK presence is the reliable
 * "needs translation" discriminator (a pure-ASCII heuristic would misfire on
 * accented English, but the real-world non-English content here is Chinese).
 * Covers CJK Unified Ideographs + common punctuation/Hiragana/Katakana ranges.
 */
export function containsCjk(text: string): boolean {
  return /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/.test(
    text
  )
}

/**
 * Normalize a structured memory content object to English (LUM-336). If the
 * flattened text contains no CJK, the content is assumed already-English and
 * returned unchanged with NO LLM call. Otherwise an LLM translates each string
 * field to English while preserving the per-category schema shape and keys; the
 * result is re-validated via parseMemoryContent.
 *
 * fail-open: any failure (no key / gateway down / invalid translation) returns
 * the ORIGINAL content unchanged. A manual write must never be lost or blocked
 * by a translation failure.
 *
 * The gateway is dynamic-imported INSIDE the function so static-importing this
 * module stays jest-safe (the real @ai-sdk/gateway crashes jest via
 * TransformStream).
 */
export async function canonicalizeToEnglish(
  category: MemoryCategory,
  content: MemoryContent | unknown
): Promise<MemoryContent | unknown> {
  const text = memoryContentToText(category, content)
  if (!text || !containsCjk(text)) return content
  try {
    const { generateObject } = await import('ai')
    const { gateway } = await import('@ai-sdk/gateway')
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: schemaByCategory[category],
      system:
        'You translate structured developer-memory records into English. ' +
        'Translate the VALUE of every natural-language string field into clear, ' +
        'idiomatic English. Preserve the object shape and keys EXACTLY — do not ' +
        'add, drop, or rename keys. Keep code identifiers, file paths, command ' +
        'names, and proper nouns verbatim. If a value is already English, return ' +
        'it unchanged.',
      prompt: JSON.stringify(content),
    })
    // Re-validate against the strict per-category schema; on success return the
    // translated content, else fall through to the original.
    return parseMemoryContent(category, object)
  } catch (err) {
    logger.warn(
      `[memory.canonicalize] translation skipped for category=${category} — keeping original:`,
      err instanceof Error ? err.message : err
    )
    return content
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest memory-canonicalize-language -i`
Expected: PASS (4 + 2 assertions green).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add lib/services/memory/canonicalize-language.ts __tests__/memory-canonicalize-language.test.ts
git -C "$PWD" commit -m "feat: canonicalize-to-English helper for memory writes [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `manual-dedup.ts` — hybrid-gated dedup resolution

**Files:**
- Create: `lib/services/memory/manual-dedup.ts`
- Test: `__tests__/memory-manual-dedup.test.ts`

**Contract:**

```ts
export type ManualDedupResolution =
  | { kind: 'ADD' }
  | { kind: 'UPDATE'; id: string; content: MemoryContent }
  | { kind: 'SUPERSEDE'; id: string; content: MemoryContent }
  | { kind: 'NOOP'; id: string }
```

`ADD` → caller does the plain create. `UPDATE`/`SUPERSEDE` carry the target neighbor id + validated content. `NOOP` carries the duplicate neighbor's id (for CLI messaging). Anything uncertain fails open to `ADD`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/memory-manual-dedup.test.ts`:

```ts
const mockRetrieve = jest.fn()
jest.mock('@/lib/services/memory/embedding-neighbor-retriever', () => ({
  compositeNeighborRetriever: { retrieve: (...a: any[]) => mockRetrieve(...a) },
}))
const mockGenerateObject = jest.fn()
jest.mock('ai', () => ({ generateObject: (...a: any[]) => mockGenerateObject(...a) }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { resolveManualDedup } from '@/lib/services/memory/manual-dedup'

const baseInput = () => ({
  category: 'TRAP' as const,
  content: { trigger: 'x', outcome: 'y' },
  candidateText: 'x y',
  candidateVector: [0.1, 0.2] as number[] | undefined,
  pool: [{ id: 'n1', category: 'TRAP' as const, content: { trigger: 'x2', outcome: 'y2' } }],
  scope: { kind: 'PROJECT' as const, projectId: 'p1' },
})

beforeEach(() => {
  jest.clearAllMocks()
})

it('no neighbors → ADD (no LLM call)', async () => {
  mockRetrieve.mockResolvedValue([])
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'ADD' })
  expect(mockGenerateObject).not.toHaveBeenCalled()
})

it('neighbor + reconcile NOOP → NOOP referencing the top neighbor id', async () => {
  mockRetrieve.mockResolvedValue([{ id: 'n1', category: 'TRAP', content: {}, score: 0.9 }])
  mockGenerateObject.mockResolvedValue({ object: { operations: [{ type: 'NOOP' }] } })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'NOOP', id: 'n1' })
})

it('neighbor + reconcile UPDATE → UPDATE with validated content', async () => {
  mockRetrieve.mockResolvedValue([{ id: 'n1', category: 'TRAP', content: {}, score: 0.9 }])
  mockGenerateObject.mockResolvedValue({
    object: { operations: [{ type: 'UPDATE', id: 'n1', content: { trigger: 'merged', outcome: 'merged out' } }] },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'UPDATE', id: 'n1', content: { trigger: 'merged', outcome: 'merged out' } })
})

it('reconcile SUPERSEDE → SUPERSEDE', async () => {
  mockRetrieve.mockResolvedValue([{ id: 'n1', category: 'TRAP', content: {}, score: 0.9 }])
  mockGenerateObject.mockResolvedValue({
    object: { operations: [{ type: 'SUPERSEDE', id: 'n1', content: { trigger: 't', outcome: 'o' } }] },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'SUPERSEDE', id: 'n1', content: { trigger: 't', outcome: 'o' } })
})

it('UPDATE targeting an id NOT among neighbors → ADD (fail-open)', async () => {
  mockRetrieve.mockResolvedValue([{ id: 'n1', category: 'TRAP', content: {}, score: 0.9 }])
  mockGenerateObject.mockResolvedValue({
    object: { operations: [{ type: 'UPDATE', id: 'GHOST', content: { trigger: 't', outcome: 'o' } }] },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'ADD' })
})

it('UPDATE whose content fails the category schema → ADD (fail-open)', async () => {
  mockRetrieve.mockResolvedValue([{ id: 'n1', category: 'TRAP', content: {}, score: 0.9 }])
  mockGenerateObject.mockResolvedValue({
    object: { operations: [{ type: 'UPDATE', id: 'n1', content: { trigger: 'only' } }] },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'ADD' })
})

it('reconcile throws → ADD (fail-open)', async () => {
  mockRetrieve.mockResolvedValue([{ id: 'n1', category: 'TRAP', content: {}, score: 0.9 }])
  mockGenerateObject.mockRejectedValue(new Error('gateway down'))
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'ADD' })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest memory-manual-dedup -i`
Expected: FAIL — `Cannot find module '@/lib/services/memory/manual-dedup'`.

- [ ] **Step 3: Write the implementation**

Create `lib/services/memory/manual-dedup.ts`:

```ts
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { parseMemoryContent } from '@/lib/memory/schemas'
import { compositeNeighborRetriever } from './embedding-neighbor-retriever'
import { NEIGHBOR_K } from './neighbor-retriever'
import {
  LOOSE_RECONCILE_OUTPUT,
  parseReconcileOperations,
} from './reconcile-parse'
import type { NeighborScope, ScoredNeighbor } from './neighbor-retriever'
import type { MemoryCategory } from '@prisma/client'
import type { MemoryContent } from '@/lib/memory/schemas'

/** deepseek-v4-flash via the gateway — same model as the auto reconcile path. */
const MODEL_ID = 'deepseek/deepseek-v4-flash'

/**
 * Op vocabulary for the manual single-candidate dedup. Defined LOCALLY (not
 * imported from layer2-extract) because that module static-imports the gateway;
 * keeping the schema here lets this module stay statically importable in jest.
 * No DELETE — a manual add never retracts an unrelated existing memory.
 */
const manualDedupOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ADD') }),
  z.object({ type: z.literal('UPDATE'), id: z.string().min(1), content: z.unknown() }),
  z.object({ type: z.literal('SUPERSEDE'), id: z.string().min(1), content: z.unknown() }),
  z.object({ type: z.literal('NOOP') }),
])

export type ManualDedupResolution =
  | { kind: 'ADD' }
  | { kind: 'UPDATE'; id: string; content: MemoryContent }
  | { kind: 'SUPERSEDE'; id: string; content: MemoryContent }
  | { kind: 'NOOP'; id: string }

export interface ResolveManualDedupInput {
  category: MemoryCategory
  /** The (already English-canonicalized) candidate content being added. */
  content: unknown
  /** Flattened candidate text — query for retrieval. */
  candidateText: string
  /** Candidate embedding when available (else lexical retrieval). */
  candidateVector: number[] | undefined
  /** ACTIVE existing memories in scope (lexical pool). */
  pool: Array<{ id: string; category: MemoryCategory; content: unknown }>
  scope: NeighborScope
}

function buildPrompt(
  category: MemoryCategory,
  content: unknown,
  neighbors: ScoredNeighbor[]
): { system: string; user: string } {
  const system =
    'You de-duplicate a single new developer-memory record against its nearest ' +
    'existing records. Return a JSON object {"operations":[op]} with EXACTLY ONE ' +
    'operation, where op.type is one of:\n' +
    '- "NOOP": the new record says nothing the listed records do not already say (duplicate).\n' +
    '- "UPDATE": the new record refines/extends ONE listed record — set op.id to that record id and op.content to the merged content (same field shape).\n' +
    '- "SUPERSEDE": the new record directly CONTRADICTS ONE listed record — set op.id to that record id and op.content to the corrected content.\n' +
    '- "ADD": the new record is distinct from all listed records.\n' +
    'op.id MUST be one of the listed record ids. Use the discriminator key "type" ' +
    '(never "operation"). Prefer ADD when unsure.'
  const user = JSON.stringify({
    category,
    newRecord: content,
    existingRecords: neighbors.map(n => ({
      id: n.id,
      category: n.category,
      content: n.content,
    })),
  })
  return { system, user }
}

/**
 * Hybrid-gated dedup for a manual memory add (LUM-336). Retrieve top-k neighbors
 * (embedding → lexical); if none clear the floor, ADD (zero LLM). Otherwise ask
 * the reconcile LLM for a single op and map it to a resolution. Any uncertainty
 * (LLM error, unknown target id, content failing the category schema, NOOP with
 * no neighbor) fails open to ADD so a manual add is never silently dropped.
 *
 * Gateway is dynamic-imported INSIDE the function (jest-safety; matches the auto
 * path's deferral pattern).
 */
export async function resolveManualDedup(
  input: ResolveManualDedupInput
): Promise<ManualDedupResolution> {
  let neighbors: ScoredNeighbor[]
  try {
    neighbors = await compositeNeighborRetriever.retrieve({
      query: {
        category: input.category,
        text: input.candidateText,
        vector: input.candidateVector,
      },
      pool: input.pool,
      scope: input.scope,
      k: NEIGHBOR_K,
    })
  } catch (err) {
    logger.warn(
      '[memory.manual-dedup] retrieval failed — defaulting to ADD:',
      err instanceof Error ? err.message : err
    )
    return { kind: 'ADD' }
  }
  if (neighbors.length === 0) return { kind: 'ADD' }

  const neighborIds = new Set(neighbors.map(n => n.id))
  const { system, user } = buildPrompt(input.category, input.content, neighbors)

  try {
    const { generateObject } = await import('ai')
    const { gateway } = await import('@ai-sdk/gateway')
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: LOOSE_RECONCILE_OUTPUT,
      system,
      prompt: user,
    })
    const ops = parseReconcileOperations(
      object.operations,
      manualDedupOpSchema,
      'memory.manual-dedup'
    )
    const op = ops[0]
    if (!op || op.type === 'ADD') return { kind: 'ADD' }
    if (op.type === 'NOOP') return { kind: 'NOOP', id: neighbors[0]!.id }
    // UPDATE / SUPERSEDE — target must be a real neighbor; content must validate
    // against the candidate category (apply re-validates against the existing
    // row's category, which equals candidate category for a same-category merge).
    if (!neighborIds.has(op.id)) return { kind: 'ADD' }
    let validated: MemoryContent
    try {
      validated = parseMemoryContent(input.category, op.content)
    } catch {
      return { kind: 'ADD' }
    }
    return op.type === 'UPDATE'
      ? { kind: 'UPDATE', id: op.id, content: validated }
      : { kind: 'SUPERSEDE', id: op.id, content: validated }
  } catch (err) {
    logger.warn(
      '[memory.manual-dedup] reconcile failed — defaulting to ADD:',
      err instanceof Error ? err.message : err
    )
    return { kind: 'ADD' }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest memory-manual-dedup -i`
Expected: PASS (7 tests green).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add lib/services/memory/manual-dedup.ts __tests__/memory-manual-dedup.test.ts
git -C "$PWD" commit -m "feat: hybrid-gated manual-add dedup resolver [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire canonicalize + dedup into `createForProject` / `createForTask`

**Files:**
- Modify: `lib/services/memory-management.service.ts`
- Test: `__tests__/memory-management.service.test.ts`

**Return-type change:** `createForProject` / `createForTask` now return
`Promise<{ outcome: 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'NOOP'; memory: { id: string } }>`.

- [ ] **Step 1: Write the failing tests** (append to `__tests__/memory-management.service.test.ts`)

First add the module mocks at the TOP of the file (next to the existing `jest.mock` calls):

```ts
const mockCanonicalize = jest.fn()
jest.mock('@/lib/services/memory/canonicalize-language', () => ({
  canonicalizeToEnglish: (...a: any[]) => mockCanonicalize(...a),
}))
const mockResolveDedup = jest.fn()
jest.mock('@/lib/services/memory/manual-dedup', () => ({
  resolveManualDedup: (...a: any[]) => mockResolveDedup(...a),
}))
const mockUpdateContent = jest.fn()
const mockSupersede = jest.fn()
```

Add `updateContent` + `supersede` to the existing `memory.repository` mock object:

```ts
    updateContent: (...a: any[]) => mockUpdateContent(...a),
    supersede: (...a: any[]) => mockSupersede(...a),
```

Extend `beforeEach` defaults (so existing create tests still pass — default = pass-through canonicalize + ADD):

```ts
  mockCanonicalize.mockImplementation(async (_cat: any, content: any) => content)
  mockResolveDedup.mockResolvedValue({ kind: 'ADD' })
  mockUpdateContent.mockResolvedValue({ id: 'u1' })
  mockSupersede.mockResolvedValue({ newId: 'sup1' })
```

> NOTE: the existing `createForProject`/`createForTask` tests assert on `mockCreate`
> being called with the row + the returned value. Update those existing assertions
> to read the new shape: `expect(result).toEqual({ outcome: 'ADD', memory: { id: 'm1' } })`
> and keep the `mockCreate` argument assertion as-is (ADD still calls create).

Then add new tests:

```ts
describe('createForProject — canonicalize + dedup', () => {
  it('canonicalizes content before storing (ADD path)', async () => {
    mockCanonicalize.mockResolvedValue({ trigger: 'EN trigger', outcome: 'EN outcome' })
    mockResolveDedup.mockResolvedValue({ kind: 'ADD' })
    mockCreate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.createForProject({
      projectId: 'p1', workspaceId: 'w1', category: 'TRAP',
      content: { trigger: '触发', outcome: '后果' }, actorMemberId: 'mem1',
    })
    expect(mockCanonicalize).toHaveBeenCalledWith('TRAP', { trigger: '触发', outcome: '后果' })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ content: { trigger: 'EN trigger', outcome: 'EN outcome' } })
    )
  })

  it('NOOP → no create, returns the duplicate neighbor id', async () => {
    mockResolveDedup.mockResolvedValue({ kind: 'NOOP', id: 'dup1' })
    const r = await memoryManagementService.createForProject({
      projectId: 'p1', workspaceId: 'w1', category: 'TRAP',
      content: { trigger: 't', outcome: 'o' }, actorMemberId: 'mem1',
    })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(r).toEqual({ outcome: 'NOOP', memory: { id: 'dup1' } })
  })

  it('UPDATE → updateContent on the neighbor, returns its id', async () => {
    mockResolveDedup.mockResolvedValue({ kind: 'UPDATE', id: 'n1', content: { trigger: 't', outcome: 'o' } })
    const r = await memoryManagementService.createForProject({
      projectId: 'p1', workspaceId: 'w1', category: 'TRAP',
      content: { trigger: 't', outcome: 'o' }, actorMemberId: 'mem1',
    })
    expect(mockUpdateContent).toHaveBeenCalledWith('n1', { trigger: 't', outcome: 'o' })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(r).toEqual({ outcome: 'UPDATE', memory: { id: 'n1' } })
  })

  it('SUPERSEDE → supersede on the neighbor, returns the new id', async () => {
    mockResolveDedup.mockResolvedValue({ kind: 'SUPERSEDE', id: 'n1', content: { trigger: 't', outcome: 'o' } })
    mockSupersede.mockResolvedValue({ newId: 'new9' })
    const r = await memoryManagementService.createForProject({
      projectId: 'p1', workspaceId: 'w1', category: 'TRAP',
      content: { trigger: 't', outcome: 'o' }, actorMemberId: 'mem1',
    })
    expect(mockSupersede).toHaveBeenCalledWith('n1', { trigger: 't', outcome: 'o' })
    expect(r).toEqual({ outcome: 'SUPERSEDE', memory: { id: 'new9' } })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest memory-management.service -i`
Expected: FAIL — new assertions + return-shape mismatches.

- [ ] **Step 3: Implement** — edit `lib/services/memory-management.service.ts`

Add imports at the top:

```ts
import { memoryContentToText } from '@/lib/memory/content-text'
import { canonicalizeToEnglish } from './memory/canonicalize-language'
import { resolveManualDedup } from './memory/manual-dedup'
import type { MemoryCategory, TaskArtifactAgent } from '@prisma/client'
```

(The file already imports `memoryRepository`, `embedTexts`, `logger`, types. Keep `memoryContentToText` import once — it may already be transitively used; add if absent.)

Add the shared result type + helper near the top of the module (after `httpError`):

```ts
export type CreateOutcome = 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'NOOP'
export interface CreateMemoryResult {
  outcome: CreateOutcome
  memory: { id: string }
}

/** Embed the (canonical) candidate text once for retrieval; undefined on failure
 * (retrieval then degrades to lexical). Never throws. */
async function embedCandidate(text: string): Promise<number[] | undefined> {
  if (!text) return undefined
  try {
    const [v] = await embedTexts([text])
    return v
  } catch {
    return undefined
  }
}
```

Replace `createForProject`:

```ts
  async createForProject(
    input: CreateForProjectInput
  ): Promise<CreateMemoryResult> {
    const content = await canonicalizeToEnglish(input.category, input.content)
    const text = memoryContentToText(input.category, content)
    const vector = await embedCandidate(text)
    const pool = (await memoryRepository.listForProject(input.projectId)).map(
      m => ({ id: m.id, category: m.category, content: m.content })
    )
    const resolution = await resolveManualDedup({
      category: input.category,
      content,
      candidateText: text,
      candidateVector: vector,
      pool,
      scope: { kind: 'PROJECT', projectId: input.projectId },
    })

    if (resolution.kind === 'NOOP') {
      return { outcome: 'NOOP', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'UPDATE') {
      await memoryRepository.updateContent(
        resolution.id,
        resolution.content as Prisma.InputJsonValue
      )
      await stampEmbeddingBestEffort(resolution.id, input.category, resolution.content)
      return { outcome: 'UPDATE', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'SUPERSEDE') {
      const { newId } = await memoryRepository.supersede(
        resolution.id,
        resolution.content as Prisma.InputJsonValue
      )
      await stampEmbeddingBestEffort(newId, input.category, resolution.content)
      return { outcome: 'SUPERSEDE', memory: { id: newId } }
    }
    // ADD
    const created = await memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: null,
      scope: 'PROJECT',
      category: input.category,
      content: content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
      agent: input.agent,
    })
    await stampEmbeddingBestEffort(created.id, input.category, content)
    return { outcome: 'ADD', memory: { id: created.id } }
  },
```

Replace `createForTask` analogously — the ONLY differences: `taskId: input.taskId`, `scope: 'TASK'`, the pool comes from `listForTask(input.taskId)`, and the dedup scope is `{ kind: 'TASK', taskId: input.taskId }`:

```ts
  async createForTask(
    input: CreateForTaskInput
  ): Promise<CreateMemoryResult> {
    const content = await canonicalizeToEnglish(input.category, input.content)
    const text = memoryContentToText(input.category, content)
    const vector = await embedCandidate(text)
    const pool = (await memoryRepository.listForTask(input.taskId)).map(m => ({
      id: m.id,
      category: m.category,
      content: m.content,
    }))
    const resolution = await resolveManualDedup({
      category: input.category,
      content,
      candidateText: text,
      candidateVector: vector,
      pool,
      scope: { kind: 'TASK', taskId: input.taskId },
    })

    if (resolution.kind === 'NOOP') {
      return { outcome: 'NOOP', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'UPDATE') {
      await memoryRepository.updateContent(
        resolution.id,
        resolution.content as Prisma.InputJsonValue
      )
      await stampEmbeddingBestEffort(resolution.id, input.category, resolution.content)
      return { outcome: 'UPDATE', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'SUPERSEDE') {
      const { newId } = await memoryRepository.supersede(
        resolution.id,
        resolution.content as Prisma.InputJsonValue
      )
      await stampEmbeddingBestEffort(newId, input.category, resolution.content)
      return { outcome: 'SUPERSEDE', memory: { id: newId } }
    }
    const created = await memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      scope: 'TASK',
      category: input.category,
      content: content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
      agent: input.agent,
    })
    await stampEmbeddingBestEffort(created.id, input.category, content)
    return { outcome: 'ADD', memory: { id: created.id } }
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest memory-management.service -i`
Expected: PASS (existing create tests updated to new shape + 5 new tests).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add lib/services/memory-management.service.ts __tests__/memory-management.service.test.ts
git -C "$PWD" commit -m "feat: wire canonicalize + dedup into manual memory create paths [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Canonicalize on `editContent` / `promoteToProject`

**Files:**
- Modify: `lib/services/memory-management.service.ts`
- Test: `__tests__/memory-management.service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('editContent — canonicalize', () => {
  it('canonicalizes the new content before update', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', category: 'TRAP' })
    mockCanonicalize.mockResolvedValue({ trigger: 'EN', outcome: 'EN out' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.editContent('m1', { trigger: '中', outcome: '文' })
    expect(mockCanonicalize).toHaveBeenCalledWith('TRAP', { trigger: '中', outcome: '文' })
    expect(mockUpdate).toHaveBeenCalledWith('m1', { content: { trigger: 'EN', outcome: 'EN out' } })
  })
})

describe('promoteToProject — canonicalize on content override', () => {
  it('canonicalizes the overridden content', async () => {
    mockFindByIdWithWorkspace.mockResolvedValue({ id: 'm1', category: 'TRAP', scope: 'TASK' })
    mockCanonicalize.mockResolvedValue({ trigger: 'EN', outcome: 'EN out' })
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryManagementService.promoteToProject('m1', { trigger: '中', outcome: '文' })
    expect(mockCanonicalize).toHaveBeenCalledWith('TRAP', { trigger: '中', outcome: '文' })
    expect(mockUpdate).toHaveBeenCalledWith('m1', expect.objectContaining({
      scope: 'PROJECT', taskId: null, content: { trigger: 'EN', outcome: 'EN out' },
    }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest memory-management.service -i -t canonicalize`
Expected: FAIL.

- [ ] **Step 3: Implement** — edit `editContent` and `promoteToProject`

`editContent` (canonicalize using the existing row's category, before update):

```ts
  async editContent(memoryId: string, content: MemoryContent) {
    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    const canonical = existing
      ? await canonicalizeToEnglish(existing.category, content)
      : content
    const updated = await memoryRepository.update(memoryId, {
      content: canonical as Prisma.InputJsonValue,
    })
    if (existing) {
      await stampEmbeddingBestEffort(memoryId, existing.category, canonical)
    }
    return updated
  },
```

`promoteToProject` (canonicalize the override when present):

```ts
  async promoteToProject(memoryId: string, content?: MemoryContent) {
    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    if (!existing) throw httpError('Not found', 404)
    if (existing.scope === 'PROJECT') {
      throw httpError('Memory is already project-scoped', 409)
    }
    const canonical =
      content !== undefined
        ? await canonicalizeToEnglish(existing.category, content)
        : undefined
    const updated = await memoryRepository.update(memoryId, {
      scope: 'PROJECT',
      taskId: null,
      ...(canonical !== undefined
        ? { content: canonical as Prisma.InputJsonValue }
        : {}),
    })
    if (canonical !== undefined) {
      await stampEmbeddingBestEffort(memoryId, existing.category, canonical)
    }
    return updated
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest memory-management.service -i`
Expected: PASS (all service tests).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add lib/services/memory-management.service.ts __tests__/memory-management.service.test.ts
git -C "$PWD" commit -m "feat: canonicalize edit/promote memory content to English [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: API routes return the dedup `outcome`

**Files:**
- Modify: `app/api/projects/[id]/memories/route.ts`
- Modify: `app/api/tasks/[id]/memories/route.ts`

- [ ] **Step 1: Implement (project route)** — change the POST success block

Replace:

```ts
    const memory = await memoryManagementService.createForProject({
      projectId: id,
      workspaceId: identity.workspaceId,
      category: parsed.data.category,
      content,
      actorMemberId: identity.memberId,
      agent: parsed.data.agent,
    })
    return NextResponse.json({ memory }, { status: 201 })
```

with:

```ts
    const result = await memoryManagementService.createForProject({
      projectId: id,
      workspaceId: identity.workspaceId,
      category: parsed.data.category,
      content,
      actorMemberId: identity.memberId,
      agent: parsed.data.agent,
    })
    return NextResponse.json(
      { memory: result.memory, outcome: result.outcome },
      { status: 201 }
    )
```

- [ ] **Step 2: Implement (task route)** — apply the identical change to `app/api/tasks/[id]/memories/route.ts` (it calls `createForTask`; wrap its `{ memory }` response the same way: `{ memory: result.memory, outcome: result.outcome }`).

- [ ] **Step 3: Verify routes typecheck**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "memories/route|memory-management" || echo "no route/service type errors"`
Expected: `no route/service type errors`.

> If a route-level jest test exists (`grep -rl "memories/route" __tests__ tests`), update its
> expected response body to include `outcome` and assert it; run that test file.

- [ ] **Step 4: Commit**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add "app/api/projects/[id]/memories/route.ts" "app/api/tasks/[id]/memories/route.ts"
git -C "$PWD" commit -m "feat: return dedup outcome from memory create routes [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: API-client types + CLI dedup-outcome output

**Files:**
- Modify: `lib/api-client/memories.ts`
- Modify: `cli/src/commands/memory-project-add.ts`
- Modify: `cli/src/commands/memory-task-add.ts`

- [ ] **Step 1: Implement (api-client)** — update the two create return types

Add a shared type and update both create methods:

```ts
export type CreateOutcome = 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'NOOP'

// createForProject:
  createForProject(
    projectId: string,
    body: CreateBody
  ): Promise<{ memory: { id: string }; outcome: CreateOutcome }> {
    return apiFetch(`/api/projects/${projectId}/memories`, {
      method: 'POST',
      body,
    })
  },

// createForTask:
  createForTask(
    taskId: string,
    body: CreateBody
  ): Promise<{ memory: { id: string }; outcome: CreateOutcome }> {
    return apiFetch(`/api/tasks/${taskId}/memories`, { method: 'POST', body })
  },
```

> `app/workspace/[workspaceUrl]/hooks/useMemories.ts` reads only `result.memory.id`,
> so the added `outcome` field does not break it. Leave the hook unchanged.

- [ ] **Step 2: Implement (CLI project add)** — replace the final success line

The CLI parses the response body and prints by outcome. Replace the block after the
`res.status !== 201` guard:

```ts
  let outcome = 'ADD'
  let memId = ''
  try {
    const b = (await res.json()) as { outcome?: string; memory?: { id?: string } }
    if (typeof b.outcome === 'string') outcome = b.outcome
    if (b.memory && typeof b.memory.id === 'string') memId = b.memory.id
  } catch { /* keep defaults */ }

  switch (outcome) {
    case 'NOOP':
      process.stdout.write(`Skipped — duplicate of existing memory ${memId}, nothing written${echoSuffix}\n`)
      break
    case 'UPDATE':
      process.stdout.write(`Merged into existing memory ${memId} (near-duplicate)${echoSuffix}\n`)
      break
    case 'SUPERSEDE':
      process.stdout.write(`Superseded an existing memory; new version ${memId}${echoSuffix}\n`)
      break
    default:
      process.stdout.write(`Added ${built.category} PROJECT memory${echoSuffix}\n`)
  }
```

- [ ] **Step 3: Implement (CLI task add)** — apply the same outcome-switch to
`cli/src/commands/memory-task-add.ts`, using its existing echo/suffix variable and
the word `TASK` instead of `PROJECT` in the default `Added …` line. (Open the file
to match its exact existing success-line wording before editing.)

- [ ] **Step 4: Verify CLI typechecks + builds**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup/cli && npx tsc --noEmit 2>&1 | grep -E "memory-(project|task)-add" || echo "cli types ok"`
Expected: `cli types ok`.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add lib/api-client/memories.ts cli/src/commands/memory-project-add.ts cli/src/commands/memory-task-add.ts
git -C "$PWD" commit -m "feat: surface dedup outcome in lumo memory add output [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Update `.claude/skills/lumo/SKILL.md` (CLI doc sync)

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md` (and/or `references/memory.md` if the detail lives there)

Per CLAUDE.md, CLI behavior/output changes MUST sync the skill doc.

- [ ] **Step 1: Locate the memory section**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && grep -rn "memory add\|memory:add\|Added .* memory" .claude/skills/lumo/`

- [ ] **Step 2: Edit the memory add doc** — add a note describing the new behavior:

> `lumo task|project memory add` now **reconciles** the new entry against existing
> memories before writing, and **normalizes content to English**. A near-duplicate
> (including a cross-language ZH↔EN match) is merged instead of creating a second
> row. The command prints one of:
> - `Added <CATEGORY> <SCOPE> memory` — stored as a new memory
> - `Merged into existing memory <id> (near-duplicate)` — refined an existing row
> - `Superseded an existing memory; new version <id>` — replaced a contradicted row
> - `Skipped — duplicate of existing memory <id>, nothing written`

Update the frontmatter `description` triggers only if a new subcommand/flag was added
(none here — behavior change only; per CLAUDE.md a pure behavior change still warrants
the section update, which this step does).

- [ ] **Step 3: Commit**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add .claude/skills/lumo/SKILL.md
git -C "$PWD" commit -m "docs: sync lumo skill — memory add now dedups + canonicalizes to English [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Cross-language eval slice (LUM-329 harness)

**Files:**
- Modify: `scripts/eval/memory/eval-set.ts`
- Modify: `scripts/eval/memory/eval-set.test.ts`
- Modify: `scripts/eval/memory/run.ts`

- [ ] **Step 1: Add ZH↔EN synonym cases to `eval-set.ts`**

Append a clearly-marked block of cross-language cases to the `evalSet` array. Each
pairs an English `existing` with a Chinese `candidate` that is its translation, so
the RAW cross-language cosine can be measured. Use real Lumo topics, rewritten.
Add at least 5 pairs spanning categories. Example (add the full block; this shows
the shape for two):

```ts
  // ── CROSS-LANGUAGE (ZH candidate ↔ EN existing) — LUM-336 ──────────────────
  {
    id: 'xlang-prisma-drift-dup-01',
    category: 'TRAP',
    existing: {
      summary: 'Vercel CI does NOT run prisma migrate deploy — prod schema drifts',
      trigger: 'Merging a schema-change PR',
      outcome: 'App reads columns absent in prod → 500s until you migrate deploy manually',
    },
    candidate: {
      summary: 'Vercel CI 不会自动跑 prisma migrate deploy，生产 schema 漂移',
      trigger: '合并带 schema 变更的 PR',
      outcome: '应用读取生产环境不存在的列 → 500，直到手动 migrate deploy',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Cross-language duplicate (ZH translation of the EN trap).',
  },
  {
    id: 'xlang-tag-ops-dup-02',
    category: 'CONVENTION',
    existing: {
      rule: 'Use tagIds for full replacement; addTagIds / removeTagIds for partial mutations',
      scope: 'Document and task tag operation schemas',
    },
    candidate: {
      rule: '用 tagIds 做整体替换；addTagIds / removeTagIds 做局部增删',
      scope: '文档和任务的标签操作 schema',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Cross-language duplicate (ZH translation of the EN convention).',
  },
  // … add ≥3 more ZH↔EN pairs across DECISION / PROCEDURAL / TRAP …
```

- [ ] **Step 2: Add a coverage assertion to `eval-set.test.ts`**

```ts
it('includes cross-language (ZH↔EN) duplicate cases', () => {
  const xlang = evalSet.filter(c => c.id.startsWith('xlang-'))
  expect(xlang.length).toBeGreaterThanOrEqual(5)
  // each cross-language case's candidate text must contain CJK
  for (const c of xlang) {
    const text = JSON.stringify(c.candidate)
    expect(/[一-鿿]/.test(text)).toBe(true)
  }
})
```

- [ ] **Step 3: Run the eval-set test (offline, no key)**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest eval-set -i`
Expected: PASS — existing balance assertions + the new cross-language assertion.
(`validateEvalCase` re-asserts `expectedOp` matches `relationship` for the new cases.)

- [ ] **Step 4: Add the cross-lingual cosine report to `run.ts`**

After the existing lexical-recall line, add a function + report block. It measures,
per `xlang-` case, the raw cosine (ZH candidate vs EN existing) — documenting WHY
canonicalization is needed (raw cross-language cosine is expected to sit below the
0.78 floor). Add:

```ts
function crossLingualReport(model: string): {
  n: number
  meanRaw: number
  minRaw: number
  belowFloor: number
} {
  const xlang = evalSet.filter(c => c.id.startsWith('xlang-'))
  const raws: number[] = []
  for (const c of xlang) {
    const cand = fx.cases[c.id]!.candidate[model]!
    const exist = fx.cases[c.id]!.existing[model]!
    raws.push(cosineSimilarity(cand, exist))
  }
  const mean = raws.length ? raws.reduce((a, b) => a + b, 0) / raws.length : 0
  const min = raws.length ? Math.min(...raws) : 0
  const belowFloor = raws.filter(r => r < 0.78).length
  return { n: raws.length, meanRaw: mean, minRaw: min, belowFloor }
}
```

And in `main()`, after the lexical-recall log line:

```ts
  const xl = crossLingualReport(PROD_MODEL)
  log(
    `\n  cross-lingual RAW cosine (${PROD_MODEL}, n=${xl.n}): mean=${xl.meanRaw.toFixed(3)} min=${xl.minRaw.toFixed(3)} below-0.78=${xl.belowFloor}/${xl.n}`
  )
  log(
    `    → ${xl.belowFloor > 0 ? 'cross-language synonyms fall below the floor; LUM-336 canonicalizes manual content to English so dedup runs same-language.' : 'cross-language synonyms clear the floor at this model.'}`
  )
```

- [ ] **Step 5: Commit (offline parts)**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add scripts/eval/memory/eval-set.ts scripts/eval/memory/eval-set.test.ts scripts/eval/memory/run.ts
git -C "$PWD" commit -m "test: cross-language eval slice + raw-cosine report [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8b: Regenerate the eval fixture + run the live eval (KEY-GATED)

**Files:**
- Modify: `scripts/eval/memory/vectors.fixture.json` (regenerated)

This step needs `AI_GATEWAY_API_KEY` (present in `.env.local`). If the key is absent
or rejected, STOP and report — do NOT mark the task done (LUM-329 convention).

- [ ] **Step 1: Regenerate the fixture (embeds the new cross-language cases)**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx tsx scripts/eval/memory/fixture-gen.ts`
Expected: `Wrote …/vectors.fixture.json (<N> cases × 3 models).` with N = old count + new cross-language cases.

- [ ] **Step 2: Run the eval and capture the cross-lingual report**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx tsx scripts/eval/memory/run.ts`
Expected: prints the AR headline AND the new `cross-lingual RAW cosine …` line.
**Record the measured mean/min/below-floor numbers** — they go into the DECISION
memory and the PR description as the empirical justification for canonicalization.

- [ ] **Step 3: Sanity-check the regenerated fixture is committed-ready**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && git -C "$PWD" diff --stat scripts/eval/memory/vectors.fixture.json`
Expected: a single changed file (it is in `.prettierignore`, so format hooks skip it).

- [ ] **Step 4: Commit the fixture**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add scripts/eval/memory/vectors.fixture.json
git -C "$PWD" commit -m "test: regenerate eval fixture with cross-language cases [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Full verification — jest (both roots) + tsc

**Files:** none (verification only)

- [ ] **Step 1: Regenerate Prisma client once (atomic, end-of-work)**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx prisma generate`
Expected: `Generated Prisma Client`. (Per worktree gotchas: do this ONCE at the end,
not mid-work, because the client is shared via the node_modules symlink.)

- [ ] **Step 2: Typecheck the app**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Typecheck the CLI**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup/cli && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full jest suite from inside the worktree**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest`
Expected: all suites pass across BOTH roots (`__tests__/` and `tests/`). If the run
picks up the wrong tests, confirm cwd is the worktree (haste-collision gotcha).

- [ ] **Step 5: token-lint (if UI/style touched — here it is not, but cheap to confirm clean)**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npm run lint:tokens 2>&1 | tail -5 || echo "lint:tokens n/a"`
Expected: clean or unchanged baseline.

- [ ] **Step 6: Commit any incidental fixes** (only if Steps 2–4 forced changes)

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add -A
git -C "$PWD" commit -m "chore: typecheck/test fixes [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9b: ~~One-time canonicalization backfill of existing non-English rows (closes C2)~~ — DROPPED

**DROPPED (2026-06-09, see top-of-file amendment).** The measured ZH↔EN cosine (0.886
> 0.78 floor) means a new English manual add already retrieves existing Chinese rows,
so dedup needs no backfill. Normalizing existing rows to the canonical language is a
deferred *optional* convention follow-up, not part of this change. The original task
text is retained below for history but is NOT implemented.

<details><summary>Original (not implemented)</summary>

**Files:**
- Create: `scripts/backfill-memory-canonicalize.ts`
- Test: `__tests__/backfill-memory-canonicalize.test.ts`

**Why:** canonicalize-on-write only fixes future writes. Existing non-English rows
stay in their original-language embedding space, so a new English manual add scores
a low cross-language cosine against them, doesn't retrieve them, and duplicates them
anyway — breaking acceptance #1 for the existing corpus. This backfill translates +
re-embeds existing ACTIVE non-English rows so the whole store shares one embedding
space. Modeled on `scripts/backfill-memory-embeddings.ts` (DI-testable core +
keyset-by-id loop that terminates in dry-run).

- [ ] **Step 1: Write the failing test**

Create `__tests__/backfill-memory-canonicalize.test.ts`:

```ts
import { canonicalizeBackfill } from '@/scripts/backfill-memory-canonicalize'

const cjkRow = (id: string) => ({ id, category: 'TRAP' as const, content: { trigger: '触发', outcome: '后果' } })
const enRow = (id: string) => ({ id, category: 'TRAP' as const, content: { trigger: 'trigger', outcome: 'outcome' } })

function fetcherFrom(rows: Array<{ id: string; category: 'TRAP'; content: unknown }>) {
  return async (limit: number, afterId?: string) => {
    const start = afterId ? rows.findIndex(r => r.id === afterId) + 1 : 0
    return rows.slice(start, start + limit)
  }
}

it('translates + re-embeds only the CJK rows; skips English rows', async () => {
  const updated: Array<[string, unknown]> = []
  const stored: Array<[string, number[]]> = []
  const result = await canonicalizeBackfill({
    fetchActiveBatch: fetcherFrom([cjkRow('a'), enRow('b'), cjkRow('c')]),
    canonicalize: async (_cat, _content) => ({ trigger: 'EN trigger', outcome: 'EN outcome' }),
    embed: async texts => texts.map(() => [0.1, 0.2]),
    updateContent: async (id, content) => { updated.push([id, content]) },
    store: async (id, v) => { stored.push([id, v]) },
    batchSize: 10,
  })
  expect(updated.map(u => u[0])).toEqual(['a', 'c'])
  expect(stored.map(s => s[0])).toEqual(['a', 'c'])
  expect(result).toEqual({ processed: 3, canonicalized: 2, skipped: 1, failedBatches: 0 })
})

it('dry-run counts without writing', async () => {
  const updated: string[] = []
  const result = await canonicalizeBackfill({
    fetchActiveBatch: fetcherFrom([cjkRow('a'), cjkRow('c')]),
    canonicalize: async () => ({ trigger: 'EN', outcome: 'EN' }),
    embed: async texts => texts.map(() => [0.1]),
    updateContent: async id => { updated.push(id) },
    store: async () => {},
    dryRun: true,
    batchSize: 10,
  })
  expect(updated).toEqual([])
  expect(result.canonicalized).toBe(2)
})

it('fail-open: translation that stays CJK is skipped (retried next run)', async () => {
  const updated: string[] = []
  const result = await canonicalizeBackfill({
    fetchActiveBatch: fetcherFrom([cjkRow('a')]),
    canonicalize: async (_cat, content) => content, // fail-open returns original (still CJK)
    embed: async texts => texts.map(() => [0.1]),
    updateContent: async id => { updated.push(id) },
    store: async () => {},
    batchSize: 10,
  })
  expect(updated).toEqual([])
  expect(result).toEqual({ processed: 1, canonicalized: 0, skipped: 1, failedBatches: 0 })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest backfill-memory-canonicalize -i`
Expected: FAIL — `Cannot find module '@/scripts/backfill-memory-canonicalize'`.

- [ ] **Step 3: Implement**

Create `scripts/backfill-memory-canonicalize.ts`:

```ts
/**
 * One-shot, idempotent, resumable backfill (LUM-336): translate existing ACTIVE
 * memory rows whose content is non-English into English (canonical language) and
 * re-embed them, so the whole store shares one embedding space and future manual
 * adds dedup correctly across the existing corpus. In-place update (stable id —
 * preserves lineage/usage/provenance); this is a representation normalization,
 * not a semantic supersede. Already-English rows are skipped; rows whose
 * translation fail-opens (stays CJK) are skipped and retried next run.
 *
 * Usage:
 *   npx tsx scripts/backfill-memory-canonicalize.ts --dry-run
 *   npx tsx scripts/backfill-memory-canonicalize.ts
 * Requires DATABASE_URL_UNPOOLED + AI_GATEWAY_API_KEY (or .env.production).
 */
import type { MemoryCategory } from '@prisma/client'

export interface CanonicalizeBackfillDeps {
  fetchActiveBatch: (
    limit: number,
    afterId?: string
  ) => Promise<Array<{ id: string; category: MemoryCategory; content: unknown }>>
  canonicalize: (category: MemoryCategory, content: unknown) => Promise<unknown>
  embed: (texts: string[]) => Promise<number[][]>
  updateContent: (id: string, content: unknown) => Promise<void>
  store: (id: string, vector: number[]) => Promise<void>
  batchSize?: number
  dryRun?: boolean
  log?: (msg: string) => void
}

export interface CanonicalizeBackfillResult {
  processed: number
  canonicalized: number
  skipped: number
  failedBatches: number
}

export async function canonicalizeBackfill(
  deps: CanonicalizeBackfillDeps
): Promise<CanonicalizeBackfillResult> {
  const { memoryContentToText } = await import('@/lib/memory/content-text')
  const { containsCjk } = await import('@/lib/services/memory/canonicalize-language')

  const {
    fetchActiveBatch,
    canonicalize,
    embed,
    updateContent,
    store,
    batchSize = 100,
    dryRun = false,
    log = () => undefined,
  } = deps

  const result: CanonicalizeBackfillResult = {
    processed: 0,
    canonicalized: 0,
    skipped: 0,
    failedBatches: 0,
  }
  let afterId: string | undefined = undefined

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await fetchActiveBatch(batchSize, afterId)
    if (batch.length === 0) break
    result.processed += batch.length
    afterId = batch[batch.length - 1]!.id

    for (const row of batch) {
      const text = memoryContentToText(row.category, row.content)
      if (!text || !containsCjk(text)) {
        result.skipped++
        continue
      }
      if (dryRun) {
        result.canonicalized++
        continue
      }
      let english: unknown
      try {
        english = await canonicalize(row.category, row.content)
      } catch {
        result.failedBatches++
        continue
      }
      const englishText = memoryContentToText(row.category, english)
      // fail-open returned the original (still CJK) → leave for a later run.
      if (!englishText || containsCjk(englishText)) {
        result.skipped++
        continue
      }
      await updateContent(row.id, english)
      try {
        const [vec] = await embed([englishText])
        if (vec) await store(row.id, vec)
      } catch {
        // content normalized; embedding retried by the NULL-embedding backfill.
      }
      result.canonicalized++
    }
    log(
      `processed=${result.processed} canonicalized=${result.canonicalized} skipped=${result.skipped}`
    )
  }
  return result
}

if (require.main === module) {
  ;(async () => {
    await import('dotenv/config')
    const { prisma } = await import('@/lib/db/prisma')
    const { Prisma } = await import('@prisma/client')
    const { embedTexts } = await import('@/lib/ai/embedding')
    const { memoryRepository } = await import('@/lib/repositories/memory.repository')
    const { canonicalizeToEnglish } = await import('@/lib/services/memory/canonicalize-language')

    const dryRun = process.argv.includes('--dry-run')
    // eslint-disable-next-line no-console
    console.log(`[backfill-canonicalize] mode=${dryRun ? 'DRY-RUN' : 'APPLY'}`)

    const result = await canonicalizeBackfill({
      fetchActiveBatch: async (limit, afterId) => {
        type Row = { id: string; category: string; content: unknown }
        const cursor = afterId ? Prisma.sql`AND "id" > ${afterId}` : Prisma.empty
        const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
          SELECT id, category, content FROM "memories"
          WHERE "status" = 'ACTIVE' ${cursor}
          ORDER BY "id" ASC LIMIT ${limit}
        `)
        return rows.map(r => ({
          id: r.id,
          category: r.category as MemoryCategory,
          content: r.content,
        }))
      },
      canonicalize: canonicalizeToEnglish,
      embed: embedTexts,
      updateContent: (id, content) =>
        memoryRepository.updateContent(id, content as never).then(() => undefined),
      store: (id, v) => memoryRepository.setEmbedding(id, v),
      dryRun,
      // eslint-disable-next-line no-console
      log: msg => console.log(`  ${msg}`),
    })

    // eslint-disable-next-line no-console
    console.log(`\n[backfill-canonicalize] done — ${JSON.stringify(result)}`)
    if (dryRun) console.log('Re-run without --dry-run to apply.')
    await prisma.$disconnect()
  })().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && npx jest backfill-memory-canonicalize -i`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" add scripts/backfill-memory-canonicalize.ts __tests__/backfill-memory-canonicalize.test.ts
git -C "$PWD" commit -m "feat: one-time backfill to canonicalize existing non-English memories [LUM-336]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Live run (KEY-GATED, prod data — user-gated)**

This rewrites prod memory content. Run `--dry-run` first, surface the count to the
USER, get explicit confirmation, THEN apply. Sequence: run this BEFORE the Task 10
cleanup (don't translate rows about to be deleted — but harmless if order flips).

Dry-run: `cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup && DOTENV_CONFIG_PATH=.env.production npx tsx scripts/backfill-memory-canonicalize.ts --dry-run`
Apply (after user OK): same command without `--dry-run`.
Expected: dry-run reports `canonicalized=<N>` non-English rows; apply rewrites them.

</details>

---

## Task 10: Production data cleanup (MANUAL, user-gated)

**Files:** none (runtime data operation via `lumo` CLI)

The 2 existing LUM-327 duplicate pairs must collapse to 1 + 1. This touches prod data
— DO NOT delete without explicit user confirmation in-session. Run AFTER Task 9b's
canonicalization backfill.

- [ ] **Step 1: Verify current state**

Run: `lumo project memory list <project-ref>` (the Lumo project that owns these PROJECT
memories) and confirm all 4 ids still exist with the expected category:
- DECISION: `cmq72c817` (auto/EN, keep) + `cmq72b0yy` (manual/ZH, delete)
- TRAP: `cmq72c81k` (auto/EN, keep) + `cmq72b1us` (manual/ZH, delete)

- [ ] **Step 2: Confirm `lumo memory rm` semantics**

Run: `lumo memory rm --help` (confirm whether it hard-deletes or invalidates per
LUM-325). Surface the verification + the exact delete commands to the USER and wait
for explicit go-ahead.

- [ ] **Step 3: Delete the two ZH duplicates (only after user confirms)**

Run:
```
lumo memory rm cmq72b0yy --yes
lumo memory rm cmq72b1us --yes
```

- [ ] **Step 4: Verify 1 + 1**

Run: `lumo project memory list <project-ref>` and confirm the DECISION + TRAP topics
now have a single (English) row each.

---

## Task 11: Produce memories + open PR

**Files:** none (Lumo memory + GitHub PR)

- [ ] **Step 1: Record the produced memories** (per the task's "expected output memories")

- TRAP: manual `memory add` bypassed reconcile + the cross-language floor was
  calibrated same-language only → bilingual stores accrued duplicates. Workaround/fix:
  canonicalize manual content to English + hybrid-gated dedup on the create paths.
- DECISION: cross-language dedup strategy = canonicalize-to-English on write (chosen
  over a lower cross-language floor); include the measured raw cross-lingual cosine
  from Task 8b as the evidence.
- PROCEDURAL: cross-language eval-slice protocol (add ZH↔EN pairs to eval-set →
  fixture-gen → run.ts raw-cosine report).

(Use `lumo task memory add` / `lumo project memory add` — these now self-dedup, so a
near-duplicate of an existing memory will be merged/skipped, which is the intended
behavior.)

- [ ] **Step 2: Push the branch**

```bash
cd .worktrees/LUM-336-manual-add-reconcile-cross-lang-dedup
git -C "$PWD" push -u origin lumo/LUM-336-manual-add-reconcile-cross-lang-dedup
```

- [ ] **Step 3: Open the PR**

Title: `feat: reconcile + English-canonical dedup for manual memory add [LUM-336]`

Body must note:
- No schema change; no migration needed.
- New transitive gateway calls on the manual write path (translation when content is
  non-English; reconcile only when a near-duplicate neighbor exists) — both fail open.
- The measured raw cross-lingual cosine (from Task 8b) justifying canonicalization.
- Production data cleanup performed (Task 10) — 2 duplicate pairs → 1 + 1.
- No new npm dependency.

- [ ] **Step 4: Set the Lumo task to in_review** (PR open ≠ done)

```
lumo task comment LUM-336 "PR open: <url>. Awaiting review."
```

(Per working-style: don't mark DONE on a merged-but-unverified-in-prod basis; keep the
task in review until merged + prod cleanup confirmed.)

---

## Self-Review

**Spec coverage:**
- §A canonicalize-on-write → Task 1 (helper) + Task 3 (create paths) + Task 4 (edit/promote). ✅
- §B hybrid-gated dedup (create only) → Task 2 (resolver) + Task 3 (wiring). ✅ edit/promote explicitly NOT deduped (Task 4 only canonicalizes). ✅
- §B CLI feedback → Task 5 (route outcome) + Task 6 (CLI lines) + Task 7 (doc). ✅
- §C cross-language eval slice (raw vs canonical cosine) → Task 8 + 8b. ✅
- §D existing-corpus canonicalization backfill (C2 — without it acceptance #1 fails for the existing non-English corpus) → Task 9b. ✅
- §E data cleanup keep-EN/delete-ZH → Task 10 (user-gated, runs after Task 9b). ✅
- §E testing/workflow (worktree, TDD, both jest roots, tsc, dynamic-import gateway, no schema) → Tasks 1–4 (TDD), Task 9 (full verify). ✅
- Acceptance #1 no second row → Task 2/3 NOOP/UPDATE/SUPERSEDE paths + tests (future writes) AND Task 9b backfill (existing non-English corpus — else cross-language dedup misses pre-existing rows). ✅
- Acceptance #2 cross-language test coverage → Task 8. ✅
- Acceptance #3 cleanup → Task 10. ✅
- Acceptance #4 no breakage to auto path / lease / ACTIVE filter → no edits to layer1/layer2 services or repository filters; only additive new modules + service wiring. ✅
- Acceptance #5 jest + tsc green → Task 9. ✅

**Placeholder scan:** Task 8 Step 1 says "add ≥3 more ZH↔EN pairs" — this is a quantity instruction with two full worked examples and an explicit count/category spread, not a code placeholder; acceptable. No "TBD"/"implement later"/bare "add error handling".

**Type consistency:** `CreateMemoryResult { outcome, memory:{id} }` (Task 3) ↔ route response `{ memory, outcome }` (Task 5) ↔ api-client `{ memory:{id}, outcome }` (Task 6) ↔ CLI reads `b.outcome` + `b.memory.id` (Task 6). `ManualDedupResolution` kinds (Task 2) ↔ service switch (Task 3). `canonicalizeToEnglish(category, content)` signature (Task 1) ↔ all call sites (Tasks 3, 4). `resolveManualDedup` input fields (Task 2) ↔ service call (Task 3). Consistent. ✅
