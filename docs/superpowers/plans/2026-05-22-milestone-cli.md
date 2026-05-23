# Milestone CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full CRUD `milestone` commands to `lumo-cli` plus a `task list --milestone <ref>` filter, backed by one new server endpoint and one enriched response.

**Architecture:** Server adds a narrow `taskRepository.findByMilestone` method, a `milestoneService.listTasks` orchestrator, and a `GET /api/milestones/[id]/tasks` route; `GET /api/milestones/[id]` is enriched with `taskCounts`. CLI introduces two shared helpers (`cli/src/lib/resolve.ts`, `cli/src/lib/format.ts`) used by four new commands (`milestone create / show / update / delete`) and the existing `task list` (new `--milestone` flag) and `milestone list` (refactored to use the shared resolver). SKILL.md is updated last.

**Tech Stack:** TypeScript, Next.js App Router, Prisma, Jest, Commander.

**Spec:** [`docs/superpowers/specs/2026-05-22-milestone-cli-design.md`](../specs/2026-05-22-milestone-cli-design.md)

**Task:** [LUM-65](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-65) on branch `lumo/LUM-65-milestone-cli`.

---

## Task 1: Repository — `taskRepository.findByMilestone`

**Files:**

- Test: `__tests__/repositories/task-find-by-milestone.test.ts` (create)
- Modify: `lib/repositories/task.repository.ts` (add new method near `findByProjectWithDetails`)

- [ ] **Step 1.1: Write the failing test**

Create `__tests__/repositories/task-find-by-milestone.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import { taskRepository } from '@/lib/repositories/task.repository'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'

const mockFindMany = prisma.task.findMany as jest.Mock

beforeEach(() => mockFindMany.mockReset())

describe('taskRepository.findByMilestone', () => {
  it('filters by milestoneId only when no assignee is given', async () => {
    mockFindMany.mockResolvedValue([])
    await taskRepository.findByMilestone({ milestoneId: 'm-1' })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: 'm-1' },
        orderBy: { order: 'asc' },
      })
    )
  })

  it('adds assigneeActorId filter when provided', async () => {
    mockFindMany.mockResolvedValue([])
    await taskRepository.findByMilestone({
      milestoneId: 'm-1',
      assigneeActorId: 'actor-1',
    })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: 'm-1', assigneeActorId: 'actor-1' },
      })
    )
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
npx jest __tests__/repositories/task-find-by-milestone.test.ts
```

Expected: FAIL with `taskRepository.findByMilestone is not a function`.

- [ ] **Step 1.3: Add the method**

In `lib/repositories/task.repository.ts`, add after `findByProjectWithDetails` (around line 572):

```typescript
  /** Find tasks under a milestone, optionally filtered by assignee.
   * Used by GET /api/milestones/[id]/tasks (milestone show + task list --milestone).
   */
  async findByMilestone(opts: {
    milestoneId: string
    assigneeActorId?: string
  }) {
    const where: Prisma.TaskWhereInput = { milestoneId: opts.milestoneId }
    if (opts.assigneeActorId) {
      where.assigneeActorId = opts.assigneeActorId
    }
    return prisma.task.findMany({
      where,
      include: TASK_ASSIGNED_INCLUDE,
      orderBy: { order: 'asc' },
    })
  },
```

`TASK_ASSIGNED_INCLUDE` (already defined around line 271) gives us the same project + team + assignee shape `findAssignedTasks` produces, so the API response will be byte-compatible with `/api/tasks/me`.

- [ ] **Step 1.4: Run test to verify it passes**

```bash
npx jest __tests__/repositories/task-find-by-milestone.test.ts
```

Expected: PASS (both cases).

- [ ] **Step 1.5: Commit**

```bash
git add lib/repositories/task.repository.ts __tests__/repositories/task-find-by-milestone.test.ts
git commit -m "feat: taskRepository.findByMilestone [LUM-65]"
```

---

## Task 2: Service — `milestoneService.listTasks`

**Files:**

- Test: `__tests__/services/milestone-list-tasks.test.ts` (create)
- Modify: `lib/services/milestone.service.ts`

- [ ] **Step 2.1: Write the failing test**

Create `__tests__/services/milestone-list-tasks.test.ts`:

```typescript
/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findByMilestone: jest.fn() },
}))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: jest.fn() },
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { projectService } from '@/lib/services/project.service'

const findById = milestoneRepository.findById as jest.Mock
const findByMilestone = taskRepository.findByMilestone as jest.Mock
const getProject = projectService.getProject as jest.Mock

beforeEach(() => {
  findById.mockReset()
  findByMilestone.mockReset()
  getProject.mockReset()
})

describe('milestoneService.listTasks', () => {
  it('throws 404 when milestone not found', async () => {
    findById.mockResolvedValue(null)
    await expect(
      milestoneService.listTasks('m-1', 'mem-1', {})
    ).rejects.toMatchObject({ status: 404 })
  })

  it('checks project membership and returns tasks', async () => {
    findById.mockResolvedValue({ id: 'm-1', projectId: 'p-1' })
    getProject.mockResolvedValue({ id: 'p-1' })
    findByMilestone.mockResolvedValue([{ id: 't-1' }])
    const tasks = await milestoneService.listTasks('m-1', 'mem-1', {})
    expect(getProject).toHaveBeenCalledWith('p-1', 'mem-1')
    expect(findByMilestone).toHaveBeenCalledWith({ milestoneId: 'm-1' })
    expect(tasks).toEqual([{ id: 't-1' }])
  })

  it('passes assigneeActorId through when provided', async () => {
    findById.mockResolvedValue({ id: 'm-1', projectId: 'p-1' })
    getProject.mockResolvedValue({ id: 'p-1' })
    findByMilestone.mockResolvedValue([])
    await milestoneService.listTasks('m-1', 'mem-1', {
      assigneeActorId: 'actor-1',
    })
    expect(findByMilestone).toHaveBeenCalledWith({
      milestoneId: 'm-1',
      assigneeActorId: 'actor-1',
    })
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npx jest __tests__/services/milestone-list-tasks.test.ts
```

Expected: FAIL with `milestoneService.listTasks is not a function`.

- [ ] **Step 2.3: Add the method**

In `lib/services/milestone.service.ts`:

At the top of the file, add the import:

```typescript
import { taskRepository } from '@/lib/repositories/task.repository'
```

Inside the `milestoneService` object, after `deleteMilestone`, add:

```typescript
  async listTasks(
    milestoneId: string,
    memberId: string,
    opts: { assigneeActorId?: string }
  ) {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(milestone.projectId, memberId)
    return taskRepository.findByMilestone({
      milestoneId,
      ...(opts.assigneeActorId && { assigneeActorId: opts.assigneeActorId }),
    })
  },
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npx jest __tests__/services/milestone-list-tasks.test.ts
```

Expected: PASS (all three cases).

- [ ] **Step 2.5: Commit**

```bash
git add lib/services/milestone.service.ts __tests__/services/milestone-list-tasks.test.ts
git commit -m "feat: milestoneService.listTasks [LUM-65]"
```

---

## Task 3: Route — `GET /api/milestones/[id]/tasks`

**Files:**

- Test: `__tests__/api-milestones-tasks.test.ts` (create)
- Create: `app/api/milestones/[milestoneId]/tasks/route.ts`

- [ ] **Step 3.1: Write the failing test**

Create `__tests__/api-milestones-tasks.test.ts`:

```typescript
/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { listTasks: jest.fn() },
}))

import { GET } from '@/app/api/milestones/[milestoneId]/tasks/route'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { milestoneService } from '@/lib/services/milestone.service'
import { NextResponse } from 'next/server'

const mockIdentity = requireIdentity as jest.Mock
const mockActor = getHumanActorId as jest.Mock
const mockList = milestoneService.listTasks as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockActor.mockReset()
  mockList.mockReset()
})

function req(url = 'http://x/api/milestones/m-1/tasks') {
  return new Request(url) as any
}

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

describe('GET /api/milestones/[id]/tasks', () => {
  it('returns 401 when identity fails', async () => {
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'x' }, { status: 401 })
    )
    const res = await GET(req(), params)
    expect(res.status).toBe(401)
  })

  it('returns all tasks when assigned filter is absent', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockList.mockResolvedValue([{ id: 't-1' }])
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tasks: [{ id: 't-1' }] })
    expect(mockList).toHaveBeenCalledWith('m-1', 'mem-1', {})
    expect(mockActor).not.toHaveBeenCalled()
  })

  it('resolves actor id and filters when ?assigned=me', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockActor.mockResolvedValue('actor-1')
    mockList.mockResolvedValue([])
    await GET(req('http://x/api/milestones/m-1/tasks?assigned=me'), params)
    expect(mockList).toHaveBeenCalledWith('m-1', 'mem-1', {
      assigneeActorId: 'actor-1',
    })
  })

  it('returns 401 when assigned=me but member has no human actor', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockActor.mockResolvedValue(null)
    const res = await GET(
      req('http://x/api/milestones/m-1/tasks?assigned=me'),
      params
    )
    expect(res.status).toBe(401)
  })

  it('propagates service errors with status code', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockList.mockRejectedValue(
      Object.assign(new Error('Milestone not found'), { status: 404 })
    )
    const res = await GET(req(), params)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npx jest __tests__/api-milestones-tasks.test.ts
```

Expected: FAIL — module `@/app/api/milestones/[milestoneId]/tasks/route` not found.

- [ ] **Step 3.3: Create the route**

Create `app/api/milestones/[milestoneId]/tasks/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ milestoneId: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const { searchParams } = new URL(request.url)
    const assignedToMe = searchParams.get('assigned') === 'me'

    let assigneeActorId: string | undefined
    if (assignedToMe) {
      const actorId = await getHumanActorId(identity.memberId)
      if (!actorId) {
        return NextResponse.json(
          { error: 'No human actor linked to this member' },
          { status: 401 }
        )
      }
      assigneeActorId = actorId
    }

    const tasks = await milestoneService.listTasks(
      milestoneId,
      identity.memberId,
      {
        ...(assigneeActorId && { assigneeActorId }),
      }
    )

    return NextResponse.json({ tasks })
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

- [ ] **Step 3.4: Run test to verify it passes**

```bash
npx jest __tests__/api-milestones-tasks.test.ts
```

Expected: PASS (all five cases).

- [ ] **Step 3.5: Commit**

```bash
git add app/api/milestones/[milestoneId]/tasks/route.ts __tests__/api-milestones-tasks.test.ts
git commit -m "feat: GET /api/milestones/[id]/tasks [LUM-65]"
```

---

## Task 4: Enrich `GET /api/milestones/[id]` with `taskCounts`

**Files:**

- Test: `__tests__/api-milestone-get.test.ts` (create)
- Modify: `app/api/milestones/[milestoneId]/route.ts`

- [ ] **Step 4.1: Write the failing test**

Create `__tests__/api-milestone-get.test.ts`:

```typescript
/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { getMilestone: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { countTasksByStatus: jest.fn() },
}))

import { GET } from '@/app/api/milestones/[milestoneId]/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const mockIdentity = requireIdentity as jest.Mock
const mockGet = milestoneService.getMilestone as jest.Mock
const mockCount = milestoneRepository.countTasksByStatus as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  mockGet.mockReset()
  mockCount.mockReset()
})

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

describe('GET /api/milestones/[id]', () => {
  it('returns milestone enriched with taskCounts', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    mockGet.mockResolvedValue({ id: 'm-1', name: 'Q3', status: 'ACTIVE' })
    mockCount.mockResolvedValue({
      TODO: 1,
      IN_PROGRESS: 2,
      IN_REVIEW: 0,
      DONE: 3,
    })
    const res = await GET(new Request('http://x/m') as any, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone).toMatchObject({
      id: 'm-1',
      taskCounts: { TODO: 1, IN_PROGRESS: 2, IN_REVIEW: 0, DONE: 3 },
    })
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npx jest __tests__/api-milestone-get.test.ts
```

Expected: FAIL — `taskCounts` is `undefined` in the response.

- [ ] **Step 4.3: Modify the route**

In `app/api/milestones/[milestoneId]/route.ts`, replace the `GET` handler with:

```typescript
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const milestone = await milestoneService.getMilestone(
      milestoneId,
      identity.memberId
    )
    const taskCounts = await milestoneRepository.countTasksByStatus(milestoneId)
    return NextResponse.json({ milestone: { ...milestone, taskCounts } })
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

If `milestoneRepository` is not already imported, add the import at the top.

- [ ] **Step 4.4: Run test to verify it passes**

```bash
npx jest __tests__/api-milestone-get.test.ts
```

Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add app/api/milestones/[milestoneId]/route.ts __tests__/api-milestone-get.test.ts
git commit -m "feat: include taskCounts on GET /api/milestones/[id] [LUM-65]"
```

---

## Task 5: Extract `formatTaskListTable` to `cli/src/lib/format.ts`

**Files:**

- Create: `cli/src/lib/format.ts`
- Modify: `cli/src/commands/task-list.ts`
- Test (existing): `__tests__/cli/...` — any existing `formatTaskListTable` import should still pass

- [ ] **Step 5.1: Inspect current `formatTaskListTable` shape**

Open `cli/src/commands/task-list.ts`. Confirm:

- `TaskRow` type (lines 13–21)
- `formatTaskListTable` function (lines 41–66)

Both will move into `cli/src/lib/format.ts` together.

- [ ] **Step 5.2: Create the shared module**

Create `cli/src/lib/format.ts`:

```typescript
export interface TaskRow {
  id: string
  number: number
  title: string
  status: string
  priority: string
  teamIdentifier: string
  project: { id: string; name: string }
}

/**
 * Render a task list as a fixed-width table. Each row:
 *   LUM-42  IN_PROGRESS  HIGH    project-name   Title here
 * Columns are right-padded to the widest cell in the result set so output
 * lines up regardless of identifier or project-name length.
 */
export function formatTaskListTable(tasks: TaskRow[]): string {
  if (tasks.length === 0) return 'No tasks.'
  const rows = tasks.map(t => ({
    identifier: `${t.teamIdentifier}-${t.number}`,
    status: t.status,
    priority: t.priority,
    project: t.project.name,
    title: t.title,
  }))
  const widths = {
    identifier: Math.max(...rows.map(r => r.identifier.length)),
    status: Math.max(...rows.map(r => r.status.length)),
    priority: Math.max(...rows.map(r => r.priority.length)),
    project: Math.max(...rows.map(r => r.project.length)),
  }
  return rows
    .map(
      r =>
        `${r.identifier.padEnd(widths.identifier)}  ` +
        `${r.status.padEnd(widths.status)}  ` +
        `${r.priority.padEnd(widths.priority)}  ` +
        `${r.project.padEnd(widths.project)}  ` +
        r.title
    )
    .join('\n')
}
```

- [ ] **Step 5.3: Update `task-list.ts` to re-export**

In `cli/src/commands/task-list.ts`:

- Delete the inline `interface TaskRow` (lines 13–21)
- Delete the inline `formatTaskListTable` definition (lines 41–66)
- At the top, after existing imports, add:

```typescript
import { formatTaskListTable, type TaskRow } from '../lib/format'

export { formatTaskListTable } from '../lib/format'
export type { TaskRow } from '../lib/format'
```

The re-exports keep existing imports (`@/cli/src/commands/task-list`) working.

- [ ] **Step 5.4: Run existing CLI tests to verify nothing regressed**

```bash
npx jest __tests__/cli/
```

Expected: PASS (every existing test).

- [ ] **Step 5.5: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5.6: Commit**

```bash
git add cli/src/lib/format.ts cli/src/commands/task-list.ts
git commit -m "refactor: hoist formatTaskListTable to cli/src/lib/format [LUM-65]"
```

---

## Task 6: Shared resolver — `cli/src/lib/resolve.ts`

**Files:**

- Test: `__tests__/cli/resolve.test.ts` (create)
- Create: `cli/src/lib/resolve.ts`

- [ ] **Step 6.1: Write the failing test**

Create `__tests__/cli/resolve.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import {
  isUuid,
  resolveProjectId,
  resolveMilestoneId,
} from '@/cli/src/lib/resolve'

const mockFetch = jest.fn()
beforeEach(() => {
  ;(global as any).fetch = mockFetch
  mockFetch.mockReset()
})

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('isUuid', () => {
  it('returns true for canonical UUIDs', () => {
    expect(isUuid('11111111-2222-3333-4444-555555555555')).toBe(true)
  })
  it('returns false for non-UUIDs', () => {
    expect(isUuid('Q3 Launch')).toBe(false)
    expect(isUuid('lumo')).toBe(false)
  })
})

describe('resolveProjectId', () => {
  it('auto-selects the only project when ref is undefined', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }],
      })
    )
    const id = await resolveProjectId('http://x', 'tok', undefined)
    expect(id).toBe('p-1')
  })

  it('throws when multiple projects exist and ref is undefined', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        projects: [
          { id: 'p-1', name: 'Lumo', isIdea: false },
          { id: 'p-2', name: 'Other', isIdea: false },
        ],
      })
    )
    await expect(
      resolveProjectId('http://x', 'tok', undefined)
    ).rejects.toThrow(/multiple projects/)
  })

  it('matches by slug case-insensitively', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        projects: [
          { id: 'p-1', name: 'My Cool Project', isIdea: false },
          { id: 'p-2', name: 'Other', isIdea: false },
        ],
      })
    )
    const id = await resolveProjectId('http://x', 'tok', 'my-cool-project')
    expect(id).toBe('p-1')
  })

  it('throws when ref does not match any project', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }] })
    )
    await expect(
      resolveProjectId('http://x', 'tok', 'missing')
    ).rejects.toThrow(/not found/)
  })
})

describe('resolveMilestoneId', () => {
  it('returns the identifier directly when it is a UUID', async () => {
    const result = await resolveMilestoneId(
      'http://x',
      'tok',
      '11111111-2222-3333-4444-555555555555',
      undefined
    )
    expect(result.id).toBe('11111111-2222-3333-4444-555555555555')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('resolves a name within an auto-selected single project', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          milestones: [
            { id: 'm-1', name: 'Q3 Launch', status: 'ACTIVE' },
            { id: 'm-2', name: 'Q4 Plan', status: 'PLANNED' },
          ],
        })
      )
    const result = await resolveMilestoneId(
      'http://x',
      'tok',
      'q3 launch',
      undefined
    )
    expect(result).toEqual({
      id: 'm-1',
      name: 'Q3 Launch',
      projectId: 'p-1',
    })
  })

  it('throws when name is not found in the resolved project', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ milestones: [] }))
    await expect(
      resolveMilestoneId('http://x', 'tok', 'missing', undefined)
    ).rejects.toThrow(/no milestone matches/)
  })
})
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
npx jest __tests__/cli/resolve.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Create the helper**

Create `cli/src/lib/resolve.ts`:

```typescript
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

interface ProjectRow {
  id: string
  name: string
  isIdea?: boolean
}

interface MilestoneRow {
  id: string
  name: string
  status: string
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function fetchJson<T>(
  base: string,
  token: string,
  path: string
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    throw new Error('API key invalid or revoked. Run `lumo auth login`.')
  }
  if (!res.ok) {
    throw new Error(`Request failed (HTTP ${res.status}): ${path}`)
  }
  return (await res.json()) as T
}

/**
 * Resolve `--project <ref>` to a project id.
 * - `ref` undefined and workspace has 1 visible project → auto-select
 * - `ref` undefined and workspace has >1 visible project → throw
 * - `ref` set → match by name or slug, case-insensitive
 */
export async function resolveProjectId(
  base: string,
  token: string,
  ref: string | undefined
): Promise<string> {
  const { projects } = await fetchJson<{ projects: ProjectRow[] }>(
    base,
    token,
    '/api/projects'
  )
  const visible = projects.filter(p => !p.isIdea)

  if (!ref) {
    if (visible.length === 0) throw new Error('workspace has no projects yet.')
    if (visible.length === 1) return visible[0]!.id
    throw new Error('workspace has multiple projects; pass --project <slug>.')
  }

  const needle = ref.trim().toLowerCase()
  const match = visible.find(
    p => p.name.toLowerCase() === needle || slugify(p.name) === needle
  )
  if (!match) {
    throw new Error(`project "${ref}" not found. Try \`lumo project list\`.`)
  }
  return match.id
}

/**
 * Resolve a milestone `<identifier>`:
 * - If it's a UUID, return as-is (project not fetched).
 * - Otherwise, resolve the project (via `--project <ref>` or auto-select),
 *   list its milestones, and match by name case-insensitively.
 */
export async function resolveMilestoneId(
  base: string,
  token: string,
  identifier: string,
  projectRef: string | undefined
): Promise<{ id: string; name: string; projectId: string }> {
  if (isUuid(identifier)) {
    // Caller will fetch /api/milestones/<id> to learn the projectId & name.
    return { id: identifier, name: '', projectId: '' }
  }

  const projectId = await resolveProjectId(base, token, projectRef)
  const { milestones } = await fetchJson<{ milestones: MilestoneRow[] }>(
    base,
    token,
    `/api/projects/${projectId}/milestones`
  )
  const needle = identifier.trim().toLowerCase()
  const match = milestones.find(m => m.name.toLowerCase() === needle)
  if (!match) {
    throw new Error(
      `no milestone matches "${identifier}" in this project. Try \`lumo milestone list\`.`
    )
  }
  return { id: match.id, name: match.name, projectId }
}
```

- [ ] **Step 6.4: Run test to verify it passes**

```bash
npx jest __tests__/cli/resolve.test.ts
```

Expected: PASS (all cases).

- [ ] **Step 6.5: Commit**

```bash
git add cli/src/lib/resolve.ts __tests__/cli/resolve.test.ts
git commit -m "feat: shared CLI project + milestone resolver [LUM-65]"
```

---

## Task 7: Refactor `milestone-list.ts` to use the shared resolver

**Files:**

- Modify: `cli/src/commands/milestone-list.ts`

- [ ] **Step 7.1: Replace the project resolution block**

In `cli/src/commands/milestone-list.ts`:

- Add import at the top:

```typescript
import { resolveProjectId } from '../lib/resolve'
```

- Delete the local `slugify` function (lines 56–62 in current file)
- Delete the local `ProjectRow` and `ProjectsResponse` interfaces (lines 16–24)
- Replace the project-resolution block (lines 76–123, from the `let projectsRes: Response` declaration to `}` after the multi-project error) with:

```typescript
let projectId: string
try {
  projectId = await resolveProjectId(base, creds.token, options.project)
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`Error: ${msg}`)
  return 1
}
```

The remaining `fetch` to `/api/projects/<projectId>/milestones` and `formatMilestoneList` block stays unchanged.

- [ ] **Step 7.2: Run existing tests**

```bash
npx jest __tests__/cli/
```

Expected: PASS (no regression — `formatMilestoneList` is still exported with the same signature).

- [ ] **Step 7.3: Smoke-test by hand**

```bash
cd cli && npm run build && cd ..
lumo milestone list
```

Expected: same output as before (or `No milestones.` if none exist).

- [ ] **Step 7.4: Commit**

```bash
git add cli/src/commands/milestone-list.ts
git commit -m "refactor: milestone list uses shared resolveProjectId [LUM-65]"
```

---

## Task 8: `lumo milestone create <name>`

**Files:**

- Test: `__tests__/cli/milestone-create-format.test.ts` (create)
- Create: `cli/src/commands/milestone-create.ts`
- Modify: `cli/src/index.ts` (register command — done in Task 13)

- [ ] **Step 8.1: Write the failing test for payload building**

Create `__tests__/cli/milestone-create-format.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import {
  buildCreatePayload,
  formatCreatedMilestoneLine,
} from '@/cli/src/commands/milestone-create'

describe('buildCreatePayload', () => {
  it('keeps only provided optional fields', () => {
    expect(buildCreatePayload('Q3 Launch', {})).toEqual({ name: 'Q3 Launch' })
  })

  it('forwards description and dates as ISO date strings', () => {
    expect(
      buildCreatePayload('Q3 Launch', {
        description: 'rollout',
        start: '2026-06-01',
        target: '2026-08-31',
      })
    ).toEqual({
      name: 'Q3 Launch',
      description: 'rollout',
      startDate: '2026-06-01',
      targetDate: '2026-08-31',
    })
  })
})

describe('formatCreatedMilestoneLine', () => {
  it('renders id + name', () => {
    expect(formatCreatedMilestoneLine({ id: 'm-1', name: 'Q3 Launch' })).toBe(
      'Created milestone "Q3 Launch"  m-1'
    )
  })
})
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
npx jest __tests__/cli/milestone-create-format.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement the command**

Create `cli/src/commands/milestone-create.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'

export interface CreateMilestoneOptions {
  project?: string
  description?: string
  start?: string
  target?: string
}

interface CreatePayload {
  name: string
  description?: string
  startDate?: string
  targetDate?: string
}

export function buildCreatePayload(
  name: string,
  opts: CreateMilestoneOptions
): CreatePayload {
  const payload: CreatePayload = { name }
  if (opts.description !== undefined) payload.description = opts.description
  if (opts.start !== undefined) payload.startDate = opts.start
  if (opts.target !== undefined) payload.targetDate = opts.target
  return payload
}

export function formatCreatedMilestoneLine(milestone: {
  id: string
  name: string
}): string {
  return `Created milestone "${milestone.name}"  ${milestone.id}`
}

export async function milestoneCreate(
  name: string,
  opts: CreateMilestoneOptions
): Promise<number | void> {
  if (!name || !name.trim()) {
    console.error('Error: milestone name is required')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  try {
    projectId = await resolveProjectId(base, creds.token, opts.project)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const payload = buildCreatePayload(name.trim(), opts)
  const res = await fetch(`${base}/api/projects/${projectId}/milestones`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`Error: milestone create failed (HTTP ${res.status}) ${body}`)
    return 1
  }

  const { milestone } = (await res.json()) as {
    milestone: { id: string; name: string }
  }
  process.stdout.write(formatCreatedMilestoneLine(milestone) + '\n')
}
```

- [ ] **Step 8.4: Run test to verify it passes**

```bash
npx jest __tests__/cli/milestone-create-format.test.ts
```

Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add cli/src/commands/milestone-create.ts __tests__/cli/milestone-create-format.test.ts
git commit -m "feat: lumo milestone create [LUM-65]"
```

---

## Task 9: `lumo milestone show <identifier>`

**Files:**

- Test: `__tests__/cli/milestone-show-format.test.ts` (create)
- Create: `cli/src/commands/milestone-show.ts`

- [ ] **Step 9.1: Write the failing test for output formatting**

Create `__tests__/cli/milestone-show-format.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import { formatMilestoneShow } from '@/cli/src/commands/milestone-show'
import type { TaskRow } from '@/cli/src/lib/format'

const milestone = {
  id: 'm-1',
  name: 'Q3 Launch',
  status: 'ACTIVE',
  startDate: '2026-06-01T00:00:00.000Z',
  targetDate: '2026-08-31T00:00:00.000Z',
  description: 'Ship the launch.',
  projectName: 'Lumo',
  taskCounts: { TODO: 1, IN_PROGRESS: 2, IN_REVIEW: 0, DONE: 3 },
}

const task: TaskRow = {
  id: 't-1',
  number: 42,
  title: 'Fix Slack OAuth redirect',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  teamIdentifier: 'LUM',
  project: { id: 'p-1', name: 'Lumo' },
}

describe('formatMilestoneShow', () => {
  it('renders milestone header + counts + task table', () => {
    const out = formatMilestoneShow(milestone, [task])
    expect(out).toContain('Milestone:    Q3 Launch')
    expect(out).toContain('Status:       ACTIVE')
    expect(out).toContain('Start:        2026-06-01')
    expect(out).toContain('Target:       2026-08-31')
    expect(out).toContain('Project:      Lumo')
    expect(out).toContain('Ship the launch.')
    expect(out).toContain(
      'Tasks:        6 total (TODO 1 / IN_PROGRESS 2 / IN_REVIEW 0 / DONE 3)'
    )
    expect(out).toContain('LUM-42  IN_PROGRESS')
  })

  it('renders "-" for missing description and dates', () => {
    const out = formatMilestoneShow(
      { ...milestone, description: null, startDate: null, targetDate: null },
      []
    )
    expect(out).toContain('Start:        -')
    expect(out).toContain('Target:       -')
    expect(out).toMatch(/Description:\n  -/)
  })

  it('omits the task table when there are zero tasks', () => {
    const out = formatMilestoneShow(
      {
        ...milestone,
        taskCounts: { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 },
      },
      []
    )
    expect(out).toContain('Tasks:        0 total')
    expect(out).not.toContain('LUM-')
  })
})
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
npx jest __tests__/cli/milestone-show-format.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement the command**

Create `cli/src/commands/milestone-show.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { formatTaskListTable, type TaskRow } from '../lib/format'

export interface ShowMilestoneOptions {
  project?: string
}

export interface MilestoneShowData {
  id: string
  name: string
  status: string
  startDate: string | null
  targetDate: string | null
  description: string | null
  projectName: string
  taskCounts: {
    TODO: number
    IN_PROGRESS: number
    IN_REVIEW: number
    DONE: number
  }
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '-'
}

export function formatMilestoneShow(
  m: MilestoneShowData,
  tasks: TaskRow[]
): string {
  const total =
    m.taskCounts.TODO +
    m.taskCounts.IN_PROGRESS +
    m.taskCounts.IN_REVIEW +
    m.taskCounts.DONE
  const lines = [
    `Milestone:    ${m.name}`,
    `Status:       ${m.status}`,
    `Start:        ${fmtDate(m.startDate)}`,
    `Target:       ${fmtDate(m.targetDate)}`,
    `Project:      ${m.projectName}`,
    `Description:`,
    `  ${m.description && m.description.length > 0 ? m.description : '-'}`,
    ``,
    `Tasks:        ${total} total (TODO ${m.taskCounts.TODO} / IN_PROGRESS ${m.taskCounts.IN_PROGRESS} / IN_REVIEW ${m.taskCounts.IN_REVIEW} / DONE ${m.taskCounts.DONE})`,
  ]
  if (tasks.length > 0) {
    lines.push('', formatTaskListTable(tasks))
  }
  return lines.join('\n')
}

export async function milestoneShow(
  identifier: string,
  opts: ShowMilestoneOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
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

  // Fetch the milestone (with taskCounts) and the task list in parallel.
  const [milestoneRes, tasksRes] = await Promise.all([
    fetch(`${base}/api/milestones/${milestoneId}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    }),
    fetch(`${base}/api/milestones/${milestoneId}/tasks`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    }),
  ])

  if (!milestoneRes.ok) {
    console.error(`Error: milestone show failed (HTTP ${milestoneRes.status})`)
    return 1
  }
  if (!tasksRes.ok) {
    console.error(`Error: milestone tasks failed (HTTP ${tasksRes.status})`)
    return 1
  }

  const { milestone } = (await milestoneRes.json()) as {
    milestone: {
      id: string
      name: string
      status: string
      startDate: string | null
      targetDate: string | null
      description: string | null
      projectId: string
      taskCounts: MilestoneShowData['taskCounts']
    }
  }
  const { tasks } = (await tasksRes.json()) as { tasks: TaskRow[] }

  // Look up project display name. If the caller passed `--project <ref>`
  // we already know it; otherwise hit /api/projects once.
  let projectName = opts.project ?? ''
  if (!projectName) {
    const pr = await fetch(`${base}/api/projects`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (pr.ok) {
      const { projects } = (await pr.json()) as {
        projects: { id: string; name: string }[]
      }
      projectName = projects.find(p => p.id === milestone.projectId)?.name ?? ''
    }
  }

  process.stdout.write(
    formatMilestoneShow(
      {
        id: milestone.id,
        name: milestone.name,
        status: milestone.status,
        startDate: milestone.startDate,
        targetDate: milestone.targetDate,
        description: milestone.description,
        projectName,
        taskCounts: milestone.taskCounts,
      },
      tasks
    ) + '\n'
  )
}
```

- [ ] **Step 9.4: Run test to verify it passes**

```bash
npx jest __tests__/cli/milestone-show-format.test.ts
```

Expected: PASS (all three cases).

- [ ] **Step 9.5: Commit**

```bash
git add cli/src/commands/milestone-show.ts __tests__/cli/milestone-show-format.test.ts
git commit -m "feat: lumo milestone show [LUM-65]"
```

---

## Task 10: `lumo milestone update <identifier>`

**Files:**

- Test: `__tests__/cli/milestone-update-format.test.ts` (create)
- Create: `cli/src/commands/milestone-update.ts`

- [ ] **Step 10.1: Write the failing test**

Create `__tests__/cli/milestone-update-format.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import {
  buildMilestoneUpdatePayload,
  formatMilestoneUpdateSummary,
  normalizeMilestoneStatus,
} from '@/cli/src/commands/milestone-update'

describe('normalizeMilestoneStatus', () => {
  it('uppercases canonical values', () => {
    expect(normalizeMilestoneStatus('planned')).toBe('PLANNED')
    expect(normalizeMilestoneStatus('active')).toBe('ACTIVE')
    expect(normalizeMilestoneStatus('COMPLETED')).toBe('COMPLETED')
    expect(normalizeMilestoneStatus('cancelled')).toBe('CANCELLED')
  })

  it('returns null for unknown values', () => {
    expect(normalizeMilestoneStatus('done')).toBeNull()
    expect(normalizeMilestoneStatus('')).toBeNull()
  })
})

describe('buildMilestoneUpdatePayload', () => {
  it('returns empty when nothing is set', () => {
    const { payload, flagsGiven } = buildMilestoneUpdatePayload({})
    expect(payload).toEqual({})
    expect(flagsGiven).toEqual([])
  })

  it('maps name, description, status, start, target', () => {
    const { payload, flagsGiven } = buildMilestoneUpdatePayload({
      name: 'Q3 v2',
      description: 'updated',
      status: 'ACTIVE',
      start: '2026-06-01',
      target: '2026-08-31',
    })
    expect(payload).toEqual({
      name: 'Q3 v2',
      description: 'updated',
      status: 'ACTIVE',
      startDate: '2026-06-01',
      targetDate: '2026-08-31',
    })
    expect(flagsGiven).toEqual([
      '--name',
      '--description',
      '--status',
      '--start',
      '--target',
    ])
  })

  it('treats empty string as clear for nullable fields', () => {
    const { payload } = buildMilestoneUpdatePayload({
      description: '',
      start: '',
      target: '',
    })
    expect(payload).toEqual({
      description: null,
      startDate: null,
      targetDate: null,
    })
  })
})

describe('formatMilestoneUpdateSummary', () => {
  it('lists changed fields in flag order', () => {
    const line = formatMilestoneUpdateSummary(
      { name: 'Q3 Launch', status: 'PLANNED', targetDate: null },
      { status: 'ACTIVE', targetDate: '2026-08-31' }
    )
    expect(line).toBe(
      'Updated milestone "Q3 Launch": status PLANNED → ACTIVE, target → 2026-08-31'
    )
  })
})
```

- [ ] **Step 10.2: Run test to verify it fails**

```bash
npx jest __tests__/cli/milestone-update-format.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 10.3: Implement the command**

Create `cli/src/commands/milestone-update.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'

const ALLOWED_STATUSES = [
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
] as const
type Status = (typeof ALLOWED_STATUSES)[number]

export interface UpdateMilestoneOptions {
  project?: string
  name?: string
  description?: string
  status?: string
  start?: string
  target?: string
}

interface UpdatePayload {
  name?: string
  description?: string | null
  status?: Status
  startDate?: string | null
  targetDate?: string | null
}

export function normalizeMilestoneStatus(value: string): Status | null {
  if (!value) return null
  const upper = value.toUpperCase().replace(/-/g, '_')
  return (ALLOWED_STATUSES as readonly string[]).includes(upper)
    ? (upper as Status)
    : null
}

export function buildMilestoneUpdatePayload(opts: UpdateMilestoneOptions): {
  payload: UpdatePayload
  flagsGiven: string[]
} {
  const payload: UpdatePayload = {}
  const flagsGiven: string[] = []
  if (opts.name !== undefined) {
    payload.name = opts.name
    flagsGiven.push('--name')
  }
  if (opts.description !== undefined) {
    payload.description = opts.description === '' ? null : opts.description
    flagsGiven.push('--description')
  }
  if (opts.status !== undefined) {
    payload.status = opts.status as Status
    flagsGiven.push('--status')
  }
  if (opts.start !== undefined) {
    payload.startDate = opts.start === '' ? null : opts.start
    flagsGiven.push('--start')
  }
  if (opts.target !== undefined) {
    payload.targetDate = opts.target === '' ? null : opts.target
    flagsGiven.push('--target')
  }
  return { payload, flagsGiven }
}

interface MilestoneSnapshot {
  name: string
  description?: string | null
  status?: string
  startDate?: string | null
  targetDate?: string | null
}

function fmtDate(v: string | null | undefined): string {
  if (v === null) return '∅'
  if (v === undefined) return '-'
  return v.slice(0, 10)
}

export function formatMilestoneUpdateSummary(
  before: MilestoneSnapshot,
  after: UpdatePayload
): string {
  const changes: string[] = []
  if (after.name !== undefined && after.name !== before.name) {
    changes.push(`name "${before.name}" → "${after.name}"`)
  }
  if (after.description !== undefined) {
    changes.push(
      after.description === null ? 'description → ∅' : 'description updated'
    )
  }
  if (after.status !== undefined && after.status !== before.status) {
    changes.push(`status ${before.status} → ${after.status}`)
  }
  if (after.startDate !== undefined) {
    changes.push(`start → ${fmtDate(after.startDate)}`)
  }
  if (after.targetDate !== undefined) {
    changes.push(`target → ${fmtDate(after.targetDate)}`)
  }
  return `Updated milestone "${before.name}": ${changes.join(', ')}`
}

export async function milestoneUpdate(
  identifier: string,
  opts: UpdateMilestoneOptions
): Promise<number | void> {
  // Validate status flag eagerly.
  let normalizedStatus: Status | undefined
  if (opts.status !== undefined) {
    const n = normalizeMilestoneStatus(opts.status)
    if (!n) {
      console.error(
        `Error: invalid status "${opts.status}". Allowed: planned, active, completed, cancelled`
      )
      return 1
    }
    normalizedStatus = n
  }

  const { payload, flagsGiven } = buildMilestoneUpdatePayload({
    ...opts,
    ...(normalizedStatus !== undefined && { status: normalizedStatus }),
  })
  if (flagsGiven.length === 0) {
    console.error(
      'Error: provide at least one field to update (--name, --description, --status, --start, --target)'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
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

  // Fetch current values so we can render a delta summary.
  const beforeRes = await fetch(`${base}/api/milestones/${milestoneId}`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!beforeRes.ok) {
    console.error(`Error: milestone fetch failed (HTTP ${beforeRes.status})`)
    return 1
  }
  const { milestone: before } = (await beforeRes.json()) as {
    milestone: MilestoneSnapshot & { name: string }
  }

  const res = await fetch(`${base}/api/milestones/${milestoneId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(`Error: milestone update failed (HTTP ${res.status}) ${body}`)
    return 1
  }

  process.stdout.write(formatMilestoneUpdateSummary(before, payload) + '\n')
}
```

- [ ] **Step 10.4: Run test to verify it passes**

```bash
npx jest __tests__/cli/milestone-update-format.test.ts
```

Expected: PASS (all cases).

- [ ] **Step 10.5: Commit**

```bash
git add cli/src/commands/milestone-update.ts __tests__/cli/milestone-update-format.test.ts
git commit -m "feat: lumo milestone update [LUM-65]"
```

---

## Task 11: `lumo milestone delete <identifier>`

**Files:**

- Test: `__tests__/cli/milestone-delete-guard.test.ts` (create)
- Create: `cli/src/commands/milestone-delete.ts`

- [ ] **Step 11.1: Write the failing test for the --yes guard**

Create `__tests__/cli/milestone-delete-guard.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import { formatDeleteRefusal } from '@/cli/src/commands/milestone-delete'

describe('formatDeleteRefusal', () => {
  it('lists task impact for safety', () => {
    expect(formatDeleteRefusal('Q3 Launch', 12)).toBe(
      'Refusing to delete milestone "Q3 Launch" without --yes.\n' +
        '12 tasks under it will keep their data; only milestoneId is cleared.\n' +
        'Re-run with --yes to confirm.'
    )
  })

  it('omits the "tasks" line when count is zero', () => {
    expect(formatDeleteRefusal('Empty', 0)).toBe(
      'Refusing to delete milestone "Empty" without --yes.\n' +
        'Re-run with --yes to confirm.'
    )
  })
})
```

- [ ] **Step 11.2: Run test to verify it fails**

```bash
npx jest __tests__/cli/milestone-delete-guard.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 11.3: Implement the command**

Create `cli/src/commands/milestone-delete.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'

export interface DeleteMilestoneOptions {
  project?: string
  yes?: boolean
}

export function formatDeleteRefusal(name: string, taskCount: number): string {
  const head = `Refusing to delete milestone "${name}" without --yes.`
  const tail = `Re-run with --yes to confirm.`
  if (taskCount === 0) return `${head}\n${tail}`
  return `${head}\n${taskCount} tasks under it will keep their data; only milestoneId is cleared.\n${tail}`
}

interface TaskCounts {
  TODO: number
  IN_PROGRESS: number
  IN_REVIEW: number
  DONE: number
}

function totalTasks(counts: TaskCounts): number {
  return counts.TODO + counts.IN_PROGRESS + counts.IN_REVIEW + counts.DONE
}

export async function milestoneDelete(
  identifier: string,
  opts: DeleteMilestoneOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  let milestoneId: string
  let resolvedName: string
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
    milestoneId = resolved.id
    resolvedName = resolved.name
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Always fetch the milestone first — we need name + taskCounts for the
  // refusal message, and the same data confirms the milestone exists.
  const showRes = await fetch(`${base}/api/milestones/${milestoneId}`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!showRes.ok) {
    console.error(`Error: milestone fetch failed (HTTP ${showRes.status})`)
    return 1
  }
  const { milestone } = (await showRes.json()) as {
    milestone: { name: string; taskCounts: TaskCounts }
  }
  const name = resolvedName || milestone.name
  const total = totalTasks(milestone.taskCounts)

  if (!opts.yes) {
    console.error(formatDeleteRefusal(name, total))
    return 1
  }

  const res = await fetch(`${base}/api/milestones/${milestoneId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${creds.token}` },
  })
  if (!res.ok) {
    console.error(`Error: milestone delete failed (HTTP ${res.status})`)
    return 1
  }
  process.stdout.write(`Deleted milestone "${name}"\n`)
}
```

- [ ] **Step 11.4: Run test to verify it passes**

```bash
npx jest __tests__/cli/milestone-delete-guard.test.ts
```

Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
git add cli/src/commands/milestone-delete.ts __tests__/cli/milestone-delete-guard.test.ts
git commit -m "feat: lumo milestone delete with --yes guard [LUM-65]"
```

---

## Task 12: `lumo task list --milestone <ref>`

**Files:**

- Test: `__tests__/cli/task-list-milestone-flag.test.ts` (create)
- Modify: `cli/src/commands/task-list.ts`

- [ ] **Step 12.1: Write the failing test**

Create `__tests__/cli/task-list-milestone-flag.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import { resolveTaskListEndpoint } from '@/cli/src/commands/task-list'

describe('resolveTaskListEndpoint', () => {
  it('returns /api/tasks/me when no milestone is set', () => {
    expect(resolveTaskListEndpoint('http://x', undefined)).toBe(
      'http://x/api/tasks/me'
    )
  })

  it('returns the milestone-scoped endpoint with assigned=me when milestone is set', () => {
    expect(resolveTaskListEndpoint('http://x', 'm-1')).toBe(
      'http://x/api/milestones/m-1/tasks?assigned=me'
    )
  })
})
```

- [ ] **Step 12.2: Run test to verify it fails**

```bash
npx jest __tests__/cli/task-list-milestone-flag.test.ts
```

Expected: FAIL — `resolveTaskListEndpoint` is not exported.

- [ ] **Step 12.3: Update `task-list.ts`**

In `cli/src/commands/task-list.ts`:

- Extend the options interface:

```typescript
export interface ListTaskOptions {
  status?: string
  project?: string
  limit?: string
  milestone?: string
}
```

- Add `import { resolveMilestoneId } from '../lib/resolve'` after the existing imports.

- Add this helper near the top, exported:

```typescript
export function resolveTaskListEndpoint(
  base: string,
  milestoneId: string | undefined
): string {
  if (!milestoneId) return `${base}/api/tasks/me`
  return `${base}/api/milestones/${milestoneId}/tasks?assigned=me`
}
```

- Replace the existing block that begins with `const envUrl = process.env.LUMO_API_URL?.trim()` and ends with `const url = \`${trimTrailingSlash(apiUrl)}/api/tasks/me\``(a few lines above`let res: Response`) with:

```typescript
const envUrl = process.env.LUMO_API_URL?.trim()
const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
const base = trimTrailingSlash(apiUrl)

let milestoneId: string | undefined
if (opts.milestone !== undefined) {
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      opts.milestone,
      opts.project
    )
    milestoneId = resolved.id
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

const url = resolveTaskListEndpoint(base, milestoneId)
```

The existing `let res: Response` and downstream filter/render code stays unchanged.

- [ ] **Step 12.4: Run test to verify it passes**

```bash
npx jest __tests__/cli/task-list-milestone-flag.test.ts
```

Expected: PASS.

- [ ] **Step 12.5: Run the full CLI test suite**

```bash
npx jest __tests__/cli/
```

Expected: PASS (no regression).

- [ ] **Step 12.6: Commit**

```bash
git add cli/src/commands/task-list.ts __tests__/cli/task-list-milestone-flag.test.ts
git commit -m "feat: task list --milestone filter [LUM-65]"
```

---

## Task 13: Register new commands in `cli/src/index.ts`

**Files:**

- Modify: `cli/src/index.ts`

- [ ] **Step 13.1: Add imports**

In `cli/src/index.ts`, after the existing `import { milestoneList } from './commands/milestone-list'` line, add:

```typescript
import { milestoneCreate } from './commands/milestone-create'
import { milestoneShow } from './commands/milestone-show'
import { milestoneUpdate } from './commands/milestone-update'
import { milestoneDelete } from './commands/milestone-delete'
```

- [ ] **Step 13.2: Add the `--milestone` flag to `task list`**

Find the `task.command('list')` block (around line 112). After the `--limit` option, add:

```typescript
  .option(
    '-m, --milestone <ref>',
    'Filter by milestone name or UUID (scopes to my tasks under that milestone)'
  )
```

Update the description on the same block from `'List tasks assigned to you. Filter with --status, --project, --limit.'` to `'List tasks assigned to you. Filter with --status, --project, --milestone, --limit.'`.

- [ ] **Step 13.3: Register milestone subcommands**

After the existing `milestoneCmd.command('list')` block (ends around line 182), append:

```typescript
milestoneCmd
  .command('create <name>')
  .description(
    'Create a milestone. --project required when workspace has >1 project.'
  )
  .option('--project <ref>', 'Project name or slug')
  .option('-d, --description <text>', 'Milestone description')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--target <date>', 'Target date (YYYY-MM-DD)')
  .action(
    wrap((name, options) =>
      milestoneCreate(name as string, options as Record<string, string>)
    )
  )

milestoneCmd
  .command('show <identifier>')
  .description(
    'Show a milestone: status, dates, description, task counts, and tasks under it. Identifier accepts UUID or name.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .action(
    wrap((identifier, options) =>
      milestoneShow(identifier as string, options as Record<string, string>)
    )
  )

milestoneCmd
  .command('update <identifier>')
  .description(
    'Update a milestone. Provide at least one of --name, --description, --status, --start, --target. Use "" to clear nullable fields.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .option('-n, --name <text>', 'New name')
  .option('-d, --description <text>', 'New description (empty string to clear)')
  .option(
    '-s, --status <value>',
    'New status: planned | active | completed | cancelled'
  )
  .option('--start <date>', 'Start date YYYY-MM-DD (empty string to clear)')
  .option('--target <date>', 'Target date YYYY-MM-DD (empty string to clear)')
  .action(
    wrap((identifier, options) =>
      milestoneUpdate(identifier as string, options as Record<string, string>)
    )
  )

milestoneCmd
  .command('delete <identifier>')
  .description(
    'Delete a milestone. Tasks under it keep their data (milestoneId is cleared). Requires --yes.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .option('--yes', 'Required: confirm deletion without TTY prompt')
  .action(
    wrap((identifier, options) =>
      milestoneDelete(
        identifier as string,
        options as { project?: string; yes?: boolean }
      )
    )
  )
```

- [ ] **Step 13.4: Build the CLI**

```bash
cd cli && npm run build && cd ..
```

Expected: clean build, no TS errors.

- [ ] **Step 13.5: Smoke-test each new command**

```bash
lumo milestone --help
lumo milestone create --help
lumo milestone show --help
lumo milestone update --help
lumo milestone delete --help
lumo task list --help
```

Expected: each subcommand listed under `milestone`, `task list` shows `--milestone` flag.

- [ ] **Step 13.6: End-to-end smoke (against your dev DB or staging)**

```bash
lumo milestone create "CLI smoke test" --description "test"
lumo milestone list
lumo milestone show "CLI smoke test"
lumo milestone update "CLI smoke test" --status active
lumo task list --milestone "CLI smoke test"
lumo milestone delete "CLI smoke test"            # expect refusal
lumo milestone delete "CLI smoke test" --yes      # expect delete
```

Expected: each step prints the documented stdout / stderr lines and exits 0 (refusal exits 1).

- [ ] **Step 13.7: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat: register milestone create/show/update/delete commands [LUM-65]"
```

---

## Task 14: Update `.claude/skills/lumo/SKILL.md`

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 14.1: Update frontmatter triggers**

Open `.claude/skills/lumo/SKILL.md`. In the frontmatter `description:` field, append triggers (comma-separated, both English and Chinese forms) to the existing list:

```
create milestone, new milestone, update milestone, change milestone status, delete milestone, show milestone, view milestone, tasks in milestone, milestone tasks, 新建里程碑, 更新里程碑, 删除里程碑, 查看里程碑
```

- [ ] **Step 14.2: Remove the "milestones are web-UI only" caveat**

In the "Out of scope" subsection under `### lumo task update`, delete the paragraph that begins:

> Milestone updates (`--milestone`) work, but creating / editing / deleting milestones themselves is web-UI only ...

Replace it with:

> Milestone updates (`--milestone`) work, and full milestone CRUD is available via `lumo milestone create / show / update / delete` (see below).

- [ ] **Step 14.3: Document the new commands**

After the existing `### lumo milestone list` subsection, insert four new subsections — copy the structure of the existing `lumo task create / show / update / comment` blocks. Use the same flag tables and example invocations defined in Tasks 8–11 above.

Concretely, add (in this order):

```markdown
### `lumo milestone create <name>` — create a milestone

| Flag                   | Type   | Notes                                   |
| ---------------------- | ------ | --------------------------------------- |
| `--project <ref>`      | string | Required when workspace has >1 project. |
| `-d, --description <>` | string | Optional.                               |
| `--start <date>`       | string | YYYY-MM-DD.                             |
| `--target <date>`      | string | YYYY-MM-DD.                             |

Examples:

\`\`\`bash
lumo milestone create "Q3 Launch"
lumo milestone create "Q3 Launch" --start 2026-06-01 --target 2026-08-31
\`\`\`

On success: `Created milestone "Q3 Launch"  <id>`.

### `lumo milestone show <identifier>` — show milestone detail + tasks

Accepts UUID or name. With a name, `--project <ref>` is required when the workspace has >1 project.

Prints a key:value header (name, status, dates, project, description), task counts, and the full task table under the milestone.

\`\`\`bash
lumo milestone show "Q3 Launch"
lumo milestone show 11111111-2222-3333-4444-555555555555
\`\`\`

### `lumo milestone update <identifier>` — patch a milestone

| Flag                   | Type   | Notes                                                            |
| ---------------------- | ------ | ---------------------------------------------------------------- | ------ | --------- | ----------- |
| `--project <ref>`      | string | Required when identifier is a name and workspace has >1 project. |
| `-n, --name <text>`    | string | Cannot be empty.                                                 |
| `-d, --description <>` | string | `--description ""` clears.                                       |
| `-s, --status <value>` | enum   | `planned                                                         | active | completed | cancelled`. |
| `--start <date>`       | string | `--start ""` clears.                                             |
| `--target <date>`      | string | `--target ""` clears.                                            |

At least one field required.

\`\`\`bash
lumo milestone update "Q3 Launch" --status active
lumo milestone update "Q3 Launch" --target 2026-09-15
lumo milestone update "Q3 Launch" --description ""
\`\`\`

### `lumo milestone delete <identifier>` — delete a milestone

Requires `--yes`. No interactive prompt — CLI is agent-friendly. Tasks under the milestone keep their data; their `milestoneId` is cleared.

\`\`\`bash
lumo milestone delete "Q3 Launch" --yes
\`\`\`
```

- [ ] **Step 14.4: Document `--milestone` on `task list`**

In the existing `### lumo task list` subsection, add a row to the flag table:

```markdown
| `-m, --milestone <ref>` | string | Filter to my tasks under this milestone (name or UUID). |
```

And add a note: "When `--milestone` is set, the CLI calls `GET /api/milestones/<id>/tasks?assigned=me` instead of `/api/tasks/me`, and other filters (`--status`, `--limit`) still apply client-side."

- [ ] **Step 14.5: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: sync SKILL.md with milestone CLI commands [LUM-65]"
```

---

## Task 15: Verification before claiming completion

**Files:** none — verification only

- [ ] **Step 15.1: Run the full test suite**

```bash
npx jest
```

Expected: 0 failures.

- [ ] **Step 15.2: Typecheck the main app**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 15.3: Build the CLI**

```bash
cd cli && npm run build && cd ..
```

Expected: clean.

- [ ] **Step 15.4: Lint**

```bash
npm run lint
```

Expected: 0 errors. Warnings are OK if the codebase already has some.

- [ ] **Step 15.5: Final manual smoke**

Repeat the smoke commands from Task 13.6 against your dev DB to confirm end-to-end.

- [ ] **Step 15.6: PR description**

When opening the PR for `lumo/LUM-65-milestone-cli`, include in the body:

```
Closes [LUM-65](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-65).

Changes:
- Server: new GET /api/milestones/[id]/tasks; taskCounts on GET /api/milestones/[id]
- CLI: milestone create / show / update / delete; task list --milestone <ref>
- Docs: SKILL.md synced

No new dependencies. No database migration.
```

PR title: `feat: lumo milestone CLI CRUD + task list --milestone [LUM-65]`.

---

## Acceptance Criteria

- [ ] `lumo milestone create`, `show`, `update`, `delete` all run end-to-end against staging without errors
- [ ] `lumo task list --milestone <ref>` returns only the caller's tasks under that milestone
- [ ] `lumo milestone delete` without `--yes` refuses with the documented message and exits 1
- [ ] `GET /api/milestones/[id]` response includes `taskCounts`
- [ ] `GET /api/milestones/[id]/tasks?assigned=me` returns only caller-owned tasks
- [ ] All new functions covered by at least one unit test
- [ ] `npx jest`, `npx tsc --noEmit`, `npm run lint`, `cli && npm run build` all clean
- [ ] `.claude/skills/lumo/SKILL.md` reflects the new commands and triggers
