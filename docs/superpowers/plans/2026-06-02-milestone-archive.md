# Milestone Soft-Archive (archivedAt) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a soft-archive capability to milestones — a nullable `archivedAt` timestamp, distinct from hard delete — so milestones can be hidden from lists by default, keep their history/task links, and be restored.

**Architecture:** Follows Lumo's layered flow `CLI → API Route → Service → Repository → Prisma`. `archivedAt` is orthogonal to `status`: any status can be archived/unarchived. Listing default-excludes archived (`filter: active|archived|all`); _addressing by name_ sees all milestones; archived milestones are frozen for edits and reject new task bindings. Hard delete is unchanged. Frontend auto-hides archived because it consumes the same default list API — no frontend code in this task.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Prisma + Postgres, Zod, Jest, Commander-based CLI (`cli/`).

**Spec:** `docs/superpowers/specs/2026-06-02-milestone-archive-design.md`

---

## Scope refinements (decided during planning, consistent with the approved spec)

- **CLI uses raw `fetch`**, not the frontend `lib/api-client`. So the api-client gets only an accurate `archivedAt` field on `ApiMilestone` (typing); **no** `archive`/`unarchive`/`filter` client methods are added — they would be dead code (YAGNI / CLAUDE.md "no unused").
- **Name addressing must see archived milestones.** CLI `resolveMilestoneId` (in `cli/src/lib/resolve.ts`) is changed to request `?filter=all`, otherwise `milestone unarchive <name>` / `show <name>` couldn't find an archived milestone. This is an _addressing_ concern, separate from _display_ (default-active) and _binding_ (server rejects archived).
- **Binding guard** lives at the two server-side `milestoneId` validation points (`task-creation.service.ts`, `task-state.service.ts`). The by-name CLI binding path is _additionally_ blocked because the server's `task-cli.service.ts` `resolveMilestoneId` lists active-only.

---

## File Structure

**Created:**

- `prisma/migrations/20260602020000_add_milestone_archived_at/migration.sql` — add column + index
- `app/api/milestones/[milestoneId]/archive/route.ts` — POST archive
- `app/api/milestones/[milestoneId]/unarchive/route.ts` — POST unarchive
- `cli/src/commands/milestone-archive.ts` — `milestone archive <identifier>`
- `cli/src/commands/milestone-unarchive.ts` — `milestone unarchive <identifier>`
- `__tests__/lib/repositories/milestone-archive.repository.test.ts`
- `__tests__/api-milestone-archive.test.ts`
- `__tests__/cli/milestone-archive-format.test.ts`

**Modified:**

- `prisma/schema.prisma` — `Milestone.archivedAt` + index
- `lib/repositories/milestone.repository.ts` — `findByProject(projectId, filter)`, `archive`, `unarchive`
- `lib/services/milestone.service.ts` — `listMilestones(…, filter)`, `archiveMilestone`, `unarchiveMilestone`, update freeze guard
- `lib/validation/schemas.ts` — `listMilestonesQuerySchema`
- `app/api/projects/[id]/milestones/route.ts` — parse `?filter=` on GET
- `lib/services/task-creation.service.ts` — reject archived milestone bind
- `lib/services/task-state.service.ts` — reject archived milestone bind
- `lib/api-client/milestones.ts` — `archivedAt` field on `ApiMilestone`
- `cli/src/lib/resolve.ts` — `resolveMilestoneId` lists with `?filter=all`
- `cli/src/commands/milestone-list.ts` — `--archived` / `--all` flags + archived marker
- `cli/src/commands/milestone-show.ts` — `Archived:` line
- `cli/src/index.ts` — register `archive`/`unarchive`, add list flags
- `cli/package.json` — version bump (minor)
- `.claude/skills/lumo/SKILL.md` — document new commands/flags + triggers
- `__tests__/lib/services/milestone.service.test.ts` — update `findByProject` call assertion; add archive/unarchive/freeze tests
- `__tests__/lib/repositories/milestone.repository.test.ts` — update `findByProject` filter assertions (if present)
- `__tests__/lib/services/task-state.service.test.ts` — add archived-milestone bind guard case (reuses its full mock scaffolding)
- `__tests__/lib/services/task-creation.service.test.ts` — add archived-milestone bind guard case (reuses its full mock scaffolding)

---

## Task 1: Schema + migration for `archivedAt`

**Files:**

- Modify: `prisma/schema.prisma` (Milestone model, ~lines 504-525)
- Create: `prisma/migrations/20260602020000_add_milestone_archived_at/migration.sql`

- [ ] **Step 1: Add the field + index to the schema**

In `prisma/schema.prisma`, inside `model Milestone`, add `archivedAt` after `completedAt` and a new index alongside the existing ones:

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
  archivedAt  DateTime?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tasks   Task[]
  summary MilestoneSummary?

  @@unique([projectId, slug])
  @@index([projectId])
  @@index([projectId, status])
  @@index([projectId, archivedAt])
  @@map("milestones")
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260602020000_add_milestone_archived_at/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "milestones" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "milestones_projectId_archivedAt_idx" ON "milestones"("projectId", "archivedAt");
```

- [ ] **Step 3: Apply the migration + regenerate the client**

Run: `npx prisma migrate dev --name add_milestone_archived_at`
Expected: "Your database is now in sync with your schema." and the client regenerates.

If Prisma rejects with drift (P3008 / P3012), follow CLAUDE.md's documented workaround (do NOT reset):

```bash
npx prisma db execute --file prisma/migrations/20260602020000_add_milestone_archived_at/migration.sql
npx prisma migrate resolve --applied 20260602020000_add_milestone_archived_at
npx prisma generate
```

- [ ] **Step 4: Verify the generated client knows the field**

Run: `npx tsc --noEmit 2>&1 | grep -i archivedAt || echo "no archivedAt type errors"`
Expected: `no archivedAt type errors` (the column is now part of the generated `Milestone` type).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260602020000_add_milestone_archived_at
git commit -m "feat: add Milestone.archivedAt column + index [LUM-161]"
```

---

## Task 2: Repository — list filter + archive/unarchive

**Files:**

- Modify: `lib/repositories/milestone.repository.ts`
- Test: `__tests__/lib/repositories/milestone-archive.repository.test.ts`

- [ ] **Step 1: Write failing tests for the new repo behavior**

Create `__tests__/lib/repositories/milestone-archive.repository.test.ts`:

```ts
/**
 * @jest-environment node
 */
const mockFindMany = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    milestone: {
      findMany: (...a: any[]) => mockFindMany(...a),
      update: (...a: any[]) => mockUpdate(...a),
    },
  },
}))

import { milestoneRepository } from '@/lib/repositories/milestone.repository'

beforeEach(() => {
  jest.clearAllMocks()
  mockFindMany.mockResolvedValue([])
  mockUpdate.mockResolvedValue({ id: 'm1' })
})

describe('milestoneRepository.findByProject filter', () => {
  it('defaults to active (archivedAt: null)', async () => {
    await milestoneRepository.findByProject('p1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1', archivedAt: null } })
    )
  })

  it('filter=archived selects only archived', async () => {
    await milestoneRepository.findByProject('p1', 'archived')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', archivedAt: { not: null } },
      })
    )
  })

  it('filter=all applies no archivedAt condition', async () => {
    await milestoneRepository.findByProject('p1', 'all')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1' } })
    )
  })
})

describe('milestoneRepository.archive / unarchive', () => {
  it('archive sets archivedAt to the given date', async () => {
    const at = new Date('2026-06-02T00:00:00.000Z')
    await milestoneRepository.archive('m1', at)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { archivedAt: at },
    })
  })

  it('unarchive clears archivedAt', async () => {
    await milestoneRepository.unarchive('m1')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { archivedAt: null },
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/lib/repositories/milestone-archive.repository.test.ts`
Expected: FAIL — `findByProject` ignores the filter arg / `archive`/`unarchive` are not functions.

- [ ] **Step 3: Implement**

In `lib/repositories/milestone.repository.ts`, add the filter type export, rewrite `findByProject`, and add `archive`/`unarchive`. Replace the existing `findByProject` (lines 27-35):

```ts
export type MilestoneListFilter = 'active' | 'archived' | 'all'

// ... inside milestoneRepository:

  async findByProject(
    projectId: string,
    filter: MilestoneListFilter = 'active'
  ) {
    const where: {
      projectId: string
      archivedAt?: null | { not: null }
    } = { projectId }
    if (filter === 'active') where.archivedAt = null
    else if (filter === 'archived') where.archivedAt = { not: null }
    return prisma.milestone.findMany({
      where,
      orderBy: [
        { targetDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    })
  },
```

Add `archive`/`unarchive` next to `delete`:

```ts
  async archive(id: string, archivedAt: Date) {
    return prisma.milestone.update({
      where: { id },
      data: { archivedAt },
    })
  },

  async unarchive(id: string) {
    return prisma.milestone.update({
      where: { id },
      data: { archivedAt: null },
    })
  },
```

Put `export type MilestoneListFilter = …` at the top of the file (after the imports), so the service can import it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/lib/repositories/milestone-archive.repository.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Fix the pre-existing repo test if it asserts the old where-shape**

Run: `npx jest __tests__/lib/repositories/milestone.repository.test.ts`
If it fails because `findByProject` now adds `archivedAt: null`, update those assertions to include `archivedAt: null` for the default call. If it passes, do nothing.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/milestone.repository.ts __tests__/lib/repositories/milestone-archive.repository.test.ts __tests__/lib/repositories/milestone.repository.test.ts
git commit -m "feat: milestone repository filter + archive/unarchive [LUM-161]"
```

---

## Task 3: Service — list filter, archive/unarchive, edit-freeze guard

**Files:**

- Modify: `lib/services/milestone.service.ts`
- Test: `__tests__/lib/services/milestone.service.test.ts`

- [ ] **Step 1: Write failing tests**

In `__tests__/lib/services/milestone.service.test.ts`:

1. Update the existing `listMilestones` assertion at line 40 from `toHaveBeenCalledWith('p1')` to `toHaveBeenCalledWith('p1', 'active')`.

2. Add these mocks near the top mock list (the `jest.mock` factory at lines 16-26): add `archive` and `unarchive` to the mocked repository object:

```ts
const mockRepoArchive = jest.fn()
const mockRepoUnarchive = jest.fn()
// inside milestoneRepository mock object:
    archive: (...a: any[]) => mockRepoArchive(...a),
    unarchive: (...a: any[]) => mockRepoUnarchive(...a),
```

3. Append these describe blocks:

```ts
describe('milestoneService.listMilestones filter', () => {
  it('passes the filter through to the repository', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindByProject.mockResolvedValue([])
    await milestoneService.listMilestones('p1', 'mem1', 'all')
    expect(mockRepoFindByProject).toHaveBeenCalledWith('p1', 'all')
  })
})

describe('milestoneService.archiveMilestone', () => {
  it('throws 404 when not found', async () => {
    mockRepoFindById.mockResolvedValue(null)
    await expect(
      milestoneService.archiveMilestone('m-x', 'mem1')
    ).rejects.toMatchObject({ message: 'Milestone not found', status: 404 })
  })

  it('archives after permission check when not already archived', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      archivedAt: null,
    })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoArchive.mockResolvedValue({ id: 'm1', archivedAt: new Date() })
    await milestoneService.archiveMilestone('m1', 'mem1')
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(mockRepoArchive).toHaveBeenCalledWith('m1', expect.any(Date))
  })

  it('is idempotent: returns existing without re-archiving', async () => {
    const existing = { id: 'm1', projectId: 'p1', archivedAt: new Date() }
    mockRepoFindById.mockResolvedValue(existing)
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    const result = await milestoneService.archiveMilestone('m1', 'mem1')
    expect(mockRepoArchive).not.toHaveBeenCalled()
    expect(result).toBe(existing)
  })
})

describe('milestoneService.unarchiveMilestone', () => {
  it('unarchives when currently archived', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      archivedAt: new Date(),
    })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoUnarchive.mockResolvedValue({ id: 'm1', archivedAt: null })
    await milestoneService.unarchiveMilestone('m1', 'mem1')
    expect(mockRepoUnarchive).toHaveBeenCalledWith('m1')
  })

  it('is idempotent: returns existing when not archived', async () => {
    const existing = { id: 'm1', projectId: 'p1', archivedAt: null }
    mockRepoFindById.mockResolvedValue(existing)
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    const result = await milestoneService.unarchiveMilestone('m1', 'mem1')
    expect(mockRepoUnarchive).not.toHaveBeenCalled()
    expect(result).toBe(existing)
  })
})

describe('milestoneService.updateMilestone archive freeze', () => {
  it('rejects updates on an archived milestone with 409', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      status: 'ACTIVE',
      completedAt: null,
      archivedAt: new Date(),
    })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    await expect(
      milestoneService.updateMilestone('m1', 'mem1', { name: 'x' })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockRepoUpdate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/lib/services/milestone.service.test.ts`
Expected: FAIL — `archiveMilestone`/`unarchiveMilestone` undefined; freeze not enforced; `listMilestones` arity.

- [ ] **Step 3: Implement**

In `lib/services/milestone.service.ts`:

Add the import at the top:

```ts
import {
  milestoneRepository,
  type MilestoneListFilter,
} from '@/lib/repositories/milestone.repository'
```

(replace the existing `import { milestoneRepository } from …` line).

Change `listMilestones` (lines 49-52):

```ts
  async listMilestones(
    projectId: string,
    memberId: string,
    filter: MilestoneListFilter = 'active'
  ) {
    await projectService.getProject(projectId, memberId)
    return milestoneRepository.findByProject(projectId, filter)
  },
```

In `updateMilestone`, right after the project permission check (after line 107 `await projectService.getProject(existing.projectId, memberId)`), add the freeze guard:

```ts
if (existing.archivedAt) {
  throw Object.assign(
    new Error('Milestone is archived; unarchive it before editing'),
    { status: 409 }
  )
}
```

Add the two new methods after `deleteMilestone` (after line 148):

```ts
  async archiveMilestone(milestoneId: string, memberId: string) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)
    if (existing.archivedAt) return existing
    return milestoneRepository.archive(milestoneId, new Date())
  },

  async unarchiveMilestone(milestoneId: string, memberId: string) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)
    if (!existing.archivedAt) return existing
    return milestoneRepository.unarchive(milestoneId)
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/lib/services/milestone.service.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/services/milestone.service.ts __tests__/lib/services/milestone.service.test.ts
git commit -m "feat: milestone service archive/unarchive + edit-freeze [LUM-161]"
```

---

## Task 4: Validation — list query schema

**Files:**

- Modify: `lib/validation/schemas.ts` (Milestones section, ~line 531)

- [ ] **Step 1: Add the schema**

After `updateMilestoneSchema` (after line ~551), add:

```ts
export const listMilestonesQuerySchema = z.object({
  filter: z.enum(['active', 'archived', 'all']).default('active'),
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/validation/schemas.ts
git commit -m "feat: listMilestonesQuerySchema for archive filter [LUM-161]"
```

---

## Task 5: API — list `?filter=` + archive/unarchive routes

**Files:**

- Modify: `app/api/projects/[id]/milestones/route.ts` (GET)
- Create: `app/api/milestones/[milestoneId]/archive/route.ts`
- Create: `app/api/milestones/[milestoneId]/unarchive/route.ts`
- Test: `__tests__/api-milestone-archive.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api-milestone-archive.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: {
    archiveMilestone: jest.fn(),
    unarchiveMilestone: jest.fn(),
  },
}))

import { POST as archivePOST } from '@/app/api/milestones/[milestoneId]/archive/route'
import { POST as unarchivePOST } from '@/app/api/milestones/[milestoneId]/unarchive/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'

const mockIdentity = requireIdentity as jest.Mock
const mockArchive = milestoneService.archiveMilestone as jest.Mock
const mockUnarchive = milestoneService.unarchiveMilestone as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockArchive.mockReset()
  mockUnarchive.mockReset()
})

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

describe('POST /api/milestones/[id]/archive', () => {
  it('archives and returns the milestone', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockArchive.mockResolvedValue({ id: 'm-1', archivedAt: '2026-06-02' })
    const res = await archivePOST(
      new Request('http://x', { method: 'POST' }) as any,
      params
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone).toMatchObject({ id: 'm-1' })
    expect(mockArchive).toHaveBeenCalledWith('m-1', 'mem-1')
  })

  it('maps a service status error to the response', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockArchive.mockRejectedValue(
      Object.assign(new Error('Milestone not found'), { status: 404 })
    )
    const res = await archivePOST(
      new Request('http://x', { method: 'POST' }) as any,
      params
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/milestones/[id]/unarchive', () => {
  it('unarchives and returns the milestone', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockUnarchive.mockResolvedValue({ id: 'm-1', archivedAt: null })
    const res = await unarchivePOST(
      new Request('http://x', { method: 'POST' }) as any,
      params
    )
    expect(res.status).toBe(200)
    expect(mockUnarchive).toHaveBeenCalledWith('m-1', 'mem-1')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/api-milestone-archive.test.ts`
Expected: FAIL — route modules do not exist.

- [ ] **Step 3: Create the archive route**

Create `app/api/milestones/[milestoneId]/archive/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ milestoneId: string }>
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const milestone = await milestoneService.archiveMilestone(
      milestoneId,
      identity.memberId
    )
    return NextResponse.json({ milestone })
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

- [ ] **Step 4: Create the unarchive route**

Create `app/api/milestones/[milestoneId]/unarchive/route.ts` (identical except the service call):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ milestoneId: string }>
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const milestone = await milestoneService.unarchiveMilestone(
      milestoneId,
      identity.memberId
    )
    return NextResponse.json({ milestone })
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

- [ ] **Step 5: Wire `?filter=` into the list GET**

In `app/api/projects/[id]/milestones/route.ts`:

Add the import at the top (alongside the existing validation import — the file currently imports `createMilestoneSchema`):

```ts
import {
  createMilestoneSchema,
  listMilestonesQuerySchema,
} from '@/lib/validation/schemas'
```

In `GET`, replace the `listMilestones` call (line 23) with filter parsing:

```ts
const parsedQuery = listMilestonesQuerySchema.safeParse({
  filter: new URL(request.url).searchParams.get('filter') ?? undefined,
})
if (!parsedQuery.success) return zodError(parsedQuery)

const milestones = await milestoneService.listMilestones(
  id,
  member.id,
  parsedQuery.data.filter
)
```

Ensure `zodError` is imported — it already is via `import { loadProjectAndMember, zodError } from '@/lib/api/helpers'`.

- [ ] **Step 6: Run to verify route tests pass**

Run: `npx jest __tests__/api-milestone-archive.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the existing list GET test (regression)**

Run: `npx jest __tests__/api-milestone-get.test.ts`
Expected: PASS (the milestone GET-by-id test is unaffected).

- [ ] **Step 8: Commit**

```bash
git add app/api/milestones/[milestoneId]/archive app/api/milestones/[milestoneId]/unarchive app/api/projects/[id]/milestones/route.ts __tests__/api-milestone-archive.test.ts
git commit -m "feat: milestone archive/unarchive routes + list filter param [LUM-161]"
```

---

## Task 6: Binding guard — reject task binding to archived milestone

**Files:**

- Modify: `lib/services/task-state.service.ts` (~lines 124-135, inside exported `updateTask`)
- Modify: `lib/services/task-creation.service.ts` (~lines 69-80, inside exported `createTask`)
- Test: `__tests__/lib/services/task-state.service.test.ts` (extend — full mock scaffolding already present)
- Test: `__tests__/lib/services/task-creation.service.test.ts` (extend — full mock scaffolding already present)

These two existing test files already `jest.mock` every repository `updateTask`/`createTask` touch (including `milestoneRepository.findById`, `marked`, task/project/tag/activity repos, and — in the creation test — `task-notifications.service`). Add cases to them rather than authoring a fresh file with partial mocks (avoids the `@ai-sdk/gateway`/notification import trap). The real functions are `updateTask(taskId, input, actorId?)` and `createTask(projectId, input, …)`.

- [ ] **Step 1: Write a failing test for the update path**

Append to `__tests__/lib/services/task-state.service.test.ts` (it already imports `updateTask`, mocks `milestoneRepository.findById`, and has the `mockTaskRow()` helper whose row is `{ id:'task-1', projectId:'proj-1', status:'TODO', project:{workspaceId:'ws-1'}, … }`):

```ts
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

describe('updateTask — archived milestone bind guard', () => {
  it('rejects binding a task to an archived milestone with 409', async () => {
    ;(milestoneRepository.findById as jest.Mock).mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      archivedAt: new Date(),
    })
    await expect(
      updateTask('task-1', { milestoneId: 'm1' })
    ).rejects.toMatchObject({ status: 409 })
  })
})
```

- [ ] **Step 2: Write a failing test for the create path**

Append to `__tests__/lib/services/task-creation.service.test.ts` (it already imports `createTask` and mocks `milestoneRepository.findById`; `projectMock` resolves a project with `id:'proj-1'`):

```ts
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

describe('createTask — archived milestone bind guard', () => {
  it('rejects creating a task bound to an archived milestone with 409', async () => {
    ;(milestoneRepository.findById as jest.Mock).mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      archivedAt: new Date(),
    })
    await expect(
      createTask('proj-1', {
        title: 'T',
        status: 'TODO',
        priority: 'LOW',
        milestoneId: 'm1',
      })
    ).rejects.toMatchObject({ status: 409 })
  })
})
```

- [ ] **Step 3: Run to verify both fail**

Run: `npx jest __tests__/lib/services/task-state.service.test.ts __tests__/lib/services/task-creation.service.test.ts`
Expected: FAIL on the two new cases — currently no archived check, so no 409 is thrown (a non-archived milestone would pass the project check and proceed).

- [ ] **Step 4: Implement the guard in task-state.service.ts**

In `lib/services/task-state.service.ts`, inside the milestone validation block (lines 126-135), add the archived check after the project-match check:

```ts
if (milestoneId !== undefined && milestoneId !== null) {
  const milestone = await milestoneRepository.findById(milestoneId)
  const expectedProjectId = projectId ?? task.projectId
  if (!milestone || milestone.projectId !== expectedProjectId) {
    throw Object.assign(
      new Error('Milestone does not belong to this project'),
      { status: 400 }
    )
  }
  if (milestone.archivedAt) {
    throw Object.assign(
      new Error('Cannot bind a task to an archived milestone'),
      { status: 409 }
    )
  }
}
```

- [ ] **Step 5: Implement the guard in task-creation.service.ts**

In `lib/services/task-creation.service.ts`, inside the milestone validation block (lines 72-80), add the archived check:

```ts
if (resolvedMilestoneId) {
  const milestone = await milestoneRepository.findById(resolvedMilestoneId)
  if (!milestone || milestone.projectId !== projectId) {
    throw Object.assign(
      new Error('Milestone does not belong to this project'),
      { status: 400 }
    )
  }
  if (milestone.archivedAt) {
    throw Object.assign(
      new Error('Cannot bind a task to an archived milestone'),
      { status: 409 }
    )
  }
}
```

- [ ] **Step 6: Run to verify both new cases pass**

Run: `npx jest __tests__/lib/services/task-state.service.test.ts __tests__/lib/services/task-creation.service.test.ts`
Expected: PASS (the two new guard cases plus all existing cases).

- [ ] **Step 7: Commit**

```bash
git add lib/services/task-creation.service.ts lib/services/task-state.service.ts __tests__/lib/services/task-state.service.test.ts __tests__/lib/services/task-creation.service.test.ts
git commit -m "feat: reject binding tasks to archived milestones [LUM-161]"
```

---

## Task 7: CLI — name addressing sees all + list flags/marker

**Files:**

- Modify: `cli/src/lib/resolve.ts` (~line 229)
- Modify: `cli/src/commands/milestone-list.ts`
- Modify: `cli/src/index.ts` (list command registration, ~lines 635-641)
- Test: `__tests__/cli/milestone-list-format.test.ts` (existing — extend)

- [ ] **Step 1: Make name resolution see archived milestones**

In `cli/src/lib/resolve.ts`, change the list fetch inside `resolveMilestoneId` (line 226-230) so name addressing works for archived milestones too:

```ts
const { milestones } = await fetchJson<{ milestones: MilestoneRow[] }>(
  base,
  token,
  `/api/projects/${projectId}/milestones?filter=all`
)
```

- [ ] **Step 2: Write failing test for the archived marker in the list formatter**

In `__tests__/cli/milestone-list-format.test.ts`, extend the `row` factory to allow `archivedAt` and add a test. Update the factory default and add a case:

```ts
function row(overrides: Partial<Row>): Row {
  return {
    id: 'm-1',
    name: 'Q3 Launch',
    status: 'ACTIVE',
    targetDate: '2026-08-31T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

it('marks an archived milestone with a (archived) suffix', () => {
  const out = formatMilestoneList([
    row({ archivedAt: '2026-06-02T00:00:00.000Z' }),
  ])
  expect(out).toContain('Q3 Launch (archived)')
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest __tests__/cli/milestone-list-format.test.ts`
Expected: FAIL — `archivedAt` not on `MilestoneRow`; no marker emitted.

- [ ] **Step 4: Implement list flags + marker**

In `cli/src/commands/milestone-list.ts`:

Add `archivedAt` to `MilestoneRow`:

```ts
interface MilestoneRow {
  id: string
  name: string
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  targetDate: string | null
  createdAt: string
  archivedAt: string | null
  health?: MilestoneHealth | null
}
```

Update the name cell in `formatMilestoneList` (line 58) to mark archived rows:

```ts
return rows
  .map(r => {
    const name = r.archivedAt
      ? `${sanitizeField(r.name)} (archived)`
      : sanitizeField(r.name)
    return `${r.status.padEnd(statusW)}  ${formatHealth(r.health).padEnd(healthW)}  ${formatDate(r.targetDate).padEnd(dateW)}  ${name}`
  })
  .join('\n')
```

Extend the options + add flag handling + filter query in `milestoneList`:

```ts
export interface MilestoneListOptions {
  project?: string | undefined
  archived?: boolean | undefined
  all?: boolean | undefined
}
```

After resolving `projectId` and before the fetch, compute the filter and guard mutual exclusivity:

```ts
if (options.archived && options.all) {
  console.error('Error: --archived and --all are mutually exclusive.')
  return 1
}
const filter = options.all ? 'all' : options.archived ? 'archived' : 'active'
```

Change the fetch URL (line 83) to include the filter:

```ts
const res = await fetch(
  `${base}/api/projects/${projectId}/milestones?filter=${filter}`,
  { headers: { Authorization: `Bearer ${creds.token}` } }
)
```

- [ ] **Step 5: Register the new list flags**

In `cli/src/index.ts`, in the `milestone list` command block (lines 635-641), add the two flags before `.action(...)`:

```ts
milestoneCmd
  .command('list')
  .description(
    'List milestones for a project. --project required when workspace has >1 project. By default only non-archived milestones are shown.'
  )
  .option('--project <ref>', 'Project name or slug')
  .option('--archived', 'Show only archived milestones')
  .option('--all', 'Show both archived and non-archived milestones')
  .action(wrap(options => milestoneList(options as Record<string, string>)))
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest __tests__/cli/milestone-list-format.test.ts`
Expected: PASS (existing tests still green — the default `archivedAt: null` factory keeps old assertions exact — plus the new marker test).

- [ ] **Step 7: Commit**

```bash
git add cli/src/lib/resolve.ts cli/src/commands/milestone-list.ts cli/src/index.ts __tests__/cli/milestone-list-format.test.ts
git commit -m "feat: milestone list --archived/--all + archived marker; resolve sees all [LUM-161]"
```

---

## Task 8: CLI — archive / unarchive commands

**Files:**

- Create: `cli/src/commands/milestone-archive.ts`
- Create: `cli/src/commands/milestone-unarchive.ts`
- Modify: `cli/src/index.ts` (imports + registration)
- Test: `__tests__/cli/milestone-archive-format.test.ts`

- [ ] **Step 1: Write a failing test for the success message helpers**

Create `__tests__/cli/milestone-archive-format.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { formatArchiveResult } from '@/cli/src/commands/milestone-archive'
import { formatUnarchiveResult } from '@/cli/src/commands/milestone-unarchive'

describe('milestone archive/unarchive output', () => {
  it('formats the archive success line', () => {
    expect(formatArchiveResult('Q3 Launch')).toBe('Archived "Q3 Launch"')
  })

  it('formats the unarchive success line', () => {
    expect(formatUnarchiveResult('Q3 Launch')).toBe('Unarchived "Q3 Launch"')
  })

  it('sanitizes the milestone name', () => {
    // ANSI escape must be stripped by sanitizeField
    expect(formatArchiveResult('a[31mb')).not.toContain('')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/cli/milestone-archive-format.test.ts`
Expected: FAIL — modules/exports don't exist.

- [ ] **Step 3: Create `milestone-archive.ts`**

Create `cli/src/commands/milestone-archive.ts`:

```ts
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'

export interface MilestoneArchiveOptions {
  project?: string
}

export function formatArchiveResult(name: string): string {
  return `Archived "${sanitizeField(name)}"`
}

export async function milestoneArchive(
  identifier: string,
  opts: MilestoneArchiveOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let milestoneId: string
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
    milestoneId = resolved.id
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/milestones/${milestoneId}/archive`, {
      method: 'POST',
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
  if (!res.ok) {
    let errMsg = `milestone archive failed (HTTP ${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) errMsg = body.error
    } catch {
      // non-JSON body; keep the status-only message
    }
    console.error(`Error: ${sanitizeField(errMsg)}`)
    return 1
  }

  const { milestone } = (await res.json()) as { milestone: { name: string } }
  process.stdout.write(formatArchiveResult(milestone.name) + '\n')
}
```

- [ ] **Step 4: Create `milestone-unarchive.ts`**

Create `cli/src/commands/milestone-unarchive.ts` (identical except endpoint/wording):

```ts
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'

export interface MilestoneUnarchiveOptions {
  project?: string
}

export function formatUnarchiveResult(name: string): string {
  return `Unarchived "${sanitizeField(name)}"`
}

export async function milestoneUnarchive(
  identifier: string,
  opts: MilestoneUnarchiveOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let milestoneId: string
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
    milestoneId = resolved.id
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/milestones/${milestoneId}/unarchive`, {
      method: 'POST',
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
  if (!res.ok) {
    let errMsg = `milestone unarchive failed (HTTP ${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) errMsg = body.error
    } catch {
      // non-JSON body; keep the status-only message
    }
    console.error(`Error: ${sanitizeField(errMsg)}`)
    return 1
  }

  const { milestone } = (await res.json()) as { milestone: { name: string } }
  process.stdout.write(formatUnarchiveResult(milestone.name) + '\n')
}
```

- [ ] **Step 5: Register both commands**

In `cli/src/index.ts`:

Add imports near the other milestone imports (after line 50):

```ts
import { milestoneArchive } from './commands/milestone-archive'
import { milestoneUnarchive } from './commands/milestone-unarchive'
```

Add the command registrations after the `milestone delete` block (after line 704):

```ts
milestoneCmd
  .command('archive <identifier>')
  .description(
    'Archive a milestone: hidden from `milestone list` by default, history and task links preserved, reversible with `milestone unarchive`. Identifier accepts UUID or name.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .action(
    wrap((identifier, options) =>
      milestoneArchive(identifier as string, options as { project?: string })
    )
  )

milestoneCmd
  .command('unarchive <identifier>')
  .description(
    'Restore an archived milestone so it shows in `milestone list` again. Identifier accepts UUID or name.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .action(
    wrap((identifier, options) =>
      milestoneUnarchive(identifier as string, options as { project?: string })
    )
  )
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest __tests__/cli/milestone-archive-format.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/milestone-archive.ts cli/src/commands/milestone-unarchive.ts cli/src/index.ts __tests__/cli/milestone-archive-format.test.ts
git commit -m "feat: lumo milestone archive/unarchive CLI commands [LUM-161]"
```

---

## Task 9: CLI client typing + milestone show archived line

**Files:**

- Modify: `lib/api-client/milestones.ts` (`ApiMilestone`)
- Modify: `cli/src/commands/milestone-show.ts`

- [ ] **Step 1: Add `archivedAt` to the frontend `ApiMilestone` type**

In `lib/api-client/milestones.ts`, add to the `ApiMilestone` interface after `completedAt` (line 15):

```ts
completedAt: string | null
archivedAt: string | null
```

- [ ] **Step 2: Show the archived state in `milestone show`**

In `cli/src/commands/milestone-show.ts`:

Add `archivedAt` to `MilestoneShowData` (after `targetDate`, line 18):

```ts
targetDate: string | null
archivedAt: string | null
```

Add an `Archived:` line in `formatMilestoneShow` after the `Status:` line (line 56):

```ts
    `Status:       ${m.status}`,
    `Archived:     ${m.archivedAt ? m.archivedAt.slice(0, 10) : 'no'}`,
```

Extend the response type (line 130-141) and the `formatMilestoneShow` call (line 161-171) to thread `archivedAt`:

```ts
const { milestone } = (await milestoneRes.json()) as {
  milestone: {
    id: string
    name: string
    status: string
    startDate: string | null
    targetDate: string | null
    archivedAt: string | null
    description: string | null
    projectId: string
    taskCounts: MilestoneShowData['taskCounts']
    health?: MilestoneHealth | null
  }
}
```

and in the `formatMilestoneShow({...})` object literal add:

```ts
        targetDate: milestone.targetDate,
        archivedAt: milestone.archivedAt,
```

- [ ] **Step 3: Update the milestone-show format test for the new line**

Run: `npx jest __tests__/cli/milestone-show-format.test.ts`
If it asserts the exact multi-line block, add `archivedAt: null` to its fixture and insert the `Archived:     no` line into the expected output. If it only checks substrings, it will likely still pass — confirm by running.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/api-client/milestones.ts cli/src/commands/milestone-show.ts __tests__/cli/milestone-show-format.test.ts
git commit -m "feat: surface archivedAt in milestone show + ApiMilestone type [LUM-161]"
```

---

## Task 10: Docs (SKILL.md) + CLI version bump

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`
- Modify: `cli/package.json`

- [ ] **Step 1: Document the new commands and flags in SKILL.md**

In `.claude/skills/lumo/SKILL.md`:

1. In the `milestone list` section, document the new flags:
   - `--archived` — show only archived milestones
   - `--all` — show both; default lists only non-archived; archived rows are marked `(archived)`.

2. Add two new command sections after `milestone delete`:

```markdown
### `lumo milestone archive <identifier>` — soft-archive a milestone

Sets `archivedAt`. The milestone is hidden from `milestone list` by default
(use `--archived` / `--all` to see it), but its history and task links are
preserved and it is fully reversible via `milestone unarchive`. Distinct from
`milestone delete` (which hard-deletes). While archived, the milestone rejects
edits (`milestone update`) and new task bindings (`task --milestone`,
`milestone add`) until restored. `<identifier>` accepts a UUID or name;
`--project <ref>` is required when the identifier is a name and the workspace
has more than one project.

\`\`\`bash
lumo milestone archive "Q3 Launch"
lumo milestone archive 11111111-2222-3333-4444-555555555555
\`\`\`

### `lumo milestone unarchive <identifier>` — restore an archived milestone

Clears `archivedAt`, so the milestone reappears in `milestone list` and can be
edited / bound again. Idempotent. Same identifier/`--project` rules as
`archive`.

\`\`\`bash
lumo milestone unarchive "Q3 Launch"
\`\`\`
```

3. In the frontmatter `description`, add trigger words: `archive milestone`, `unarchive milestone`, `归档里程碑`, `恢复里程碑`, `取消归档`, `archived milestones`, `restore milestone`.

- [ ] **Step 2: Bump the CLI version (minor — new commands)**

In `cli/package.json`, bump the `version` field by a minor increment (e.g. `1.11.0` → `1.12.0`). Confirm the current value first:
Run: `node -p "require('./cli/package.json').version"`
Then edit `version` to the next minor.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/lumo/SKILL.md cli/package.json
git commit -m "docs: document milestone archive/unarchive in SKILL.md + bump CLI [LUM-161]"
```

> **Publish reminder (post-merge):** per project memory, user-facing `cli/src` changes need a manual `cd cli && npm publish` after the version bump — no CI publishes the CLI. Flag this to the user when the PR is ready; do not publish without their go-ahead.

---

## Task 11: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole project**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: no errors. (Run `prisma generate` first — per project memory, stale client causes phantom "X is not exported" errors.)

- [ ] **Step 2: Run the full milestone + task-binding test surface**

Run: `npx jest milestone task-creation task-state`
Expected: all PASS.

- [ ] **Step 3: Run the entire test suite**

Run: `npm test`
Expected: green.

- [ ] **Step 4: Token-lint (in case any touched file trips it)**

Run: `npm run lint:tokens`
Expected: pass. If it flags an intentional value, follow the project's baseline-update procedure.

- [ ] **Step 5: Confirm no `console.log` / debug leftovers**

Run: `git diff origin/main --unified=0 | grep -n "console.log" || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin lumo/LUM-161-milestone-archive
gh pr create --title "feat: milestone soft-archive (archivedAt) [LUM-161]" --body "$(cat <<'EOF'
## Summary
Adds soft-archive for milestones (`archivedAt`), distinct from hard delete.
Archived milestones are hidden from lists by default, keep history + task
links, and are restorable.

- Schema: `Milestone.archivedAt` + `@@index([projectId, archivedAt])`
- Repository/Service: `findByProject(filter)`, `archive`/`unarchive`, edit-freeze on archived
- API: `POST /api/milestones/[id]/archive` + `…/unarchive`; `GET …/milestones?filter=active|archived|all`
- Binding guard: tasks cannot be bound to an archived milestone (409)
- CLI: `milestone archive` / `unarchive`, `milestone list --archived/--all` (archived rows marked), `show` reports archived state
- Docs: SKILL.md updated; CLI version bumped

## Production / migration
Includes a schema migration (new **nullable** column + index — no data
deletion). Requires `prisma migrate deploy` on the next production deploy;
backward compatible (old rows default to NULL = not archived = visible).

## Out of scope
Frontend archive/unarchive buttons + "show archived" toggle (frontend already
auto-hides archived via the default list API); slug reuse after archive.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

- Schema field + index → Task 1 ✓
- Repository filter + archive/unarchive → Task 2 ✓
- Service list filter + archive/unarchive + edit-freeze → Task 3 ✓
- Validation list query → Task 4 ✓
- API list filter + archive/unarchive routes → Task 5 ✓
- Task-binding guard (reject archived) → Task 6 ✓
- List default-exclude (CLI + frontend) → Task 5 (API default) + Task 7 (CLI flags); frontend auto-inherits ✓
- Name addressing sees archived → Task 7 Step 1 ✓
- CLI archive/unarchive commands → Task 8 ✓
- `archivedAt` typing + show line → Task 9 ✓
- SKILL.md + version bump → Task 10 ✓
- Deploy note in PR → Task 11 Step 6 ✓

**Type consistency:** `MilestoneListFilter` defined in Task 2, imported in Task 3. `findByProject(projectId, filter)` signature consistent across repo/service/test updates. `archive(id, Date)` / `unarchive(id)` consistent in repo, service, tests. `formatArchiveResult`/`formatUnarchiveResult` defined and tested in Task 8. `archivedAt: string | null` consistent across `ApiMilestone`, `MilestoneRow`, `MilestoneShowData`.

**Placeholder scan:** No TBD/TODO. The one runtime-confirm note (Task 6 Step 1: exact exported function name in `task-state.service.ts`) is explicit with a fallback instruction, not a placeholder — the assertion is fully specified.
