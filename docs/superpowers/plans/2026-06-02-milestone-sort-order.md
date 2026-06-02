# Milestone Manual Sort Order (sortOrder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `sortOrder` field to the `Milestone` model with a reorder API and two CLI subcommands (`milestone reorder`, `milestone move`) so a project's milestones can be arranged in an explicit user-chosen order.

**Architecture:** A single server endpoint `PATCH /api/projects/:id/milestones/reorder` accepts the full `orderedIds` array and rewrites `sortOrder = index` in a transaction (mirrors `project.repository.reorder`). The CLI translates both `reorder <refs...>` and `move <ref> --before/--after <ref>` into a complete `orderedIds` array client-side, so the server has one code path. A Prisma migration backfills existing milestones to preserve today's `targetDate → createdAt` order.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Prisma + Neon Postgres, Zod, Jest, Commander (CLI).

**Branch:** `lumo/LUM-160-milestone-sort-order` (already created, spec committed).

**Spec:** `docs/superpowers/specs/2026-06-02-milestone-sort-order-design.md`

---

## File Map

**Create:**

- `prisma/migrations/<timestamp>_milestone_sort_order/migration.sql` — column + index + backfill
- `app/api/projects/[id]/milestones/reorder/route.ts` — PATCH endpoint
- `cli/src/lib/milestone-reorder.ts` — pure resolution/splice helpers (testable, no network)
- `cli/src/commands/milestone-reorder.ts` — `lumo milestone reorder` command
- `cli/src/commands/milestone-move.ts` — `lumo milestone move` command
- `__tests__/repositories/milestone-reorder.test.ts`
- `__tests__/services/milestone-reorder.service.test.ts`
- `__tests__/api-milestones-reorder.test.ts`
- `__tests__/cli/milestone-reorder-logic.test.ts`

**Modify:**

- `prisma/schema.prisma` — add `sortOrder Float @default(0)` + index to `Milestone`
- `lib/repositories/milestone.repository.ts` — `findByProject` orderBy, `reorder`, `getMaxSortOrder`, `create` accepts `sortOrder`, `MilestoneUpdate` type
- `lib/services/milestone.service.ts` — `reorderMilestones`, `createMilestone` appends to bottom
- `lib/validation/schemas.ts` — `reorderMilestonesSchema`
- `lib/api-client/milestones.ts` — `reorder` method
- `app/workspace/[workspaceUrl]/constants.ts` — `API.milestones.reorder`
- `cli/src/index.ts` — register the two new subcommands
- `.claude/skills/lumo/SKILL.md` — docs sync (CLAUDE.md hard requirement)

---

## Task 1: Schema field + migration with backfill

**Files:**

- Modify: `prisma/schema.prisma` (Milestone model, ~lines 504–525)
- Create: `prisma/migrations/<timestamp>_milestone_sort_order/migration.sql`

- [ ] **Step 1: Add the field + index to the schema**

In `prisma/schema.prisma`, inside `model Milestone`, add `sortOrder` after `completedAt` and an index alongside the existing `@@index` lines:

```prisma
model Milestone {
  id          String          @id @default(cuid())
  projectId   String
  name        String
  slug        String
  description String?
  status      MilestoneStatus @default(PLANNED)
  startDate   DateTime?
  targetDate  DateTime?
  completedAt DateTime?
  sortOrder   Float           @default(0)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tasks   Task[]
  summary MilestoneSummary?

  @@unique([projectId, slug])
  @@index([projectId])
  @@index([projectId, status])
  @@index([projectId, sortOrder])
  @@map("milestones")
}
```

- [ ] **Step 2: Generate the migration (creates the SQL, does not yet have backfill)**

Run: `npx prisma migrate dev --name milestone_sort_order --create-only`
Expected: a new folder `prisma/migrations/<timestamp>_milestone_sort_order/` containing `migration.sql` with `ALTER TABLE ... ADD COLUMN "sortOrder"` and a `CREATE INDEX`.

> If `migrate dev` rejects with drift (P3008/P3012), hand-write the `migration.sql` per CLAUDE.md's drift workaround (see "Database Migrations") and use `prisma db execute` + `prisma migrate resolve --applied`. Do NOT `migrate reset`.

- [ ] **Step 3: Append the backfill UPDATE to migration.sql**

Edit the generated `migration.sql` so the full file reads (column + index from generation, then the backfill you add):

```sql
-- AlterTable
ALTER TABLE "milestones" ADD COLUMN "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "milestones_projectId_sortOrder_idx" ON "milestones"("projectId", "sortOrder");

-- Backfill existing milestones so the manual order initially matches the old
-- targetDate (nulls last) -> createdAt ordering. No visible change on deploy.
UPDATE "milestones" m
SET "sortOrder" = sub.rn
FROM (
  SELECT id,
         (ROW_NUMBER() OVER (
            PARTITION BY "projectId"
            ORDER BY "targetDate" ASC NULLS LAST, "createdAt" ASC
          ) - 1)::double precision AS rn
  FROM "milestones"
) sub
WHERE m.id = sub.id;
```

- [ ] **Step 4: Apply the migration locally + regenerate the client**

Run: `npx prisma migrate dev`
Expected: "The following migration(s) have been applied" + the backfill runs. Then run `npx prisma generate`.
(If you used the drift workaround in Step 2, instead run `npx prisma db execute --file prisma/migrations/<timestamp>_milestone_sort_order/migration.sql`, then `npx prisma migrate resolve --applied <timestamp>_milestone_sort_order`, then `npx prisma generate`.)

- [ ] **Step 5: Verify the generated client knows the field**

Run: `npx tsc --noEmit 2>&1 | grep -i "sortOrder" || echo "no sortOrder type errors"`
Expected: `no sortOrder type errors` (the field is now on the generated `Milestone` type).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Milestone.sortOrder column + backfill migration [LUM-160]"
```

---

## Task 2: Repository — ordering, reorder, getMaxSortOrder, create

**Files:**

- Modify: `lib/repositories/milestone.repository.ts`
- Test: `__tests__/repositories/milestone-reorder.test.ts`

- [ ] **Step 1: Write the failing repository test**

Create `__tests__/repositories/milestone-reorder.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    milestone: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'

const mockFindMany = prisma.milestone.findMany as jest.Mock
const mockFindFirst = prisma.milestone.findFirst as jest.Mock
const mockUpdate = prisma.milestone.update as jest.Mock
const mockTx = prisma.$transaction as jest.Mock

beforeEach(() => {
  mockFindMany.mockReset()
  mockFindFirst.mockReset()
  mockUpdate.mockReset()
  mockTx.mockReset()
})

describe('milestoneRepository.findByProject', () => {
  it('orders by sortOrder asc then createdAt asc', async () => {
    mockFindMany.mockResolvedValue([])
    await milestoneRepository.findByProject('p-1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { projectId: 'p-1' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  })
})

describe('milestoneRepository.reorder', () => {
  it('rewrites sortOrder to the array index inside a transaction', async () => {
    // Run the callback passed to $transaction against a fake tx.
    const txUpdate = jest.fn()
    mockTx.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({ milestone: { update: txUpdate } })
    )
    await milestoneRepository.reorder('p-1', ['b', 'a', 'c'])
    expect(txUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'b', projectId: 'p-1' },
      data: { sortOrder: 0 },
    })
    expect(txUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'a', projectId: 'p-1' },
      data: { sortOrder: 1 },
    })
    expect(txUpdate).toHaveBeenNthCalledWith(3, {
      where: { id: 'c', projectId: 'p-1' },
      data: { sortOrder: 2 },
    })
  })
})

describe('milestoneRepository.getMaxSortOrder', () => {
  it('returns the top sortOrder when milestones exist', async () => {
    mockFindFirst.mockResolvedValue({ sortOrder: 4 })
    await expect(milestoneRepository.getMaxSortOrder('p-1')).resolves.toBe(4)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { projectId: 'p-1' },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })
  })

  it('returns null when the project has no milestones', async () => {
    mockFindFirst.mockResolvedValue(null)
    await expect(milestoneRepository.getMaxSortOrder('p-1')).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/repositories/milestone-reorder.test.ts`
Expected: FAIL — `findByProject` still uses the old orderBy; `reorder` and `getMaxSortOrder` are undefined.

- [ ] **Step 3: Implement the repository changes**

In `lib/repositories/milestone.repository.ts`:

(a) Add `sortOrder` to the `MilestoneUpdate` Pick:

```ts
type MilestoneUpdate = Partial<
  Pick<
    Milestone,
    | 'name'
    | 'description'
    | 'status'
    | 'startDate'
    | 'targetDate'
    | 'completedAt'
    | 'sortOrder'
  >
>
```

(b) Replace `findByProject`'s orderBy:

```ts
  async findByProject(projectId: string) {
    return prisma.milestone.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  },
```

(c) Add `sortOrder` to `create`'s input + write-through:

```ts
  async create(data: {
    projectId: string
    name: string
    slug: string
    description?: string | null
    startDate?: Date | null
    targetDate?: Date | null
    sortOrder?: number
  }) {
    return prisma.milestone.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        startDate: data.startDate ?? null,
        targetDate: data.targetDate ?? null,
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    })
  },
```

(d) Add `getMaxSortOrder` and `reorder` (place after `delete`, before `countTasksByStatus`):

```ts
  async getMaxSortOrder(projectId: string): Promise<number | null> {
    const top = await prisma.milestone.findFirst({
      where: { projectId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })
    return top ? top.sortOrder : null
  },

  async reorder(projectId: string, orderedIds: string[]) {
    return prisma.$transaction(async tx => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.milestone.update({
          where: { id: orderedIds[i]!, projectId },
          data: { sortOrder: i },
        })
      }
    })
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/repositories/milestone-reorder.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/milestone.repository.ts __tests__/repositories/milestone-reorder.test.ts
git commit -m "feat: milestone repo reorder + getMaxSortOrder + sortOrder ordering [LUM-160]"
```

---

## Task 3: Service — reorderMilestones + createMilestone appends to bottom

**Files:**

- Modify: `lib/services/milestone.service.ts`
- Test: `__tests__/services/milestone-reorder.service.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `__tests__/services/milestone-reorder.service.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findByProject: jest.fn(),
    findSlugsByProject: jest.fn(),
    getMaxSortOrder: jest.fn(),
    create: jest.fn(),
    reorder: jest.fn(),
  },
}))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {},
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { projectService } from '@/lib/services/project.service'

const mockFindByProject = milestoneRepository.findByProject as jest.Mock
const mockGetMax = milestoneRepository.getMaxSortOrder as jest.Mock
const mockSlugs = milestoneRepository.findSlugsByProject as jest.Mock
const mockCreate = milestoneRepository.create as jest.Mock
const mockReorder = milestoneRepository.reorder as jest.Mock
const mockGetProject = projectService.getProject as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProject.mockResolvedValue({ id: 'p-1' })
})

function expectStatus(p: Promise<unknown>, status: number) {
  return p.then(
    () => {
      throw new Error('expected rejection')
    },
    (e: unknown) => {
      expect((e as { status?: number }).status).toBe(status)
    }
  )
}

describe('milestoneService.reorderMilestones', () => {
  beforeEach(() => {
    mockFindByProject.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  })

  it('rejects a duplicate id with 400', async () => {
    await expectStatus(
      milestoneService.reorderMilestones('p-1', 'mem-1', ['a', 'a', 'b']),
      400
    )
    expect(mockReorder).not.toHaveBeenCalled()
  })

  it('rejects an unknown id with 400', async () => {
    await expectStatus(
      milestoneService.reorderMilestones('p-1', 'mem-1', ['a', 'b', 'x']),
      400
    )
    expect(mockReorder).not.toHaveBeenCalled()
  })

  it('rejects an incomplete set with 400', async () => {
    await expectStatus(
      milestoneService.reorderMilestones('p-1', 'mem-1', ['a', 'b']),
      400
    )
    expect(mockReorder).not.toHaveBeenCalled()
  })

  it('reorders when the set is complete and valid', async () => {
    await milestoneService.reorderMilestones('p-1', 'mem-1', ['c', 'a', 'b'])
    expect(mockGetProject).toHaveBeenCalledWith('p-1', 'mem-1')
    expect(mockReorder).toHaveBeenCalledWith('p-1', ['c', 'a', 'b'])
  })
})

describe('milestoneService.createMilestone', () => {
  it('appends to the bottom (max + 1) when milestones exist', async () => {
    mockSlugs.mockResolvedValue([])
    mockGetMax.mockResolvedValue(2)
    mockCreate.mockResolvedValue({ id: 'new' })
    await milestoneService.createMilestone('p-1', 'mem-1', { name: 'New' })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 3 })
    )
  })

  it('uses sortOrder 0 for the first milestone in a project', async () => {
    mockSlugs.mockResolvedValue([])
    mockGetMax.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 'new' })
    await milestoneService.createMilestone('p-1', 'mem-1', { name: 'First' })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 0 })
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/services/milestone-reorder.service.test.ts`
Expected: FAIL — `reorderMilestones` is undefined; `createMilestone` does not pass `sortOrder`.

- [ ] **Step 3: Implement the service changes**

In `lib/services/milestone.service.ts`, update `createMilestone` to compute the append position (insert the two new lines before the `return`):

```ts
  async createMilestone(
    projectId: string,
    memberId: string,
    input: CreateInput
  ) {
    await projectService.getProject(projectId, memberId)
    const existingSlugs = new Set(
      await milestoneRepository.findSlugsByProject(projectId)
    )
    const slug = resolveUniqueMilestoneSlug(
      buildMilestoneSlugBase(input.name),
      existingSlugs
    )
    const maxSortOrder = await milestoneRepository.getMaxSortOrder(projectId)
    const sortOrder = maxSortOrder === null ? 0 : maxSortOrder + 1
    return milestoneRepository.create({
      projectId,
      name: input.name,
      slug,
      description: input.description ?? null,
      sortOrder,
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
    })
  },
```

Then add `reorderMilestones` (place after `deleteMilestone`, before `listTasks`):

```ts
  async reorderMilestones(
    projectId: string,
    memberId: string,
    orderedIds: string[]
  ) {
    await projectService.getProject(projectId, memberId)

    const milestones = await milestoneRepository.findByProject(projectId)
    const known = new Set(milestones.map(m => m.id))

    if (new Set(orderedIds).size !== orderedIds.length) {
      throw Object.assign(
        new Error('orderedIds must not contain duplicates'),
        { status: 400 }
      )
    }
    const unknown = orderedIds.find(id => !known.has(id))
    if (unknown) {
      throw Object.assign(
        new Error('orderedIds contains a milestone not in this project'),
        { status: 400 }
      )
    }
    if (orderedIds.length !== milestones.length) {
      throw Object.assign(
        new Error('orderedIds must list every milestone in the project'),
        { status: 400 }
      )
    }

    await milestoneRepository.reorder(projectId, orderedIds)
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/services/milestone-reorder.service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/milestone.service.ts __tests__/services/milestone-reorder.service.test.ts
git commit -m "feat: milestoneService.reorderMilestones + append-on-create [LUM-160]"
```

---

## Task 4: Validation schema + API route

**Files:**

- Modify: `lib/validation/schemas.ts`
- Create: `app/api/projects/[id]/milestones/reorder/route.ts`
- Test: `__tests__/api-milestones-reorder.test.ts`

- [ ] **Step 1: Add the validation schema**

In `lib/validation/schemas.ts`, directly below `reorderProjectsSchema`, add:

```ts
export const reorderMilestonesSchema = z.object({
  orderedIds: z
    .array(z.string().cuid())
    .min(1, 'orderedIds must contain at least one id')
    .max(500, 'orderedIds is limited to 500 entries'),
})
```

- [ ] **Step 2: Write the failing API route test**

Create `__tests__/api-milestones-reorder.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/helpers', () => ({
  loadProjectAndMember: jest.fn(),
  zodError: jest.requireActual('@/lib/api/helpers').zodError,
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { reorderMilestones: jest.fn() },
}))

import { PATCH } from '@/app/api/projects/[id]/milestones/reorder/route'
import { requireIdentity } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'

const mockIdentity = requireIdentity as jest.Mock
const mockLoad = loadProjectAndMember as jest.Mock
const mockReorder = milestoneService.reorderMilestones as jest.Mock

const CUID = 'clm00000000000000000000a'

function req(body: unknown) {
  return new NextRequest(
    'http://localhost/api/projects/p-1/milestones/reorder',
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    }
  )
}
const params = { params: Promise.resolve({ id: 'p-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue({ clerkId: 'u-1' })
  mockLoad.mockResolvedValue({ member: { id: 'mem-1' } })
})

describe('PATCH /api/projects/[id]/milestones/reorder', () => {
  it('returns ok when the service succeeds', async () => {
    mockReorder.mockResolvedValue(undefined)
    const res = await PATCH(req({ orderedIds: [CUID] }), params)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mockReorder).toHaveBeenCalledWith('p-1', 'mem-1', [CUID])
  })

  it('returns 400 on an invalid body (non-cuid id)', async () => {
    const res = await PATCH(req({ orderedIds: ['not-a-cuid'] }), params)
    expect(res.status).toBe(400)
    expect(mockReorder).not.toHaveBeenCalled()
  })

  it('propagates a service 400 (incomplete set)', async () => {
    mockReorder.mockRejectedValue(
      Object.assign(new Error('incomplete'), { status: 400 })
    )
    const res = await PATCH(req({ orderedIds: [CUID] }), params)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'incomplete' })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/api-milestones-reorder.test.ts`
Expected: FAIL — the route module does not exist yet.

- [ ] **Step 4: Create the route**

Create `app/api/projects/[id]/milestones/reorder/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { reorderMilestonesSchema } from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ id: string }>
}

/**
 * PATCH /api/projects/[id]/milestones/reorder
 * Body: { orderedIds: string[] }
 * Rewrites Milestone.sortOrder for every milestone in the project to match the
 * supplied order. orderedIds must list every milestone in the project exactly
 * once (enforced in the service).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const result = await loadProjectAndMember(id, identity.clerkId)
    if (result instanceof NextResponse) return result
    const { member } = result

    const body = await request.json()
    const parsed = reorderMilestonesSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    await milestoneService.reorderMilestones(
      id,
      member.id,
      parsed.data.orderedIds
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/api-milestones-reorder.test.ts`
Expected: PASS (3 tests).

> If `loadProjectAndMember` / `requireIdentity` signatures differ from the assumptions here, mirror the exact usage in `app/api/projects/[id]/milestones/route.ts` (the POST handler) — this route is a copy of that auth preamble.

- [ ] **Step 6: Commit**

```bash
git add lib/validation/schemas.ts "app/api/projects/[id]/milestones/reorder/route.ts" __tests__/api-milestones-reorder.test.ts
git commit -m "feat: PATCH milestones/reorder route + schema [LUM-160]"
```

---

## Task 5: API client + constants

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts`
- Modify: `lib/api-client/milestones.ts`

- [ ] **Step 1: Add the constant**

In `app/workspace/[workspaceUrl]/constants.ts`, inside the `milestones:` block, add a `reorder` entry:

```ts
  milestones: {
    listByProject: (projectId: string) =>
      `/api/projects/${projectId}/milestones`,
    byId: (milestoneId: string) => `/api/milestones/${milestoneId}`,
    byProjectAndSlug: (projectId: string, slug: string) =>
      `/api/projects/${projectId}/milestones/by-slug/${encodeURIComponent(slug)}`,
    reorder: (projectId: string) =>
      `/api/projects/${projectId}/milestones/reorder`,
  },
```

- [ ] **Step 2: Add the client method**

In `lib/api-client/milestones.ts`, add to `milestonesClient` (after `delete`):

```ts
  reorder(projectId: string, orderedIds: string[]) {
    return apiFetch<{ ok: boolean }>(API.milestones.reorder(projectId), {
      method: 'PATCH',
      body: { orderedIds },
    })
  },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/workspace/[workspaceUrl]/constants.ts" lib/api-client/milestones.ts
git commit -m "feat: milestones API client reorder method + constant [LUM-160]"
```

---

## Task 6: CLI pure helper lib (resolution + splice)

**Files:**

- Create: `cli/src/lib/milestone-reorder.ts`
- Test: `__tests__/cli/milestone-reorder-logic.test.ts`

- [ ] **Step 1: Write the failing logic test**

Create `__tests__/cli/milestone-reorder-logic.test.ts`:

```ts
/**
 * @jest-environment node
 */
import {
  resolveOrderedIds,
  computeMoveOrder,
  type MilestoneRef,
} from '@/cli/src/lib/milestone-reorder'

const MS: MilestoneRef[] = [
  { id: 'm-a', name: 'Alpha', sortOrder: 0 },
  { id: 'm-b', name: 'Beta', sortOrder: 1 },
  { id: 'm-c', name: 'Gamma', sortOrder: 2 },
]

describe('resolveOrderedIds', () => {
  it('maps a full list of names (case-insensitive) to ids in order', () => {
    const r = resolveOrderedIds(['gamma', 'Alpha', 'BETA'], MS)
    expect(r).toEqual({ ok: true, orderedIds: ['m-c', 'm-a', 'm-b'] })
  })

  it('resolves by UUID too', () => {
    const r = resolveOrderedIds(['m-c', 'm-b', 'm-a'], MS)
    expect(r).toEqual({ ok: true, orderedIds: ['m-c', 'm-b', 'm-a'] })
  })

  it('errors on an unknown ref', () => {
    const r = resolveOrderedIds(['Alpha', 'Nope', 'Beta'], MS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Nope')
  })

  it('errors on a duplicate ref', () => {
    const r = resolveOrderedIds(['Alpha', 'Alpha', 'Beta'], MS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('duplicate')
  })

  it('errors on an incomplete set, listing the missing names', () => {
    const r = resolveOrderedIds(['Alpha', 'Beta'], MS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Gamma')
  })
})

describe('computeMoveOrder', () => {
  it('moves a milestone before a target', () => {
    const r = computeMoveOrder('Gamma', 'Alpha', 'before', MS)
    expect(r).toEqual({ ok: true, orderedIds: ['m-c', 'm-a', 'm-b'] })
  })

  it('moves a milestone after a target', () => {
    const r = computeMoveOrder('Alpha', 'Gamma', 'after', MS)
    expect(r).toEqual({ ok: true, orderedIds: ['m-b', 'm-c', 'm-a'] })
  })

  it('errors when the milestone to move is not found', () => {
    const r = computeMoveOrder('Nope', 'Alpha', 'before', MS)
    expect(r.ok).toBe(false)
  })

  it('errors when the target is not found', () => {
    const r = computeMoveOrder('Alpha', 'Nope', 'before', MS)
    expect(r.ok).toBe(false)
  })

  it('errors when moving a milestone relative to itself', () => {
    const r = computeMoveOrder('Alpha', 'Alpha', 'before', MS)
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/cli/milestone-reorder-logic.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the helper**

Create `cli/src/lib/milestone-reorder.ts`:

```ts
export interface MilestoneRef {
  id: string
  name: string
  sortOrder: number
}

export type ResolveResult =
  | { ok: true; orderedIds: string[] }
  | { ok: false; error: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function findRef(
  ref: string,
  milestones: MilestoneRef[]
): MilestoneRef | undefined {
  if (UUID_RE.test(ref)) return milestones.find(m => m.id === ref)
  const needle = ref.trim().toLowerCase()
  return milestones.find(m => m.name.toLowerCase() === needle)
}

/** Milestones in current display order (sortOrder asc, stable). */
function sorted(milestones: MilestoneRef[]): MilestoneRef[] {
  return [...milestones].sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Resolve a full list of milestone refs (name or UUID) to ids in the given
 * order. The list must name EVERY milestone in the project exactly once.
 */
export function resolveOrderedIds(
  refs: string[],
  milestones: MilestoneRef[]
): ResolveResult {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const match = findRef(ref, milestones)
    if (!match) {
      return { ok: false, error: `unknown milestone: "${ref}"` }
    }
    if (seen.has(match.id)) {
      return { ok: false, error: `duplicate milestone: "${ref}"` }
    }
    seen.add(match.id)
    ids.push(match.id)
  }
  if (ids.length !== milestones.length) {
    const missing = milestones.filter(m => !seen.has(m.id)).map(m => m.name)
    return {
      ok: false,
      error: `incomplete order: list every milestone. Missing: ${missing.join(', ')}`,
    }
  }
  return { ok: true, orderedIds: ids }
}

/**
 * Compute the full orderedIds after moving `moveRef` immediately before/after
 * `targetRef` in the project's current order.
 */
export function computeMoveOrder(
  moveRef: string,
  targetRef: string,
  position: 'before' | 'after',
  milestones: MilestoneRef[]
): ResolveResult {
  const move = findRef(moveRef, milestones)
  if (!move) return { ok: false, error: `unknown milestone: "${moveRef}"` }
  const target = findRef(targetRef, milestones)
  if (!target) return { ok: false, error: `unknown milestone: "${targetRef}"` }
  if (move.id === target.id) {
    return { ok: false, error: 'cannot move a milestone relative to itself' }
  }

  const order = sorted(milestones)
    .map(m => m.id)
    .filter(id => id !== move.id)
  const targetIndex = order.indexOf(target.id)
  const insertAt = position === 'before' ? targetIndex : targetIndex + 1
  order.splice(insertAt, 0, move.id)
  return { ok: true, orderedIds: order }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/cli/milestone-reorder-logic.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/milestone-reorder.ts __tests__/cli/milestone-reorder-logic.test.ts
git commit -m "feat: CLI milestone reorder/move pure helpers [LUM-160]"
```

---

## Task 7: CLI commands + registration

**Files:**

- Create: `cli/src/commands/milestone-reorder.ts`
- Create: `cli/src/commands/milestone-move.ts`
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Implement `milestone reorder` command**

Create `cli/src/commands/milestone-reorder.ts`:

```ts
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { resolveOrderedIds, type MilestoneRef } from '../lib/milestone-reorder'

export interface ReorderMilestoneOptions {
  project?: string | undefined
}

interface MilestoneListRow {
  id: string
  name: string
  sortOrder: number
}

export async function milestoneReorder(
  refs: string[],
  opts: ReorderMilestoneOptions
): Promise<number | void> {
  if (!refs || refs.length === 0) {
    console.error(
      'Error: usage: lumo milestone reorder <ref...> [--project <ref>]'
    )
    return 1
  }
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  try {
    projectId = await resolveProjectId(base, creds.token, opts.project)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const listRes = await fetch(`${base}/api/projects/${projectId}/milestones`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!listRes.ok) {
    console.error(`Error: milestone list failed (HTTP ${listRes.status})`)
    return 1
  }
  const { milestones } = (await listRes.json()) as {
    milestones: MilestoneListRow[]
  }
  const refRows: MilestoneRef[] = milestones.map(m => ({
    id: m.id,
    name: m.name,
    sortOrder: m.sortOrder,
  }))

  const resolved = resolveOrderedIds(refs, refRows)
  if (!resolved.ok) {
    console.error(`Error: ${resolved.error}`)
    return 1
  }

  const patchRes = await fetch(
    `${base}/api/projects/${projectId}/milestones/reorder`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderedIds: resolved.orderedIds }),
    }
  )
  if (!patchRes.ok) {
    const text = await patchRes.text()
    let msg = text
    try {
      const json = JSON.parse(text) as { error?: string }
      if (json.error) msg = json.error
    } catch {}
    console.error(
      `Error: ${patchRes.status} ${patchRes.statusText}: ${sanitizeField(msg)}`
    )
    return 1
  }

  const byId = new Map(refRows.map(m => [m.id, m.name]))
  console.log(`Reordered ${resolved.orderedIds.length} milestones:`)
  resolved.orderedIds.forEach((id, i) => {
    console.log(`  ${i + 1}. ${sanitizeField(byId.get(id) ?? id)}`)
  })
}
```

- [ ] **Step 2: Implement `milestone move` command**

Create `cli/src/commands/milestone-move.ts`:

```ts
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { computeMoveOrder, type MilestoneRef } from '../lib/milestone-reorder'

export interface MoveMilestoneOptions {
  project?: string | undefined
  before?: string | undefined
  after?: string | undefined
}

interface MilestoneListRow {
  id: string
  name: string
  sortOrder: number
}

export async function milestoneMove(
  reference: string | undefined,
  opts: MoveMilestoneOptions
): Promise<number | void> {
  if (!reference) {
    console.error(
      'Error: usage: lumo milestone move <ref> --before <ref> | --after <ref>'
    )
    return 1
  }
  const hasBefore = typeof opts.before === 'string' && opts.before.length > 0
  const hasAfter = typeof opts.after === 'string' && opts.after.length > 0
  if (hasBefore && hasAfter) {
    console.error('Error: --before and --after are mutually exclusive')
    return 1
  }
  if (!hasBefore && !hasAfter) {
    console.error('Error: specify --before <ref> or --after <ref>')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  try {
    projectId = await resolveProjectId(base, creds.token, opts.project)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const listRes = await fetch(`${base}/api/projects/${projectId}/milestones`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!listRes.ok) {
    console.error(`Error: milestone list failed (HTTP ${listRes.status})`)
    return 1
  }
  const { milestones } = (await listRes.json()) as {
    milestones: MilestoneListRow[]
  }
  const refRows: MilestoneRef[] = milestones.map(m => ({
    id: m.id,
    name: m.name,
    sortOrder: m.sortOrder,
  }))

  const position: 'before' | 'after' = hasBefore ? 'before' : 'after'
  const targetRef = (hasBefore ? opts.before : opts.after) as string
  const resolved = computeMoveOrder(reference, targetRef, position, refRows)
  if (!resolved.ok) {
    console.error(`Error: ${resolved.error}`)
    return 1
  }

  const patchRes = await fetch(
    `${base}/api/projects/${projectId}/milestones/reorder`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderedIds: resolved.orderedIds }),
    }
  )
  if (!patchRes.ok) {
    const text = await patchRes.text()
    let msg = text
    try {
      const json = JSON.parse(text) as { error?: string }
      if (json.error) msg = json.error
    } catch {}
    console.error(
      `Error: ${patchRes.status} ${patchRes.statusText}: ${sanitizeField(msg)}`
    )
    return 1
  }

  const byId = new Map(refRows.map(m => [m.id, m.name]))
  console.log(
    `Moved "${sanitizeField(reference)}" ${position} "${sanitizeField(targetRef)}". New order:`
  )
  resolved.orderedIds.forEach((id, i) => {
    console.log(`  ${i + 1}. ${sanitizeField(byId.get(id) ?? id)}`)
  })
}
```

- [ ] **Step 3: Register both commands in `cli/src/index.ts`**

Add the imports near the other milestone imports (after line 50):

```ts
import { milestoneReorder } from './commands/milestone-reorder'
import { milestoneMove } from './commands/milestone-move'
```

Then register the subcommands inside the `milestoneCmd` block (place after the `summary` subcommand, before `const sprintCmd =`):

```ts
milestoneCmd
  .command('reorder <refs...>')
  .description(
    "Reorder a project's milestones. Pass every milestone (name or UUID) in the desired order. --project required when workspace has >1 project."
  )
  .option('--project <ref>', 'Project name or slug')
  .action(
    wrap((refs, options) =>
      milestoneReorder(refs as string[], options as { project?: string })
    )
  )

milestoneCmd
  .command('move <ref>')
  .description(
    'Move one milestone before or after another. --before and --after are mutually exclusive; exactly one is required. --project required when workspace has >1 project.'
  )
  .option('--project <ref>', 'Project name or slug')
  .option('--before <ref>', 'Place <ref> immediately before this milestone')
  .option('--after <ref>', 'Place <ref> immediately after this milestone')
  .action(
    wrap((ref, options) =>
      milestoneMove(
        ref as string,
        options as { project?: string; before?: string; after?: string }
      )
    )
  )
```

- [ ] **Step 4: Build the CLI + typecheck**

Run: `cd cli && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/milestone-reorder.ts cli/src/commands/milestone-move.ts cli/src/index.ts
git commit -m "feat: lumo milestone reorder + move commands [LUM-160]"
```

---

## Task 8: Docs sync (SKILL.md) + CLI version bump

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`
- Modify: `cli/package.json` (version bump — CLI behavior changed)

- [ ] **Step 1: Update the SKILL.md frontmatter triggers**

In `.claude/skills/lumo/SKILL.md`, add trigger words to the frontmatter `description` (find the milestone trigger list and append): `"milestone reorder", "milestone move", "reorder milestones", "里程碑排序", "里程碑调序", "move milestone before", "move milestone after"`.

- [ ] **Step 2: Add command documentation sections**

In `.claude/skills/lumo/SKILL.md`, after the `### lumo milestone summary ...` section, add:

````markdown
### `lumo milestone reorder <ref...> [--project <ref>]` — set the full milestone order

Reorders a project's milestones. Pass **every** milestone in the project (by name,
case-insensitive, or UUID) in the desired order — the command rewrites
`sortOrder` to match. An incomplete list, an unknown ref, or a duplicate is
rejected before any network mutation.

```bash
lumo milestone reorder "Q3 Launch" "Beta" "Alpha"
lumo milestone reorder "Q3 Launch" "Beta" "Alpha" --project backend
```

`--project <ref>` is required when the workspace has more than one project.

Output:

```
Reordered 3 milestones:
  1. Q3 Launch
  2. Beta
  3. Alpha
```

### `lumo milestone move <ref> --before <ref> | --after <ref> [--project <ref>]` — move one milestone

Moves a single milestone immediately before or after a target milestone, leaving
the rest in their current relative order. `--before` and `--after` are mutually
exclusive and exactly one is required (errors before any network call if both or
neither is given).

```bash
lumo milestone move "Alpha" --before "Q3 Launch"
lumo milestone move "Alpha" --after "Beta" --project backend
```

Output:

```
Moved "Alpha" before "Q3 Launch". New order:
  1. Alpha
  2. Q3 Launch
  3. Beta
```

Both commands resolve to a full ordered list client-side and call the same
`PATCH /api/projects/<id>/milestones/reorder` endpoint. New milestones created via
`milestone create` are appended to the bottom of the order.
````

- [ ] **Step 3: Bump the CLI version**

In `cli/package.json`, bump the `version` minor (new feature). E.g. `1.11.0` → `1.12.0`.

> Per project memory: user-facing `cli/src` changes need a `cli/package.json` bump AND a manual `cd cli && npm publish` (no CI publishes). The publish happens at release time, not in this task — just bump the version here.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/lumo/SKILL.md cli/package.json
git commit -m "docs: SKILL.md milestone reorder/move + CLI version bump [LUM-160]"
```

---

## Task 9: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx jest __tests__/repositories/milestone-reorder.test.ts __tests__/services/milestone-reorder.service.test.ts __tests__/api-milestones-reorder.test.ts __tests__/cli/milestone-reorder-logic.test.ts`
Expected: all PASS.

- [ ] **Step 2: Full typecheck (root + CLI)**

Run: `npx tsc --noEmit && cd cli && npx tsc --noEmit && cd ..`
Expected: no errors. (If you see "TaskArtifact not exported"-style phantom errors, run `npx prisma generate` first — stale client, per project memory.)

- [ ] **Step 3: Run the broader milestone test set to catch regressions**

Run: `npx jest milestone`
Expected: all PASS (existing milestone tests still green — `findByProject` orderBy change and `createMilestone` change are covered).

- [ ] **Step 4: Token lint (only if any styling touched — expected no-op here)**

Run: `npm run lint:tokens`
Expected: pass (no UI changes in this task).

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin lumo/LUM-160-milestone-sort-order
gh pr create --title "feat: milestone manual sort order (sortOrder) [LUM-160]" --body "$(cat <<'EOF'
## Summary
- Adds `Milestone.sortOrder` (Float) with a backfill migration preserving the current targetDate → createdAt order.
- New `PATCH /api/projects/:id/milestones/reorder` endpoint (full orderedIds, rewrites sortOrder).
- CLI: `lumo milestone reorder <refs...>` and `lumo milestone move <ref> --before/--after <ref>` (both resolve to a complete order client-side).
- New milestones now append to the bottom of the order.

## Production
- **Requires `prisma migrate deploy` on next deploy.** Migration is additive (new column + index + backfill UPDATE); non-destructive.

## Test plan
- Repository, service, API route, and CLI-logic unit tests added.
- `npx tsc --noEmit` clean (root + cli); `npx jest milestone` green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Post-merge reminder**

After merge + deploy, verify the migration applied on prod (`prisma migrate status` against the prod URL, or the deploy log). A merged PR alone does not migrate prod (project memory: Vercel has skipped `migrate deploy` before).

---

## Self-Review notes

- **Spec coverage:** schema+migration (T1), repo ordering/reorder/getMax (T2), service reorder + append (T3), validation+route (T4), api-client+constants (T5), CLI helpers (T6), CLI commands+registration (T7), SKILL.md docs (T8), verification+prod note (T9). All spec sections mapped.
- **Auth pattern:** the reorder route mirrors the existing project-scoped milestone route (`requireIdentity` + `loadProjectAndMember`), not the workspace-scoped `projects/reorder` route — verified against `app/api/projects/[id]/milestones/route.ts`.
- **Type consistency:** `MilestoneRef { id, name, sortOrder }`, `ResolveResult` discriminated union, `resolveOrderedIds`/`computeMoveOrder` names used identically in T6 and T7.
- **Completeness semantics:** enforced twice on purpose — CLI (`resolveOrderedIds`, friendly error listing missing names) and server (`reorderMilestones`, authoritative 400). The CLI check is UX; the server check is the guarantee.
