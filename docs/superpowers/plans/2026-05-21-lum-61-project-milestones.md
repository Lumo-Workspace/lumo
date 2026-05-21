# Project Milestones Implementation Plan [LUM-61]

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-05-21-project-milestones-design.md`](../specs/2026-05-21-project-milestones-design.md)

**Goal:** Add project-scoped Milestones (PLANNED/ACTIVE/COMPLETED/CANCELLED, optional start+target dates) with full CRUD, Task `milestoneId` FK, CLI flags, project Milestones tab + detail page, task selector, project tasks filter, i18n across all locales.

**Architecture:** New `Milestone` Prisma model owned by `Project` (Cascade). `Task` gains optional `milestoneId` (SetNull). Backend follows the existing repository → service → API route layering. CLI extends `task create / update` and adds `milestone list`. Frontend adds a tab + detail page + selector + filter, reusing existing dialog / popover patterns.

**Tech Stack:** Next.js 14 App Router, Prisma 5+, Neon Postgres, TypeScript strict, Jest, Zod, React + Tailwind + shadcn/ui, react-intl, commander-based CLI.

**Branch:** `lumo/LUM-61-add-project-milestones` (already created and contains the spec commit).

---

## Phase 0 — Preflight

### Task 0.1: Confirm branch & clean tree

- [ ] **Step 1:** Confirm branch and clean working tree.

Run:

```bash
git status && git rev-parse --abbrev-ref HEAD
```

Expected: branch `lumo/LUM-61-add-project-milestones`, working tree clean (spec already committed).

- [ ] **Step 2:** Confirm Prisma + node deps installed.

Run:

```bash
node -v && npm ls prisma @prisma/client --depth=0 2>&1 | head -5
```

Expected: node 20+, prisma/client both resolve.

---

## Phase 1 — Data Model

### Task 1.1: Add `MilestoneStatus` enum + `Milestone` model + relations

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1:** Add the `MilestoneStatus` enum near other enums (e.g. after `TaskPriority`).

```prisma
enum MilestoneStatus {
  PLANNED
  ACTIVE
  COMPLETED
  CANCELLED
}
```

- [ ] **Step 2:** Add the `Milestone` model. Place it after the `Sprint` model so related concepts cluster.

```prisma
model Milestone {
  id          String          @id @default(cuid())
  projectId   String
  name        String
  description String?
  status      MilestoneStatus @default(PLANNED)
  startDate   DateTime?
  targetDate  DateTime?
  completedAt DateTime?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tasks   Task[]

  @@index([projectId])
  @@index([projectId, status])
}
```

- [ ] **Step 3:** Add `milestones Milestone[]` to the `Project` model's relations block (next to `tasks Task[]`).

In `model Project { ... }`, find:

```prisma
  tasks                 Task[]
  views                 View[]
```

Change to:

```prisma
  tasks                 Task[]
  milestones            Milestone[]
  views                 View[]
```

- [ ] **Step 4:** Add `milestoneId` field, relation, and index to the `Task` model.

In `model Task { ... }`, find the `sprintId` block:

```prisma
  sprintId           String?
```

Add immediately after:

```prisma
  milestoneId        String?
```

In the relations block, find:

```prisma
  sprint             Sprint?            @relation(fields: [sprintId], references: [id], onDelete: SetNull)
```

Add immediately after:

```prisma
  milestone          Milestone?         @relation(fields: [milestoneId], references: [id], onDelete: SetNull)
```

In the index block, find:

```prisma
  @@index([sprintId])
```

Add:

```prisma
  @@index([milestoneId])
```

- [ ] **Step 5:** Format the schema and validate.

Run:

```bash
npx prisma format && npx prisma validate
```

Expected: no errors. `prisma format` may reflow whitespace — accept.

### Task 1.2: Create + run the migration locally

- [ ] **Step 1:** Create the migration.

Run:

```bash
npx prisma migrate dev --name add_milestones
```

Expected: new directory `prisma/migrations/<timestamp>_add_milestones/` with `migration.sql`, then "Already in sync" message, then `prisma generate` runs.

- [ ] **Step 2:** Sanity-check the generated SQL.

Read the new `migration.sql`. It should:

- `CREATE TYPE "MilestoneStatus" AS ENUM (...)`
- `CREATE TABLE "Milestone" (...)`
- Add `ALTER TABLE "Task" ADD COLUMN "milestoneId" TEXT;`
- Add the two indexes
- Add the FK constraints with `ON DELETE CASCADE` (Milestone→Project) and `ON DELETE SET NULL` (Task→Milestone)

If anything is off, fix `schema.prisma` and re-run `prisma migrate dev`.

### Task 1.3: Commit the schema + migration

- [ ] **Step 1:** Verify file list.

Run:

```bash
git status
```

Expected: modified `prisma/schema.prisma`, new files under `prisma/migrations/<ts>_add_milestones/`.

- [ ] **Step 2:** Commit.

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add Milestone model + Task.milestoneId [LUM-61]"
```

---

## Phase 2 — Validation Schemas

### Task 2.1: Add milestone Zod schemas

**Files:**

- Modify: `lib/validation/schemas.ts` (add new exports; do NOT touch existing)

- [ ] **Step 1:** Open `lib/validation/schemas.ts`. At the bottom, add:

```typescript
export const createMilestoneSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Name must be at most 120 characters'),
  description: z.string().max(2000).nullable().optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
})

export const updateMilestoneSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
})
```

- [ ] **Step 2:** Extend `createTaskSchema` and the task update schema with `milestoneId`.

Find `createTaskSchema` (it already has `sprintId: z.string().nullable().optional()`). Add right after the `sprintId` line:

```typescript
  milestoneId: z.string().nullable().optional(),
```

Repeat for the task update schema (`updateTaskSchema` or equivalent).

- [ ] **Step 3:** Type-check.

Run:

```bash
npx tsc --noEmit
```

Expected: no new errors. (If `updateTaskSchema` lives in a different file, search for `sprintId: z.string()` to locate.)

- [ ] **Step 4:** Commit.

```bash
git add lib/validation/schemas.ts
git commit -m "feat: add milestone validation schemas + task milestoneId field [LUM-61]"
```

---

## Phase 3 — Repository (TDD)

### Task 3.1: Write repository tests

**Files:**

- Create: `__tests__/lib/repositories/milestone.repository.test.ts`

- [ ] **Step 1:** Create the test file.

```typescript
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    milestone: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    task: {
      groupBy: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const mockFindUnique = prisma.milestone.findUnique as jest.Mock
const mockFindMany = prisma.milestone.findMany as jest.Mock
const mockCreate = prisma.milestone.create as jest.Mock
const mockUpdate = prisma.milestone.update as jest.Mock
const mockDelete = prisma.milestone.delete as jest.Mock
const mockTaskGroupBy = prisma.task.groupBy as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('milestoneRepository.findById', () => {
  it('returns the milestone when found', async () => {
    const row = { id: 'm1', projectId: 'p1', name: 'v1.0', status: 'PLANNED' }
    mockFindUnique.mockResolvedValue(row)
    const result = await milestoneRepository.findById('m1')
    expect(result).toEqual(row)
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1' } })
    )
  })

  it('returns null when not found', async () => {
    mockFindUnique.mockResolvedValue(null)
    const result = await milestoneRepository.findById('missing')
    expect(result).toBeNull()
  })
})

describe('milestoneRepository.findByProject', () => {
  it('orders by targetDate asc nulls last, then createdAt asc', async () => {
    mockFindMany.mockResolvedValue([])
    await milestoneRepository.findByProject('p1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { projectId: 'p1' },
      orderBy: [
        { targetDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    })
  })
})

describe('milestoneRepository.create', () => {
  it('inserts with PLANNED default and returns the row', async () => {
    const created = {
      id: 'm1',
      projectId: 'p1',
      name: 'v1.0',
      status: 'PLANNED',
    }
    mockCreate.mockResolvedValue(created)
    const result = await milestoneRepository.create({
      projectId: 'p1',
      name: 'v1.0',
    })
    expect(result).toEqual(created)
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        projectId: 'p1',
        name: 'v1.0',
        description: null,
        startDate: null,
        targetDate: null,
      },
    })
  })
})

describe('milestoneRepository.update', () => {
  it('passes through fields including completedAt', async () => {
    const updated = {
      id: 'm1',
      status: 'COMPLETED',
      completedAt: new Date('2026-06-01'),
    }
    mockUpdate.mockResolvedValue(updated)
    const result = await milestoneRepository.update('m1', {
      status: 'COMPLETED',
      completedAt: new Date('2026-06-01'),
    })
    expect(result).toEqual(updated)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'COMPLETED', completedAt: new Date('2026-06-01') },
    })
  })
})

describe('milestoneRepository.delete', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValue({ id: 'm1' })
    await milestoneRepository.delete('m1')
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })
})

describe('milestoneRepository.countTasksByStatus', () => {
  it('returns a map keyed by status', async () => {
    mockTaskGroupBy.mockResolvedValue([
      { status: 'TODO', _count: { _all: 3 } },
      { status: 'DONE', _count: { _all: 2 } },
    ])
    const result = await milestoneRepository.countTasksByStatus('m1')
    expect(result).toEqual({ TODO: 3, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 2 })
    expect(mockTaskGroupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { milestoneId: 'm1' },
      _count: { _all: true },
    })
  })
})
```

- [ ] **Step 2:** Run the tests and verify they fail (repository doesn't exist).

Run:

```bash
npm test -- __tests__/lib/repositories/milestone.repository.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/repositories/milestone.repository'`.

### Task 3.2: Implement `milestoneRepository`

**Files:**

- Create: `lib/repositories/milestone.repository.ts`

- [ ] **Step 1:** Create the file.

```typescript
import { prisma } from '@/lib/db/prisma'
import type { Milestone, MilestoneStatus, TaskStatus } from '@prisma/client'

type MilestoneUpdate = Partial<
  Pick<
    Milestone,
    | 'name'
    | 'description'
    | 'status'
    | 'startDate'
    | 'targetDate'
    | 'completedAt'
  >
>

export const milestoneRepository = {
  async findById(id: string) {
    return prisma.milestone.findUnique({ where: { id } })
  },

  async findByProject(projectId: string) {
    return prisma.milestone.findMany({
      where: { projectId },
      orderBy: [
        { targetDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    })
  },

  async create(data: {
    projectId: string
    name: string
    description?: string | null
    startDate?: Date | null
    targetDate?: Date | null
  }) {
    return prisma.milestone.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        description: data.description ?? null,
        startDate: data.startDate ?? null,
        targetDate: data.targetDate ?? null,
      },
    })
  },

  async update(id: string, data: MilestoneUpdate) {
    return prisma.milestone.update({
      where: { id },
      data,
    })
  },

  async delete(id: string) {
    return prisma.milestone.delete({ where: { id } })
  },

  async countTasksByStatus(milestoneId: string) {
    const rows = await prisma.task.groupBy({
      by: ['status'],
      where: { milestoneId },
      _count: { _all: true },
    })
    const result: Record<TaskStatus, number> = {
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 0,
    }
    for (const row of rows) {
      result[row.status] = row._count._all
    }
    return result
  },
}

export type MilestoneRepository = typeof milestoneRepository
```

- [ ] **Step 2:** Run the tests; they should all pass.

Run:

```bash
npm test -- __tests__/lib/repositories/milestone.repository.test.ts
```

Expected: PASS, all suites green.

- [ ] **Step 3:** Commit.

```bash
git add lib/repositories/milestone.repository.ts __tests__/lib/repositories/milestone.repository.test.ts
git commit -m "feat: add milestone repository [LUM-61]"
```

---

## Phase 4 — Service (TDD)

### Task 4.1: Write service tests

**Files:**

- Create: `__tests__/lib/services/milestone.service.test.ts`

- [ ] **Step 1:** Create the test file.

```typescript
const mockProjectGet = jest.fn()
const mockRepoFindById = jest.fn()
const mockRepoFindByProject = jest.fn()
const mockRepoCreate = jest.fn()
const mockRepoUpdate = jest.fn()
const mockRepoDelete = jest.fn()

jest.mock('@/lib/services/project.service', () => ({
  projectService: {
    getProject: (...a: any[]) => mockProjectGet(...a),
  },
}))

jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: any[]) => mockRepoFindById(...a),
    findByProject: (...a: any[]) => mockRepoFindByProject(...a),
    create: (...a: any[]) => mockRepoCreate(...a),
    update: (...a: any[]) => mockRepoUpdate(...a),
    delete: (...a: any[]) => mockRepoDelete(...a),
  },
}))

import { milestoneService } from '@/lib/services/milestone.service'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('milestoneService.listMilestones', () => {
  it('delegates permission check to projectService.getProject and returns the list', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoFindByProject.mockResolvedValue([{ id: 'm1' }])
    const result = await milestoneService.listMilestones('p1', 'mem1')
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(mockRepoFindByProject).toHaveBeenCalledWith('p1')
    expect(result).toEqual([{ id: 'm1' }])
  })

  it('propagates the project not-found error', async () => {
    mockProjectGet.mockRejectedValue(
      Object.assign(new Error('Project not found'), { status: 404 })
    )
    await expect(
      milestoneService.listMilestones('p1', 'mem1')
    ).rejects.toMatchObject({
      message: 'Project not found',
      status: 404,
    })
  })
})

describe('milestoneService.getMilestone', () => {
  it('throws 404 when the milestone does not exist', async () => {
    mockRepoFindById.mockResolvedValue(null)
    await expect(
      milestoneService.getMilestone('m-missing', 'mem1')
    ).rejects.toMatchObject({
      message: 'Milestone not found',
      status: 404,
    })
    expect(mockProjectGet).not.toHaveBeenCalled()
  })

  it('delegates the project permission check after finding the milestone', async () => {
    mockRepoFindById.mockResolvedValue({ id: 'm1', projectId: 'p1' })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    const result = await milestoneService.getMilestone('m1', 'mem1')
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(result).toEqual({ id: 'm1', projectId: 'p1' })
  })
})

describe('milestoneService.createMilestone', () => {
  it('writes through to repository after permission check', async () => {
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoCreate.mockResolvedValue({ id: 'm1' })
    await milestoneService.createMilestone('p1', 'mem1', {
      name: 'v1.0',
      description: 'first release',
    })
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(mockRepoCreate).toHaveBeenCalledWith({
      projectId: 'p1',
      name: 'v1.0',
      description: 'first release',
      startDate: undefined,
      targetDate: undefined,
    })
  })
})

describe('milestoneService.updateMilestone status transitions', () => {
  beforeEach(() => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      status: 'PLANNED',
      completedAt: null,
    })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
  })

  it('writes completedAt when transitioning to COMPLETED', async () => {
    mockRepoUpdate.mockResolvedValue({ id: 'm1' })
    await milestoneService.updateMilestone('m1', 'mem1', {
      status: 'COMPLETED',
    })
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        status: 'COMPLETED',
        completedAt: expect.any(Date),
      })
    )
  })

  it('clears completedAt when leaving COMPLETED', async () => {
    mockRepoFindById.mockResolvedValue({
      id: 'm1',
      projectId: 'p1',
      status: 'COMPLETED',
      completedAt: new Date(),
    })
    mockRepoUpdate.mockResolvedValue({ id: 'm1' })
    await milestoneService.updateMilestone('m1', 'mem1', { status: 'ACTIVE' })
    expect(mockRepoUpdate).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: 'ACTIVE', completedAt: null })
    )
  })

  it('does not touch completedAt when transitioning to CANCELLED', async () => {
    mockRepoUpdate.mockResolvedValue({ id: 'm1' })
    await milestoneService.updateMilestone('m1', 'mem1', {
      status: 'CANCELLED',
    })
    const [, payload] = mockRepoUpdate.mock.calls[0]
    expect(payload.status).toBe('CANCELLED')
    expect(payload).not.toHaveProperty('completedAt')
  })
})

describe('milestoneService.deleteMilestone', () => {
  it('throws 404 when not found', async () => {
    mockRepoFindById.mockResolvedValue(null)
    await expect(
      milestoneService.deleteMilestone('m-missing', 'mem1')
    ).rejects.toMatchObject({
      message: 'Milestone not found',
      status: 404,
    })
  })

  it('deletes after permission check', async () => {
    mockRepoFindById.mockResolvedValue({ id: 'm1', projectId: 'p1' })
    mockProjectGet.mockResolvedValue({ id: 'p1' })
    mockRepoDelete.mockResolvedValue({ id: 'm1' })
    await milestoneService.deleteMilestone('m1', 'mem1')
    expect(mockProjectGet).toHaveBeenCalledWith('p1', 'mem1')
    expect(mockRepoDelete).toHaveBeenCalledWith('m1')
  })
})
```

- [ ] **Step 2:** Verify the tests fail (service doesn't exist).

Run:

```bash
npm test -- __tests__/lib/services/milestone.service.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/services/milestone.service'`.

### Task 4.2: Implement `milestoneService`

**Files:**

- Create: `lib/services/milestone.service.ts`

- [ ] **Step 1:** Create the file.

```typescript
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { projectService } from '@/lib/services/project.service'
import type { MilestoneStatus } from '@prisma/client'

interface CreateInput {
  name: string
  description?: string | null
  startDate?: Date
  targetDate?: Date
}

interface UpdateInput {
  name?: string
  description?: string | null
  status?: MilestoneStatus
  startDate?: Date | null
  targetDate?: Date | null
}

export const milestoneService = {
  async listMilestones(projectId: string, memberId: string) {
    await projectService.getProject(projectId, memberId)
    return milestoneRepository.findByProject(projectId)
  },

  async getMilestone(milestoneId: string, memberId: string) {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(milestone.projectId, memberId)
    return milestone
  },

  async createMilestone(
    projectId: string,
    memberId: string,
    input: CreateInput
  ) {
    await projectService.getProject(projectId, memberId)
    return milestoneRepository.create({
      projectId,
      name: input.name,
      description: input.description ?? null,
      startDate: input.startDate,
      targetDate: input.targetDate,
    })
  },

  async updateMilestone(
    milestoneId: string,
    memberId: string,
    input: UpdateInput
  ) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)

    const data: Record<string, unknown> = {}
    if (input.name !== undefined) data.name = input.name
    if (input.description !== undefined) data.description = input.description
    if (input.startDate !== undefined) data.startDate = input.startDate
    if (input.targetDate !== undefined) data.targetDate = input.targetDate

    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status
      if (input.status === 'COMPLETED') {
        data.completedAt = new Date()
      } else if (existing.status === 'COMPLETED') {
        data.completedAt = null
      }
      // CANCELLED: do not touch completedAt
    } else if (input.status !== undefined) {
      data.status = input.status
    }

    return milestoneRepository.update(milestoneId, data)
  },

  async deleteMilestone(milestoneId: string, memberId: string) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)
    await milestoneRepository.delete(milestoneId)
  },
}

export type MilestoneService = typeof milestoneService
```

- [ ] **Step 2:** Run the tests.

Run:

```bash
npm test -- __tests__/lib/services/milestone.service.test.ts
```

Expected: PASS.

- [ ] **Step 3:** Commit.

```bash
git add lib/services/milestone.service.ts __tests__/lib/services/milestone.service.test.ts
git commit -m "feat: add milestone service with status-transition handling [LUM-61]"
```

---

## Phase 5 — API Routes

### Task 5.1: Project-scoped list + create — `/api/projects/[projectId]/milestones`

**Files:**

- Create: `app/api/projects/[projectId]/milestones/route.ts`

- [ ] **Step 1:** Create the route file.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { createMilestoneSchema } from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ projectId: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { projectId } = await params

    const result = await loadProjectAndMember(projectId, userId)
    if (result instanceof NextResponse) return result
    const { member } = result

    const milestones = await milestoneService.listMilestones(
      projectId,
      member.id
    )
    return NextResponse.json({ milestones })
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

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { projectId } = await params

    const result = await loadProjectAndMember(projectId, userId)
    if (result instanceof NextResponse) return result
    const { member } = result

    const body = await request.json()
    const parsed = createMilestoneSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const milestone = await milestoneService.createMilestone(
      projectId,
      member.id,
      parsed.data
    )
    return NextResponse.json({ milestone }, { status: 201 })
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

- [ ] **Step 2:** Type-check.

Run:

```bash
npx tsc --noEmit
```

Expected: pass (or report the helper signature you need to adjust).

### Task 5.2: Milestone detail / update / delete — `/api/milestones/[milestoneId]`

**Files:**

- Create: `app/api/milestones/[milestoneId]/route.ts`

- [ ] **Step 1:** Create the route file.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { updateMilestoneSchema } from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ milestoneId: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const milestone = await milestoneService.getMilestone(
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

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const body = await request.json()
    const parsed = updateMilestoneSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const milestone = await milestoneService.updateMilestone(
      milestoneId,
      identity.memberId,
      parsed.data
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

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    await milestoneService.deleteMilestone(milestoneId, identity.memberId)
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

- [ ] **Step 2:** Type-check.

Run:

```bash
npx tsc --noEmit
```

If `requireIdentity` is not the right helper here (it accepts a `NextRequest` and returns `{ memberId }` — verify against `lib/auth.ts`), replace with whichever helper the API uses for "Bearer token from CLI OR Clerk session" auth. Use `loadProjectAndMember` if you need to re-load the project; the milestone service already does its own project permission check via `projectService.getProject`, so `requireIdentity` alone suffices.

- [ ] **Step 3:** Manual smoke test against a dev server.

Run:

```bash
npm run dev
```

In another shell, with a known project id `<pid>` and a valid `Bearer` token:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"name":"v0.1 test"}' \
  http://localhost:3000/api/projects/<pid>/milestones | jq
```

Expected: `{ milestone: { id, name: 'v0.1 test', status: 'PLANNED', ... } }`. Then GET / PATCH / DELETE follow the same pattern.

- [ ] **Step 4:** Commit.

```bash
git add app/api/projects/[projectId]/milestones/route.ts app/api/milestones/[milestoneId]/route.ts
git commit -m "feat: add milestone API routes (list/create/get/update/delete) [LUM-61]"
```

---

## Phase 6 — Task ↔ Milestone Integration

### Task 6.1: Cross-project guard test for task service

**Files:**

- Modify: `__tests__/lib/services/task.service.test.ts` (or whichever existing test file covers task updates; create a sibling test file if none exists)

- [ ] **Step 1:** Add the following test block. Replace `taskService.updateTask` if the actual method name differs (check `lib/services/task.service.ts` exports).

```typescript
describe('taskService.updateTask milestone guard', () => {
  it('rejects when milestone belongs to a different project', async () => {
    // Mocks: task.findById returns { projectId: 'pA' }, milestoneRepository.findById returns { projectId: 'pB' }
    // ... existing mock setup ...
    await expect(
      taskService.updateTask('task-1', 'member-1', { milestoneId: 'm-other' })
    ).rejects.toMatchObject({
      message: 'Milestone does not belong to this project',
      status: 400,
    })
  })

  it('accepts milestoneId from the same project', async () => {
    // task.projectId === milestone.projectId
    // ... existing mock setup ...
    const result = await taskService.updateTask('task-1', 'member-1', {
      milestoneId: 'm-same',
    })
    expect(result.milestoneId).toBe('m-same')
  })

  it('unbinds milestone when milestoneId === null', async () => {
    const result = await taskService.updateTask('task-1', 'member-1', {
      milestoneId: null,
    })
    expect(result.milestoneId).toBeNull()
  })
})
```

- [ ] **Step 2:** Run tests; they fail until the service is updated.

Run:

```bash
npm test -- __tests__/lib/services/task.service.test.ts
```

Expected: FAIL on the three new cases.

### Task 6.2: Implement cross-project guard in task service

**Files:**

- Modify: `lib/services/task.service.ts` (and/or `lib/services/task-state.service.ts` — wherever `updateTask` resolves)

- [ ] **Step 1:** Locate the update method.

Run:

```bash
grep -n "milestoneId\|updateTask\|sprintId" lib/services/task.service.ts lib/services/task-state.service.ts 2>/dev/null | head -40
```

Use the same code path as the `sprintId` handling (which already exists). The guard goes immediately before the repository call.

- [ ] **Step 2:** In the chosen file, at the top of the update method body, after the task is loaded but before the update is dispatched, add:

```typescript
if (input.milestoneId !== undefined && input.milestoneId !== null) {
  const { milestoneRepository } =
    await import('@/lib/repositories/milestone.repository')
  const milestone = await milestoneRepository.findById(input.milestoneId)
  if (!milestone || milestone.projectId !== task.projectId) {
    throw Object.assign(
      new Error('Milestone does not belong to this project'),
      { status: 400 }
    )
  }
}
```

(Prefer a top-of-file import if it doesn't create a circular dependency — try that first; fall back to dynamic import only if the static import causes a cycle.)

- [ ] **Step 3:** Pass `milestoneId` through to the repository update. Find the existing `data: { ... }` block that already passes `sprintId`. Add `milestoneId: input.milestoneId` (the `undefined` case is naturally a no-op in Prisma; `null` unbinds).

- [ ] **Step 4:** Mirror the same guard in `task-creation.service.ts` (or wherever `createTask` lives) before the repository insert. Search for the existing sprint handling pattern and clone it.

- [ ] **Step 5:** Run all task tests.

Run:

```bash
npm test -- __tests__/lib/services/task
```

Expected: PASS, no regression on existing tests.

- [ ] **Step 6:** Commit.

```bash
git add lib/services/task.service.ts lib/services/task-state.service.ts lib/services/task-creation.service.ts __tests__/lib/services/task.service.test.ts
git commit -m "feat: accept milestoneId in task create/update with cross-project guard [LUM-61]"
```

### Task 6.3: Task list API milestoneId filter

**Files:**

- Modify: `app/api/projects/[id]/tasks/route.ts`
- Modify: `lib/repositories/task.repository.ts` (extend `findByProjectWithDetails` or the equivalent function used by this route)

- [ ] **Step 1:** In `app/api/projects/[id]/tasks/route.ts`, find the existing `sprintIdParam` block. Add an analogous block immediately after:

```typescript
const milestoneIdParam = searchParams.get('milestoneId')
const milestoneId: string | null | undefined =
  milestoneIdParam === null
    ? undefined
    : milestoneIdParam === 'null'
      ? null
      : milestoneIdParam
```

- [ ] **Step 2:** Pass `milestoneId` into the repository call:

```typescript
const tasks = await taskRepository.findByProjectWithDetails(
  id,
  sprintId,
  milestoneId
)
```

- [ ] **Step 3:** In `lib/repositories/task.repository.ts`, find `findByProjectWithDetails`. Add `milestoneId` as the third optional parameter and combine it into the `where` clause mirroring the existing `sprintId` handling. For example, if the existing pattern is:

```typescript
async findByProjectWithDetails(
  projectId: string,
  sprintId: string | null | undefined
) {
  const where: Prisma.TaskWhereInput = { projectId }
  if (sprintId === null) where.sprintId = null
  else if (typeof sprintId === 'string') where.sprintId = sprintId
  return prisma.task.findMany({ where, include: { ... } })
}
```

Extend to:

```typescript
async findByProjectWithDetails(
  projectId: string,
  sprintId: string | null | undefined,
  milestoneId: string | null | undefined
) {
  const where: Prisma.TaskWhereInput = { projectId }
  if (sprintId === null) where.sprintId = null
  else if (typeof sprintId === 'string') where.sprintId = sprintId
  if (milestoneId === null) where.milestoneId = null
  else if (typeof milestoneId === 'string') where.milestoneId = milestoneId
  return prisma.task.findMany({ where, include: { ... } })
}
```

- [ ] **Step 4:** Update any other callers of `findByProjectWithDetails` to pass `undefined` for the new param.

Run:

```bash
grep -rn "findByProjectWithDetails" lib app | grep -v node_modules
```

Inspect each call site and add the new arg.

- [ ] **Step 5:** Type-check.

Run:

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6:** Commit.

```bash
git add app/api/projects/[id]/tasks/route.ts lib/repositories/task.repository.ts
git commit -m "feat: support milestoneId filter on project task list [LUM-61]"
```

---

## Phase 7 — CLI

### Task 7.1: `lumo milestone list`

**Files:**

- Create: `cli/src/commands/milestone-list.ts`
- Modify: `cli/src/cli.ts` (or wherever commander is wired — the file that registers `task-create`, `project-list`, etc.)

- [ ] **Step 1:** Create the command file.

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

interface MilestoneRow {
  id: string
  name: string
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  targetDate: string | null
  createdAt: string
}

interface MilestonesResponse {
  milestones: MilestoneRow[]
}

export interface MilestoneListOptions {
  project?: string
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return iso.slice(0, 10)
}

export function formatMilestoneList(rows: MilestoneRow[]): string {
  if (rows.length === 0) return 'No milestones.'
  const statusW = Math.max(...rows.map(r => r.status.length))
  const dateW = Math.max(...rows.map(r => formatDate(r.targetDate).length))
  return rows
    .map(
      r =>
        `${r.status.padEnd(statusW)}  ${formatDate(r.targetDate).padEnd(dateW)}  ${r.name}`
    )
    .join('\n')
}

export async function milestoneList(
  options: MilestoneListOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  // Resolve project: either --project, or default if the workspace has exactly one.
  const projectsRes = await fetch(`${base}/api/projects`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (projectsRes.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!projectsRes.ok) {
    console.error(`Error: could not list projects (HTTP ${projectsRes.status})`)
    return 1
  }
  const { projects } = (await projectsRes.json()) as {
    projects: Array<{ id: string; name: string }>
  }

  let projectId: string | undefined
  if (options.project) {
    const ref = options.project.trim().toLowerCase()
    const match = projects.find(
      p => p.name.toLowerCase() === ref || slugify(p.name) === ref
    )
    if (!match) {
      console.error(
        `Error: project "${options.project}" not found. Try \`lumo project list\`.`
      )
      return 1
    }
    projectId = match.id
  } else if (projects.length === 1) {
    projectId = projects[0].id
  } else {
    console.error(
      'Error: workspace has multiple projects; pass --project <slug>.'
    )
    return 1
  }

  const res = await fetch(`${base}/api/projects/${projectId}/milestones`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!res.ok) {
    console.error(`Error: milestone list failed (HTTP ${res.status})`)
    return 1
  }
  const data = (await res.json()) as MilestonesResponse
  process.stdout.write(formatMilestoneList(data.milestones) + '\n')
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
```

- [ ] **Step 2:** Wire the command into commander.

Open the CLI entry (search: `grep -rn "task-create\|task create" cli/src/cli.ts cli/src/index.ts 2>/dev/null`). Add:

```typescript
import { milestoneList } from './commands/milestone-list'

const milestone = program.command('milestone').description('Milestone commands')
milestone
  .command('list')
  .description('List milestones for a project')
  .option('--project <ref>', 'Project name or slug')
  .action(async opts => {
    const code = await milestoneList({ project: opts.project })
    if (typeof code === 'number') process.exit(code)
  })
```

- [ ] **Step 3:** Build and smoke-test the CLI.

Run:

```bash
cd cli && npm run build && cd -
lumo milestone list
```

Expected: prints `No milestones.` (empty state) for the current workspace's project — or rows if you created one earlier via curl.

- [ ] **Step 4:** Commit.

```bash
git add cli/src/commands/milestone-list.ts cli/src/cli.ts
git commit -m "feat(cli): add \`lumo milestone list\` [LUM-61]"
```

### Task 7.2: `--milestone` flag on `task create` and `task update`

**Files:**

- Modify: `cli/src/commands/task-create.ts`
- Modify: `cli/src/commands/task-update.ts`
- Modify: CLI entry file (registration of `--milestone` flag)

- [ ] **Step 1:** In `task-create.ts`, extend `CreateTaskOptions`:

```typescript
export interface CreateTaskOptions {
  description?: string
  priority?: string
  assignee?: string
  project?: string
  milestone?: string
}
```

- [ ] **Step 2:** In the same file, find where the POST body is constructed (search for `priority`). Add the milestone resolution step _before_ the POST:

```typescript
let milestoneId: string | undefined
if (options.milestone && options.milestone.length > 0) {
  // resolve via /api/projects/<projectId>/milestones
  const msRes = await fetch(`${base}/api/projects/${projectId}/milestones`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!msRes.ok) {
    console.error(`Error: could not list milestones (HTTP ${msRes.status})`)
    return 1
  }
  const { milestones } = (await msRes.json()) as {
    milestones: Array<{ id: string; name: string }>
  }
  const needle = options.milestone.toLowerCase()
  const match = milestones.find(m => m.name.toLowerCase() === needle)
  if (!match) {
    console.error(
      `Error: milestone "${options.milestone}" not found. Try \`lumo milestone list --project <slug>\`.`
    )
    return 1
  }
  milestoneId = match.id
}
```

Then include `milestoneId` in the JSON body sent to `POST /api/tasks`.

- [ ] **Step 3:** In `task-update.ts`, extend `UpdateTaskOptions`:

```typescript
export interface UpdateTaskOptions {
  title?: string
  description?: string
  status?: string
  priority?: string
  assignee?: string
  milestone?: string
}
```

- [ ] **Step 4:** Add the milestone-resolution branch in `task-update.ts`. Note that `--milestone ""` must unbind. After loading the task (so we know its `projectId`):

```typescript
if (options.milestone !== undefined) {
  if (options.milestone === '') {
    patchBody.milestoneId = null
  } else {
    const msRes = await fetch(
      `${base}/api/projects/${task.projectId}/milestones`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
    if (!msRes.ok) {
      console.error(`Error: could not list milestones (HTTP ${msRes.status})`)
      return 1
    }
    const { milestones } = (await msRes.json()) as {
      milestones: Array<{ id: string; name: string }>
    }
    const needle = options.milestone.toLowerCase()
    const match = milestones.find(m => m.name.toLowerCase() === needle)
    if (!match) {
      console.error(
        `Error: milestone "${options.milestone}" not found. Try \`lumo milestone list\`.`
      )
      return 1
    }
    patchBody.milestoneId = match.id
  }
}
```

- [ ] **Step 5:** Add the `--milestone <ref>` option to both commander registrations in the CLI entry file.

```typescript
.option('--milestone <ref>', 'Milestone name (case-insensitive); "" to unbind on update')
```

- [ ] **Step 6:** Build + smoke-test.

```bash
cd cli && npm run build && cd -
lumo task create "Plan smoke test" --milestone "v0.1 test"
lumo task update LUM-<n> --milestone ""
```

Expected: first prints `Created LUM-<n+1> "Plan smoke test"  https://...`; second prints `Updated LUM-<n>` and the task page shows no milestone.

- [ ] **Step 7:** Commit.

```bash
git add cli/src/commands/task-create.ts cli/src/commands/task-update.ts cli/src/cli.ts
git commit -m "feat(cli): add --milestone flag to task create/update [LUM-61]"
```

### Task 7.3: Show milestone in `lumo task context`

**Files:**

- Modify: `app/api/tasks/[id]/context/route.ts` (or wherever the context endpoint lives — search if unsure)
- Modify: `cli/src/commands/task-context.ts`

- [ ] **Step 1:** Find the context endpoint.

```bash
grep -rn "task.*context\|TaskContextResponse" app cli/src | head
```

- [ ] **Step 2:** In the server route, add `milestone` to the task `select`/`include` (`{ id, name, status, targetDate }`).

- [ ] **Step 3:** In `cli/src/commands/task-context.ts`, extend the `TaskContextResponse` type with:

```typescript
milestone?: {
  id: string
  name: string
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  targetDate: string | null
} | null
```

- [ ] **Step 4:** In `formatTaskContextMarkdown`, after the existing `**Status**: ...` line, add:

```typescript
if (data.task.milestone) {
  const target = data.task.milestone.targetDate
    ? `, target ${data.task.milestone.targetDate.slice(0, 10)}`
    : ''
  lines.push(
    `**Milestone**: ${data.task.milestone.name} (${data.task.milestone.status}${target})`
  )
}
```

- [ ] **Step 5:** Build + smoke-test.

```bash
cd cli && npm run build && cd -
lumo task context LUM-<n with milestone>
```

Expected: output includes the new `**Milestone**: ...` line.

- [ ] **Step 6:** Commit.

```bash
git add app/api/tasks/[id]/context/route.ts cli/src/commands/task-context.ts
git commit -m "feat(cli): include milestone in task context output [LUM-61]"
```

### Task 7.4: Update `.claude/skills/lumo/SKILL.md`

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1:** In the frontmatter `description` field, append the milestone triggers. Locate the current `description:` line and add to its prose: `, milestone, 里程碑, set milestone, 挂到 milestone`.

- [ ] **Step 2:** In the `### lumo task create` section, add a row to the flag table:

```markdown
| `--milestone <ref>` | string | Milestone name (case-insensitive) within the resolved project. Omit for no binding. |
```

And add one example to the Examples block:

```bash
lumo task create "Plan API design" --milestone "v1.0"
```

- [ ] **Step 3:** In the `### lumo task update` section, add a row:

```markdown
| `--milestone <ref>` | string | Milestone name (case-insensitive). `--milestone ""` unbinds. |
```

And one example:

```bash
lumo task update LUM-48 --milestone "v1.0"
lumo task update LUM-48 --milestone ""        # unbind
```

- [ ] **Step 4:** Add a new section under "Project Management" (or near `project list`):

````markdown
### `lumo milestone list [--project <ref>]` — list milestones in a project

Prints fixed-width rows: `<STATUS>  <target-date or ->  <name>`, sorted by target date asc (nulls last) then created asc.

```bash
lumo milestone list                # only-one-project workspace
lumo milestone list --project web  # multi-project workspace
```

`--project <ref>` is required when the workspace has more than one project (consistent with `task create --project`). Match is by project name or slug, case-insensitive.

### When to suggest `milestone list`

- Before suggesting `task create --milestone <ref>` or `task update --milestone <ref>` to confirm the milestone exists with the user's expected name.
- When the user asks "what milestones do we have on <project>" or similar.
````

- [ ] **Step 5:** Commit.

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs(skill): document --milestone flag and milestone list command [LUM-61]"
```

---

## Phase 8 — i18n

### Task 8.1: Add milestone keys to every locale file

**Files:**

- Modify: every `lib/i18n/*.json` (en, en-AU, en-GB, de, es, es-419, fr, hi, id, ja, ko, ms, ru, vi, zh-CN, zh-TW)

This is a single coordinated edit. New keys to add to every locale, with the language-appropriate value:

| Key                           | en (also use for en-GB, en-AU)                                  | zh-CN                                             | zh-TW                                              | ja                                                                 | ko                                                                   | de                                                                     | es / es-419                                                | fr                                                                       | id                                                    | ms                                                      | vi                                                      | ru                                                        | hi                                                         |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `milestone.tab.title`         | `Milestones`                                                    | `里程碑`                                          | `里程碑`                                           | `マイルストーン`                                                   | `마일스톤`                                                           | `Meilensteine`                                                         | `Hitos`                                                    | `Jalons`                                                                 | `Tonggak`                                             | `Tonggak`                                               | `Cột mốc`                                               | `Вехи`                                                    | `मील के पत्थर`                                             |
| `milestone.empty.title`       | `No milestones yet`                                             | `还没有里程碑`                                    | `還沒有里程碑`                                     | `マイルストーンなし`                                               | `마일스톤 없음`                                                      | `Noch keine`                                                           | `Aún no hay`                                               | `Aucun jalon`                                                            | `Belum ada`                                           | `Belum ada`                                             | `Chưa có cột mốc`                                       | `Пока нет вех`                                            | `अभी तक नहीं`                                              |
| `milestone.empty.cta`         | `Create your first milestone`                                   | `创建第一个里程碑`                                | `建立第一個里程碑`                                 | `最初の作成`                                                       | `첫 마일스톤 만들기`                                                 | `Ersten anlegen`                                                       | `Crear primero`                                            | `Créer le premier`                                                       | `Buat pertama`                                        | `Cipta pertama`                                         | `Tạo đầu tiên`                                          | `Создать первую`                                          | `पहला बनाएँ`                                               |
| `milestone.new`               | `New milestone`                                                 | `新建里程碑`                                      | `新增里程碑`                                       | `新規`                                                             | `새 마일스톤`                                                        | `Neu`                                                                  | `Nuevo`                                                    | `Nouveau`                                                                | `Baru`                                                | `Baharu`                                                | `Mới`                                                   | `Создать`                                                 | `नया`                                                      |
| `milestone.edit`              | `Edit milestone`                                                | `编辑里程碑`                                      | `編輯里程碑`                                       | `編集`                                                             | `편집`                                                               | `Bearbeiten`                                                           | `Editar`                                                   | `Modifier`                                                               | `Edit`                                                | `Sunting`                                               | `Sửa`                                                   | `Изменить`                                                | `संपादित करें`                                             |
| `milestone.delete`            | `Delete milestone`                                              | `删除里程碑`                                      | `刪除里程碑`                                       | `削除`                                                             | `삭제`                                                               | `Löschen`                                                              | `Eliminar`                                                 | `Supprimer`                                                              | `Hapus`                                               | `Padam`                                                 | `Xoá`                                                   | `Удалить`                                                 | `हटाएँ`                                                    |
| `milestone.delete.confirm`    | `Delete milestone "{name}"? Tasks under it will be unassigned.` | `确认删除里程碑 "{name}"？其下的任务将解除关联。` | `確認刪除里程碑「{name}」？其下的任務將解除關聯。` | `マイルストーン「{name}」を削除しますか？関連タスクは外されます。` | `마일스톤 "{name}"을(를) 삭제할까요? 관련 작업은 연결이 해제됩니다.` | `Meilenstein "{name}" löschen? Zugehörige Aufgaben werden entkoppelt.` | `¿Eliminar el hito "{name}"? Las tareas se desvincularán.` | `Supprimer le jalon « {name} » ? Les tâches associées seront détachées.` | `Hapus tonggak "{name}"? Tugas terkait akan dilepas.` | `Padam tonggak "{name}"? Tugas berkaitan akan dilepas.` | `Xoá cột mốc "{name}"? Các nhiệm vụ sẽ bị bỏ liên kết.` | `Удалить веху «{name}»? Связанные задачи будут отвязаны.` | `मील का पत्थर "{name}" हटाएँ? संबंधित कार्य अनलिंक होंगे।` |
| `milestone.field.name`        | `Name`                                                          | `名称`                                            | `名稱`                                             | `名前`                                                             | `이름`                                                               | `Name`                                                                 | `Nombre`                                                   | `Nom`                                                                    | `Nama`                                                | `Nama`                                                  | `Tên`                                                   | `Имя`                                                     | `नाम`                                                      |
| `milestone.field.description` | `Description`                                                   | `描述`                                            | `描述`                                             | `説明`                                                             | `설명`                                                               | `Beschreibung`                                                         | `Descripción`                                              | `Description`                                                            | `Deskripsi`                                           | `Penerangan`                                            | `Mô tả`                                                 | `Описание`                                                | `विवरण`                                                    |
| `milestone.field.status`      | `Status`                                                        | `状态`                                            | `狀態`                                             | `状態`                                                             | `상태`                                                               | `Status`                                                               | `Estado`                                                   | `Statut`                                                                 | `Status`                                              | `Status`                                                | `Trạng thái`                                            | `Статус`                                                  | `स्थिति`                                                   |
| `milestone.field.startDate`   | `Start date`                                                    | `开始日期`                                        | `開始日期`                                         | `開始日`                                                           | `시작일`                                                             | `Startdatum`                                                           | `Fecha de inicio`                                          | `Date de début`                                                          | `Tanggal mulai`                                       | `Tarikh mula`                                           | `Ngày bắt đầu`                                          | `Дата начала`                                             | `आरंभ तिथि`                                                |
| `milestone.field.targetDate`  | `Target date`                                                   | `目标日期`                                        | `目標日期`                                         | `目標日`                                                           | `목표일`                                                             | `Zieldatum`                                                            | `Fecha objetivo`                                           | `Date cible`                                                             | `Tanggal target`                                      | `Tarikh sasaran`                                        | `Ngày mục tiêu`                                         | `Целевая дата`                                            | `लक्ष्य तिथि`                                              |
| `milestone.status.PLANNED`    | `Planned`                                                       | `计划中`                                          | `規劃中`                                           | `計画中`                                                           | `계획됨`                                                             | `Geplant`                                                              | `Planificado`                                              | `Planifié`                                                               | `Direncanakan`                                        | `Dirancang`                                             | `Đã lên kế hoạch`                                       | `Запланирована`                                           | `नियोजित`                                                  |
| `milestone.status.ACTIVE`     | `Active`                                                        | `进行中`                                          | `進行中`                                           | `進行中`                                                           | `진행 중`                                                            | `Aktiv`                                                                | `Activo`                                                   | `Actif`                                                                  | `Aktif`                                               | `Aktif`                                                 | `Đang hoạt động`                                        | `Активна`                                                 | `सक्रिय`                                                   |
| `milestone.status.COMPLETED`  | `Completed`                                                     | `已完成`                                          | `已完成`                                           | `完了`                                                             | `완료됨`                                                             | `Abgeschlossen`                                                        | `Completado`                                               | `Terminé`                                                                | `Selesai`                                             | `Selesai`                                               | `Hoàn thành`                                            | `Завершена`                                               | `पूर्ण`                                                    |
| `milestone.status.CANCELLED`  | `Cancelled`                                                     | `已取消`                                          | `已取消`                                           | `中止`                                                             | `취소됨`                                                             | `Abgebrochen`                                                          | `Cancelado`                                                | `Annulé`                                                                 | `Dibatalkan`                                          | `Dibatalkan`                                            | `Đã huỷ`                                                | `Отменена`                                                | `रद्द`                                                     |
| `milestone.progress`          | `{done}/{total} tasks`                                          | `{done}/{total} 项任务`                           | `{done}/{total} 項任務`                            | `{done}/{total} 件のタスク`                                        | `{done}/{total} 작업`                                                | `{done}/{total} Aufgaben`                                              | `{done}/{total} tareas`                                    | `{done}/{total} tâches`                                                  | `{done}/{total} tugas`                                | `{done}/{total} tugas`                                  | `{done}/{total} nhiệm vụ`                               | `{done}/{total} задач`                                    | `{done}/{total} कार्य`                                     |
| `milestone.targetDate.none`   | `No target date`                                                | `无目标日期`                                      | `無目標日期`                                       | `目標日なし`                                                       | `목표일 없음`                                                        | `Kein Zieldatum`                                                       | `Sin fecha`                                                | `Aucune date`                                                            | `Tanpa tanggal`                                       | `Tanpa tarikh`                                          | `Không có`                                              | `Без даты`                                                | `कोई तिथि नहीं`                                            |
| `task.field.milestone`        | `Milestone`                                                     | `里程碑`                                          | `里程碑`                                           | `マイルストーン`                                                   | `마일스톤`                                                           | `Meilenstein`                                                          | `Hito`                                                     | `Jalon`                                                                  | `Tonggak`                                             | `Tonggak`                                               | `Cột mốc`                                               | `Веха`                                                    | `मील का पत्थर`                                             |
| `task.field.milestone.none`   | `No milestone`                                                  | `无里程碑`                                        | `無里程碑`                                         | `マイルストーンなし`                                               | `마일스톤 없음`                                                      | `Kein Meilenstein`                                                     | `Sin hito`                                                 | `Aucun jalon`                                                            | `Tanpa tonggak`                                       | `Tiada tonggak`                                         | `Không có cột mốc`                                      | `Без вехи`                                                | `कोई नहीं`                                                 |
| `task.filter.milestone`       | `Milestone`                                                     | `里程碑`                                          | `里程碑`                                           | `マイルストーン`                                                   | `마일스톤`                                                           | `Meilenstein`                                                          | `Hito`                                                     | `Jalon`                                                                  | `Tonggak`                                             | `Tonggak`                                               | `Cột mốc`                                               | `Веха`                                                    | `मील का पत्थर`                                             |
| `task.filter.milestone.none`  | `No milestone`                                                  | `无里程碑`                                        | `無里程碑`                                         | `マイルストーンなし`                                               | `마일스톤 없음`                                                      | `Kein Meilenstein`                                                     | `Sin hito`                                                 | `Aucun jalon`                                                            | `Tanpa tonggak`                                       | `Tiada tonggak`                                         | `Không có cột mốc`                                      | `Без вехи`                                                | `कोई नहीं`                                                 |
| `project.tab.milestones`      | `Milestones`                                                    | `里程碑`                                          | `里程碑`                                           | `マイルストーン`                                                   | `마일스톤`                                                           | `Meilensteine`                                                         | `Hitos`                                                    | `Jalons`                                                                 | `Tonggak`                                             | `Tonggak`                                               | `Cột mốc`                                               | `Вехи`                                                    | `मील के पत्थर`                                             |

- [ ] **Step 1:** Open each locale file and insert the new keys. The files are dotted/flat JSON: add lines like

```json
  "milestone.tab.title": "Milestones",
  "milestone.empty.title": "No milestones yet",
  ...
```

into the existing flat key list. Maintain alphabetical proximity if the file is grouped; otherwise append near the existing `project.tab.*` or `task.field.*` lines.

- [ ] **Step 2:** Verify all 16 files contain every new key.

Run:

```bash
for f in lib/i18n/*.json; do
  echo "== $f =="
  grep -c '"milestone\.' "$f"
done
```

Expected: each prints the same count (the number of `milestone.*` keys you added, ~19).

- [ ] **Step 3:** Commit.

```bash
git add lib/i18n/
git commit -m "i18n: add milestone keys across all locales [LUM-61]"
```

---

## Phase 9 — Frontend: API Client

### Task 9.1: Milestone API client

**Files:**

- Create: `lib/api-client/milestone.ts`

- [ ] **Step 1:** Create the file.

```typescript
import type { MilestoneStatus } from '@prisma/client'

export interface Milestone {
  id: string
  projectId: string
  name: string
  description: string | null
  status: MilestoneStatus
  startDate: string | null
  targetDate: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MilestoneCreateInput {
  name: string
  description?: string | null
  startDate?: string | null
  targetDate?: string | null
}

export interface MilestoneUpdateInput {
  name?: string
  description?: string | null
  status?: MilestoneStatus
  startDate?: string | null
  targetDate?: string | null
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export const milestoneApi = {
  async list(projectId: string): Promise<Milestone[]> {
    const res = await fetch(`/api/projects/${projectId}/milestones`)
    const data = await handle<{ milestones: Milestone[] }>(res)
    return data.milestones
  },
  async get(milestoneId: string): Promise<Milestone> {
    const res = await fetch(`/api/milestones/${milestoneId}`)
    const data = await handle<{ milestone: Milestone }>(res)
    return data.milestone
  },
  async create(
    projectId: string,
    input: MilestoneCreateInput
  ): Promise<Milestone> {
    const res = await fetch(`/api/projects/${projectId}/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await handle<{ milestone: Milestone }>(res)
    return data.milestone
  },
  async update(
    milestoneId: string,
    input: MilestoneUpdateInput
  ): Promise<Milestone> {
    const res = await fetch(`/api/milestones/${milestoneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await handle<{ milestone: Milestone }>(res)
    return data.milestone
  },
  async delete(milestoneId: string): Promise<void> {
    const res = await fetch(`/api/milestones/${milestoneId}`, {
      method: 'DELETE',
    })
    await handle<{ ok: true }>(res)
  },
}
```

- [ ] **Step 2:** Type-check.

Run:

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3:** Commit.

```bash
git add lib/api-client/milestone.ts
git commit -m "feat: add milestone API client [LUM-61]"
```

---

## Phase 10 — Frontend: Milestones Tab + Detail

### Task 10.1: Register `'milestones'` in the project page tab state

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx`

- [ ] **Step 1:** Find the existing tab state:

```typescript
const [tab, setTab] = useState<'overview' | 'tasks' | 'summary'>('overview')
```

Change to (note tab ORDER for rendering will be Overview | Milestones | Tasks | Summary):

```typescript
const [tab, setTab] = useState<'overview' | 'milestones' | 'tasks' | 'summary'>(
  'overview'
)
```

- [ ] **Step 2:** In the tab-rendering JSX (search for the existing `overview` / `tasks` / `summary` triggers), add a `<TabsTrigger value="milestones">` between Overview and Tasks. Use:

```tsx
<TabsTrigger value='milestones'>
  {intl.formatMessage({ id: 'project.tab.milestones' })}
</TabsTrigger>
```

- [ ] **Step 3:** Add a `<TabsContent value="milestones">` rendering `<ProjectMilestonesTab projectId={project.id} />` (component created in 10.2).

- [ ] **Step 4:** Type-check (will fail because the component doesn't exist yet).

Run:

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: error about missing `ProjectMilestonesTab` — that's fine, we'll create it next.

### Task 10.2: `ProjectMilestonesTab` list component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/milestones/ProjectMilestonesTab.tsx`
- Create: `app/workspace/[workspaceUrl]/components/milestones/MilestoneCard.tsx`

- [ ] **Step 1:** Create `MilestoneCard.tsx`.

```tsx
'use client'

import { useIntl } from 'react-intl'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import type { Milestone } from '@/lib/api-client/milestone'

interface Props {
  milestone: Milestone
  progress: { done: number; total: number }
  workspaceUrl: string
  projectSlug: string
  onEdit: (m: Milestone) => void
  onDelete: (m: Milestone) => void
}

const STATUS_CLASS: Record<Milestone['status'], string> = {
  PLANNED: 'bg-gray-100 text-gray-800',
  ACTIVE: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-zinc-200 text-zinc-600',
}

export function MilestoneCard({
  milestone,
  progress,
  workspaceUrl,
  projectSlug,
  onEdit,
  onDelete,
}: Props) {
  const intl = useIntl()
  const href = `/workspace/${workspaceUrl}/projects/${projectSlug}/milestones/${milestone.id}`

  return (
    <div className='rounded-lg border p-4 hover:bg-muted/40 transition-colors'>
      <div className='flex items-start justify-between gap-2'>
        <Link href={href} className='flex-1 font-medium hover:underline'>
          {milestone.name}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' className='h-7 w-7'>
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={() => onEdit(milestone)}>
              {intl.formatMessage({ id: 'milestone.edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(milestone)}>
              {intl.formatMessage({ id: 'milestone.delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className='mt-2 flex items-center gap-3 text-xs text-muted-foreground'>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[milestone.status]}`}
        >
          {intl.formatMessage({ id: `milestone.status.${milestone.status}` })}
        </span>
        <span>
          {milestone.targetDate
            ? milestone.targetDate.slice(0, 10)
            : intl.formatMessage({ id: 'milestone.targetDate.none' })}
        </span>
        <span>
          {intl.formatMessage(
            { id: 'milestone.progress' },
            { done: progress.done, total: progress.total }
          )}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2:** Create `ProjectMilestonesTab.tsx`.

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { milestoneApi, type Milestone } from '@/lib/api-client/milestone'
import { MilestoneCard } from './MilestoneCard'
import { MilestoneFormDialog } from './MilestoneFormDialog'

interface Props {
  projectId: string
  projectSlug: string
}

export function ProjectMilestonesTab({ projectId, projectSlug }: Props) {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()
  const qc = useQueryClient()

  const { data: milestones = [], isLoading } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => milestoneApi.list(projectId),
  })

  const [dialogState, setDialogState] = useState<
    { mode: 'create' } | { mode: 'edit'; milestone: Milestone } | null
  >(null)

  const deleteMutation = useMutation({
    mutationFn: (m: Milestone) => milestoneApi.delete(m.id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['milestones', projectId] }),
  })

  if (isLoading) return null

  return (
    <div className='space-y-4 p-4'>
      <div className='flex justify-end'>
        <Button onClick={() => setDialogState({ mode: 'create' })}>
          {intl.formatMessage({ id: 'milestone.new' })}
        </Button>
      </div>

      {milestones.length === 0 ? (
        <div className='py-12 text-center'>
          <p className='text-lg font-medium'>
            {intl.formatMessage({ id: 'milestone.empty.title' })}
          </p>
          <Button
            variant='outline'
            className='mt-4'
            onClick={() => setDialogState({ mode: 'create' })}
          >
            {intl.formatMessage({ id: 'milestone.empty.cta' })}
          </Button>
        </div>
      ) : (
        <div className='grid gap-3'>
          {milestones.map(m => (
            <MilestoneCard
              key={m.id}
              milestone={m}
              progress={{
                done: m.taskCounts?.DONE ?? 0,
                total:
                  (m.taskCounts?.TODO ?? 0) +
                  (m.taskCounts?.IN_PROGRESS ?? 0) +
                  (m.taskCounts?.IN_REVIEW ?? 0) +
                  (m.taskCounts?.DONE ?? 0),
              }}
              workspaceUrl={params.workspaceUrl as string}
              projectSlug={projectSlug}
              onEdit={() => setDialogState({ mode: 'edit', milestone: m })}
              onDelete={m => {
                const ok = window.confirm(
                  intl.formatMessage(
                    { id: 'milestone.delete.confirm' },
                    { name: m.name }
                  )
                )
                if (ok) deleteMutation.mutate(m)
              }}
            />
          ))}
        </div>
      )}

      {dialogState && (
        <MilestoneFormDialog
          projectId={projectId}
          milestone={
            dialogState.mode === 'edit' ? dialogState.milestone : undefined
          }
          onClose={() => setDialogState(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3:** Pass `projectSlug` from `ProjectDetailPage.tsx` to `<ProjectMilestonesTab>` (update the call site added in 10.1).

- [ ] **Step 4:** Replace the `progress` placeholder in `MilestoneCard`. The simplest path: extend the GET `/api/projects/[projectId]/milestones` route to include `_count` per status. To do that:

In `app/api/projects/[projectId]/milestones/route.ts` GET handler, replace `milestoneService.listMilestones(...)` with a wrapper that, for each milestone, calls `milestoneRepository.countTasksByStatus(m.id)` and returns `{ ...m, taskCounts: { TODO, IN_PROGRESS, IN_REVIEW, DONE } }`. Update the `Milestone` type in `lib/api-client/milestone.ts` to include `taskCounts?: { TODO: number; IN_PROGRESS: number; IN_REVIEW: number; DONE: number }`.

Then in `ProjectMilestonesTab`, derive `progress` per card:

```typescript
const total =
  (m.taskCounts?.TODO ?? 0) +
  (m.taskCounts?.IN_PROGRESS ?? 0) +
  (m.taskCounts?.IN_REVIEW ?? 0) +
  (m.taskCounts?.DONE ?? 0)
const done = m.taskCounts?.DONE ?? 0
```

- [ ] **Step 5:** Type-check (will still fail on `MilestoneFormDialog` import).

```bash
npx tsc --noEmit 2>&1 | head -10
```

### Task 10.3: `MilestoneFormDialog`

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/milestones/MilestoneFormDialog.tsx`

- [ ] **Step 1:** Create the dialog.

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  milestoneApi,
  type Milestone,
  type MilestoneStatus,
} from '@/lib/api-client/milestone'

interface Props {
  projectId: string
  milestone?: Milestone
  onClose: () => void
}

const STATUSES: MilestoneStatus[] = [
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
]

export function MilestoneFormDialog({ projectId, milestone, onClose }: Props) {
  const intl = useIntl()
  const qc = useQueryClient()
  const editing = !!milestone

  const [name, setName] = useState(milestone?.name ?? '')
  const [description, setDescription] = useState(milestone?.description ?? '')
  const [status, setStatus] = useState<MilestoneStatus>(
    milestone?.status ?? 'PLANNED'
  )
  const [startDate, setStartDate] = useState(
    milestone?.startDate?.slice(0, 10) ?? ''
  )
  const [targetDate, setTargetDate] = useState(
    milestone?.targetDate?.slice(0, 10) ?? ''
  )

  const createMutation = useMutation({
    mutationFn: () =>
      milestoneApi.create(projectId, {
        name,
        description: description || null,
        startDate: startDate || null,
        targetDate: targetDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', projectId] })
      onClose()
    },
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      milestoneApi.update(milestone!.id, {
        name,
        description: description || null,
        status,
        startDate: startDate || null,
        targetDate: targetDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', projectId] })
      onClose()
    },
  })

  const busy = createMutation.isPending || updateMutation.isPending
  const submit = () =>
    editing ? updateMutation.mutate() : createMutation.mutate()

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({
              id: editing ? 'milestone.edit' : 'milestone.new',
            })}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div>
            <label className='text-sm font-medium'>
              {intl.formatMessage({ id: 'milestone.field.name' })}
            </label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className='text-sm font-medium'>
              {intl.formatMessage({ id: 'milestone.field.description' })}
            </label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {editing && (
            <div>
              <label className='text-sm font-medium'>
                {intl.formatMessage({ id: 'milestone.field.status' })}
              </label>
              <Select
                value={status}
                onValueChange={v => setStatus(v as MilestoneStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => (
                    <SelectItem key={s} value={s}>
                      {intl.formatMessage({ id: `milestone.status.${s}` })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='text-sm font-medium'>
                {intl.formatMessage({ id: 'milestone.field.startDate' })}
              </label>
              <Input
                type='date'
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className='text-sm font-medium'>
                {intl.formatMessage({ id: 'milestone.field.targetDate' })}
              </label>
              <Input
                type='date'
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={onClose} disabled={busy}>
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button onClick={submit} disabled={busy || name.trim().length === 0}>
            {intl.formatMessage({ id: 'common.save' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

(If `common.cancel` / `common.save` don't exist, use existing dialog buttons in the codebase as the model — search `grep -rn '"common\.' lib/i18n/en.json`. Add new keys if needed and replicate translations across all locales.)

- [ ] **Step 2:** Type-check the full app.

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3:** Manual smoke: start dev, navigate to project page → Milestones tab → create one, edit it, delete it.

```bash
npm run dev
```

- Browse to `/workspace/<slug>/projects/<projectSlug>`
- Click Milestones tab → click New milestone → fill in → save
- Verify it appears in the list
- Edit it (status change to ACTIVE) → save → status pill updates
- Delete → confirm prompt → card disappears

- [ ] **Step 4:** Commit.

```bash
git add app/workspace/[workspaceUrl]/components/milestones/ app/workspace/[workspaceUrl]/components/pages/ProjectDetailPage.tsx
git commit -m "feat: add project Milestones tab with create/edit/delete [LUM-61]"
```

### Task 10.4: Milestone detail page

**Files:**

- Modify: `app/workspace/[workspaceUrl]/utils/pathToPage.ts`
- Modify: `app/workspace/[workspaceUrl]/components/WorkspaceApp.tsx` (or wherever the page switch is)
- Create: `app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage.tsx`

- [ ] **Step 1:** Extend `pathToPage`. Find the existing `'/projects/'` branch:

```typescript
if (rest.startsWith('/projects/')) {
  const projectSlug = rest.slice('/projects/'.length).split('/')[0]
  return { page: 'project-detail', projectSlug }
}
```

Change to:

```typescript
if (rest.startsWith('/projects/')) {
  const after = rest.slice('/projects/'.length)
  const [projectSlug, segment, milestoneId] = after.split('/')
  if (segment === 'milestones' && milestoneId) {
    return { page: 'milestone-detail', projectSlug, milestoneId }
  }
  return { page: 'project-detail', projectSlug }
}
```

(Update the discriminated union return type accordingly.)

- [ ] **Step 2:** In `WorkspaceApp.tsx`, add a case for `'milestone-detail'`:

```tsx
{
  state.page === 'milestone-detail' && (
    <MilestoneDetailPage
      projectSlug={state.projectSlug}
      milestoneId={state.milestoneId}
    />
  )
}
```

- [ ] **Step 3:** Create `MilestoneDetailPage.tsx`.

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { milestoneApi, type Milestone } from '@/lib/api-client/milestone'
import { Button } from '@/components/ui/button'
import { MilestoneFormDialog } from '../milestones/MilestoneFormDialog'
import { TaskListByMilestone } from '../milestones/TaskListByMilestone'

interface Props {
  projectSlug: string
  milestoneId: string
}

const STATUS_CLASS: Record<Milestone['status'], string> = {
  PLANNED: 'bg-gray-100 text-gray-800',
  ACTIVE: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-zinc-200 text-zinc-600',
}

export function MilestoneDetailPage({ projectSlug, milestoneId }: Props) {
  const intl = useIntl()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)

  const { data: milestone } = useQuery({
    queryKey: ['milestone', milestoneId],
    queryFn: () => milestoneApi.get(milestoneId),
  })

  const deleteMutation = useMutation({
    mutationFn: () => milestoneApi.delete(milestoneId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', milestone!.projectId] })
      window.history.back()
    },
  })

  if (!milestone) return null

  return (
    <div className='space-y-6 p-6'>
      <header className='space-y-2'>
        <div className='flex items-center gap-3'>
          <h1 className='text-2xl font-semibold'>{milestone.name}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[milestone.status]}`}
          >
            {intl.formatMessage({ id: `milestone.status.${milestone.status}` })}
          </span>
          <div className='ml-auto flex gap-2'>
            <Button variant='outline' onClick={() => setEditing(true)}>
              {intl.formatMessage({ id: 'milestone.edit' })}
            </Button>
            <Button
              variant='outline'
              onClick={() => {
                const ok = window.confirm(
                  intl.formatMessage(
                    { id: 'milestone.delete.confirm' },
                    { name: milestone.name }
                  )
                )
                if (ok) deleteMutation.mutate()
              }}
            >
              {intl.formatMessage({ id: 'milestone.delete' })}
            </Button>
          </div>
        </div>
        <div className='text-sm text-muted-foreground'>
          {milestone.startDate && (
            <span>{milestone.startDate.slice(0, 10)} → </span>
          )}
          <span>
            {milestone.targetDate
              ? milestone.targetDate.slice(0, 10)
              : intl.formatMessage({ id: 'milestone.targetDate.none' })}
          </span>
        </div>
        {milestone.description && (
          <p className='whitespace-pre-wrap text-sm'>{milestone.description}</p>
        )}
      </header>

      <TaskListByMilestone
        projectId={milestone.projectId}
        milestoneId={milestone.id}
      />

      {editing && (
        <MilestoneFormDialog
          projectId={milestone.projectId}
          milestone={milestone}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4:** Create `TaskListByMilestone.tsx` — a thin wrapper that calls the existing project task-list endpoint with `?milestoneId=<id>` and renders the existing task list component. Search for the existing component used by the Project Tasks tab (likely `TaskTable` or `ProjectTasksTab`) and reuse its rendering. The minimal version:

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'

interface Props {
  projectId: string
  milestoneId: string
}

interface Task {
  id: string
  identifier: string
  title: string
  status: string
}

export function TaskListByMilestone({ projectId, milestoneId }: Props) {
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', projectId, { milestoneId }],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/tasks?milestoneId=${encodeURIComponent(milestoneId)}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { tasks: Task[] }
      return data.tasks
    },
  })

  return (
    <div className='rounded border'>
      {tasks.length === 0 ? (
        <div className='p-6 text-center text-sm text-muted-foreground'>
          No tasks
        </div>
      ) : (
        <ul className='divide-y'>
          {tasks.map(t => (
            <li key={t.id} className='p-3 text-sm'>
              <span className='font-mono text-xs text-muted-foreground mr-2'>
                {t.identifier}
              </span>
              {t.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

(If the existing task-list component is straightforward to import, prefer that over this minimal version.)

- [ ] **Step 5:** Type-check + smoke.

```bash
npx tsc --noEmit && npm run dev
```

Browse to a milestone card → click it → detail page renders with description, status pill, task list (empty or populated). Edit + delete buttons work.

- [ ] **Step 6:** Commit.

```bash
git add app/workspace/[workspaceUrl]
git commit -m "feat: add milestone detail page with task list [LUM-61]"
```

---

## Phase 11 — Frontend: Task Form Milestone Selector

### Task 11.1: Add `<TaskMilestoneField>` next to the Sprint field

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/milestones/TaskMilestoneField.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`

- [ ] **Step 1:** Create the field component.

```tsx
'use client'

import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { milestoneApi } from '@/lib/api-client/milestone'

interface Props {
  projectId: string
  value: string | null
  onChange: (milestoneId: string | null) => void
  triggerClassName?: string
}

const NONE = '__none__'

export function TaskMilestoneField({
  projectId,
  value,
  onChange,
  triggerClassName,
}: Props) {
  const intl = useIntl()
  const { data: milestones = [] } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => milestoneApi.list(projectId),
  })

  const selectable = milestones.filter(m => m.status !== 'CANCELLED')

  return (
    <Select
      value={value ?? NONE}
      onValueChange={v => onChange(v === NONE ? null : v)}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue
          placeholder={intl.formatMessage({ id: 'task.field.milestone' })}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          {intl.formatMessage({ id: 'task.field.milestone.none' })}
        </SelectItem>
        {selectable.map(m => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
            {m.targetDate ? ` · ${m.targetDate.slice(0, 10)}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 2:** In `TaskDetailSidebar.tsx`, find the `TaskSprintField` import + usage:

```typescript
import { TaskSprintField } from '../sprints/components/TaskSprintField'
```

Add immediately below:

```typescript
import { TaskMilestoneField } from './milestones/TaskMilestoneField'
```

- [ ] **Step 3:** In the same file, find the properties array entry that renders the Sprint field. Add a sibling entry immediately after, calling `onPatch({ milestoneId: ... })`:

```typescript
{
  label: intl.formatMessage({ id: 'task.field.milestone' }),
  node: (
    <TaskMilestoneField
      projectId={task.projectId}
      value={task.milestoneId ?? null}
      onChange={v => onPatch({ milestoneId: v })}
      triggerClassName={FIELD_TRIGGER_CLS}
    />
  ),
},
```

(If `task` doesn't expose `milestoneId` yet — most likely the type comes from `lib/api-client/task.ts` or similar — add the field there. Search: `grep -rn "sprintId" lib/api-client/task.ts types/` to find the type and mirror the addition.)

- [ ] **Step 4:** Type-check.

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5:** Smoke-test: open a task in the project → milestone selector appears next to sprint → select a milestone → reload → still selected.

- [ ] **Step 6:** Commit.

```bash
git add app/workspace/[workspaceUrl]/components/milestones/TaskMilestoneField.tsx app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx lib/api-client/task.ts types/
git commit -m "feat: add milestone selector to task detail sidebar [LUM-61]"
```

---

## Phase 12 — Frontend: Project Tasks Tab Filter

### Task 12.1: `<MilestoneFilterPicker>` and wire-up

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/milestones/MilestoneFilterPicker.tsx`
- Modify: the file that renders the existing Status/Priority/Assignee filter bar inside the project Tasks tab (search: `grep -rn "BulkStatusPicker\|sprintId\|task.filter" app/workspace/[workspaceUrl] | head -30`)

- [ ] **Step 1:** Create the filter picker.

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { milestoneApi } from '@/lib/api-client/milestone'

interface Props {
  projectId: string
  value: string | null | undefined // undefined = no filter, null = "no milestone", string = milestone id
  onChange: (v: string | null | undefined) => void
}

const NONE = '__none__'
const CLEAR = '__clear__'

export function MilestoneFilterPicker({ projectId, value, onChange }: Props) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const { data: milestones = [] } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => milestoneApi.list(projectId),
  })

  const selected =
    value === null
      ? intl.formatMessage({ id: 'task.filter.milestone.none' })
      : value
        ? (milestones.find(m => m.id === value)?.name ??
          intl.formatMessage({ id: 'task.filter.milestone' }))
        : intl.formatMessage({ id: 'task.filter.milestone' })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          {selected}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-56 p-0' align='end'>
        <Command>
          <CommandList>
            <CommandItem
              onSelect={() => {
                onChange(undefined)
                setOpen(false)
              }}
            >
              {intl.formatMessage({ id: 'task.filter.milestone' })} (any)
            </CommandItem>
            <CommandItem
              onSelect={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              {intl.formatMessage({ id: 'task.filter.milestone.none' })}
            </CommandItem>
            {milestones.map(m => (
              <CommandItem
                key={m.id}
                onSelect={() => {
                  onChange(m.id)
                  setOpen(false)
                }}
              >
                {m.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2:** In the project Tasks tab component (the one that renders the existing filter bar + task table), add a `milestoneFilter` state alongside the existing filters:

```typescript
const [milestoneFilter, setMilestoneFilter] = useState<
  string | null | undefined
>(undefined)
```

- [ ] **Step 3:** Render `<MilestoneFilterPicker>` next to the existing filter pickers, passing `projectId={project.id}` and the state.

- [ ] **Step 4:** Include `milestoneId` in the task fetch. Find where the project Tasks tab fetches tasks (it should hit `/api/projects/[id]/tasks` already). Extend the query string:

```typescript
const params = new URLSearchParams()
if (sprintFilter !== undefined)
  params.set('sprintId', sprintFilter === null ? 'null' : sprintFilter)
if (milestoneFilter !== undefined)
  params.set('milestoneId', milestoneFilter === null ? 'null' : milestoneFilter)
const qs = params.toString()
const res = await fetch(`/api/projects/${projectId}/tasks${qs ? `?${qs}` : ''}`)
```

Also include `milestoneFilter` in the `queryKey` so React Query refetches on change.

- [ ] **Step 5:** Type-check.

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6:** Smoke-test: open project Tasks tab → click new Milestone filter → pick a milestone → list narrows to tasks in that milestone. Pick "No milestone" → list narrows to unbound tasks. Pick "any" → filter clears.

- [ ] **Step 7:** Commit.

```bash
git add app/workspace/[workspaceUrl]/components/milestones/MilestoneFilterPicker.tsx app/workspace/[workspaceUrl]/components
git commit -m "feat: add milestone filter to project tasks tab [LUM-61]"
```

---

## Phase 13 — Final Verification + PR

### Task 13.1: Run all checks

- [ ] **Step 1:** Full type check.

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2:** Full test suite.

```bash
npm test
```

Expected: all pass. Inspect any unrelated failures and decide whether they're pre-existing (allowed) or introduced by this PR (must fix).

- [ ] **Step 3:** Manual end-to-end walkthrough.

```bash
npm run dev
```

With the dev server running:

1. Open a project → Milestones tab → create "v0.1 demo" (target date 2026-06-30)
2. Open a task → set milestone to "v0.1 demo" → reload → still set
3. Open project Tasks tab → filter by "v0.1 demo" → task appears
4. Filter by "No milestone" → other tasks appear
5. From CLI: `lumo milestone list` → row appears
6. From CLI: `lumo task create "test milestone CLI" --milestone "v0.1 demo"` → task created with milestone
7. From CLI: `lumo task context LUM-<n>` → output includes `**Milestone**: v0.1 demo (PLANNED, target 2026-06-30)`
8. From CLI: `lumo task update LUM-<n> --milestone ""` → output `Updated LUM-<n>`, page shows unbound
9. From Milestones tab → click "v0.1 demo" → delete (confirm dialog) → tasks under it show no milestone

- [ ] **Step 4:** Check the i18n key counts are still uniform.

```bash
for f in lib/i18n/*.json; do
  printf "%s %s\n" "$f" "$(grep -c '"milestone\.' "$f")"
done | sort -k2
```

Expected: all files report the same count (e.g., 19).

### Task 13.2: Open PR

- [ ] **Step 1:** Push the branch.

```bash
git push -u origin lumo/LUM-61-add-project-milestones
```

- [ ] **Step 2:** Open the PR.

```bash
gh pr create --title "feat: add milestones under project [LUM-61]" --body "$(cat <<'EOF'
## Summary

- Adds project-scoped Milestone model (PLANNED/ACTIVE/COMPLETED/CANCELLED, optional start+target dates) with task linkage via `Task.milestoneId`
- Full repository/service/API stack with status-transition handling and cross-project guard
- New project Milestones tab + milestone detail page + task selector + project-tasks milestone filter
- CLI: `lumo milestone list`, `--milestone` flag on `task create / update`, milestone line in `task context`
- i18n across all 16 locales
- Sprint and Milestone are orthogonal — a task can belong to both

## Test plan

- [x] `npx tsc --noEmit` passes
- [x] `npm test` passes
- [x] `prisma migrate dev` applies cleanly
- [x] End-to-end manual walkthrough (web + CLI)
- [x] All locale files have identical milestone key counts
- [x] `.claude/skills/lumo/SKILL.md` updated to match new CLI surface

Spec: [`docs/superpowers/specs/2026-05-21-project-milestones-design.md`](docs/superpowers/specs/2026-05-21-project-milestones-design.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3:** Return the PR URL.

---

## Self-Review Notes

The plan addresses every requirement from the spec:

- §3 Data model → Phase 1
- §4.1 Repository → Phase 3
- §4.2 Service → Phase 4
- §4.3 API routes → Phase 5
- §4.4 Validation → Phase 2
- §4.5 Task API extension (milestoneId + cross-project guard) → Phase 6
- §4.6 Task list API filter → Phase 6
- §5 CLI → Phase 7
- §6 Frontend (tab, detail, dialog, selector, filter) → Phases 9–12
- §7 i18n → Phase 8
- §8 Testing → Phases 3, 4, 6 (repo + service + cross-project guard tests)
- §9 Acceptance Checklist → Phase 13

Known imprecisions that require the implementing engineer to look at existing code (called out inline rather than fabricated):

- Exact import path of `requireIdentity` / `requireAuth` / `loadProjectAndMember` from `lib/api/helpers.ts` and `lib/auth` — code uses both shapes in different routes
- Exact location of task `updateTask` / `createTask` logic (split across `task.service.ts`, `task-state.service.ts`, `task-creation.service.ts`)
- Exact `WorkspaceApp` page-switch render block and `pathToPage` return type union
- Existing dialog button labels (`common.cancel` / `common.save`) — fall back to existing dialog patterns if these keys don't exist
- Project Tasks tab filter bar location — search needed to confirm component path

Each of those is wrapped in a "find with grep, then modify in this pattern" step rather than a fabricated path.
