# LUM-280 Fragment Identity (consolidation provenance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a memory fragment's lineage survive Layer-2 consolidation, so per-fragment outcome aggregation (LUM-278) doesn't split one logical lesson across two cuids.

**Architecture:** Layer-2 consolidation already creates a *new* PROJECT memory (new cuid) when it promotes recurring TASK lessons, but records no link back to the source TASK memories. We add a FK-less `MemoryProvenance(childMemoryId, parentMemoryId)` side-table populated at consolidation time (LLM cites source ids on each ADD; cites are hard-validated against the consolidation input window, hallucinations dropped). A `resolveCanonicalFragment(type, id)` walks the parent→child chain so an edge keyed by an old TASK cuid resolves to the promoted PROJECT cuid. `LineageEdge.fragmentId` stays = cuid; the shipped LUM-274/275 contract is untouched.

**Tech Stack:** Next.js 14, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Prisma 7 (offline migration), Zod, Jest (SWC, mocks Prisma — no DB), ai-sdk `generateObject`.

**Scope (LOCKED, see `docs/strategy/LUM-280-fragment-identity.md`):** Only ① memory consolidation re-keying. Soft-delete orphans = known debt (out). Semantic drift = v2 (out). `fragmentId` stays = cuid.

**Worktree:** `.worktrees/LUM-280-fragment-identity` (branch `lumo/LUM-280-fragment-identity`, off fresh origin/main, node_modules symlinked). Run all jest from INSIDE the worktree. Do NOT run `prisma generate` until Task 7.

---

## File Structure

- Create: `prisma/migrations/20260606130000_add_memory_provenance/migration.sql` — offline migration.
- Modify: `prisma/schema.prisma` — add `model MemoryProvenance`.
- Create: `lib/repositories/memory-provenance.repository.ts` — write provenance + `resolveCanonicalFragment`.
- Create: `__tests__/lib/repositories/memory-provenance.repository.test.ts`.
- Modify: `lib/services/memory/layer2-extract.ts` — add optional `sourceMemoryIds` to the ADD op.
- Modify: `lib/services/memory/layer2-apply.ts` — validate cites against the input window, write provenance per ADD.
- Modify: `__tests__/lib/services/memory/layer2-apply.test.ts` — provenance assertions.
- Modify: `lib/services/memory/layer2.service.ts` — thread `validSourceMemoryIds` from input window into apply.
- Modify: `lib/services/memory/layer2-prompt.ts` — instruct the LLM to cite `sourceMemoryIds` on ADD.
- Modify: `__tests__/lib/services/memory/layer2-prompt.test.ts` — assert the citing instruction renders.

---

### Task 1: MemoryProvenance Prisma model + offline migration

**Files:**
- Modify: `prisma/schema.prisma` (after the `model Memory { … }` block, ~line 1550)
- Create: `prisma/migrations/20260606130000_add_memory_provenance/migration.sql`

- [ ] **Step 1: Add the model to schema.prisma**

Insert immediately after the closing `}` of `model Memory` (the block ending with `@@map("memories")`):

```prisma
/// Provenance edges for Layer-2 memory consolidation (LUM-280). When
/// consolidation promotes recurring TASK lessons into a new PROJECT memory,
/// it records which source TASK memories fed the promotion. `resolveCanonicalFragment`
/// walks parent→child so a LineageEdge keyed by an old TASK cuid still rolls up
/// to the promoted PROJECT cuid. FK-less on purpose (mirrors LineageEdge): a
/// deleted parent memory must NOT cascade away the redirect, and source rows
/// are consolidated/edited/deleted independently (deletion propagation is
/// milestone known-debt).
model MemoryProvenance {
  id             String   @id @default(cuid())
  // The PROJECT memory created by consolidation (the promoted lesson).
  childMemoryId  String
  // A source TASK memory the promotion was synthesized from. Validated to be
  // in the consolidation input window before insert — hallucinated ids dropped.
  parentMemoryId String
  createdAt      DateTime @default(now())

  @@unique([childMemoryId, parentMemoryId])
  @@index([parentMemoryId])
  @@map("memory_provenance")
}
```

- [ ] **Step 2: Hand-write the migration SQL**

Create `prisma/migrations/20260606130000_add_memory_provenance/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "memory_provenance" (
    "id" TEXT NOT NULL,
    "childMemoryId" TEXT NOT NULL,
    "parentMemoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memory_provenance_childMemoryId_parentMemoryId_key" ON "memory_provenance"("childMemoryId", "parentMemoryId");

-- CreateIndex
CREATE INDEX "memory_provenance_parentMemoryId_idx" ON "memory_provenance"("parentMemoryId");
```

- [ ] **Step 3: Verify the migration timestamp is newest**

Run: `ls prisma/migrations | sort | tail -3`
Expected: `20260606130000_add_memory_provenance` sorts last (after `20260606120000_add_lineage_edge`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260606130000_add_memory_provenance/migration.sql
git commit -m "feat: add MemoryProvenance model + offline migration [LUM-280]"
```

> Do NOT run `prisma generate` here — the shared client is symlinked across worktrees; generate happens once at Task 7.

---

### Task 2: memory-provenance.repository.ts (write + resolveCanonicalFragment)

**Files:**
- Create: `lib/repositories/memory-provenance.repository.ts`
- Test: `__tests__/lib/repositories/memory-provenance.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/repositories/memory-provenance.repository.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memoryProvenance: {
      createMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'

const mp = prisma.memoryProvenance as unknown as {
  createMany: jest.Mock
  findFirst: jest.Mock
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('memoryProvenanceRepository.createMany', () => {
  it('no-ops on empty parent list (no DB write)', async () => {
    await memoryProvenanceRepository.createMany('child', [])
    expect(mp.createMany).not.toHaveBeenCalled()
  })

  it('writes one row per parent with skipDuplicates', async () => {
    await memoryProvenanceRepository.createMany('child', ['p1', 'p2'])
    expect(mp.createMany).toHaveBeenCalledWith({
      data: [
        { childMemoryId: 'child', parentMemoryId: 'p1' },
        { childMemoryId: 'child', parentMemoryId: 'p2' },
      ],
      skipDuplicates: true,
    })
  })
})

describe('memoryProvenanceRepository.resolveCanonicalFragment', () => {
  it('returns the id unchanged for non-MEMORY fragment types (no query)', async () => {
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'SLACK_CONTEXT',
      'slack_1'
    )
    expect(out).toBe('slack_1')
    expect(mp.findFirst).not.toHaveBeenCalled()
  })

  it('returns the id unchanged when the memory has no child (orphan-free identity)', async () => {
    mp.findFirst.mockResolvedValueOnce(null)
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'MEMORY',
      'c2'
    )
    expect(out).toBe('c2')
  })

  it('walks a single hop c1 -> c2', async () => {
    mp.findFirst
      .mockResolvedValueOnce({ childMemoryId: 'c2' })
      .mockResolvedValueOnce(null)
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'MEMORY',
      'c1'
    )
    expect(out).toBe('c2')
  })

  it('walks a multi-hop chain c1 -> c2 -> c3', async () => {
    mp.findFirst
      .mockResolvedValueOnce({ childMemoryId: 'c2' })
      .mockResolvedValueOnce({ childMemoryId: 'c3' })
      .mockResolvedValueOnce(null)
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'MEMORY',
      'c1'
    )
    expect(out).toBe('c3')
  })

  it('breaks a cycle instead of looping forever', async () => {
    // c1 -> c2 -> c1 (corrupt data): must terminate.
    mp.findFirst
      .mockResolvedValueOnce({ childMemoryId: 'c2' })
      .mockResolvedValueOnce({ childMemoryId: 'c1' })
    const out = await memoryProvenanceRepository.resolveCanonicalFragment(
      'MEMORY',
      'c1'
    )
    expect(['c1', 'c2']).toContain(out)
    // Stopped on revisiting a seen id — far fewer than the depth cap.
    expect(mp.findFirst.mock.calls.length).toBeLessThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/repositories/memory-provenance.repository.test.ts`
Expected: FAIL — "Cannot find module '@/lib/repositories/memory-provenance.repository'".

- [ ] **Step 3: Write the implementation**

Create `lib/repositories/memory-provenance.repository.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

/**
 * Provenance side-table access for Layer-2 consolidation lineage (LUM-280).
 * `fragmentId` in LineageEdge stays = cuid; canonical identity is resolved
 * here by walking the parent→child promotion chain.
 */

/** Safety cap so corrupt/cyclic provenance can never loop unbounded. */
const MAX_RESOLVE_DEPTH = 16

/**
 * Find the PROJECT memory that a given (parent) memory was promoted into.
 * If a parent was cited by more than one consolidation, the most recent
 * child wins — deterministic and good enough for v1 (re-citation is rare:
 * promotion requires recurrence + dedup). Returns null when the memory was
 * never a consolidation source (it is already canonical).
 */
async function queryChildMemoryId(
  parentMemoryId: string
): Promise<string | null> {
  const row = await prisma.memoryProvenance.findFirst({
    where: { parentMemoryId },
    orderBy: { createdAt: 'desc' },
    select: { childMemoryId: true },
  })
  return row?.childMemoryId ?? null
}

export const memoryProvenanceRepository = {
  /**
   * Record that `childMemoryId` (a promoted PROJECT memory) was synthesized
   * from `parentMemoryIds` (source TASK memories). No-op on empty input.
   * `skipDuplicates` makes re-runs idempotent against the unique index.
   */
  async createMany(
    childMemoryId: string,
    parentMemoryIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (parentMemoryIds.length === 0) return
    const client = tx ?? prisma
    await client.memoryProvenance.createMany({
      data: parentMemoryIds.map(parentMemoryId => ({
        childMemoryId,
        parentMemoryId,
      })),
      skipDuplicates: true,
    })
  },

  /**
   * Resolve a fragment to its canonical id. Non-MEMORY types are identity
   * (their cuid is stable for life). MEMORY walks the promotion chain so an
   * edge keyed by a pre-consolidation TASK cuid rolls up to the promoted
   * PROJECT cuid. Cycle- and depth-guarded.
   */
  async resolveCanonicalFragment(
    fragmentType: string,
    fragmentId: string
  ): Promise<string> {
    if (fragmentType !== 'MEMORY') return fragmentId
    let current = fragmentId
    const seen = new Set<string>([current])
    for (let i = 0; i < MAX_RESOLVE_DEPTH; i++) {
      const child = await queryChildMemoryId(current)
      if (!child || seen.has(child)) break
      seen.add(child)
      current = child
    }
    return current
  },
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/repositories/memory-provenance.repository.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/memory-provenance.repository.ts __tests__/lib/repositories/memory-provenance.repository.test.ts
git commit -m "feat: MemoryProvenance repository + resolveCanonicalFragment [LUM-280]"
```

---

### Task 3: Add optional sourceMemoryIds to the Layer-2 ADD op schema

**Files:**
- Modify: `lib/services/memory/layer2-extract.ts:30-42` (the `layer2OperationSchema` ADD member)
- Test: `__tests__/lib/services/memory/layer2-extract-schema.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/services/memory/layer2-extract-schema.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { layer2OperationSchema } from '@/lib/services/memory/layer2-extract'

describe('layer2OperationSchema ADD sourceMemoryIds', () => {
  it('accepts an ADD with sourceMemoryIds', () => {
    const parsed = layer2OperationSchema.parse({
      type: 'ADD',
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o' },
      sourceMemoryIds: ['mem_1', 'mem_2'],
    })
    expect(parsed).toMatchObject({ sourceMemoryIds: ['mem_1', 'mem_2'] })
  })

  it('accepts an ADD without sourceMemoryIds (optional)', () => {
    const parsed = layer2OperationSchema.parse({
      type: 'ADD',
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o' },
    })
    expect(parsed.type).toBe('ADD')
    expect((parsed as { sourceMemoryIds?: string[] }).sourceMemoryIds).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/services/memory/layer2-extract-schema.test.ts`
Expected: FAIL — Zod strips unknown keys, so `sourceMemoryIds` is undefined in the first test → assertion fails.

- [ ] **Step 3: Add the field**

In `lib/services/memory/layer2-extract.ts`, change the ADD member of `layer2OperationSchema` from:

```ts
  z.object({
    type: z.literal('ADD'),
    category: memoryCategorySchema,
    content: z.unknown(),
  }),
```

to:

```ts
  z.object({
    type: z.literal('ADD'),
    category: memoryCategorySchema,
    content: z.unknown(),
    // LUM-280: ids of the source TASK memories this promotion was synthesized
    // from. Optional — the model may omit them; apply-side hard-validates each
    // against the consolidation input window and drops anything not present.
    sourceMemoryIds: z.array(z.string().min(1)).optional(),
  }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/services/memory/layer2-extract-schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer2-extract.ts __tests__/lib/services/memory/layer2-extract-schema.test.ts
git commit -m "feat: Layer-2 ADD op carries optional sourceMemoryIds [LUM-280]"
```

---

### Task 4: applyLayer2Operations validates cites + writes provenance

**Files:**
- Modify: `lib/services/memory/layer2-apply.ts` (the `ApplyOperationsInput` interface + the ADD branch)
- Modify: `__tests__/lib/services/memory/layer2-apply.test.ts` (mock the provenance repo, new assertions)

- [ ] **Step 1: Write the failing tests**

In `__tests__/lib/services/memory/layer2-apply.test.ts`, extend the top `jest.mock` block to also mock the provenance repo by adding this second mock right below the existing `memory.repository` mock:

```ts
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    createMany: jest.fn(),
  },
}))
```

Add this import near the other imports:

```ts
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
```

Add a typed handle near `const repo = …`:

```ts
const provRepo = memoryProvenanceRepository as jest.Mocked<
  typeof memoryProvenanceRepository
>
```

In `beforeEach`, make `create` return a deterministic id (it already returns `{ id: 'new_mem' }` — keep it) and reset is covered by `jest.clearAllMocks()`.

Then add a new `describe` block at the end of the file:

```ts
describe('applyLayer2Operations provenance (LUM-280)', () => {
  it('writes provenance for an ADD citing ids inside the input window', async () => {
    const result = await applyLayer2Operations({
      ...baseInput,
      validSourceMemoryIds: ['mem_1', 'mem_2', 'mem_3'],
      operations: [
        {
          type: 'ADD',
          category: 'TRAP',
          content: { trigger: 't', outcome: 'o' },
          sourceMemoryIds: ['mem_1', 'mem_2'],
        },
      ],
    })
    expect(result.added).toBe(1)
    expect(provRepo.createMany).toHaveBeenCalledWith(
      'new_mem',
      ['mem_1', 'mem_2'],
      expect.anything()
    )
  })

  it('drops cited ids not in the input window (hallucination guard)', async () => {
    await applyLayer2Operations({
      ...baseInput,
      validSourceMemoryIds: ['mem_1'],
      operations: [
        {
          type: 'ADD',
          category: 'TRAP',
          content: { trigger: 't', outcome: 'o' },
          sourceMemoryIds: ['mem_1', 'ghost_999'],
        },
      ],
    })
    expect(provRepo.createMany).toHaveBeenCalledWith(
      'new_mem',
      ['mem_1'],
      expect.anything()
    )
  })

  it('writes no provenance when every cited id is hallucinated', async () => {
    await applyLayer2Operations({
      ...baseInput,
      validSourceMemoryIds: ['mem_1'],
      operations: [
        {
          type: 'ADD',
          category: 'TRAP',
          content: { trigger: 't', outcome: 'o' },
          sourceMemoryIds: ['ghost_1', 'ghost_2'],
        },
      ],
    })
    expect(provRepo.createMany).not.toHaveBeenCalled()
  })

  it('writes no provenance when the ADD cites nothing', async () => {
    await applyLayer2Operations({
      ...baseInput,
      validSourceMemoryIds: ['mem_1'],
      operations: [
        { type: 'ADD', category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
      ],
    })
    expect(provRepo.createMany).not.toHaveBeenCalled()
  })
})
```

> Note: existing tests pass `baseInput` without `validSourceMemoryIds`. Keep the field OPTIONAL in the implementation (Step 3) so those tests stay green unchanged.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/services/memory/layer2-apply.test.ts`
Expected: the 4 new tests FAIL (`provRepo.createMany` never called — apply doesn't write provenance yet); existing tests still PASS.

- [ ] **Step 3: Implement provenance writing in apply**

In `lib/services/memory/layer2-apply.ts`:

(a) Add the import at the top, below the existing imports:

```ts
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
```

(b) Add the optional field to `ApplyOperationsInput` (after `sourceSessionId?`):

```ts
  /**
   * Ids of the TASK memories that fed this consolidation (the input window).
   * LUM-280: an ADD's `sourceMemoryIds` are intersected with this set before
   * provenance is written, so a hallucinated id can never create a dangling
   * provenance edge. Omitted/empty → no provenance is written for any ADD.
   */
  validSourceMemoryIds?: string[]
```

(c) Just before the `for (const op of input.operations)` loop, build the validation set:

```ts
  const validSourceIds = new Set(input.validSourceMemoryIds ?? [])
```

(d) Replace the ADD plan push. Change:

```ts
      plans.push(async tx => {
        await memoryRepository.create(
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            taskId: null,
            scope: 'PROJECT',
            category,
            content: validated as Prisma.InputJsonValue,
            sourceSessionId: input.sourceSessionId ?? null,
            createdByMemberId: null,
          },
          tx
        )
        result.added++
      })
      continue
```

to:

```ts
      const citedSourceIds = (op.sourceMemoryIds ?? []).filter(id =>
        validSourceIds.has(id)
      )
      plans.push(async tx => {
        const created = await memoryRepository.create(
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            taskId: null,
            scope: 'PROJECT',
            category,
            content: validated as Prisma.InputJsonValue,
            sourceSessionId: input.sourceSessionId ?? null,
            createdByMemberId: null,
          },
          tx
        )
        result.added++
        if (citedSourceIds.length > 0) {
          await memoryProvenanceRepository.createMany(
            created.id,
            citedSourceIds,
            tx
          )
        }
      })
      continue
```

> `memoryRepository.create` already returns `{ id }` (`select: { id: true }`), so `created.id` is available. Reading `op.sourceMemoryIds` is type-safe because the ADD member now carries it (Task 3).

- [ ] **Step 4: Run the full apply test file**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/services/memory/layer2-apply.test.ts`
Expected: PASS (all existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer2-apply.ts __tests__/lib/services/memory/layer2-apply.test.ts
git commit -m "feat: write consolidation provenance for validated ADD cites [LUM-280]"
```

---

### Task 5: Thread validSourceMemoryIds through runForProject

**Files:**
- Modify: `lib/services/memory/layer2.service.ts` (the `applyLayer2Operations({ … })` call inside `runForProject`)
- Test: `__tests__/lib/services/memory/layer2.service.test.ts` (add one assertion)

- [ ] **Step 1: Write the failing test**

Open `__tests__/lib/services/memory/layer2.service.test.ts`, find the existing test that asserts `applyLayer2Operations` is called (it mocks `./layer2-apply`, `./layer2-input`, `./layer2-extract`). Add a test that the input-window ids are forwarded. Append inside the top-level `describe`:

```ts
  it('forwards the input-window task memory ids as validSourceMemoryIds', async () => {
    // getLayer2Input mock must return taskMemories with ids; see existing
    // mock setup. This asserts runForProject passes those ids to apply.
    const result = await layer2Service.runForProject('proj_1', null)
    expect(result).not.toBeNull()
    expect(applyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        validSourceMemoryIds: expect.arrayContaining(['mem_a']),
      })
    )
  })
```

> If the file's existing `getLayer2Input` mock returns `taskMemories: []` or omits ids, update that mock to include at least `{ id: 'mem_a', taskId: 'task_a', category: 'TRAP', content: {} }` so the assertion has an id to match. `applyMock` is the existing `jest.fn()` the file already wires for `applyLayer2Operations`; reuse it (do not invent a new name).

- [ ] **Step 2: Run to verify it fails**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/services/memory/layer2.service.test.ts`
Expected: FAIL — `validSourceMemoryIds` is absent from the apply call args.

- [ ] **Step 3: Forward the ids in the service**

In `lib/services/memory/layer2.service.ts`, inside `runForProject`, change the `applyLayer2Operations({ … })` call to add the field (right after `existingProjectMemories: …,` and before `sourceSessionId,`):

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/services/memory/layer2.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer2.service.ts __tests__/lib/services/memory/layer2.service.test.ts
git commit -m "feat: forward consolidation input window to provenance validation [LUM-280]"
```

---

### Task 6: Prompt the LLM to cite sourceMemoryIds on ADD

**Files:**
- Modify: `lib/services/memory/layer2-prompt.ts` (SYSTEM_PROMPT "# Operations" section + one example)
- Modify: `__tests__/lib/services/memory/layer2-prompt.test.ts` (assert the instruction renders)

- [ ] **Step 1: Write the failing test**

In `__tests__/lib/services/memory/layer2-prompt.test.ts`, add inside the existing `describe`:

```ts
  it('system prompt instructs ADD to cite sourceMemoryIds', () => {
    const { system } = buildLayer2Prompt(baseInput)
    expect(system).toContain('sourceMemoryIds')
  })
```

> `baseInput` / `buildLayer2Prompt` are already imported in this test file; reuse the existing fixture (if the file names it differently, e.g. `input`, use that name).

- [ ] **Step 2: Run to verify it fails**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/services/memory/layer2-prompt.test.ts`
Expected: FAIL — `sourceMemoryIds` not in the system prompt yet.

- [ ] **Step 3: Add the citing instruction**

In `lib/services/memory/layer2-prompt.ts`, in `SYSTEM_PROMPT`, change the ADD bullet under `# Operations` from:

```ts
- ADD: a new PROJECT-scope memory. Provide category + content. The promoted lesson should be a synthesis — write it generally enough to apply to any task, not as a copy of one TASK row's text.
```

to:

```ts
- ADD: a new PROJECT-scope memory. Provide category + content. The promoted lesson should be a synthesis — write it generally enough to apply to any task, not as a copy of one TASK row's text. Also set "sourceMemoryIds": the exact id=… values of the TASK-scope memories below that this lesson is synthesized from (the recurrence evidence). Use only ids that appear in the "Recent TASK-scope memories" list — never invent one. This is required for lineage; an ADD with no real source ids loses its provenance.
```

Then update **Example 1** in the `examples` string so its ADD includes the cited ids — change:

```ts
    { "type": "ADD", "category": "TRAP",
      "content": {
        "summary": "Enum value + use in one migration fails",
        "trigger": "Add a Postgres enum value and use it in the same Prisma migration.",
        "outcome": "Fails with P3009 — Postgres won't alter an enum and read the new value in one transaction."
      } } ] }
```

to:

```ts
    { "type": "ADD", "category": "TRAP",
      "sourceMemoryIds": ["mem_1", "mem_2"],
      "content": {
        "summary": "Enum value + use in one migration fails",
        "trigger": "Add a Postgres enum value and use it in the same Prisma migration.",
        "outcome": "Fails with P3009 — Postgres won't alter an enum and read the new value in one transaction."
      } } ] }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/services/memory/layer2-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/memory/layer2-prompt.ts __tests__/lib/services/memory/layer2-prompt.test.ts
git commit -m "feat: instruct Layer-2 to cite source memory ids on ADD [LUM-280]"
```

---

### Task 7: Generate client, typecheck, full suite, final verification

**Files:** none (verification only)

- [ ] **Step 1: Generate the Prisma client (atomic, once)**

Run: `cd .worktrees/LUM-280-fragment-identity && npx prisma generate`
Expected: "Generated Prisma Client" — now `prisma.memoryProvenance` exists on the client type.

> This mutates the shared symlinked client. Run tsc + the full suite immediately after, before any other worktree generates.

- [ ] **Step 2: Typecheck**

Run: `cd .worktrees/LUM-280-fragment-identity && npx tsc --noEmit`
Expected: no errors. (Catches `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` issues jest's SWC skips.)

- [ ] **Step 3: Run the full memory + repository suites**

Run: `cd .worktrees/LUM-280-fragment-identity && npx jest __tests__/lib/services/memory __tests__/lib/repositories/memory-provenance.repository.test.ts`
Expected: all PASS.

- [ ] **Step 4: Confirm no migrations were deleted and the diff is additive**

Run: `git diff --stat origin/main -- prisma/migrations`
Expected: only the new `20260606130000_add_memory_provenance/migration.sql` added; no deletions.

- [ ] **Step 5: Final commit (client + any tsc fixups)**

```bash
git add -A
git commit -m "chore: regenerate Prisma client for MemoryProvenance [LUM-280]" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** ① consolidation re-keying → Tasks 1–5 (model, repo+resolve, op field, apply provenance, service wiring). C1 cite + hard-validate → Task 4 (intersection with input window) + Task 6 (prompt). DoD ① stable id = `resolveCanonicalFragment`; DoD ⑥ auditable = provenance rows. Out-of-scope (② ③) intentionally untouched.
- **Type consistency:** `validSourceMemoryIds?: string[]` (optional) used identically in apply input (Task 4) and the service call (Task 5). `sourceMemoryIds?: string[]` on the ADD op (Task 3) consumed in apply (Task 4). `createMany(childMemoryId, parentMemoryIds, tx?)` / `resolveCanonicalFragment(fragmentType, fragmentId)` signatures match between repo (Task 2) and caller (Task 4) and tests.
- **Contract safety:** LineageEdge / ContextFragment / task-context.service untouched — LUM-274/275 stay byte-identical. `resolveCanonicalFragment` is the only new surface for LUM-278 to consume.
- **Downstream (LUM-278):** when 278 aggregates per-fragment, it calls `resolveCanonicalFragment(edge.fragmentType, edge.fragmentId)` before grouping. Left as 278's integration point; this plan ships the function + provenance data.
