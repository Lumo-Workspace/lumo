# Workspace-Wide Task Query (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend for LUM-224 Phase 1 — a workspace-wide task query (`GET /api/tasks/workspace`) that filters tasks by project / milestone / status / tag / assignee / priority, scoped to the authenticated viewer's workspace.

**Architecture:** Strict layered slice — Repository (`findByWorkspaceWithFilters`) → Service (`taskQueryService.findForWorkspace`, applies workspace scoping + shapes rows) → thin API Route (auth → parse comma-separated array params → Zod validate → call service → JSON). Plus an API-client method, an `API` constant, and a React Query key. No UI, no React hook (the hook lands in Phase 2 where a consumer makes it testable).

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma, Zod, Clerk/bearer auth via `requireIdentity`, Jest (SWC) with Prisma mocked.

**No schema change / no migration:** Phase 1 only reads existing columns and the existing `taskTags` join relation. Do not touch `prisma/`.

**Reference spec:** `docs/superpowers/specs/2026-06-04-embedded-live-task-view-design.md` (§5 Phase 1).

**Branch:** Work continues on `lumo/LUM-224-embedded-live-task-view` (already checked out).

---

## File Structure

| File                                                  | Responsibility                                                                                         | Create/Modify |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| `lib/repositories/task.repository.ts`                 | Add `WorkspaceTaskFilters` type, `WORKSPACE_TASK_QUERY_LIMIT`, and `findByWorkspaceWithFilters` method | Modify        |
| `__tests__/task.repository.workspace-filters.test.ts` | Repository where-clause coverage                                                                       | Create        |
| `lib/validation/schemas.ts`                           | Add `workspaceTaskFiltersSchema`                                                                       | Modify        |
| `__tests__/validation.workspace-task-filters.test.ts` | Schema accept/reject                                                                                   | Create        |
| `lib/services/task-query.service.ts`                  | `taskQueryService.findForWorkspace` — scope + shape                                                    | Create        |
| `__tests__/task-query.service.test.ts`                | Service passes args + shapes rows                                                                      | Create        |
| `app/api/tasks/workspace/route.ts`                    | Thin GET handler                                                                                       | Create        |
| `__tests__/api.tasks.workspace.route.test.ts`         | Route auth/parse/validate/return                                                                       | Create        |
| `app/workspace/[workspaceUrl]/constants.ts`           | Add `API.tasks.workspace`                                                                              | Modify        |
| `lib/api-client/tasks.ts`                             | Add `WorkspaceTaskFilterArgs` + `listWorkspace`                                                        | Modify        |
| `__tests__/api-client.tasks.workspace.test.ts`        | URL/query-string building                                                                              | Create        |
| `lib/query/keys.ts`                                   | Add `queryKeys.tasks.byWorkspace`                                                                      | Modify        |

**Shared identifiers (use these exact names in every task):**

- Repository type: `WorkspaceTaskFilters`
- Cap constant: `WORKSPACE_TASK_QUERY_LIMIT` (value `500`)
- Repository method: `taskRepository.findByWorkspaceWithFilters(workspaceId, filters)`
- Zod schema: `workspaceTaskFiltersSchema`
- Service: `taskQueryService.findForWorkspace(workspaceId, filters)`
- Route: `GET /api/tasks/workspace`
- API constant: `API.tasks.workspace`
- Client type: `WorkspaceTaskFilterArgs`; method: `tasksClient.listWorkspace(filters)`
- Query key: `queryKeys.tasks.byWorkspace(workspaceId, filtersKey)`

All commands below assume the repo root: `cd /Users/chaoli/Desktop/lumo/lumo` first.

---

### Task 1: Repository — `findByWorkspaceWithFilters`

**Files:**

- Modify: `lib/repositories/task.repository.ts` (add type + const near the top imports; add method inside the `export const taskRepository = { ... }` object before its closing brace)
- Test: `__tests__/task.repository.workspace-filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/task.repository.workspace-filters.test.ts`:

```typescript
import { taskRepository } from '@/lib/repositories/task.repository'

const mockTaskFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: (...args: any[]) => mockTaskFindMany(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.findByWorkspaceWithFilters', () => {
  it('scopes to the workspace via project and caps results when no filters', async () => {
    mockTaskFindMany.mockResolvedValueOnce([])

    await taskRepository.findByWorkspaceWithFilters('w1')

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project: { workspaceId: 'w1' } },
        orderBy: { order: 'asc' },
        take: 500,
      })
    )
  })

  it('applies every filter dimension', async () => {
    mockTaskFindMany.mockResolvedValueOnce([])

    await taskRepository.findByWorkspaceWithFilters('w1', {
      projectIds: ['p1'],
      milestoneIds: ['m1'],
      statuses: ['TODO', 'DONE'],
      priorities: ['HIGH'],
      assigneeActorIds: ['a1'],
      tagIds: ['t1', 't2'],
    })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          project: { workspaceId: 'w1' },
          projectId: { in: ['p1'] },
          milestoneId: { in: ['m1'] },
          status: { in: ['TODO', 'DONE'] },
          priority: { in: ['HIGH'] },
          assigneeActorId: { in: ['a1'] },
          taskTags: { some: { tagId: { in: ['t1', 't2'] } } },
        },
      })
    )
  })

  it('ignores empty-array filters', async () => {
    mockTaskFindMany.mockResolvedValueOnce([])

    await taskRepository.findByWorkspaceWithFilters('w1', {
      projectIds: [],
      statuses: [],
    })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { project: { workspaceId: 'w1' } } })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/task.repository.workspace-filters.test.ts`
Expected: FAIL — `findByWorkspaceWithFilters is not a function`.

- [ ] **Step 3: Add the type + cap constant**

In `lib/repositories/task.repository.ts`, just below the existing imports (the file imports `Prisma, TaskStatus, TaskPriority` from `@prisma/client`), add:

```typescript
export const WORKSPACE_TASK_QUERY_LIMIT = 500

export interface WorkspaceTaskFilters {
  projectIds?: string[] | undefined
  milestoneIds?: string[] | undefined
  statuses?: TaskStatus[] | undefined
  priorities?: TaskPriority[] | undefined
  assigneeActorIds?: string[] | undefined
  tagIds?: string[] | undefined
}
```

(The `| undefined` on each field is required — `exactOptionalPropertyTypes` is on in this repo.)

- [ ] **Step 4: Add the method**

Inside `export const taskRepository = { ... }`, add this method (place it next to `findByProjectWithDetails`, keep the trailing comma style of the file):

```typescript
  async findByWorkspaceWithFilters(
    workspaceId: string,
    filters: WorkspaceTaskFilters = {}
  ) {
    const where: Prisma.TaskWhereInput = {
      project: { workspaceId },
    }
    if (filters.projectIds?.length) {
      where.projectId = { in: filters.projectIds }
    }
    if (filters.milestoneIds?.length) {
      where.milestoneId = { in: filters.milestoneIds }
    }
    if (filters.statuses?.length) {
      where.status = { in: filters.statuses }
    }
    if (filters.priorities?.length) {
      where.priority = { in: filters.priorities }
    }
    if (filters.assigneeActorIds?.length) {
      where.assigneeActorId = { in: filters.assigneeActorIds }
    }
    if (filters.tagIds?.length) {
      where.taskTags = { some: { tagId: { in: filters.tagIds } } }
    }
    return prisma.task.findMany({
      where,
      include: TASK_LIST_INCLUDE,
      orderBy: { order: 'asc' },
      take: WORKSPACE_TASK_QUERY_LIMIT,
    })
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/task.repository.workspace-filters.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/task.repository.ts __tests__/task.repository.workspace-filters.test.ts
git commit -m "feat: workspace-wide task repository query with filters [LUM-224]"
```

---

### Task 2: Validation — `workspaceTaskFiltersSchema`

**Files:**

- Modify: `lib/validation/schemas.ts` (append the schema; file already imports `z` from `zod`)
- Test: `__tests__/validation.workspace-task-filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/validation.workspace-task-filters.test.ts`:

```typescript
import { workspaceTaskFiltersSchema } from '@/lib/validation/schemas'

describe('workspaceTaskFiltersSchema', () => {
  it('accepts a fully-populated filter set', () => {
    const parsed = workspaceTaskFiltersSchema.safeParse({
      projectIds: ['p1'],
      milestoneIds: ['m1'],
      statuses: ['TODO', 'IN_PROGRESS'],
      priorities: ['HIGH'],
      assigneeActorIds: ['a1'],
      tagIds: ['t1'],
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts an empty object (all filters optional)', () => {
    expect(workspaceTaskFiltersSchema.safeParse({}).success).toBe(true)
  })

  it('rejects an unknown status value', () => {
    const parsed = workspaceTaskFiltersSchema.safeParse({ statuses: ['BOGUS'] })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown priority value', () => {
    const parsed = workspaceTaskFiltersSchema.safeParse({
      priorities: ['SUPER'],
    })
    expect(parsed.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/validation.workspace-task-filters.test.ts`
Expected: FAIL — `workspaceTaskFiltersSchema` is not exported.

- [ ] **Step 3: Add the schema**

Append to `lib/validation/schemas.ts`:

```typescript
export const workspaceTaskFiltersSchema = z.object({
  projectIds: z.array(z.string()).optional(),
  milestoneIds: z.array(z.string()).optional(),
  statuses: z
    .array(z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']))
    .optional(),
  priorities: z.array(z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])).optional(),
  assigneeActorIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/validation.workspace-task-filters.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validation/schemas.ts __tests__/validation.workspace-task-filters.test.ts
git commit -m "feat: zod schema for workspace task filters [LUM-224]"
```

---

### Task 3: Service — `taskQueryService.findForWorkspace`

**Files:**

- Create: `lib/services/task-query.service.ts`
- Test: `__tests__/task-query.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/task-query.service.test.ts`:

```typescript
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findByWorkspaceWithFilters: jest.fn() },
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { taskQueryService } from '@/lib/services/task-query.service'

const mockFind = taskRepository.findByWorkspaceWithFilters as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskQueryService.findForWorkspace', () => {
  it('passes the workspaceId + filters straight to the repository', async () => {
    mockFind.mockResolvedValueOnce([])
    await taskQueryService.findForWorkspace('w1', { statuses: ['TODO'] })
    expect(mockFind).toHaveBeenCalledWith('w1', { statuses: ['TODO'] })
  })

  it('shapes rows into the list view shape', async () => {
    mockFind.mockResolvedValueOnce([
      {
        id: 't1',
        title: 'A',
        team: { identifier: 'ENG' },
        parent: null,
        _count: { children: 2 },
        children: [{ id: 'c1' }],
      },
    ])
    const result = await taskQueryService.findForWorkspace('w1', {})
    const [first] = result
    expect(first).toMatchObject({
      id: 't1',
      teamIdentifier: 'ENG',
      parent: null,
      childrenDoneCount: 1,
    })
  })

  it('flattens a parent reference', async () => {
    mockFind.mockResolvedValueOnce([
      {
        id: 't2',
        team: { identifier: 'ENG' },
        parent: {
          id: 'p',
          title: 'Parent',
          number: 7,
          team: { identifier: 'ENG' },
        },
        _count: { children: 0 },
        children: [],
      },
    ])
    const [first] = await taskQueryService.findForWorkspace('w1', {})
    expect(first?.parent).toEqual({
      id: 'p',
      title: 'Parent',
      number: 7,
      teamIdentifier: 'ENG',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/task-query.service.test.ts`
Expected: FAIL — cannot find module `@/lib/services/task-query.service`.

- [ ] **Step 3: Write the service**

Create `lib/services/task-query.service.ts`:

```typescript
import {
  taskRepository,
  type WorkspaceTaskFilters,
} from '@/lib/repositories/task.repository'

function shapeTask(t: any) {
  return {
    ...t,
    teamIdentifier: t.team?.identifier ?? '',
    parent: t.parent
      ? {
          id: t.parent.id,
          title: t.parent.title,
          number: t.parent.number,
          teamIdentifier: t.parent.team?.identifier ?? '',
        }
      : null,
    _count: t._count,
    childrenDoneCount: Array.isArray(t.children) ? t.children.length : 0,
  }
}

export const taskQueryService = {
  /**
   * Workspace-wide task query, scoped to the caller's workspace.
   * `workspaceId` comes from the authenticated identity, so the stored
   * block config can only narrow — never widen — the visible scope.
   */
  async findForWorkspace(workspaceId: string, filters: WorkspaceTaskFilters) {
    const tasks = await taskRepository.findByWorkspaceWithFilters(
      workspaceId,
      filters
    )
    return tasks.map(shapeTask)
  },
}
```

(`shapeTask` mirrors the existing per-team shaping in `app/api/teams/[teamId]/tasks/route.ts`; `t: any` matches that file's existing style.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/task-query.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-query.service.ts __tests__/task-query.service.test.ts
git commit -m "feat: task query service for workspace-scoped task lists [LUM-224]"
```

---

### Task 4: API Route — `GET /api/tasks/workspace`

**Files:**

- Create: `app/api/tasks/workspace/route.ts`
- Test: `__tests__/api.tasks.workspace.route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api.tasks.workspace.route.test.ts`:

```typescript
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/task-query.service', () => ({
  taskQueryService: { findForWorkspace: jest.fn() },
}))

import type { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskQueryService } from '@/lib/services/task-query.service'
import { GET } from '@/app/api/tasks/workspace/route'

const mockIdentity = requireIdentity as jest.Mock
const mockFind = taskQueryService.findForWorkspace as jest.Mock

function req(qs: string): NextRequest {
  return new Request(
    `http://localhost/api/tasks/workspace${qs}`
  ) as unknown as NextRequest
}

beforeEach(() => jest.clearAllMocks())

describe('GET /api/tasks/workspace', () => {
  it('returns viewer-scoped tasks with parsed filters', async () => {
    mockIdentity.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockFind.mockResolvedValueOnce([{ id: 't1' }])

    const res = await GET(req('?statuses=TODO,DONE&projectIds=p1'))
    const body = await res.json()

    expect(mockFind).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        statuses: ['TODO', 'DONE'],
        projectIds: ['p1'],
      })
    )
    expect(body).toEqual({ tasks: [{ id: 't1' }], truncated: false })
  })

  it('rejects an invalid status with 400 and never calls the service', async () => {
    mockIdentity.mockResolvedValueOnce({ workspaceId: 'w1' })

    const res = await GET(req('?statuses=BOGUS'))

    expect(res.status).toBe(400)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('passes no filters through when the query string is empty', async () => {
    mockIdentity.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockFind.mockResolvedValueOnce([])

    await GET(req(''))

    expect(mockFind).toHaveBeenCalledWith('w1', {})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api.tasks.workspace.route.test.ts`
Expected: FAIL — cannot find module `@/app/api/tasks/workspace/route`.

- [ ] **Step 3: Write the route**

Create `app/api/tasks/workspace/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskQueryService } from '@/lib/services/task-query.service'
import { workspaceTaskFiltersSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { WORKSPACE_TASK_QUERY_LIMIT } from '@/lib/repositories/task.repository'

function parseList(
  searchParams: URLSearchParams,
  key: string
): string[] | undefined {
  const raw = searchParams.get(key)
  if (!raw) return undefined
  const arr = raw.split(',').filter(Boolean)
  return arr.length ? arr : undefined
}

export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { searchParams } = new URL(request.url)
    const parsed = workspaceTaskFiltersSchema.safeParse({
      projectIds: parseList(searchParams, 'projectIds'),
      milestoneIds: parseList(searchParams, 'milestoneIds'),
      statuses: parseList(searchParams, 'statuses'),
      priorities: parseList(searchParams, 'priorities'),
      assigneeActorIds: parseList(searchParams, 'assigneeActorIds'),
      tagIds: parseList(searchParams, 'tagIds'),
    })
    if (!parsed.success) return zodError(parsed)

    const tasks = await taskQueryService.findForWorkspace(
      identity.workspaceId,
      parsed.data
    )

    return NextResponse.json({
      tasks,
      truncated: tasks.length >= WORKSPACE_TASK_QUERY_LIMIT,
    })
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

Note: when `parseList` returns `undefined`, that key is `undefined` in the object passed to `safeParse`; `z.array(...).optional()` accepts it. In the empty-query case Zod yields `{}`, so the service receives `{}` (matching the third test).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api.tasks.workspace.route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/tasks/workspace/route.ts __tests__/api.tasks.workspace.route.test.ts
git commit -m "feat: GET /api/tasks/workspace route [LUM-224]"
```

---

### Task 5: API client + constant + query key

**Files:**

- Modify: `app/workspace/[workspaceUrl]/constants.ts` (add `workspace` under `API.tasks`)
- Modify: `lib/api-client/tasks.ts` (add `WorkspaceTaskFilterArgs` + `listWorkspace`)
- Modify: `lib/query/keys.ts` (add `byWorkspace`)
- Test: `__tests__/api-client.tasks.workspace.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-client.tasks.workspace.test.ts`:

```typescript
jest.mock('@/lib/api-client/base', () => ({ apiFetch: jest.fn() }))

import { apiFetch } from '@/lib/api-client/base'
import { tasksClient } from '@/lib/api-client/tasks'

const mockFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('tasksClient.listWorkspace', () => {
  it('comma-joins array filters into the query string', () => {
    tasksClient.listWorkspace({ projectIds: ['p1', 'p2'], statuses: ['TODO'] })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/workspace?projectIds=p1%2Cp2&statuses=TODO'
    )
  })

  it('omits the query string entirely when no filters are given', () => {
    tasksClient.listWorkspace()
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/workspace')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api-client.tasks.workspace.test.ts`
Expected: FAIL — `listWorkspace` is not a function (and/or `API.tasks.workspace` undefined).

- [ ] **Step 3: Add the `API.tasks.workspace` constant**

In `app/workspace/[workspaceUrl]/constants.ts`, inside the `tasks:` object of the `API` constant (which already has `me` and `byId`), add:

```typescript
    workspace: '/api/tasks/workspace',
```

- [ ] **Step 4: Add the client type + method**

In `lib/api-client/tasks.ts`, add the type above `export const tasksClient = {` :

```typescript
export interface WorkspaceTaskFilterArgs {
  projectIds?: string[]
  milestoneIds?: string[]
  statuses?: string[]
  priorities?: string[]
  assigneeActorIds?: string[]
  tagIds?: string[]
}
```

Then add this method inside the `tasksClient` object (keep the file's comma style):

```typescript
  listWorkspace<T>(filters: WorkspaceTaskFilterArgs = {}) {
    const q = new URLSearchParams()
    if (filters.projectIds?.length)
      q.set('projectIds', filters.projectIds.join(','))
    if (filters.milestoneIds?.length)
      q.set('milestoneIds', filters.milestoneIds.join(','))
    if (filters.statuses?.length) q.set('statuses', filters.statuses.join(','))
    if (filters.priorities?.length)
      q.set('priorities', filters.priorities.join(','))
    if (filters.assigneeActorIds?.length)
      q.set('assigneeActorIds', filters.assigneeActorIds.join(','))
    if (filters.tagIds?.length) q.set('tagIds', filters.tagIds.join(','))
    const qs = q.toString()
    return apiFetch<T>(qs ? `${API.tasks.workspace}?${qs}` : API.tasks.workspace)
  },
```

(`lib/api-client/tasks.ts` already imports `apiFetch` from `./base` and `API` from `@/app/workspace/[workspaceUrl]/constants` — reuse those existing imports, do not re-add them.)

- [ ] **Step 5: Add the query key**

In `lib/query/keys.ts`, inside `queryKeys.tasks`, add (after `byProject`):

```typescript
    byWorkspace: (workspaceId: string, filtersKey: string) =>
      ['tasks', 'byWorkspace', workspaceId, filtersKey] as const,
```

(`filtersKey` is a caller-provided serialization of the active filters — Phase 2's hook will pass `JSON.stringify(config.filters)` so distinct filter sets cache separately.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest __tests__/api-client.tasks.workspace.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add app/workspace/[workspaceUrl]/constants.ts lib/api-client/tasks.ts lib/query/keys.ts __tests__/api-client.tasks.workspace.test.ts
git commit -m "feat: workspace task api-client method + query key [LUM-224]"
```

---

### Task 6: Full-suite verification (types + lint + tests)

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors. (Jest/SWC does NOT catch `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` — this step is the real gate. If `parsed.data` is not assignable to `WorkspaceTaskFilters`, recheck that every field in `WorkspaceTaskFilters` is declared `?: T | undefined`.)

- [ ] **Step 2: Run the Phase 1 tests together**

Run: `npx jest task.repository.workspace-filters validation.workspace-task-filters task-query.service api.tasks.workspace api-client.tasks.workspace`
Expected: all suites PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors. (No new UI/colors, so `lint:tokens` is unaffected; no `console.log`.)

- [ ] **Step 4: Commit any incidental fixes**

```bash
git add -A
git commit -m "chore: typecheck + lint fixes for workspace task query [LUM-224]" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (spec §5 Phase 1):**

- Repository multi-filter (project/milestone/status/tag/assignee/priority) → Task 1 ✓
- Service permission scoping (viewer's `workspaceId`, narrow-only) → Task 3 ✓
- Thin route + Zod → Task 4 ✓
- API client + query key → Task 5 ✓
- Tests per layer → Tasks 1–5 ✓
- Performance cap risk (spec §10) → `WORKSPACE_TASK_QUERY_LIMIT` + `truncated` flag (Tasks 1, 4) ✓
- React hook → intentionally deferred to Phase 2 (only testable with a consumer); noted in header.

**Deviation from spec:** route path is `/api/tasks/workspace` (mirrors existing `/api/tasks/me`, uses identity-resolved workspace) rather than `/api/workspaces/[workspaceUrl]/tasks`. No functional difference; reduces param-vs-identity mismatch.

**Type consistency:** `WorkspaceTaskFilters` (repo) ⊇ `z.infer<typeof workspaceTaskFiltersSchema>` (validation) — schema enums equal `TaskStatus`/`TaskPriority` values, so `parsed.data` is assignable. `WORKSPACE_TASK_QUERY_LIMIT` defined in repo, imported by route. `taskQueryService.findForWorkspace(workspaceId, filters)`, `API.tasks.workspace`, `tasksClient.listWorkspace`, `queryKeys.tasks.byWorkspace` used identically wherever referenced.

**No schema change:** confirmed — only reads existing columns + `taskTags` relation; `prisma/` untouched; no migration.
